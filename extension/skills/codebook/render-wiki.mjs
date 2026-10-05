import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, posix, relative, sep } from 'node:path';
import { escapeHtml, renderWikiDiagrams } from './render-wiki-diagrams.mjs';

const READER_VERSION = 2;
const MAX_PAGES = 256;
const MAX_SOURCE_QUOTE_LINES = 40;
/** Keeps generated files and source references within relative repository paths. @example safePath('../outside') // false */
const safePath = value => typeof value === 'string' && value !== '' && !isAbsolute(value) && !/[\\\x00-\x1f?#:]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');

/** Checks agent-authored reader data before {@link renderWikiPages} creates any page. @example validatePages({ readerVersion: 2, pages }) */
function validatePages(manifest) {
  if (manifest.readerVersion !== READER_VERSION) throw new Error('This Wiki stage needs readerVersion: 2 and semantic diagram records. Read the installed Codebook skill before publishing.');
  if (!Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.length > MAX_PAGES) throw new Error('The Wiki needs 1–256 semantic pages.');
  const paths = new Set();
  for (const page of manifest.pages) {
    if (!page || !safePath(page.path) || !page.path.endsWith('.html') || paths.has(page.path)) throw new Error('Wiki page paths must be distinct relative HTML paths.');
    paths.add(page.path);
    if (typeof page.title !== 'string' || !page.title.trim() || typeof page.section !== 'string' || !page.section.trim() || typeof page.contentHtml !== 'string' || !page.contentHtml.trim()) throw new Error(`Wiki page ${page.path} needs title, section and contentHtml.`);
    // Catch accidental old-page reuse; authored article HTML is not an untrusted-HTML sanitization API.
    if (/<\/?(?:html|head|body|main|article|form|script|style|iframe|object|embed|base|meta|link|title|h1)\b/i.test(page.contentHtml)) throw new Error(`Wiki page ${page.path} must contain article sections, not a document, form or script.`);
    if (/<\/?svg\b/i.test(page.contentHtml)) throw new Error(`Wiki page ${page.path} must use diagram records and figure slots instead of authored SVG.`);
    if (!Array.isArray(page.sources) || !page.sources.length || !Array.isArray(page.outline)) throw new Error(`Wiki page ${page.path} needs source references and an outline.`);
    const anchors = new Set();
    for (const entry of page.outline) {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(entry.id) || anchors.has(entry.id) || typeof entry.label !== 'string' || !entry.label.trim() || !new RegExp(`\\bid\\s*=\\s*["']${entry.id}["']`).test(page.contentHtml)) throw new Error(`Wiki page ${page.path} has an invalid or missing outline anchor.`);
      anchors.add(entry.id);
    }
  }
  if (!paths.has('index.html')) throw new Error('The Wiki needs an index.html overview.');
  for (const page of manifest.pages) {
    const visited = new Set([page.path]);
    let parent = page.parent;
    while (parent !== undefined) {
      const ancestor = manifest.pages.find(candidate => candidate.path === parent);
      if (!ancestor || visited.has(parent) || ancestor.section !== page.section) throw new Error(`Wiki page ${page.path} has a missing, cyclic or cross-section parent.`);
      visited.add(parent); parent = ancestor.parent;
    }
  }
}

/** Renders shared offline pages for {@link publishWiki}; the agent still authors every article and diagram. @example await renderWikiPages(manifest, { projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function renderWikiPages(manifest, { projectRoot, outputDirectory }) {
  validatePages(manifest);
  if (!Array.isArray(manifest.includedSources)) throw new Error('The Wiki needs an included-source index.');
  const indexedSources = new Map();
  for (const source of manifest.includedSources) {
    if (!source || !safePath(source.path) || !/^[a-f0-9]{64}$/.test(source.sha256) || indexedSources.has(source.path)) throw new Error('The Wiki source index has an invalid path, hash or duplicate.');
    indexedSources.set(source.path, source);
  }
  const template = await readFile(new URL('./reader-shell.html', import.meta.url), 'utf8');
  const sourceLines = new Map(), pages = new Map();
  /** The editor address of one cited line; {@link sourceLink} wraps it in a citation's anchor, and the rail's entry ({@link openSourceEntry}) opens a page's first one. @example sourceAddress({ path: 'src/a.ts', sha256 }, 1) // => 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Fa.ts&line=1&sha256=…' */
  const sourceAddress = (source, line) => `vscode://laststance.codebook/source?${new URLSearchParams({ root: projectRoot, path: source.path, line: String(line), sha256: source.sha256 })}`;
  /** The rail's entry that opens a page's first cited source: one link with the approved label and, under it, the file and line it opens, so the text and the accessible name say where it leads. A `<wbr>` after each slash lets a long path wrap there. The Codebook reader names the serving editor in the label. @example openSourceEntry({ path: 'src/utils/a.ts', sha256 }, 12) // => '<p class="open-in-editor"><a href="vscode://…"><span class="open-label">Open in VS Code</span> <span class="open-target">src/<wbr>utils/<wbr>a.ts:12</span></a></p>' */
  const openSourceEntry = (source, line) => `<p class="open-in-editor"><a href="${escapeHtml(sourceAddress(source, line))}"><span class="open-label">Open in VS Code</span> <span class="open-target">${escapeHtml(source.path).replaceAll('/', '/<wbr>')}:${line}</span></a></p>`;
  /** Resolves page and graph citations through the same current-source boundary. @example await sourceLink({ path: 'src/a.ts', line: 1 }) */
  const sourceLink = async (reference, exactQuote = false) => {
    const source = reference && indexedSources.get(reference.path);
    if (!source || !Number.isSafeInteger(reference.line) || reference.line < 1 || reference.label !== undefined && typeof reference.label !== 'string') throw new Error('Wiki references an unindexed source or invalid line.');
    if (!sourceLines.has(source.path)) {
      const file = await realpath(join(projectRoot, source.path)), withinRoot = relative(projectRoot, file);
      if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) throw new Error('A Wiki source reference resolves outside its repository.');
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Wiki source changed: ${source.path}. Refresh its content and citations.`);
      sourceLines.set(source.path, bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n'));
    }
    const lines = sourceLines.get(source.path), endLine = exactQuote ? reference.endLine : reference.line;
    if (!Number.isSafeInteger(endLine) || endLine < reference.line || endLine > lines.length) throw new Error(`Wiki source line is out of range: ${source.path}:${reference.line}.`);
    // A matching file hash cannot rescue a quote attached to the wrong line range.
    if (exactQuote && (endLine - reference.line >= MAX_SOURCE_QUOTE_LINES || typeof reference.quote !== 'string' || !reference.quote.trim() || lines.slice(reference.line - 1, endLine).join('\n').trim() !== reference.quote.replace(/\r\n/g, '\n').trim())) throw new Error(`Diagram source quote does not match ${source.path}:${reference.line}-${endLine}. Cite at most ${MAX_SOURCE_QUOTE_LINES} exact lines.`);
    const location = `${source.path}:${reference.line}${endLine === reference.line ? '' : `–${endLine}`}`;
    return `<a href="${escapeHtml(sourceAddress(source, reference.line))}">${escapeHtml(reference.label ?? location)}</a>`;
  };
  for (const page of manifest.pages) {
    const sourceLinks = [];
    for (const reference of page.sources) sourceLinks.push(`<li>${await sourceLink(reference)}</li>`);
    const article = await renderWikiDiagrams(page, sourceLink);
    // The rail opens the page's first cited source through that citation's own address; every page has one, and the links above have checked it.
    const firstSource = page.sources[0];
    const pageHref = target => escapeHtml(posix.relative(posix.dirname(page.path), target));
    const navigationList = (section, parent) => `<ul>${manifest.pages.filter(candidate => candidate.section === section && candidate.parent === parent).map(candidate => `<li><a href="${pageHref(candidate.path)}"${candidate.path === page.path ? ' aria-current="page"' : ''}>${escapeHtml(candidate.title)}</a>${manifest.pages.some(child => child.parent === candidate.path) ? navigationList(section, candidate.path) : ''}</li>`).join('')}</ul>`;
    const navigation = [...new Set(manifest.pages.map(candidate => candidate.section))].map(section => `<div class="chapter-group"><p class="group-label">${escapeHtml(section)}</p>${navigationList(section, undefined)}</div>`).join('');
    const revision = manifest.generated?.revision ?? 'Unknown';
    const values = {
      TITLE: escapeHtml(page.title), REPOSITORY: escapeHtml(basename(projectRoot)), NAVIGATION: navigation,
      ARTICLE: article, SOURCES: sourceLinks.join(''),
      OUTLINE: page.outline.map(entry => `<li><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</a></li>`).join(''),
      REVISION: escapeHtml(String(revision).slice(0, 8)), DATE: escapeHtml(String(manifest.generated?.at ?? 'Unknown').slice(0, 10)),
      INDEX_TIME: escapeHtml(manifest.generated?.at ?? 'Unknown'), SOURCE_COUNT: String(indexedSources.size),
      EXCLUSIONS: escapeHtml(Array.isArray(manifest.excludedPaths) ? manifest.excludedPaths.join(', ') : 'Not recorded'),
      ROOT: escapeHtml(projectRoot), OUTPUT: escapeHtml(outputDirectory), FULL_REVISION: escapeHtml(revision),
      OUTPUT_LABEL: outputDirectory === join(projectRoot, '.codebook/wiki') ? 'Project folder' : 'Configured folder',
      UPDATE: escapeHtml(`vscode://laststance.codebook/update?${new URLSearchParams({ root: projectRoot })}`),
      SETTINGS: escapeHtml(`vscode://laststance.codebook/settings?${new URLSearchParams({ root: projectRoot })}`),
      OPEN_SOURCE: openSourceEntry(indexedSources.get(firstSource.path), firstSource.line),
    };
    pages.set(page.path, template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown reader template field: ${key}`);
      return values[key];
    }));
  }
  return pages;
}
