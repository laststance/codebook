import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, posix, relative, sep } from 'node:path';
import { contentIdsOf, escapeHtml, hasEndlessComment, renderWikiDiagrams, unbalancedClauseOf, unreadMarkupOf, withAttributeValues } from './render-wiki-diagrams.mjs';

const READER_VERSION = 2;
const MAX_PAGES = 256;
const MAX_SOURCE_QUOTE_LINES = 40;
/** The ids the reader's own page scripts give an element of a served page, beside the ids the shell's template carries: the description of the rail entry's link, its file and line as written (the publisher prints it; the reader adds it to a site published without one), the region of the update status, and the heading and the tooltip of the keyboard help. A page's own content must not carry one of them a second time, so {@link contentIdRenames} gives such a content id another name. */
const READER_ELEMENT_IDS = ['codebook-open-target', 'codebook-update-status', 'shortcut-title', 'shortcut-tooltip'];
/** The attributes of authored HTML whose value is an id or a list of ids of the same page: the element's own `id` and the attributes that refer to elements by id; {@link withRenamedContentIds} renames an id in each of them. */
const ID_ATTRIBUTES = new Set(['id', 'anchor', 'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns', 'commandfor', 'for', 'form', 'headers', 'itemref', 'list', 'popovertarget']);
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
/** Reads a part of an address as an author writes it: percent-encoded; a text that is no valid encoding is taken as written. Called by {@link withRenamedContentIds} for the path and for the fragment of a link. @example writtenPart('my%20page.html') // => 'my page.html' */
const writtenPart = part => { try { return decodeURIComponent(part); } catch { return part; } };
/** An address that names its own place: one with a scheme, or one that starts at the root of its site. Where the root of a served or an opened Wiki lies is not the publisher's to know, so {@link withRenamedContentIds} leaves such a link alone. */
const ABSOLUTE_ADDRESS = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/)/;
/** Prints a page's content with every renamed id under its new name: on its element, in the id lists of this page, in a link of this page to it and in a link to a renamed id of another page of the Wiki. A link is read as a browser reads it: the fragment after the first `#`, percent-decoded; the path before a query. Called by {@link renderWikiPages} for each page with the renames of all pages. @example withRenamedContentIds({ path: 'index.html', contentHtml: '<h2 id="qa-form">The form</h2><a href="#qa-form">up</a>' }, new Map([['index.html', new Map([['qa-form', 'page-qa-form']])]])) // => '<h2 id="page-qa-form">The form</h2><a href="#page-qa-form">up</a>' */
const withRenamedContentIds = (page, renamesByPage) => {
  const ownRenames = renamesByPage.get(page.path);
  /** The page of the Wiki the part of a link before its fragment names from this page; this page for a link without a path. A query is no part of the path. */
  const linkedPage = beforeFragment => {
    const [path] = beforeFragment.split('?');
    return path === '' ? page.path : posix.normalize(posix.join(posix.dirname(page.path), writtenPart(path)));
  };
  /** Whether a link can lead to an id of a page of this Wiki: it has a fragment and is written relative to its page. */
  const isLinkToAnId = address => address.includes('#') && !ABSOLUTE_ADDRESS.test(address);
  /** A link's address with its fragment renamed, when the address names this page or another page of the Wiki and that page renamed the fragment's id. */
  const renamedLink = address => {
    if (!isLinkToAnId(address)) return address;
    const fragmentStart = address.indexOf('#'), beforeFragment = address.slice(0, fragmentStart);
    const renamed = renamesByPage.get(linkedPage(beforeFragment))?.get(writtenPart(address.slice(fragmentStart + 1)));
    return renamed === undefined ? address : `${beforeFragment}#${renamed}`;
  };
  /** An id, or a list of ids with its spaces kept, with each renamed id of this page under its new name. */
  const renamedIds = ids => ids.split(/([\t\n\f\r ]+)/).map(part => ownRenames.get(part) ?? part).join('');
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
    // The content is read as raw text on purpose, here and for authored SVG: a comment or an attribute value that only shows one of these tags is refused too (escaped text, `&lt;form&gt;`, is not). Read so, the check can only refuse too much; one that skipped comments would miss an element wherever it took a place for a comment that a browser does not.
    // A name is matched whole: a custom element whose name starts with one of them and a hyphen (`<link-card>`) is another element.
    // With them are refused the elements whose content a browser reads as text (`textarea`, `xmp`, `noembed`, `noframes`, `plaintext`, and `noscript` on a page that runs a script, as the reader's does), keeps out of the document (`template`), parses by rules of its own (`select`) or drops (`frame`, `frameset`): an article needs none of them, the publisher would read tags and ids in their content that a browser does not, and one that is never closed takes the reader's own form, rail and script with it.
    // The refusal names the first such element it found, so the agent can search a long page for it, also inside a comment or an attribute value.
    const unwanted = /<\/?(html|head|body|main|article|form|script|style|iframe|object|embed|base|meta|link|title|h1|textarea|xmp|noembed|noframes|plaintext|noscript|template|select|frame|frameset)(?![\w-])/i.exec(page.contentHtml);
    if (unwanted) throw new Error(`Wiki page ${page.path} must contain article sections, not a document, form or script: it holds <${unwanted[1].toLowerCase()}>.`);
    if (/<\/?svg(?![\w-])/i.test(page.contentHtml)) throw new Error(`Wiki page ${page.path} must use diagram records and figure slots instead of authored SVG.`);
    // A browser reads everything after a comment that never ends as comment: the rest of the article and, after it, the reader's question form, rail and script.
    if (hasEndlessComment(page.contentHtml)) throw new Error(`Wiki page ${page.path} has a comment that never ends; close it with -->.`);
    // A page is published only when every `<` of its content begins something the publisher reads exactly as a browser does; otherwise the two would not agree on the page's tags and ids, and markup that never ends would take the reader's own controls with it.
    const unread = unreadMarkupOf(page.contentHtml);
    if (unread !== undefined) throw new Error(`Wiki page ${page.path} has markup the publisher cannot read exactly as a browser does; write a < of the text as &lt;, close every tag and every quotation mark, quote an attribute value, name an attribute once and write an id as plain text, with & as &amp;; it starts: ${unread}`);
    // The content is one balanced piece of the page: what it opens it closes, so nothing of it reaches the reader's own form, rail and layout around it.
    const unbalanced = unbalancedClauseOf(page.contentHtml);
    if (unbalanced !== undefined) throw new Error(`Wiki page ${page.path} ${unbalanced}`);
    if (!Array.isArray(page.sources) || !page.sources.length || !Array.isArray(page.outline)) throw new Error(`Wiki page ${page.path} needs source references and an outline.`);
    // An outline entry names an anchor of its page: an id an element of the content really carries, not one a code example or a comment only shows.
    const anchors = new Set(), contentIds = contentIdsOf(page.contentHtml);
    for (const entry of page.outline) {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z][\w-]*$/.test(entry.id) || anchors.has(entry.id) || typeof entry.label !== 'string' || !entry.label.trim() || !contentIds.has(entry.id)) throw new Error(`Wiki page ${page.path} has an invalid or missing outline anchor.`);
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
  // The reader finds its own elements by id (the form, the question field, the answer, the theme button, the description of the entry's link, the status region), so an id of the shell or of its page scripts on an element of a page's content would stand twice in the served page. Such a content id is renamed on its page and in every link to it; nothing changes in the agent's page data.
  const readerIds = new Set([...[...template.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]), ...READER_ELEMENT_IDS]);
  const renamesByPage = new Map(manifest.pages.map(page => [page.path, contentIdRenames(page.contentHtml, readerIds)]));
  /** The editor address of one cited line; {@link sourceLink} wraps it in a citation's anchor, and the rail's entry ({@link openSourceEntry}) opens a page's first one. @example sourceAddress({ path: 'src/a.ts', sha256 }, 1) // => 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Fa.ts&line=1&sha256=…' */
  const sourceAddress = (source, line) => `vscode://laststance.codebook/source?${new URLSearchParams({ root: projectRoot, path: source.path, line: String(line), sha256: source.sha256 })}`;
  /** The rail's entry that opens a page's first cited source: a link that holds the approved label alone, exactly as 0.2.29.0 published it, so every reader since can name its own editor in it, and beside the link the file and line it opens. The shown target has a `<wbr>` after each slash and before the colon, so a long path wraps there and the line number stays whole; Chrome reads each `<wbr>` as a space, so the shown target is hidden from assistive technology (`aria-hidden`) and the link is described (`aria-describedby`) by a visually hidden copy of the file and line as written (`sr-only`). A page has one entry, so the description's id is fixed. @example openSourceEntry({ path: 'src/utils/a.ts', sha256 }, 12) // => '<p class="open-in-editor"><a href="vscode://…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a.ts:12</span></p>' */
  const openSourceEntry = (source, line) => `<p class="open-in-editor"><a href="${escapeHtml(sourceAddress(source, line))}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">${escapeHtml(source.path).replaceAll('/', '/<wbr>')}<wbr>:${line}</span><span class="sr-only" id="codebook-open-target">${escapeHtml(source.path)}:${line}</span></p>`;
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
