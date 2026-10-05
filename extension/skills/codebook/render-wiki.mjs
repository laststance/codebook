import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, posix, relative, sep } from 'node:path';
import { escapeHtml, renderWikiDiagrams } from './render-wiki-diagrams.mjs';

const READER_VERSION = 2;
const MAX_PAGES = 256;
const MAX_SOURCE_QUOTE_LINES = 40;
/** The ids the reader's own page scripts give an element of a served page, beside the ids the shell's template carries: the target of the rail's entry (the publisher prints it; the reader adds it to a site published without one), the region of the update status, and the heading and the tooltip of the keyboard help. A page's own content must not carry one of them a second time, so {@link contentIdRenames} gives such a content id another name. */
const READER_ELEMENT_IDS = ['codebook-open-target', 'codebook-update-status', 'shortcut-title', 'shortcut-tooltip'];
/** The attributes of authored HTML whose value is an id or a list of ids of the same page: the element's own `id` and the attributes that refer to elements by id; {@link withRenamedContentIds} renames an id in each of them. */
const ID_ATTRIBUTES = new Set(['id', 'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns', 'for', 'headers', 'list']);
/** One start tag of authored HTML; a quoted attribute value may hold a `>`. Text and an escaped code example hold no `<` before a letter, so they are never read as a tag. */
const START_TAG = /<[A-Za-z][^<>"']*(?:(?:"[^"]*"|'[^']*')[^<>"']*)*>/g;
/** One attribute with a value inside a start tag: the space before it, its name, its equals sign, and its value in double quotes, in single quotes or bare. */
const ATTRIBUTE = /(\s)([^\s"'<>/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
/** The quote an attribute's value stands in, by which of the two quoted forms {@link ATTRIBUTE} matched; none for a bare value. Called by {@link withAttributeValues}. @example quoteOf(undefined, 'a') // => "'" */
const quoteOf = (double, single) => double !== undefined ? '"' : single !== undefined ? "'" : '';
/** Rewrites attribute values in the start tags of authored HTML and leaves its text alone, so an id a code example only mentions is not touched; called by {@link contentIdsOf} and {@link withRenamedContentIds}. `rewrite` gets the attribute's name in lower case and its value and returns the value to print. @example withAttributeValues('<h2 id="a">id="a"</h2>', (name, value) => name === 'id' ? 'b' : value) // => '<h2 id="b">id="a"</h2>' */
const withAttributeValues = (html, rewrite) => html.replace(START_TAG, tag => tag.replace(ATTRIBUTE, (attribute, space, name, equals, double, single, bare) => {
  const value = double ?? single ?? bare, rewritten = rewrite(name.toLowerCase(), value);
  // An unchanged attribute keeps its exact text; a changed one keeps its own quotes.
  if (rewritten === value) return attribute;
  const quote = quoteOf(double, single);
  return `${space}${name}${equals}${quote}${rewritten}${quote}`;
}));
/** Lists the ids the elements of authored HTML carry; called by {@link contentIdRenames}. @example contentIdsOf('<h2 id="flow">Flow</h2><p id="note">…</p>') // => Set { 'flow', 'note' } */
const contentIdsOf = html => {
  const ids = new Set();
  withAttributeValues(html, (name, value) => { if (name === 'id') ids.add(value); return value; });
  return ids;
};
/** Chooses another id for every id of a page's content that the reader uses itself: `page-` and the id, with a number where the page carries that one too. Called by {@link renderWikiPages} once per page, so the published page holds each id of the reader once and the agent's page data stay as authored. @example contentIdRenames('<h2 id="qa-form">The form</h2>', new Set(['qa-form'])) // => Map { 'qa-form' => 'page-qa-form' } */
const contentIdRenames = (contentHtml, readerIds) => {
  const contentIds = contentIdsOf(contentHtml), taken = new Set([...contentIds, ...readerIds]), renames = new Map();
  for (const id of contentIds) {
    if (!readerIds.has(id)) continue;
    let renamed = `page-${id}`;
    for (let count = 2; taken.has(renamed); count += 1) renamed = `page-${id}-${count}`;
    taken.add(renamed); renames.set(id, renamed);
  }
  return renames;
};
/** Reads the path a link names as an author writes it into an address: percent-encoded; a text that is no valid encoding is taken as written. Called by {@link withRenamedContentIds}. @example writtenPath('my%20page.html') // => 'my page.html' */
const writtenPath = path => { try { return decodeURIComponent(path); } catch { return path; } };
/** Prints a page's content with every renamed id under its new name: on its element, in the id lists of this page, in a link of this page to it and in a link to a renamed id of another page of the Wiki. Called by {@link renderWikiPages} for each page with the renames of all pages. @example withRenamedContentIds({ path: 'index.html', contentHtml: '<h2 id="qa-form">The form</h2><a href="#qa-form">up</a>' }, new Map([['index.html', new Map([['qa-form', 'page-qa-form']])]])) // => '<h2 id="page-qa-form">The form</h2><a href="#page-qa-form">up</a>' */
const withRenamedContentIds = (page, renamesByPage) => {
  const ownRenames = renamesByPage.get(page.path);
  /** The page of the Wiki a link's path names from this page; this page for a link that is a fragment alone. */
  const linkedPage = path => path === '' ? page.path : posix.normalize(posix.join(posix.dirname(page.path), writtenPath(path)));
  /** A link's address with its fragment renamed, when the address names this page or another page of the Wiki and that page renamed the fragment's id. */
  const renamedLink = address => {
    const fragmentStart = address.indexOf('#');
    if (fragmentStart === -1) return address;
    const path = address.slice(0, fragmentStart), renamed = renamesByPage.get(linkedPage(path))?.get(address.slice(fragmentStart + 1));
    return renamed === undefined ? address : `${path}#${renamed}`;
  };
  /** An id, or a list of ids with its spaces kept, with each renamed id of this page under its new name. */
  const renamedIds = ids => ids.split(/(\s+)/).map(part => ownRenames.get(part) ?? part).join('');
  return withAttributeValues(page.contentHtml, (name, value) => name === 'href' ? renamedLink(value) : ID_ATTRIBUTES.has(name) ? renamedIds(value) : value);
};
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
  // The reader finds its own elements by id (the form, the question field, the answer, the theme button, the entry's target, the status region), so an id of the shell or of its page scripts on an element of a page's content would stand twice in the served page. Such a content id is renamed on its page and in every link to it; nothing changes in the agent's page data.
  const readerIds = new Set([...[...template.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]), ...READER_ELEMENT_IDS]);
  const renamesByPage = new Map(manifest.pages.map(page => [page.path, contentIdRenames(page.contentHtml, readerIds)]));
  /** The editor address of one cited line; {@link sourceLink} wraps it in a citation's anchor, and the rail's entry ({@link openSourceEntry}) opens a page's first one. @example sourceAddress({ path: 'src/a.ts', sha256 }, 1) // => 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Fa.ts&line=1&sha256=…' */
  const sourceAddress = (source, line) => `vscode://laststance.codebook/source?${new URLSearchParams({ root: projectRoot, path: source.path, line: String(line), sha256: source.sha256 })}`;
  /** The rail's entry that opens a page's first cited source: a link that holds the approved label alone, exactly as 0.2.29.0 published it, so every reader since can name its own editor in it, and beside the link the file and line it opens, which describe the link (`aria-describedby`). A `<wbr>` after each slash and before the colon lets a long path wrap there and keeps the line number whole. A page has one entry, so the target's id is fixed. @example openSourceEntry({ path: 'src/utils/a.ts', sha256 }, 12) // => '<p class="open-in-editor"><a href="vscode://…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" id="codebook-open-target">src/<wbr>utils/<wbr>a.ts<wbr>:12</span></p>' */
  const openSourceEntry = (source, line) => `<p class="open-in-editor"><a href="${escapeHtml(sourceAddress(source, line))}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" id="codebook-open-target">${escapeHtml(source.path).replaceAll('/', '/<wbr>')}<wbr>:${line}</span></p>`;
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
    const article = await renderWikiDiagrams({ ...page, contentHtml: withRenamedContentIds(page, renamesByPage) }, sourceLink);
    // The rail opens the page's first cited source through that citation's own address; every page has one, and the links above have checked it.
    const firstSource = page.sources[0];
    const pageHref = target => escapeHtml(posix.relative(posix.dirname(page.path), target));
    const navigationList = (section, parent) => `<ul>${manifest.pages.filter(candidate => candidate.section === section && candidate.parent === parent).map(candidate => `<li><a href="${pageHref(candidate.path)}"${candidate.path === page.path ? ' aria-current="page"' : ''}>${escapeHtml(candidate.title)}</a>${manifest.pages.some(child => child.parent === candidate.path) ? navigationList(section, candidate.path) : ''}</li>`).join('')}</ul>`;
    const navigation = [...new Set(manifest.pages.map(candidate => candidate.section))].map(section => `<div class="chapter-group"><p class="group-label">${escapeHtml(section)}</p>${navigationList(section, undefined)}</div>`).join('');
    const revision = manifest.generated?.revision ?? 'Unknown';
    const values = {
      TITLE: escapeHtml(page.title), REPOSITORY: escapeHtml(basename(projectRoot)), NAVIGATION: navigation,
      ARTICLE: article, SOURCES: sourceLinks.join(''),
      OUTLINE: page.outline.map(entry => `<li><a href="#${escapeHtml(renamesByPage.get(page.path).get(entry.id) ?? entry.id)}">${escapeHtml(entry.label)}</a></li>`).join(''),
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
