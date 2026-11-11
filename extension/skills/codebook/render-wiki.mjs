import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { contentIdsOf, escapeHtml, renderWikiDiagrams, scriptingClauseOf, unbalancedClauseOf, unreadMarkupOf, withAttributeValues } from './render-wiki-diagrams.mjs';

const READER_VERSION = 2;
const MAX_PAGES = 256;
const MAX_SOURCE_QUOTE_LINES = 40;
/** The largest page file the Codebook reader opens, in bytes (2 MiB): the extension's `WIKI_PAGE_FILE_LIMIT_BYTES`, which a test holds equal to this number, since a skill script imports nothing of the extension. The reader refuses a larger page file for good, and an update would render the same page again, so {@link renderWikiPages} refuses such a page before anything is written, counted as the page can stand on disk ({@link requireReadablePage}). */
const PAGE_FILE_LIMIT_BYTES = 2_097_152;
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
    // A page is published only when every `<` of its content begins something the publisher reads exactly as a browser does; otherwise the two would not agree on the page's tags and ids, and markup that never ends would take the reader's own controls with it. The reading is linear in the content's size, so it runs before any check that reads tags by a pattern.
    const unread = unreadMarkupOf(page.contentHtml);
    // A browser reads everything after a comment that never ends as comment: the rest of the article and, after it, the reader's question form, rail and script. Every comment read exactly ends, so the first place not read exactly is such a comment when it starts one.
    if (unread?.startsWith('<!--')) throw new Error(`Wiki page ${page.path} has a comment that never ends; close it with -->.`);
    if (unread !== undefined) throw new Error(`Wiki page ${page.path} has markup the publisher cannot read exactly as a browser does; write a < of the text as &lt;, close every tag and every quotation mark, quote an attribute value, name an attribute once and write an id as plain text, with & as &amp;; it starts: ${unread}`);
    // The content is one balanced piece of the page: what it opens it closes, so nothing of it reaches the reader's own form, rail and layout around it.
    const unbalanced = unbalancedClauseOf(page.contentHtml);
    if (unbalanced !== undefined) throw new Error(`Wiki page ${page.path} ${unbalanced}`);
    // The content runs no script of its own, on the reader's origin or opened from disk: no event attribute, and no address of a scheme a browser runs (`javascript:`) or that leads elsewhere than a page, the web, mail or the editor.
    const scripting = scriptingClauseOf(page.contentHtml);
    if (scripting !== undefined) throw new Error(`Wiki page ${page.path} ${scripting}`);
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

/** Names the shell's one inline script by its hash, as a Content-Security-Policy names a script, for the policy every published page carries in its head: that policy lets the shell's own script run and no script a page's content may carry (an event attribute, a `javascript:` address), also when the page is opened from disk, where no reader sends a policy. Under the reader its header policy holds too, and the two agree: it names the same hash and the page's own origin (`'self'`), where the reader's own script file is the one file served as script. The script holds no template field, so the template's script is the published one; the template comes with LF line endings, as a browser reads the page, so the hash is the one a browser computes and the one the reader knows (`WIKI_SHELL_SCRIPT_HASHES`) on every checkout. Called by {@link renderWikiPages} once. @throws When the shell holds another number of inline scripts, or one with a template field. @example shellScriptHashOf('<script>run()</script>') // => "'sha256-…'" */
const shellScriptHashOf = template => {
  const scripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, text]) => text);
  if (scripts.length !== 1 || scripts[0].includes('{{')) throw new Error('The reader shell must hold one inline script without template fields.');
  return `'sha256-${createHash('sha256').update(scripts[0]).digest('base64')}'`;
};

/** Answers a rendered page the Codebook reader can open, so that a page it would refuse for good is refused here and the agent splits it instead of publishing a page nobody can read; called by {@link renderWikiPages} for each page, before anything is written. The page is counted as it can stand on disk, where the reader looks at its size: its bytes as written (UTF-8) and one byte more for each line end that no CR precedes, as a checkout with CRLF line ends (Git's `core.autocrlf` on Windows) writes each such LF as CRLF, so a committed Wiki cloned there grows by that much. @throws When the page has more than {@link PAGE_FILE_LIMIT_BYTES} bytes so counted. @example requireReadablePage('index.html', '<!doctype html>…') // => '<!doctype html>…' */
function requireReadablePage(path, pageHtml) {
  const pageBytes = Buffer.byteLength(pageHtml, 'utf8') + (pageHtml.match(/(?<!\r)\n/g)?.length ?? 0);
  if (pageBytes > PAGE_FILE_LIMIT_BYTES) throw new Error(`Wiki page ${path} renders to ${pageBytes} bytes with CRLF line ends, as a Windows checkout may hold it, more than the ${PAGE_FILE_LIMIT_BYTES} bytes (2 MiB) the Codebook reader opens; split its article into smaller pages, each with its own sources and outline, and link them from the page.`);
  return pageHtml;
}

/** The file extensions of included sources that count as application code: {@link requireCodeCoverage} refuses a Wiki that leaves such a file unexplained. Configuration, data, style and documentation files (`.json`, `.yaml`, `.css`, `.md`) are not listed, so they need no citation. */
const CODE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.rb', '.php', '.cs', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp', '.scala', '.sh']);
/** How many uncovered paths the refusal of {@link requireCodeCoverage} names. */
const MAX_NAMED_UNCOVERED = 40;
/** The longest reason, in characters, a coverage exception may give. */
const MAX_EXCEPTION_REASON = 300;
/** Base names of files that can hold credentials, which a Wiki never indexes ({@link requireNoCredentialSources}), compared case-insensitively: an environment file (`.env`, or `.env.` and any name, such as `.env.test` or `.env.sample`), a private key or key store (`.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`), an SSH private key (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, never the `.pub` half), and the npm, netrc and PostgreSQL password files. */
const CREDENTIAL_FILE_NAME = /^(?:\.env(?:\..+)?|.+\.(?:pem|key|p12|pfx|jks|keystore)|id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pgpass)$/i;
/** The number of explained code files from which {@link requireWikiDepth} applies; a smaller repository is exempt. */
const DEPTH_MIN_EXPLAINED_FILES = 12;
/** The fewest pages with a `parent` (a chapter tree) a Wiki needs once {@link requireWikiDepth} applies. */
const DEPTH_MIN_CHILD_PAGES = 2;
/** The Wiki needs at least this many diagrams for each page (rounded up), and a diagram on every page, once {@link requireWikiDepth} applies. */
const DEPTH_DIAGRAMS_PER_PAGE = 1.5;
/** The Wiki needs at least one page for this many explained code files (rounded up) once {@link requireWikiDepth} applies. */
const DEPTH_FILES_PER_PAGE = 8;
/** The weighted characters of counted explanation ({@link countedTextOf}) a Wiki needs for each explained code file. */
const DEPTH_TEXT_PER_FILE = 400;
/** The cap, in characters, on the total counted explanation {@link requireWikiDepth} requires (reached at 150 explained files). */
const DEPTH_MAX_REQUIRED_TEXT = 60_000;
/** The cap on the pages {@link requireWikiDepth} requires: past 240 explained files the page floor stays at a DeepWiki-sized chapter tree (DeepWiki gives TanStack/query, 2,498 code files, 47 pages) instead of one page per 8 files up to {@link MAX_PAGES}. */
const DEPTH_MAX_REQUIRED_PAGES = 30;
/** The fewest weighted characters of counted explanation ({@link countedTextOf}) any single page may have once {@link requireWikiDepth} applies. */
const DEPTH_MIN_PAGE_TEXT = 1200;
/** A sentence form ({@link sentenceFormOf}) used this many times across a Wiki is template text: only its first use counts as explanation. */
const DEPTH_REPEATED_SENTENCE_USES = 3;
/** A sentence of at least this many words, nearly all of them names (identifiers, paths, file names), is a list of names, not explanation. */
const DEPTH_LIST_MIN_WORDS = 4;
/** The share of names among a sentence's words from which {@link isNameList} reads it as a list of names. */
const DEPTH_LIST_NAME_SHARE = 0.6;
/** A sentence of at least this many weighted characters that appears word for word in a source the page cites is copied text, not explanation. */
const DEPTH_MIN_COPIED_TEXT = 40;
/** How many of the thinnest pages the depth refusal names. */
const DEPTH_MAX_NAMED_PAGES = 10;
/** The query of a Codebook editor source address as the editor's URI handler reads it: `vscode://` or `cursor://laststance.codebook` (scheme and authority without case) with the route `/source` exactly, and the query without its `#fragment`; `undefined` for any other address. Called by {@link inlineSourceLinksOf}. @example sourceQueryOf('VSCODE://laststance.codebook/source?path=a.ts#L1') // => 'path=a.ts' */
function sourceQueryOf(address) {
  const match = /^([A-Za-z]+):\/\/([^/?#]+)\/source\?([^#]*)/s.exec(address.trim());
  if (!match || !['vscode', 'cursor'].includes(match[1].toLowerCase()) || match[2].toLowerCase() !== 'laststance.codebook') return undefined;
  return match[3];
}
/** Reads the parameters (`root`, `path`, `line`, `sha256`) of every editor source address ({@link sourceQueryOf}) in an `href` attribute of authored HTML; a comment, escaped text and any other attribute name no link, and character references in the value are read as a browser reads them ({@link withAttributeValues}). Called by {@link verifiedInlinePathsOf}. @example inlineSourceLinksOf('<a href="vscode://laststance.codebook/source?path=a.ts&amp;line=1">a</a>') // => [{ root: undefined, path: 'a.ts', line: '1', sha256: undefined }] */
function inlineSourceLinksOf(contentHtml) {
  const links = [];
  withAttributeValues(contentHtml, (name, value) => {
    const query = name === 'href' ? sourceQueryOf(value) : undefined;
    if (query !== undefined) {
      const parameters = new URLSearchParams(query);
      links.push({ root: parameters.get('root') ?? undefined, path: parameters.get('path') ?? undefined, line: parameters.get('line') ?? undefined, sha256: parameters.get('sha256') ?? undefined });
    }
    return value;
  });
  return links;
}
/** Whether an inline link's `line` is a whole number from 1, written as digits. Called by {@link namesIndexedSource}. @example hasWholeLine({ line: '12' }) // => true */
const hasWholeLine = link => /^[1-9]\d{0,15}$/.test(link.line ?? '');
/** Whether an inline link names the project root, an indexed source with that source's hash and a whole line, as the editor's URI handler needs them to open the file; the line's range is checked by the caller. Called by {@link verifiedInlinePathsOf}. @example namesIndexedSource({ root: '/repo', path: 'a.ts', line: '1', sha256 }, { path: 'a.ts', sha256 }, '/repo') // => true */
const namesIndexedSource = (link, source, projectRoot) => Boolean(source) && link.root === projectRoot && link.sha256 === source.sha256 && hasWholeLine(link);
/** Collects the paths of the inline editor source links that count as citations: the link names an indexed source with that source's indexed hash, a positive integer line within the file and the project root. A link that fails one of these does not count, so the file shows as uncovered. Called by {@link renderWikiPages} before {@link requireCodeCoverage}. @param manifest - The manifest's pages. @param indexedSources - The included sources by path. @param projectRoot - The project root the page sources are validated against. @param lineCountOf - Answers a source's line count. @returns The set of paths a valid inline link cites. @example await verifiedInlinePathsOf(manifest, indexedSources, '/repo', async () => 10) // => Set { 'a.ts' } */
async function verifiedInlinePathsOf(manifest, indexedSources, projectRoot, lineCountOf) {
  const verified = new Set();
  for (const page of manifest.pages) {
    for (const link of inlineSourceLinksOf(page.contentHtml)) {
      const source = indexedSources.get(link.path);
      // A link counts only when it would open the indexed file at an existing line.
      if (!namesIndexedSource(link, source, projectRoot)) continue;
      if (Number(link.line) <= await lineCountOf(source)) verified.add(link.path);
    }
  }
  return verified;
}
/** Collects every source path a Wiki cites: page source lists, diagram node and edge sources and the paths of verified inline links. Called by {@link requireCodeCoverage}. @example citedPathsOf(manifest, new Set(['b.ts'])) // => Set { 'src/a.ts', 'b.ts' } */
function citedPathsOf(manifest, inlinePaths) {
  const references = manifest.pages.flatMap(page => [
    ...page.sources,
    ...(page.diagrams ?? []).flatMap(diagram => [...diagram.nodes, ...diagram.edges].flatMap(element => element.sources)),
  ]);
  return new Set([...references.map(reference => reference.path), ...inlinePaths]);
}
/** Tells whether a coverage exception covers a file: the exception names it, or names a folder (ending with `/`) that holds it. Called by {@link requireCodeCoverage}. @example isExceptionFor({ path: 'gen/' }, 'gen/api.ts') // => true */
const isExceptionFor = (entry, path) => entry.path.endsWith('/') ? path.startsWith(entry.path) : path === entry.path;
/** Refuses a malformed, repeated or stale entry of the manifest's `coverageExceptions`. Called by {@link requireCodeCoverage}. @throws With a sentence that names the entry's path. @example requireValidExceptions([{ path: 'gen/', reason: 'Generated.' }], ['gen/api.ts']) */
function requireValidExceptions(exceptions, codeFiles) {
  if (!Array.isArray(exceptions)) throw new Error('coverageExceptions must be an array of { path, reason } entries.');
  const seen = new Set();
  for (const entry of exceptions) requireValidException(entry, seen, codeFiles);
}
/** An exception's path without the `/` that marks a folder, as {@link safePath} checks it; any other value as given. Called by {@link requireValidException}. @example folderlessPathOf({ path: 'gen/' }) // => 'gen' */
const folderlessPathOf = entry => (typeof entry?.path === 'string' && entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry?.path);
/** Whether an exception gives a reason of 1 to {@link MAX_EXCEPTION_REASON} characters, spaces around it aside. Called by {@link requireValidException}. @example hasValidReason({ reason: 'Generated.' }) // => true */
const hasValidReason = entry => typeof entry.reason === 'string' && Boolean(entry.reason.trim()) && entry.reason.trim().length <= MAX_EXCEPTION_REASON;
/** Refuses one malformed, repeated or stale `coverageExceptions` entry, recording its path in `seen`. Called by {@link requireValidExceptions} for each entry in order. @throws With a sentence that names the entry's path. @example requireValidException({ path: 'gen/', reason: 'Generated.' }, new Set(), ['gen/api.ts']) */
function requireValidException(entry, seen, codeFiles) {
  if (!safePath(folderlessPathOf(entry))) throw new Error('A coverage exception needs a relative path of an included code file, or of a folder ending with /.');
  if (!hasValidReason(entry)) throw new Error(`The coverage exception for ${entry.path} needs a reason of 1–${MAX_EXCEPTION_REASON} characters saying why that code needs no explanation.`);
  if (seen.has(entry.path)) throw new Error(`The coverage exception for ${entry.path} is listed twice.`);
  seen.add(entry.path);
  if (!codeFiles.some(path => isExceptionFor(entry, path))) throw new Error(`The coverage exception for ${entry.path} matches no included code file; remove it.`);
}
/** Lists the included sources that count as application code, by {@link CODE_FILE_EXTENSIONS}. Called by {@link requireCodeCoverage} and {@link requireWikiDepth}. @example codeFilePathsOf(new Map([['a.ts', {}], ['b.json', {}]])) // => ['a.ts'] */
const codeFilePathsOf = indexedSources => [...indexedSources.keys()].filter(path => CODE_FILE_EXTENSIONS.has(extname(path).toLowerCase()));
/** The tags of inline elements, which a reader sees joined to the text beside them: `<code>QueryCache</code>.` reads `QueryCache.`. A tag ends at the first `>` outside its quoted attribute values. */
const INLINE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
/** Reads a page's article as plain text: comments removed, inline tags ({@link INLINE_TAG}) removed with nothing in their place and other tags replaced by a space (a tag ends at the first `>` outside its quoted attribute values, as {@link validatePages} guarantees every quotation mark is closed), the common entities and numeric character references decoded (each to one character), whitespace runs collapsed. Called by {@link articleSentencesOf}. @example articleTextOf('<p>a &amp; <code>b</code>.</p>') // => 'a & b.' */
const articleTextOf = contentHtml => contentHtml.replace(/<!--[\s\S]*?-->/g, ' ').replace(INLINE_TAG, '').replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => { const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return point <= 0x10ffff ? String.fromCodePoint(point) : match; }).replaceAll('&nbsp;', '\u00a0').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim();
/** Matches the characters that carry about twice the content of a Latin one: Han ideographs, Hiragana, Katakana (halfwidth U+FF66–U+FF9F excluded), Hangul, the content-carrying Japanese marks of the Common script (U+30FC, U+30FB, U+3001, U+3002) and the fullwidth forms U+FF01–U+FF60. */
const DOUBLE_WEIGHT_CHARACTER = /(?![\uFF66-\uFF9F])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30FC\u30FB\u3001\u3002\uFF01-\uFF60]/u;
/** Matches the invisible format characters (Unicode category Cf, such as the zero-width space U+200B), which a reader never sees. Called by {@link characterWeightOf}. */
const FORMAT_CHARACTER = /\p{Cf}/u;
/** The weight of one character in English-equivalent characters: 0 for a format character ({@link FORMAT_CHARACTER}), 2 for a CJK or fullwidth one ({@link DOUBLE_WEIGHT_CHARACTER}), 1 for any other. Called by {@link textWeightOf}. @example characterWeightOf('日') // => 2 */
const characterWeightOf = character => (FORMAT_CHARACTER.test(character) ? 0 : DOUBLE_WEIGHT_CHARACTER.test(character) ? 2 : 1);
/** Measures text in English-equivalent characters, each code point by {@link characterWeightOf}: CJK and fullwidth characters count 2, invisible format characters 0, any other 1. Called by {@link depthShortfallsOf} so a Japanese Wiki is held to the same depth as an English one. @example textWeightOf('ab日本') // => 6 */
const textWeightOf = text => [...text].reduce((sum, character) => sum + characterWeightOf(character), 0);
/** A private-use character standing for the end of a block element while a page is read as sentences; no article text holds it. */
const BLOCK_END_MARK = '';
/** The end tags (and the line break) that end a sentence as a reader sees the page: a paragraph, list item or list, heading, table cell, row or table, definition, caption, summary, preformatted block, quotation, or a division or section. */
const BLOCK_END = /<\/(?:p|li|ul|ol|dl|h[1-6]|td|th|tr|table|dt|dd|caption|figcaption|summary|details|pre|blockquote|div|section|article|aside|header|footer|nav|figure)\s*>|<br\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
/** Splits a page's article into the sentences a reader sees: a block end ({@link BLOCK_END}) or sentence punctuation (`.`, `!`, `?` before a space, or `。`) ends a sentence; comments, tags and character references are read as {@link articleTextOf} reads them. Called by {@link countedTextOf}. @example articleSentencesOf('<p>One. Two</p><li>Three</li>') // => ['One.', 'Two', 'Three'] */
const articleSentencesOf = contentHtml => articleTextOf(contentHtml.replace(/<!--[\s\S]*?-->/g, ' ').replace(BLOCK_END, ` ${BLOCK_END_MARK} `)).split(new RegExp(`\\s*${BLOCK_END_MARK}\\s*|(?<=[.!?])\\s+|(?<=。)`)).map(sentence => sentence.trim()).filter(Boolean);
/** The form of a sentence that template text repeats: paths, file names, code names (camelCase, PascalCase with a second capital, snake_case) and numbers each read as one placeholder, letters lowercased, spaces collapsed. A path or file name is a run of ASCII name characters, so a Japanese sentence that names a path keeps its own words; each pattern starts only where its run starts, so a long run is read once. Called by {@link countedTextOf}. @example sentenceFormOf('Reading src/a.ts as QueryClient 2.') // => 'reading p as i n.' */
const sentenceFormOf = sentence => sentence.replace(/(?<![\w.@$~:-])[\w.@$~:-]*[/\\][\w./\\@$~:-]*/g, 'P').replace(/(?<![\w.-])[\w.-]+\.[A-Za-z]{1,6}\b/g, 'F').replace(/(?<![\w$])[A-Za-z_$][\w$]*/g, word => (isCodeName(word) ? 'I' : word)).replace(/\d+(?:[.,]\d+)*/g, 'N').toLowerCase().replace(/\s+/g, ' ');
/** Whether a word is a code name: letters, digits, `_` or `$`, starting with a letter, `_` or `$`, with a capital, `_` or `$` after its first character (camelCase, PascalCase with a second capital, snake_case). Checked in two linear tests, so a long run is read once. Called by {@link sentenceFormOf} and {@link isNameWord}. @example isCodeName('QueryClient') // => true */
const isCodeName = word => /^[A-Za-z_$][\w$]*$/.test(word) && /[A-Z_$]/.test(word.slice(1));
/** Whether a word is a name rather than prose: a path or file name (it holds `/`, or a `.` followed by a letter), a code name ({@link isCodeName}), or a call such as `fetch()`. Called by {@link isNameList}. @example isNameWord('src/a.ts') // => true */
const isNameWord = word => /^[\w$@.-]*\/[\w$@./:-]*\w$/.test(word) || /^[\w$@-]*\.[A-Za-z][\w$@./:-]*$/.test(word) || isCodeName(word) || /^[\w$]+\(\)$/.test(word);
/** Whether a sentence is a list of names (identifiers, paths, file names, calls) rather than explanation: at least {@link DEPTH_LIST_MIN_WORDS} words, of which at least {@link DEPTH_LIST_NAME_SHARE} are names ({@link isNameWord}); a word's surrounding brackets, quotes and punctuation are removed, except the `()` of a call. Called by {@link sentenceKindOf}. @example isNameList('IsServerValue 、 isServer 、 environmentManager 、 FocusManager') // => true */
const isNameList = sentence => {
  // A call keeps its "()"; any other closing bracket or punctuation at a word's end is removed.
  const words = sentence.split(/[\s、,，;；]+/).map(word => word.replace(/^[(["'`「]+/, '').replace(/[\]"'`」:：.,。]+$/, '').replace(/(?<!\()\)+$/, '').replace(/[\]"'`」:：.,。]+$/, '')).filter(Boolean);
  return words.length >= DEPTH_LIST_MIN_WORDS && words.filter(isNameWord).length / words.length >= DEPTH_LIST_NAME_SHARE;
};
/** A source file's text as prose can quote it: comment markers at line starts and backticks removed, spaces collapsed. Called by the cited-text reader of {@link renderWikiPages}. @example quotableSourceTextOf([' * A `Query` runs.', ' *\/']) // => 'A Query runs. ' */
const quotableSourceTextOf = lines => lines.map(line => line.replace(/^\s*(?:\/\*\*?|\*\/|\*|\/\/+|#)\s?/, '')).join(' ').replace(/[`*]/g, '').replace(/\s+/g, ' ');
/** Whether a sentence of at least {@link DEPTH_MIN_COPIED_TEXT} weighted characters appears word for word in one of the page's cited sources ({@link quotableSourceTextOf}). Called by {@link sentenceKindOf}. @example isCopiedText('A QueryObserver watches a single query in the QueryCache.', ['/** A QueryObserver watches a single query in the QueryCache. *\/']) // => true */
const isCopiedText = (sentence, citedTexts) => textWeightOf(sentence) >= DEPTH_MIN_COPIED_TEXT && citedTexts.some(text => text.includes(sentence.replace(/[`*]/g, '').replace(/\s+/g, ' ')));
/** Which measure a sentence adds to: `listed` for a list of names ({@link isNameList}), `repeated` for a later use of a form used {@link DEPTH_REPEATED_SENTENCE_USES} or more times (its first use counts), `copied` for text copied from a cited source ({@link isCopiedText}), else `length`, the counted explanation. Called by {@link countedTextOf} for each sentence in page order; `counted` records the repeated forms whose first use has been counted. @param form - The sentence's form ({@link sentenceFormOf}). @example sentenceKindOf('Prose.', 'prose.', { uses: new Map(), counted: new Set(), citedTexts: [] }) // => 'length' */
function sentenceKindOf(sentence, form, { uses, counted, citedTexts }) {
  if (isNameList(sentence)) return 'listed';
  // Template text: only the first counted use of a form used three or more times counts; a copied use does not take that place.
  const isTemplate = uses.get(form) >= DEPTH_REPEATED_SENTENCE_USES;
  if (isTemplate && counted.has(form)) return 'repeated';
  if (isCopiedText(sentence, citedTexts)) return 'copied';
  if (isTemplate) counted.add(form);
  return 'length';
}
/** Measures each page's counted explanation in weighted characters ({@link textWeightOf}): its sentences ({@link articleSentencesOf}) except lists of names, later uses of a sentence form the Wiki repeats {@link DEPTH_REPEATED_SENTENCE_USES} or more times, and text copied from the page's cited sources; those are measured apart. Called by {@link depthShortfallsOf}. @param pages - The manifest's pages. @param citedTextsOf - Answers a page's cited sources as quotable text ({@link quotableSourceTextOf}). @returns One `{ path, length, repeated, listed, copied }` per page, `length` the counted explanation. @example countedTextOf(manifest.pages, () => []) // => [{ path: 'index.html', length: 1500, repeated: 0, listed: 0, copied: 0 }] */
function countedTextOf(pages, citedTextsOf) {
  // Each sentence with its form, read once.
  const sentencesByPage = pages.map(page => articleSentencesOf(page.contentHtml).map(sentence => ({ sentence, form: sentenceFormOf(sentence) })));
  const uses = new Map();
  for (const { form } of sentencesByPage.flat()) uses.set(form, (uses.get(form) ?? 0) + 1);
  const counted = new Set();
  return pages.map((page, index) => {
    const measure = { path: page.path, length: 0, repeated: 0, listed: 0, copied: 0 };
    const context = { uses, counted, citedTexts: citedTextsOf(page) };
    for (const { sentence, form } of sentencesByPage[index]) measure[sentenceKindOf(sentence, form, context)] += textWeightOf(sentence);
    return measure;
  });
}
/** The text a measured page or Wiki did not count, as a clause: repeated sentences, lists of names and copied text with their weighted characters; empty when everything counted. Called by {@link thinnestPagesOf} and {@link textShortfallsOf}. @example uncountedClauseOf({ repeated: 900, listed: 0, copied: 40 }) // => '; not counted: 900 in repeated sentences, 40 copied from cited sources' */
const uncountedClauseOf = ({ repeated, listed, copied }) => {
  const parts = [repeated && `${repeated} in repeated sentences`, listed && `${listed} in lists of names`, copied && `${copied} copied from cited sources`].filter(Boolean);
  return parts.length ? `; not counted: ${parts.join(', ')}` : '';
};
/** Names up to {@link DEPTH_MAX_NAMED_PAGES} of the thinnest pages with their counted explanation and what did not count. Called by {@link depthShortfallsOf}. @example thinnestPagesOf([{ path: 'a.html', length: 9, repeated: 0, listed: 0, copied: 0 }]) // => 'a.html (9 characters)' */
const thinnestPagesOf = measured => [...measured].sort((a, b) => a.length - b.length || a.path.localeCompare(b.path)).slice(0, DEPTH_MAX_NAMED_PAGES).map(page => `${page.path} (${page.length} characters${uncountedClauseOf(page)})`).join(', ');
/** Answers the failure sentences about the page tree and the diagrams: child pages, page count and diagrams per page and in total. Called by {@link depthShortfallsOf}. @example structureShortfallsOf(manifest.pages, 12) // => [] */
function structureShortfallsOf(pages, explainedCount) {
  const children = pages.filter(page => page.parent).length;
  // Past 240 explained files the floor stays at DEPTH_MAX_REQUIRED_PAGES, as the text total stays at DEPTH_MAX_REQUIRED_TEXT.
  const neededPages = Math.min(Math.ceil(explainedCount / DEPTH_FILES_PER_PAGE), DEPTH_MAX_REQUIRED_PAGES);
  const diagrams = pages.reduce((sum, page) => sum + (page.diagrams ?? []).length, 0);
  const neededDiagrams = Math.ceil(pages.length * DEPTH_DIAGRAMS_PER_PAGE);
  const bare = pages.filter(page => !(page.diagrams ?? []).length).map(page => page.path);
  const shortfalls = [];
  if (children < DEPTH_MIN_CHILD_PAGES) shortfalls.push(`The Wiki has ${children} pages with a parent but needs at least ${DEPTH_MIN_CHILD_PAGES}: add child pages under subsystem chapters for their modules and flows.`);
  if (pages.length < neededPages) shortfalls.push(`The Wiki has ${pages.length} pages but needs at least ${neededPages} for ${explainedCount} explained code files (about one page per ${DEPTH_FILES_PER_PAGE} files, up to ${DEPTH_MAX_REQUIRED_PAGES}): split the large chapters by module and flow.`);
  if (bare.length) shortfalls.push(`${bare.length} page${bare.length === 1 ? ' has' : 's have'} no diagram but every page needs at least one: add an architecture, flow or sequence diagram to ${bare.slice(0, DEPTH_MAX_NAMED_PAGES).join(', ')}.`);
  if (diagrams < neededDiagrams) shortfalls.push(`The Wiki has ${diagrams} diagrams but needs at least ${neededDiagrams} for ${pages.length} pages (one per page and about three per two pages in total): add architecture, flow or sequence diagrams with source-backed nodes and edges.`);
  return shortfalls;
}
/** Answers the failure sentences about the explanation: the total and the stub pages, in weighted characters of counted explanation ({@link countedTextOf}), each naming what did not count. Called by {@link depthShortfallsOf}. @example textShortfallsOf(measured, 12) // => [] */
function textShortfallsOf(measured, explainedCount) {
  const sum = key => measured.reduce((total, page) => total + page[key], 0);
  const total = sum('length');
  const uncounted = uncountedClauseOf({ repeated: sum('repeated'), listed: sum('listed'), copied: sum('copied') });
  const neededText = Math.min(DEPTH_TEXT_PER_FILE * explainedCount, DEPTH_MAX_REQUIRED_TEXT);
  const stubs = measured.filter(page => page.length < DEPTH_MIN_PAGE_TEXT);
  const shortfalls = [];
  if (total < neededText) shortfalls.push(`The Wiki has ${total} characters of explanation (CJK characters counted twice${uncounted}) but needs at least ${neededText} for ${explainedCount} explained code files: write longer explanations, starting with the thinnest pages: ${thinnestPagesOf(measured)}.`);
  if (stubs.length) shortfalls.push(`${stubs.length} page${stubs.length === 1 ? ' has' : 's have'} fewer than ${DEPTH_MIN_PAGE_TEXT} characters of explanation (CJK characters counted twice; repeated sentences count once, lists of names and text copied from cited sources do not count): deepen ${thinnestPagesOf(stubs)}.`);
  return shortfalls;
}
/** Measures a Wiki against the depth rules and answers one sentence for each rule it fails. Called by {@link requireWikiDepth}. @param pages - The manifest's pages. @param explainedCount - The number of explained code files. @param citedTextsOf - Answers a page's cited sources as quotable text. @returns The failure sentences; empty when the Wiki is deep enough. @example depthShortfallsOf(manifest.pages, 12, () => []) // => [] */
function depthShortfallsOf(pages, explainedCount, citedTextsOf) {
  return [...structureShortfallsOf(pages, explainedCount), ...textShortfallsOf(countedTextOf(pages, citedTextsOf), explainedCount)];
}
/** Refuses a Wiki too thin for the code it covers: from {@link DEPTH_MIN_EXPLAINED_FILES} explained code files (included code files no `coverageExceptions` entry covers) it needs a chapter tree, enough pages, a diagram on every page and enough diagrams in total, enough counted explanation in total (CJK counted twice; {@link countedTextOf}) and no stub page. Called by {@link renderWikiPages} right after {@link requireCodeCoverage}, so a refusal comes before anything is written.
 * @param citedTextsOf - Answers a page's cited sources as quotable text, for the copied-text rule.
 * @throws With one sentence for each failed rule, naming the measured value, the required value and what to add. @example requireWikiDepth(manifest, indexedSources, () => []) */
function requireWikiDepth(manifest, indexedSources, citedTextsOf) {
  const exceptions = manifest.coverageExceptions ?? [];
  const explained = codeFilePathsOf(indexedSources).filter(path => !exceptions.some(entry => isExceptionFor(entry, path)));
  // A small repository is exempt from the depth rules.
  if (explained.length < DEPTH_MIN_EXPLAINED_FILES) return;
  const shortfalls = depthShortfallsOf(manifest.pages, explained.length, citedTextsOf);
  if (shortfalls.length) throw new Error(shortfalls.join(' '));
}
/**
 * Refuses a Wiki whose source index holds a file that can hold credentials ({@link CREDENTIAL_FILE_NAME}), so a published Wiki never indexes, hashes or cites one.
 * Why: Cycle 0116 found an editor agent that excluded `.env` but indexed the tracked `.env.e2e` and `.env.test` of the repository it documented.
 * Called by {@link renderWikiPages} once the index is read and before any source is opened, so a refusal comes before anything is written.
 * @param includedSources - The manifest's source index, already checked for valid relative paths.
 * @throws When an included source's base name is credential-shaped; the message names the files, sorted, up to {@link MAX_NAMED_UNCOVERED}.
 * @example requireNoCredentialSources([{ path: 'src/env.ts' }]) // => undefined (a code file named env is no environment file)
 * @example requireNoCredentialSources([{ path: '.env.test' }]) // throws "The Wiki's source index holds 1 file that can hold credentials: .env.test. …"
 */
function requireNoCredentialSources(includedSources) {
  const credentialPaths = includedSources.map(source => source.path).filter(path => CREDENTIAL_FILE_NAME.test(basename(path))).sort();
  if (!credentialPaths.length) return;
  const more = credentialPaths.length > MAX_NAMED_UNCOVERED ? `, and ${credentialPaths.length - MAX_NAMED_UNCOVERED} more` : '';
  throw new Error(`The Wiki's source index holds ${credentialPaths.length} file${credentialPaths.length === 1 ? '' : 's'} that can hold credentials: ${credentialPaths.slice(0, MAX_NAMED_UNCOVERED).join(', ')}${more}. Remove each from includedSources and list it under excludedPaths; a Wiki never indexes environment files, private keys or password files.`);
}
/** Refuses a Wiki that leaves an included code file unexplained: every included source with a code extension ({@link CODE_FILE_EXTENSIONS}) must be cited by a page, a diagram or an inline link, or be covered by an entry of the manifest's `coverageExceptions` (`{ path, reason }`, a file or a folder ending with `/`). Called by {@link renderWikiPages} once every citation has resolved, so a refusal comes before anything is written.
 * @throws When an exception is malformed, repeated or matches no included code file, or when code files stay uncited and unlisted; the message names the count and the first paths. @param inlinePaths - The paths of verified inline links ({@link verifiedInlinePathsOf}). @example requireCodeCoverage(manifest, indexedSources, new Set()) */
function requireCodeCoverage(manifest, indexedSources, inlinePaths) {
  const codeFiles = codeFilePathsOf(indexedSources);
  const exceptions = manifest.coverageExceptions ?? [];
  requireValidExceptions(exceptions, codeFiles);
  const cited = citedPathsOf(manifest, inlinePaths);
  const uncovered = codeFiles.filter(path => !cited.has(path) && !exceptions.some(entry => isExceptionFor(entry, path))).sort();
  if (!uncovered.length) return;
  const more = uncovered.length > MAX_NAMED_UNCOVERED ? `, and ${uncovered.length - MAX_NAMED_UNCOVERED} more` : '';
  throw new Error(`The Wiki leaves ${uncovered.length} included code file${uncovered.length === 1 ? '' : 's'} unexplained: ${uncovered.slice(0, MAX_NAMED_UNCOVERED).join(', ')}${more}. Explain each in a page and cite it, or list it (or its folder ending with /) under coverageExceptions with the reason it needs no explanation.`);
}
/** Whether a citation's `line` is a whole number from 1 and its optional `label` is text. Called by {@link citedSourceOf}. @example isCitableReference({ path: 'a.ts', line: 3 }) // => true */
const isCitableReference = reference => Number.isSafeInteger(reference.line) && reference.line >= 1 && (reference.label === undefined || typeof reference.label === 'string');
/** The indexed source a page or diagram citation names, refusing an unindexed path, a line below 1 or a label that is not text. Called by the citation resolver of {@link renderWikiPages}. @throws 'Wiki references an unindexed source or invalid line.' @example citedSourceOf({ path: 'src/a.ts', line: 1 }, indexedSources) // => { path: 'src/a.ts', sha256 } */
function citedSourceOf(reference, indexedSources) {
  const source = reference && indexedSources.get(reference.path);
  if (!source || !isCitableReference(reference)) throw new Error('Wiki references an unindexed source or invalid line.');
  return source;
}
/** Refuses a citation whose last line is not a whole number from its first line to the file's last. Called by the citation resolver of {@link renderWikiPages}. @throws Naming the file and the cited line. @example requireLineRange(source, { line: 2 }, 2, ['a', 'b']) // returns */
function requireLineRange(source, reference, endLine, lines) {
  const isInRange = Number.isSafeInteger(endLine) && endLine >= reference.line && endLine <= lines.length;
  if (!isInRange) throw new Error(`Wiki source line is out of range: ${source.path}:${reference.line}.`);
}
/** Whether a diagram citation's quote is the text of its cited lines, line ends and surrounding space aside. Called by {@link requireExactQuote}. @example quotesCitedLines({ line: 1, quote: 'a' }, 1, ['a']) // => true */
const quotesCitedLines = (reference, endLine, lines) => lines.slice(reference.line - 1, endLine).join('\n').trim() === reference.quote.replace(/\r\n/g, '\n').trim();
/** Refuses a diagram citation that quotes more than {@link MAX_SOURCE_QUOTE_LINES} lines, no text or other text than its lines: a matching file hash cannot rescue a quote attached to the wrong line range. Called by the citation resolver of {@link renderWikiPages}. @throws Naming the file and the line range. @example requireExactQuote(source, { line: 1, quote: 'a' }, 1, ['a']) // returns */
function requireExactQuote(source, reference, endLine, lines) {
  const hasQuote = typeof reference.quote === 'string' && Boolean(reference.quote.trim());
  if (endLine - reference.line >= MAX_SOURCE_QUOTE_LINES || !hasQuote || !quotesCitedLines(reference, endLine, lines)) throw new Error(`Diagram source quote does not match ${source.path}:${reference.line}-${endLine}. Cite at most ${MAX_SOURCE_QUOTE_LINES} exact lines.`);
}
/** The shown location of a citation: the file and its line, or its line range for a quote of several lines. Called by the citation resolver of {@link renderWikiPages}. @example citedLocationOf({ path: 'a.ts' }, { line: 2 }, 4) // => 'a.ts:2–4' */
const citedLocationOf = (source, reference, endLine) => `${source.path}:${reference.line}${endLine === reference.line ? '' : `–${endLine}`}`;
/** Renders shared offline pages for {@link publishWiki}; the agent still authors every article and diagram. @throws When the reader data are invalid ({@link validatePages}), the source index holds a file that can hold credentials ({@link requireNoCredentialSources}), a citation does not match its source, or a rendered page is larger than the reader opens ({@link PAGE_FILE_LIMIT_BYTES}). @example await renderWikiPages(manifest, { projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function renderWikiPages(manifest, { projectRoot, outputDirectory }) {
  validatePages(manifest);
  if (!Array.isArray(manifest.includedSources)) throw new Error('The Wiki needs an included-source index.');
  const indexedSources = new Map();
  for (const source of manifest.includedSources) {
    if (!source || !safePath(source.path) || !/^[a-f0-9]{64}$/.test(source.sha256) || indexedSources.has(source.path)) throw new Error('The Wiki source index has an invalid path, hash or duplicate.');
    indexedSources.set(source.path, source);
  }
  requireNoCredentialSources(manifest.includedSources);
  // A Windows checkout with core.autocrlf (and a VSIX packaged from one) holds the shell with CRLF line endings; a browser reads every CRLF and lone CR as LF before it hashes an inline script, so the pages are written, and their script hashed, with LF line endings.
  const template = (await readFile(new URL('./reader-shell.html', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n'), shellScriptHash = shellScriptHashOf(template);
  const sourceLines = new Map(), pages = new Map();
  // The reader finds its own elements by id (the form, the question field, the answer, the theme button, the description of the entry's link, the status region), so an id of the shell or of its page scripts on an element of a page's content would stand twice in the served page. Such a content id is renamed on its page and in every link to it; nothing changes in the agent's page data.
  const readerIds = new Set([...[...template.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]), ...READER_ELEMENT_IDS]);
  const renamesByPage = new Map(manifest.pages.map(page => [page.path, contentIdRenames(page.contentHtml, readerIds)]));
  /** The editor address of one cited line; {@link sourceLink} wraps it in a citation's anchor, and the rail's entry ({@link openSourceEntry}) opens a page's first one. @example sourceAddress({ path: 'src/a.ts', sha256 }, 1) // => 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Fa.ts&line=1&sha256=…' */
  const sourceAddress = (source, line) => `vscode://laststance.codebook/source?${new URLSearchParams({ root: projectRoot, path: source.path, line: String(line), sha256: source.sha256 })}`;
  /** The rail's entry that opens a page's first cited source: a link that holds the approved label alone, exactly as 0.2.29.0 published it, so every reader since can name its own editor in it, and beside the link the file and line it opens. The shown target has a `<wbr>` after each slash and before the colon, so a long path wraps there and the line number stays whole; Chrome reads each `<wbr>` as a space, so the shown target is hidden from assistive technology (`aria-hidden`) and the link is described (`aria-describedby`) by a visually hidden copy of the file and line as written (`sr-only`). A page has one entry, so the description's id is fixed. @example openSourceEntry({ path: 'src/utils/a.ts', sha256 }, 12) // => '<p class="open-in-editor"><a href="vscode://…" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">src/<wbr>utils/<wbr>a.ts<wbr>:12</span><span class="sr-only" id="codebook-open-target">src/utils/a.ts:12</span></p>' */
  const openSourceEntry = (source, line) => `<p class="open-in-editor"><a href="${escapeHtml(sourceAddress(source, line))}" aria-describedby="codebook-open-target">Open in VS Code</a> <span class="open-target" aria-hidden="true">${escapeHtml(source.path).replaceAll('/', '/<wbr>')}<wbr>:${line}</span><span class="sr-only" id="codebook-open-target">${escapeHtml(source.path)}:${line}</span></p>`;
  /** Reads an indexed source's lines once, refusing a file that resolves outside the repository or whose hash changed; shared by {@link sourceLink} and the inline-link check. @example await linesOf({ path: 'src/a.ts', sha256 }) // => ['export const a = 1;', ''] */
  const linesOf = async source => {
    if (!sourceLines.has(source.path)) {
      const file = await realpath(join(projectRoot, source.path)), withinRoot = relative(projectRoot, file);
      if (withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) throw new Error('A Wiki source reference resolves outside its repository.');
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Wiki source changed: ${source.path}. Refresh its content and citations.`);
      sourceLines.set(source.path, bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n'));
    }
    return sourceLines.get(source.path);
  };
  /** Resolves page and graph citations through the same current-source boundary. @example await sourceLink({ path: 'src/a.ts', line: 1 }) */
  const sourceLink = async (reference, exactQuote = false) => {
    const source = citedSourceOf(reference, indexedSources);
    const lines = await linesOf(source), endLine = exactQuote ? reference.endLine : reference.line;
    requireLineRange(source, reference, endLine, lines);
    if (exactQuote) requireExactQuote(source, reference, endLine, lines);
    return `<a href="${escapeHtml(sourceAddress(source, reference.line))}">${escapeHtml(reference.label ?? citedLocationOf(source, reference, endLine))}</a>`;
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
      SHELL_SCRIPT_HASH: shellScriptHash,
    };
    const pageHtml = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Unknown reader template field: ${key}`);
      return values[key];
    });
    // Every page is written with LF only: its text may hold CRLF or a lone CR (an editor on Windows writes them), and a browser reads each as LF anyway. So the CRLF the publisher's refusal (lineEndRefusalOf in publish-wiki.mjs) looks for is only one that Git added at a checkout, never one the page's own text brought, and that refusal does not fire for a page that merely held CRLF.
    pages.set(page.path, requireReadablePage(page.path, pageHtml.replace(/\r\n?/g, '\n')));
  }
  // Every citation has resolved; now no included code file may stay unexplained.
  requireCodeCoverage(manifest, indexedSources, await verifiedInlinePathsOf(manifest, indexedSources, projectRoot, async source => (await linesOf(source)).length));
  // A page's cited sources (its source list, diagram sources and inline links that name an indexed source, all read above) as quotable text, read once per file.
  const quotableTexts = new Map();
  const quotableTextOf = path => {
    if (!quotableTexts.has(path)) quotableTexts.set(path, quotableSourceTextOf(sourceLines.get(path) ?? []));
    return quotableTexts.get(path);
  };
  const inlinePathsOf = page => inlineSourceLinksOf(page.contentHtml).filter(link => namesIndexedSource(link, indexedSources.get(link.path), projectRoot)).map(link => link.path);
  const citedTextsOf = page => [...new Set([...[...page.sources, ...(page.diagrams ?? []).flatMap(diagram => [...diagram.nodes, ...diagram.edges].flatMap(element => element.sources))].map(reference => reference.path), ...inlinePathsOf(page)])].map(quotableTextOf);
  requireWikiDepth(manifest, indexedSources, citedTextsOf);
  return pages;
}
