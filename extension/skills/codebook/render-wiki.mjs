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
/** Base names of files that can hold credentials, which a Wiki never indexes ({@link isCredentialPath}), compared case-insensitively. It is a list of names, not a proof that another file holds no secret: an environment file (`.env`, a name that starts with `.env.`, `.env-` or `.env_`, such as `.env.test`, `.env.sample` or `.env-local`, a name that ends with `.env`, `.envrc` and `.dev.vars`), a private key, key store or variables file (`.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.p8`, `.ppk`, `.tfvars`, the extension alone included), an SSH private key (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` and their `_sk` forms, never the `.pub` half), and the `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.htpasswd`, `.git-credentials`, `credentials` and `credentials.json` files. */
const CREDENTIAL_FILE_NAME = /^(?:\.env(?:[._-].*)?|.+\.env|\.envrc|\.dev\.vars|.*\.(?:pem|key|p12|pfx|jks|keystore|p8|ppk|tfvars)|id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?|\.npmrc|\.netrc|\.pgpass|\.pypirc|\.htpasswd|\.git-credentials|credentials(?:\.json)?)$/i;
/** A folder name whose files a Wiki never indexes ({@link isCredentialPath}): an environment folder (`.env/`), compared case-insensitively. */
const CREDENTIAL_FOLDER_NAME = /^\.env$/i;
/** Whether a repository-relative path names a file that can hold credentials: its base name matches {@link CREDENTIAL_FILE_NAME} or one of its folders matches {@link CREDENTIAL_FOLDER_NAME}. Called by {@link requireNoCredentialSources} for each indexed path and the file it resolves to, and by {@link requireNoCredentialLinks} for the paths a page's text links to. @example isCredentialPath('config/.env/db.ts') // => true @example isCredentialPath('src/env.ts') // => false */
const isCredentialPath = path => {
  const segments = path.split(/[\\/]/);
  return CREDENTIAL_FILE_NAME.test(segments.at(-1)) || segments.slice(0, -1).some(segment => CREDENTIAL_FOLDER_NAME.test(segment));
};
/** The refusal of a Wiki that indexes files that can hold credentials, by their names or the files they resolve to, naming them as given (sorted by the caller), up to {@link MAX_NAMED_UNCOVERED}. Called by {@link requireNoCredentialSources}. @example credentialRefusal(['.env.test']) // => "The Wiki's source index holds 1 file that can hold credentials: .env.test. …" */
const credentialRefusal = paths => {
  const more = paths.length > MAX_NAMED_UNCOVERED ? `, and ${paths.length - MAX_NAMED_UNCOVERED} more` : '';
  return `The Wiki's source index holds ${paths.length} file${paths.length === 1 ? '' : 's'} that can hold credentials: ${paths.slice(0, MAX_NAMED_UNCOVERED).join(', ')}${more}. Remove each from includedSources and list it under excludedPaths; a Wiki never indexes environment files, private keys or password files.`;
};
/** The number of explained code files from which {@link wikiDepthShortfallsOf} applies; a smaller repository is exempt unless its explained code files hold {@link DEPTH_MIN_EXPLAINED_LINES} lines. */
const DEPTH_MIN_EXPLAINED_FILES = 12;
/** The number of lines, in total over the explained code files, from which {@link wikiDepthShortfallsOf} applies even below {@link DEPTH_MIN_EXPLAINED_FILES} files. Why: Cycle 0123 found P06 (a Chrome extension of 7 code files holding 4,424 lines) whose Wikis both hosts published below every floor, because 7 files were exempt; 1,200 lines is 12 files of about 100 lines. */
const DEPTH_MIN_EXPLAINED_LINES = 1200;
/** The fewest pages with a `parent` (a chapter tree) a Wiki needs once {@link wikiDepthShortfallsOf} applies. */
const DEPTH_MIN_CHILD_PAGES = 2;
/** The Wiki needs at least this many diagrams for each page (rounded up), and a diagram on every page, once {@link wikiDepthShortfallsOf} applies. */
const DEPTH_DIAGRAMS_PER_PAGE = 1.5;
/** The Wiki needs at least one page for this many explained code files (rounded up) once {@link wikiDepthShortfallsOf} applies. */
const DEPTH_FILES_PER_PAGE = 8;
/** The weighted characters of counted explanation ({@link countedTextOf}) a Wiki needs for each explained code file. */
const DEPTH_TEXT_PER_FILE = 400;
/** The cap, in characters, on the total counted explanation {@link wikiDepthShortfallsOf} requires (reached at 150 explained files). */
const DEPTH_MAX_REQUIRED_TEXT = 60_000;
/** The cap on the pages {@link wikiDepthShortfallsOf} requires: past 240 explained files the page floor stays at a DeepWiki-sized chapter tree (DeepWiki gives TanStack/query, 2,498 code files, 47 pages) instead of one page per 8 files up to {@link MAX_PAGES}. */
const DEPTH_MAX_REQUIRED_PAGES = 30;
/** The fewest weighted characters of counted explanation ({@link countedTextOf}) any single page may have once {@link wikiDepthShortfallsOf} applies. */
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
/** Lists the included sources that count as application code, by {@link CODE_FILE_EXTENSIONS}. Called by {@link requireCodeCoverage} and {@link explainedCodeFilesOf}. @example codeFilePathsOf(new Map([['a.ts', {}], ['b.json', {}]])) // => ['a.ts'] */
const codeFilePathsOf = indexedSources => [...indexedSources.keys()].filter(path => CODE_FILE_EXTENSIONS.has(extname(path).toLowerCase()));
/** The explained code files of a Wiki: included code files ({@link codeFilePathsOf}) that no entry of the manifest's `coverageExceptions` covers. Called by {@link wikiDepthShortfallsOf} and {@link workspaceShortfallsOf}, so a file the Wiki explicitly leaves unexplained owes neither depth nor a sentence about its imports. @example explainedCodeFilesOf({ coverageExceptions: [{ path: 'gen/', reason: 'generated' }] }, new Map([['gen/a.ts', {}], ['b.ts', {}]])) // => ['b.ts'] */
const explainedCodeFilesOf = (manifest, indexedSources) => codeFilePathsOf(indexedSources).filter(path => !(manifest.coverageExceptions ?? []).some(entry => isExceptionFor(entry, path)));
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
/** Measures a Wiki against the depth rules and answers one sentence for each rule it fails. Called by {@link wikiDepthShortfallsOf}. @param pages - The manifest's pages. @param explainedCount - The number of explained code files. @param citedTextsOf - Answers a page's cited sources as quotable text. @returns The failure sentences; empty when the Wiki is deep enough. @example depthShortfallsOf(manifest.pages, 12, () => []) // => [] */
function depthShortfallsOf(pages, explainedCount, citedTextsOf) {
  return [...structureShortfallsOf(pages, explainedCount), ...textShortfallsOf(countedTextOf(pages, citedTextsOf), explainedCount)];
}
/** The number of lines of a text: its text split on `\n` (CRLF read as LF), a final line without a newline counted, an empty text 0. Called by {@link explainedLinesOf}. @example lineCountOf('a\nb') // => 2 @example lineCountOf('a\r\nb\r\n') // => 2 @example lineCountOf('') // => 0 */
const lineCountOf = text => (text === '' ? 0 : text.replace(/\r\n/g, '\n').split('\n').length - (text.endsWith('\n') ? 1 : 0));
/** The total lines of the given explained code files, read through `textOf`. Called by {@link wikiDepthShortfallsOf} for a repository below {@link DEPTH_MIN_EXPLAINED_FILES} files, to see whether it reaches {@link DEPTH_MIN_EXPLAINED_LINES}. @param paths - The explained code files ({@link explainedCodeFilesOf}). @param textOf - Reads an included source's text by path. @returns The summed line count ({@link lineCountOf}). @example await explainedLinesOf(['a.ts', 'b.ts'], textOf) // => 4424 */
async function explainedLinesOf(paths, textOf) {
  let total = 0;
  for (const path of paths) total += lineCountOf(await textOf(path));
  return total;
}
/** Measures a Wiki against the depth rules for the code it covers: from {@link DEPTH_MIN_EXPLAINED_FILES} explained code files (included code files no `coverageExceptions` entry covers), or fewer files that hold {@link DEPTH_MIN_EXPLAINED_LINES} lines in total, it needs a chapter tree, enough pages, a diagram on every page and enough diagrams in total, enough counted explanation in total (CJK counted twice; {@link countedTextOf}) and no stub page. Called by {@link requireWikiDepthAndWorkspace}, which {@link renderWikiPages} calls right after {@link requireCodeCoverage}, so a refusal comes before anything is written.
 * @param citedTextsOf - Answers a page's cited sources as quotable text, for the copied-text rule.
 * @param textOf - Reads an included source's text by path, to count the lines of a repository below the file threshold.
 * @returns One sentence for each failed rule, naming the measured value, the required value and what to add; empty for a deep enough Wiki or a small repository (below the file threshold and below the line threshold). @example await wikiDepthShortfallsOf(manifest, indexedSources, () => [], textOf) // => [] */
async function wikiDepthShortfallsOf(manifest, indexedSources, citedTextsOf, textOf) {
  const explained = explainedCodeFilesOf(manifest, indexedSources);
  // A repository below both the file and the line threshold is exempt from the depth rules.
  if (explained.length < DEPTH_MIN_EXPLAINED_FILES && await explainedLinesOf(explained, textOf) < DEPTH_MIN_EXPLAINED_LINES) return [];
  return depthShortfallsOf(manifest.pages, explained.length, citedTextsOf);
}
/** How many imported names, and how many of a package's pages, one sentence of {@link workspaceShortfallOf} names. */
const WORKSPACE_MAX_NAMED = 3;
/** A string literal (group 1, kept), a regular-expression literal or a comment (both blanked) of JavaScript or TypeScript text, so {@link moduleTextOf} drops comments without reading into strings or patterns: a commented-out import is no import, a comment inside an import's braces hides none of its names, and a pattern such as `/[/*]/` opens no comment. A regular-expression literal is recognised after an operator (an arrow's `=>` and a comparison's `>` included), a bracket, `return` or a line start. Every match always succeeds and moves on: an unclosed string runs to the end of its line, an unclosed template or block comment to the end of the text, so the scan is linear however many quotes a line holds. */
const COMMENT_OR_STRING = /("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|\/(?<=(?:^|\n|[=(,:;!&|?{}[\]>]|\breturn)[ \t]*\/)(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
/** A code file's text as {@link MODULE_STATEMENT}, {@link BOUND_LOAD} and {@link LOAD_EXPRESSION} read it: comments removed ({@link COMMENT_OR_STRING}), each string literal replaced by a numbered token `'N'` whose text `literals[N]` keeps, and every whitespace run one space. A statement written across lines reads as one line, a long run of spaces costs one step, and import text inside a string (a code sample, a generator's template) is no statement. Called by {@link moduleStatementsOf}. @example moduleTextOf("import {\n  a, // note\n  b\n} from 'x'") // => { code: "import { a, b } from '0'", literals: ['x'] } */
function moduleTextOf(text) {
  const literals = [];
  const code = text.replace(COMMENT_OR_STRING, (comment, literal) => (literal === undefined ? ' ' : `'${literals.push(literal.slice(1, literal.length > 1 && literal.at(-1) === literal[0] ? -1 : undefined)) - 1}'`)).replace(/\s+/g, ' ');
  return { code, literals };
}
/** A static `import` or `export … from` statement in {@link moduleTextOf} text: group 1 is `type ` for a type-only statement, group 2 the clause (default name, `{ … }` names, `* as` name), group 3 the string token of the module specifier. The clause holds only names, spaces, commas, braces and `*`, never another `import` or `export` keyword, and at most 2,000 characters: a declaration (`export function f() {…}`) or an `export { … }` without `from` never reaches a later statement's `from`, and a clause that never meets `from` stops after a bounded number of steps. A side-effect import (`import 'x'`) and a dynamic `import()` have no clause and do not match; {@link BOUND_LOAD} and {@link LOAD_EXPRESSION} read dynamic imports. */
const MODULE_STATEMENT = /\b(?:import|export) ?(type )?((?:(?!\b(?:import|export)\b)[\w$ ,{}*]){1,2000}?) ?\bfrom ?'(\d+)'/g;
/** A CommonJS `require` or a dynamic `import()` of a module, bound to a name or destructured, in {@link moduleTextOf} text (`const { a } = require('x')`, `const { a } = await import('x')`): group 1 the binding (`shared`, or `{ a, b: c }`), group 2 the string token of the module specifier. */
const BOUND_LOAD = /\b(?:const|let|var) (\{[\w$ ,:]{0,2000}\}|[\w$]+) ?= ?(?:require|(?:await )?import) ?\( ?'(\d+)' ?\)/g;
/** A load of a module written as an expression in {@link moduleTextOf} text, once {@link BOUND_LOAD} has taken the bound ones: any CommonJS `require('…')` call, with group 1 its string token and group 2 the property read from it (`require('x').localDay`), and a dynamic `import('…')` that is awaited (group 3) or followed by `.then` (group 4). A bare `import('…')` is left out, because TypeScript writes a type the same way (`import('x').Day`). */
const LOAD_EXPRESSION = /\brequire ?\( ?'(\d+)' ?\)(?: ?\. ?([A-Za-z_$][\w$]*))?|\bawait import ?\( ?'(\d+)' ?\)|\bimport ?\( ?'(\d+)' ?\) ?\. ?then\b/g;
/** Whether an imported name can stand in an article as a function or schema a package uses: an identifier other than `default`, and not a constant written in capitals only (`DAY_ROWS_MAX`). Called by {@link importedNamesOf}. @example isUsableImportName('localDay') // => true @example isUsableImportName('REFUSAL') // => false */
const isUsableImportName = name => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default' && !/^[A-Z0-9_$]+$/.test(name);
/** What one statement's clause ({@link MODULE_STATEMENT}) brings in: `names`, each `{ … }` entry by its exported name (`a as b` gives `a`; an inline `type` entry gives nothing) kept when {@link isUsableImportName}, and `wholeModule`, true when the clause also has a default import or a `* as` namespace, whose local name is the importer's own choice. Called by {@link workspaceImportsOf}. @example importedNamesOf('Base, { localDay, type DayRow, dayBounds as bounds }') // => { names: ['localDay', 'dayBounds'], wholeModule: true } */
function importedNamesOf(clause) {
  const braced = /\{([^}]*)\}/.exec(clause)?.[1] ?? '';
  const exported = braced.split(',').map(entry => entry.trim()).filter(entry => entry && !entry.startsWith('type ')).map(entry => entry.split(/ as /)[0]);
  const names = exported.filter(isUsableImportName);
  // A default import, a `* as` namespace or a `{ default as x }` entry takes the whole module under the importer's own name.
  const wholeModule = exported.includes('default') || clause.replace(/\{[^}]*\}/, '').split(',').some(part => part.trim());
  return { names, wholeModule };
}
/** The `name` of a `package.json` text, or undefined for unreadable JSON or a missing or empty name. Called by {@link workspacePackagesOf}. @example packageNameOf('{"name":"@acme/shared"}') // => '@acme/shared' */
function packageNameOf(text) {
  try {
    const name = JSON.parse(text.replace(/^\uFEFF/, ''))?.name;
    return typeof name === 'string' && name ? name : undefined;
  } catch {
    return undefined;
  }
}
/** The workspace packages of a Wiki's source index: every included `package.json` below the repository root that names its package, with the folder (ending with `/`) that holds it. Called by {@link workspaceShortfallsOf}. @param textOf - Reads an included source's text by path. @example await workspacePackagesOf(indexedSources, textOf) // => [{ name: '@acme/shared', folder: 'packages/shared/' }] */
async function workspacePackagesOf(indexedSources, textOf) {
  const packages = [];
  for (const path of indexedSources.keys()) {
    const name = path.endsWith('/package.json') && !TEST_OR_FIXTURE_PATH.test(path) ? packageNameOf(await textOf(path)) : undefined;
    if (name) packages.push({ name, folder: path.slice(0, -'package.json'.length) });
  }
  return packages;
}
/** The workspace package that holds a path: the one whose folder holds it and is the deepest, so a package nested in another owns its own files. Called by {@link workspaceImportsOf} and {@link isMostlyAbout}. @example ownerOf('apps/app/src/a.ts', packages) // => { name: '@acme/app', folder: 'apps/app/' } */
const ownerOf = (path, packages) => packages.filter(candidate => path.startsWith(candidate.folder)).sort((first, second) => second.folder.length - first.folder.length)[0];
/** The workspace package a module specifier names: its package name alone or followed by a subpath (`@acme/shared/time`). Called by {@link workspaceImportsOf}. @example packageOfSpecifier('@acme/shared/time', packages) // => { name: '@acme/shared', folder: 'packages/shared/' } */
const packageOfSpecifier = (specifier, packages) => packages.find(candidate => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`));
/** The import statements of one code file, ES modules ({@link MODULE_STATEMENT}), bound requires and dynamic imports ({@link BOUND_LOAD}) and loads written as expressions ({@link LOAD_EXPRESSION}): `{ typeOnly, clause, specifier }`, a binding's `{ a: b }` rename read as `a as b`, a property read from a `require` call as `{ a }`, and any other expression load as `*`, the whole module. Called by {@link workspaceImportsOf}. @example moduleStatementsOf("const { localDay } = require('@acme/shared')") // => [{ typeOnly: false, clause: '{ localDay }', specifier: '@acme/shared' }] @example moduleStatementsOf("const day = (await import('@acme/shared')).localDay") // => [{ typeOnly: false, clause: '*', specifier: '@acme/shared' }] */
function moduleStatementsOf(text) {
  const { code, literals } = moduleTextOf(text);
  const modules = [...code.matchAll(MODULE_STATEMENT)].map(match => ({ typeOnly: Boolean(match[1]), clause: match[2], specifier: literals[match[3]] }));
  const bound = [...code.matchAll(BOUND_LOAD)].map(match => ({ typeOnly: false, clause: match[1].replace(/ ?: ?/g, ' as '), specifier: literals[match[2]] }));
  // The bound loads are taken out first, so each load counts once: a bound require keeps the names it destructures instead of also counting as the whole module.
  const expressions = [...code.replace(BOUND_LOAD, ' ').matchAll(LOAD_EXPRESSION)].map(match => ({ typeOnly: false, clause: match[2] ? `{ ${match[2]} }` : '*', specifier: literals[match[1] ?? match[3] ?? match[4]] }));
  return [...modules, ...bound, ...expressions];
}
/** The workspace package a statement of one file imports from: the package its specifier names ({@link packageOfSpecifier}), or for a relative specifier (`../../packages/shared/src/day`) the package that holds the path it resolves to ({@link ownerOf}). Called by {@link workspaceImportsOf}. @example importedPackageOf('../../packages/shared/src/day', 'apps/app/src/today.ts', packages) // => { name: '@acme/shared', folder: 'packages/shared/' } */
const importedPackageOf = (specifier, path, packages) => (specifier.startsWith('.') ? ownerOf(`${posix.join(posix.dirname(path), specifier)}/`, packages) : packageOfSpecifier(specifier, packages));
/** A test, a mock or a fixture: a file below a `__tests__`, `__mocks__`, `__fixtures__`, `__testfixtures__`, `fixture(s)`, `test(s)` or `e2e` folder, or named `*.test.*`, `*.spec.*`, `*.test-d.*` or `*.bench.*`. Its imports say how a package is tested, not what its code uses, so {@link workspaceImportsOf} skips it. */
const TEST_OR_FIXTURE_PATH = /(?:^|\/)(?:__tests__|__mocks__|__fixtures__|__testfixtures__|fixtures?|tests?|e2e)\/|\.(?:test|spec|test-d|bench)\.[cm]?[jt]sx?$/;
/** A Vue or Svelte single-file component, whose code runs only from its `<script>` elements: its template and styles are markup, so import text there (a code sample in the template) is no import. */
const COMPONENT_FILE = /\.(?:vue|svelte)$/i;
/** The text of a code file that runs, as {@link moduleStatementsOf} reads it: for a component ({@link COMPONENT_FILE}) the text of its `<script>` elements one after another, each up to its `</script>` or, without one, to the end of the file; for any other file the whole text. The scan only moves forward, so it stays linear however many tags a file holds. Called by {@link workspaceImportsOf}. @example scriptTextOf('Today.vue', '<template><code>import { a } from "x"</code></template><script setup>import { b } from "y"</script>') // => 'import { b } from "y"' */
function scriptTextOf(path, text) {
  if (!COMPONENT_FILE.test(path)) return text;
  const scripts = [], scriptTag = /<script\b[^>]{0,2000}>/gi, endTag = /<\/script/gi;
  for (let tag = scriptTag.exec(text); tag; tag = scriptTag.exec(text)) {
    endTag.lastIndex = scriptTag.lastIndex;
    const end = endTag.exec(text)?.index ?? text.length;
    scripts.push(text.slice(scriptTag.lastIndex, end));
    // The next search starts after this element; an element without its end tag runs to the end of the file.
    scriptTag.lastIndex = end;
  }
  return scripts.join('\n');
}
/** Every value a workspace package's code imports from another workspace package, by name or by a relative path into its folder ({@link importedPackageOf}), read from each statement ({@link moduleStatementsOf}) of an explained code file: one `{ path, owner, target, name }` per imported name, and one with no `name` for a default or `* as` import of the whole module ({@link importedNamesOf}). A type-only statement imports nothing that runs, a package's own name points back into it, and tests and fixtures ({@link TEST_OR_FIXTURE_PATH}) are no part of what the package's code uses, so none of them counts. Called by {@link workspaceShortfallsOf}. @param codeFiles - The explained code files: included code files no coverage exception covers. @example await workspaceImportsOf(packages, ['apps/app/src/day.ts'], textOf) // => [{ path: 'apps/app/src/day.ts', owner: app, target: shared, name: 'localDay' }] */
async function workspaceImportsOf(packages, codeFiles, textOf) {
  const imports = [];
  for (const path of codeFiles.filter(file => !TEST_OR_FIXTURE_PATH.test(file))) {
    const owner = ownerOf(path, packages);
    if (!owner) continue;
    for (const statement of moduleStatementsOf(scriptTextOf(path, await textOf(path)))) {
      const target = importedPackageOf(statement.specifier, path, packages);
      if (statement.typeOnly || !target || target === owner) continue;
      const { names, wholeModule } = importedNamesOf(statement.clause);
      imports.push(...names.map(name => ({ path, owner, target, name })), ...(wholeModule ? [{ path, owner, target }] : []));
    }
  }
  return imports;
}
/** Escapes a name for a regular expression. Called by {@link mentions} and {@link mentionsName}. @example escapedPattern('a.b') // => 'a\\.b' */
const escapedPattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether an article's text names a package or folder as a word of its own: no name character (`\w`, `$`, `@`, `-`, `.`, `/`) right before it, and no word character, `$` or `-` right after it, so `packages/shared` is named in `packages/shared/src` but not in `packages/shared-ui`. Called by {@link explainsImport}. @example mentions('It imports @acme/shared.', '@acme/shared') // => true */
const mentions = (text, name) => new RegExp(`(?<![\\w$@./-])${escapedPattern(name)}(?![\\w$-])`).test(text);
/** Whether an article's text names an imported identifier as a word of its own: no word character or `$` on either side, so a call written through its module (`shared.localDay()`) names `localDay` too. Called by {@link explainsImport}. @example mentionsName('It calls shared.localDay() first.', 'localDay') // => true */
const mentionsName = (text, name) => new RegExp(`(?<![\\w$])${escapedPattern(name)}(?![\\w$])`).test(text);
/** Whether a page is mostly about one workspace package: more than half of its `sources` entries lie in files that package owns ({@link ownerOf}). Called by {@link workspaceShortfallsOf}. @example isMostlyAbout({ sources: [{ path: 'apps/app/a.ts' }] }, app, packages) // => true */
const isMostlyAbout = (page, owner, packages) => page.sources.filter(reference => ownerOf(reference.path, packages) === owner).length * 2 > page.sources.length;
/** A page's article split at its block ends ({@link BLOCK_END}) into the paragraphs, list items and table cells a reader sees, without code blocks: an import line pasted into a `<pre>` says nothing about what the code uses it for. Called by {@link explainsImport}. @example articleBlocksOf('<p>One. Two.</p><pre>import x</pre><li>Three</li>') // => ['One. Two.', 'Three'] */
const articleBlocksOf = contentHtml => articleTextOf(contentHtml.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<pre\b[\s\S]*?<\/pre\s*>/gi, ' ').replace(/<br\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, ' ').replace(BLOCK_END, ` ${BLOCK_END_MARK} `)).split(BLOCK_END_MARK).map(block => block.trim()).filter(Boolean);
/** Whether a block of text names a workspace package, by its name or its folder. Called by {@link explainsImport}. @example namesPackage('It reads packages/shared.', shared) // => true */
const namesPackage = (text, target) => mentions(text, target.name) || mentions(text, target.folder.slice(0, -1));
/** Whether a page says what its package uses from another one: one paragraph, list item or table cell of its article ({@link articleBlocksOf}) names the target package (by name or folder) and a function or schema that a file the page cites imports from it, so the two names stand in one statement rather than in unrelated sentences; for a default or `* as` import of the whole module, naming the package is enough, since the local name is the importer's own. Called by {@link workspaceShortfallsOf}. @param used - The owner's imports from the target ({@link workspaceImportsOf}). @param citedPaths - The paths the page cites. @example explainsImport(page, shared, used, new Set(['apps/app/src/day.ts'])) // => true */
function explainsImport(page, target, used, citedPaths) {
  const cited = used.filter(entry => citedPaths.has(entry.path));
  return articleBlocksOf(page.contentHtml).some(block => namesPackage(block, target) && cited.some(entry => entry.name === undefined || mentionsName(block, entry.name)));
}
/** The refusal sentence for one package whose pages never say what it uses from another workspace package, naming up to {@link WORKSPACE_MAX_NAMED} imported names and pages (no names when it imports only the whole module). Called by {@link workspaceShortfallsOf}. @example workspaceShortfallOf(app, shared, used, [appPage]) // => 'apps/app imports @acme/shared (localDay), but …' */
function workspaceShortfallOf(owner, target, used, ownPages) {
  const ownerFolder = owner.folder.slice(0, -1), targetFolder = target.folder.slice(0, -1);
  const names = [...new Set(used.map(entry => entry.name).filter(Boolean))].slice(0, WORKSPACE_MAX_NAMED).join(', ');
  const pages = ownPages.slice(0, WORKSPACE_MAX_NAMED).map(page => page.path).join(', ');
  return `${ownerFolder} imports ${target.name}${names ? ` (${names})` : ''}, but none of its pages (${pages}) names ${target.name} or ${targetFolder} together with a function or schema that a file the page cites imports from it: on one of those pages, say what ${ownerFolder} uses from ${target.name} and for what, naming that function or schema and citing a file that imports it.`;
}
/**
 * Measures how a Wiki of a workspace explains the packages' use of each other: for each workspace package ({@link workspacePackagesOf}) with a page mostly about it ({@link isMostlyAbout}) and each other package its code imports values from ({@link workspaceImportsOf}), one of those pages must name the imported package and a function or schema it uses from it ({@link explainsImport}).
 * Why: Cycle 0118 found a Wiki of P08 (an Expo app and a Hono API that both import a shared package) whose app and API pages never said that their code imports the shared package or what they take from it, so a learner could not see the parts' connection from either app's pages.
 * Called by {@link requireWikiDepthAndWorkspace} beside {@link wikiDepthShortfallsOf}, so both refusals come together and before anything is written. A package without a page of its own owes no sentence here; one package alone is no workspace.
 * @param textOf - Reads an included source's text by path.
 * @param citedPathsOf - Answers the paths a page cites.
 * @returns One sentence for each package and imported package left unexplained; empty otherwise.
 * @example await workspaceShortfallsOf(manifest, indexedSources, textOf, citedPathsOf) // => []
 */
async function workspaceShortfallsOf(manifest, indexedSources, textOf, citedPathsOf) {
  const packages = await workspacePackagesOf(indexedSources, textOf);
  if (packages.length < 2) return [];
  const imports = await workspaceImportsOf(packages, explainedCodeFilesOf(manifest, indexedSources), textOf);
  const shortfalls = [];
  for (const owner of packages) {
    const ownPages = manifest.pages.filter(page => isMostlyAbout(page, owner, packages));
    for (const target of packages) {
      const used = imports.filter(entry => entry.owner === owner && entry.target === target);
      // A package without a page of its own, or that takes nothing from this one, owes no sentence about it.
      if (!ownPages.length || !used.length) continue;
      if (!ownPages.some(page => explainsImport(page, target, used, citedPathsOf(page)))) shortfalls.push(workspaceShortfallOf(owner, target, used, ownPages));
    }
  }
  return shortfalls;
}
/** The most other runtime contexts' main files a refusal of {@link extensionShortfallsOf} names; the rest are counted. */
const EXTENSION_MAX_NAMED = 4;
/** The `manifest_version` values that make a `manifest.json` a browser extension's manifest; a web-app manifest has none. */
const EXTENSION_MANIFEST_VERSIONS = new Set([2, 3]);
/** A folder with one of these names, at any depth below the manifest's folder, holds no extension page that owes a Wiki page. */
const EXTENSION_NON_PAGE_FOLDERS = new Set(['test', 'tests', '__tests__', 'e2e', 'fixtures', 'spec', 'docs', 'examples']);
/** The `src` of a `<script>` tag in an extension page's HTML (group 1 double-quoted, group 2 single-quoted). */
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** The manifest keys that declare one HTML page each, with the label the refusal gives it. Read by {@link declaredContextsOf}. */
const EXTENSION_PAGE_KEYS = [
  ['the popup', manifest => manifest.action?.default_popup],
  ['the popup', manifest => manifest.browser_action?.default_popup],
  ['the popup', manifest => manifest.page_action?.default_popup],
  ['the options page', manifest => manifest.options_page],
  ['the options page', manifest => manifest.options_ui?.page],
  ['the side panel', manifest => manifest.side_panel?.default_path],
  ['the devtools page', manifest => manifest.devtools_page],
  ...['newtab', 'bookmarks', 'history'].map(key => [`the ${key} override page`, manifest => manifest.chrome_url_overrides?.[key]]),
];
/** The string entries of a manifest value that should be an array. */
const stringsOf = value => (Array.isArray(value) ? value : []).filter(entry => typeof entry === 'string');
/** The folder of a path as a prefix: empty for the repository root, else ending with `/`. Called by {@link extensionContextsOf} and {@link pageContextFilesOf}. @example folderPrefixOf('ext/manifest.json') // => 'ext/' */
const folderPrefixOf = path => (posix.dirname(path) === '.' ? '' : `${posix.dirname(path)}/`);
/**
 * Resolves a manifest or HTML reference to a repository path: relative to `folder`, query and hash stripped. An absolute path, a URL or a path that climbs out of `folder` answers null.
 * Called by {@link extensionContextsOf} and {@link pageContextFilesOf}.
 * @param folder - The folder the reference is relative to ({@link folderPrefixOf}).
 * @example extensionPathOf('ext/', 'popup/popup.html?x=1') // => 'ext/popup/popup.html'
 */
function extensionPathOf(folder, value) {
  if (typeof value !== 'string') return null;
  const local = posix.normalize(value.replace(/[?#].*$/, ''));
  // Absolute paths, URLs and values that leave the folder name no file of this extension.
  if (!local || local === '.' || local.startsWith('/') || local === '..' || local.startsWith('../') || /^[a-z][a-z\d+.-]*:/i.test(local)) return null;
  return posix.join(folder, local);
}
/** The runtime contexts a manifest declares, before any file is checked: `{ label, kind, values }` with `values` the raw file references. Called by {@link extensionContextsOf}. @example declaredContextsOf({ background: { service_worker: 'sw.js' } }) // => [{ label: 'the service worker', kind: 'script', values: ['sw.js'] }, …] */
function declaredContextsOf(manifest) {
  const background = manifest.background ?? {};
  const contentScripts = (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).map((group, index) => ({
    label: `the content scripts for ${stringsOf(group?.matches)[0] ?? `group ${index + 1}`}`,
    kind: 'script',
    values: stringsOf(group?.js),
  }));
  return [
    { label: 'the service worker', kind: 'script', values: [background.service_worker] },
    { label: 'the background scripts', kind: 'script', values: stringsOf(background.scripts) },
    { label: 'the background page', kind: 'page', values: [background.page] },
    ...contentScripts,
    ...EXTENSION_PAGE_KEYS.map(([label, pick]) => ({ label, kind: 'page', values: [pick(manifest)] })),
  ];
}
/** An extension page's files: its HTML file, then each local included script its `<script src>` tags load. Called by {@link extensionContextsOf}. @example await pageContextFilesOf('popup/popup.html', indexedSources, textOf) // => ['popup/popup.html', 'popup/popup.js'] */
async function pageContextFilesOf(htmlPath, indexedSources, textOf) {
  const html = await textOf(htmlPath);
  const folder = folderPrefixOf(htmlPath);
  const scripts = [...html.matchAll(SCRIPT_SRC)].map(match => extensionPathOf(folder, match[1] ?? match[2])).filter(path => path && indexedSources.has(path));
  return [htmlPath, ...new Set(scripts)];
}
/**
 * The runtime contexts of one extension manifest that have files in the Wiki's source index: each declared context ({@link declaredContextsOf}) with an included file, and each included `.html` file below the manifest's folder that no declaration names (outside {@link EXTENSION_NON_PAGE_FOLDERS}), which the extension's code opens in a tab.
 * Called by {@link extensionShortfallsOf}.
 * @param manifestPath - The manifest's indexed path.
 * @returns `{ label, main, files }` per context: its label, its main file and every file it loads.
 * @example await extensionContextsOf('manifest.json', manifest, indexedSources, textOf) // => [{ label: 'the popup', main: 'popup/popup.html', files: ['popup/popup.html', 'popup/popup.js'] }]
 */
async function extensionContextsOf(manifestPath, manifest, indexedSources, textOf) {
  const folder = folderPrefixOf(manifestPath);
  const declared = declaredContextsOf(manifest);
  const claimed = new Set(declared.flatMap(context => context.values).map(value => extensionPathOf(folder, value)).filter(Boolean));
  const contexts = [];
  const seenPages = new Set();
  for (const { label, kind, values } of declared) {
    const files = values.map(value => extensionPathOf(folder, value)).filter(path => path && indexedSources.has(path));
    if (!files.length) continue;
    // A page declared twice (options_page and options_ui.page) is one context.
    if (kind === 'page' && seenPages.has(files[0])) continue;
    if (kind === 'page') seenPages.add(files[0]);
    contexts.push({ label, main: files[0], files: kind === 'page' ? await pageContextFilesOf(files[0], indexedSources, textOf) : [...new Set(files)] });
  }
  for (const path of indexedSources.keys()) {
    const inside = path.startsWith(folder) && !posix.dirname(path.slice(folder.length)).split('/').some(segment => EXTENSION_NON_PAGE_FOLDERS.has(segment));
    // An undeclared page is one the extension's code opens itself.
    if (path.toLowerCase().endsWith('.html') && inside && !claimed.has(path) && !seenPages.has(path)) {
      contexts.push({ label: `the extension page ${path}`, main: path, files: await pageContextFilesOf(path, indexedSources, textOf) });
    }
  }
  return contexts;
}
/** Whether a page is the page of its own for a context: among the page's `sources` files that belong to some context (a shared file, or one two contexts load, counts for none), the context has at least one and strictly more than every other single context, so a tie gives no context the page. Called by {@link ownPageShortfallsOf}. @param owners - The owning context index of each file that exactly one context loads. @example isPageOfContext({ sources: [{ path: 'popup/popup.js' }] }, 0, new Map([['popup/popup.js', 0]])) // => true */
const isPageOfContext = (page, index, owners) => {
  const counts = new Map();
  for (const path of new Set((page.sources ?? []).map(source => source.path))) {
    const owner = owners.get(path);
    if (owner !== undefined) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  const own = counts.get(index) ?? 0;
  return own > 0 && [...counts].every(([owner, count]) => owner === index || count < own);
};
/** One refusal sentence per context of one manifest that no page is about alone, naming the context, its main file and up to {@link EXTENSION_MAX_NAMED} other contexts' main files. Called by {@link extensionShortfallsOf}. @example ownPageShortfallsOf(pages, 'manifest.json', contexts) // => ['The Wiki documents a browser extension (manifest.json) but gives the popup (popup.html) no page of its own: …'] */
function ownPageShortfallsOf(pages, manifestPath, contexts) {
  const counts = new Map();
  for (const context of contexts) for (const file of context.files) counts.set(file, (counts.get(file) ?? 0) + 1);
  const owners = new Map();
  contexts.forEach((context, index) => context.files.filter(file => counts.get(file) === 1).forEach(file => owners.set(file, index)));
  const shortfalls = [];
  contexts.forEach((context, index) => {
    if (pages.some(page => isPageOfContext(page, index, owners))) return;
    const others = contexts.filter((_, other) => other !== index).map(other => other.main);
    const more = others.length > EXTENSION_MAX_NAMED ? `, and ${others.length - EXTENSION_MAX_NAMED} more` : '';
    const rest = others.length ? ` (${others.slice(0, EXTENSION_MAX_NAMED).join(', ')}${more})` : '';
    shortfalls.push(`The Wiki documents a browser extension (${manifestPath}) but gives ${context.label} (${context.main}) no page of its own: write a page whose sources name more files of ${context.label} (starting with ${context.main}) than of any other runtime context${rest}.`);
  });
  return shortfalls;
}
/** The parsed manifest at `path` when it is a browser extension's (`manifest_version` 2 or 3), else null: a web-app manifest and unparsable JSON are none. Called by {@link extensionShortfallsOf}. */
async function extensionManifestOf(path, textOf) {
  try {
    const parsed = JSON.parse(await textOf(path));
    return EXTENSION_MANIFEST_VERSIONS.has(parsed?.manifest_version) ? parsed : null;
  } catch {
    return null;
  }
}
/**
 * Measures a Wiki of a browser extension against the runtime-context rule: for each included `manifest.json` with a `manifest_version` of 2 or 3, every runtime context ({@link extensionContextsOf}) needs a page whose `sources` name more files of that context than of any other single context (at least one; a tie gives no context the page), so a page may also cite another context's files. Shared files (the manifest, the README, shared libraries, a script two pages load) belong to no context. A web-app manifest, an unparsable one and a repository without a manifest owe nothing.
 * Why: the first version refused a popup page that also cited the service worker's message handler and a full-page page that cited the settings script, which pushed agents to drop good cross-context citations. Cycle 0123 found a Wiki that gave the service worker of a Chrome extension no page of its own, beside the settings page it shared one with, though the skill asked for a page per context.
 * Called by {@link requireWikiDepthAndWorkspace}.
 * @returns One sentence per context without a page of its own; empty when every context has one or the repository holds no extension.
 * @example await extensionShortfallsOf(manifest, indexedSources, textOf) // => []
 */
async function extensionShortfallsOf(manifest, indexedSources, textOf) {
  const shortfalls = [];
  for (const path of indexedSources.keys()) {
    if (basename(path) !== 'manifest.json') continue;
    const parsed = await extensionManifestOf(path, textOf);
    if (parsed) shortfalls.push(...ownPageShortfallsOf(manifest.pages, path, await extensionContextsOf(path, parsed, indexedSources, textOf)));
  }
  return shortfalls;
}
/**
 * Refuses a Wiki that fails the depth rules ({@link wikiDepthShortfallsOf}) the workspace rule ({@link workspaceShortfallsOf}) or the browser-extension rule ({@link extensionShortfallsOf}), with one refusal that names everything the Wiki still lacks, so the editor AI fixes all of them in one pass.
 * Called by {@link renderWikiPages} once every citation has resolved and the code coverage holds, so a refusal comes before anything is written.
 * @param readers - `citedTextsOf` answers a page's cited sources as quotable text, `citedPathsOf` the paths a page cites, `textOf` an included source's text by path.
 * @throws With the depth sentences first, then the workspace sentences, then the extension sentences.
 * @example await requireWikiDepthAndWorkspace(manifest, indexedSources, { citedTextsOf, citedPathsOf, textOf })
 */
async function requireWikiDepthAndWorkspace(manifest, indexedSources, { citedTextsOf, citedPathsOf, textOf }) {
  const shortfalls = [...await wikiDepthShortfallsOf(manifest, indexedSources, citedTextsOf, textOf), ...await workspaceShortfallsOf(manifest, indexedSources, textOf, citedPathsOf), ...await extensionShortfallsOf(manifest, indexedSources, textOf)];
  if (shortfalls.length) throw new Error(shortfalls.join(' '));
}
/**
 * Refuses a Wiki whose source index holds a file that can hold credentials ({@link CREDENTIAL_FILE_NAME}), by its own name or by the file it resolves to, so a published Wiki never indexes, hashes or cites one and its answers never read one.
 * Why: Cycle 0116 found an editor agent that excluded `.env` but indexed the tracked `.env.e2e` and `.env.test` of the repository it documented; an indexed link such as `config/runtime.json` pointing at `.env.test` reaches the Wiki's answers even when no page cites it.
 * Called by {@link renderWikiPages} once the index is read and before any source is read, so a refusal comes before anything is written.
 * @param includedSources - The manifest's source index, already checked for valid relative paths.
 * @param projectRoot - The repository root those paths are relative to.
 * @throws When an included source's path, or the path it resolves to ({@link resolvedPathOf}), is credential-shaped ({@link isCredentialPath}); the message names the files, sorted, up to {@link MAX_NAMED_UNCOVERED}.
 * @example await requireNoCredentialSources([{ path: 'src/env.ts' }], '/repo') // => undefined (a code file named env is no environment file)
 * @example await requireNoCredentialSources([{ path: '.env.test' }], '/repo') // throws "The Wiki's source index holds 1 file that can hold credentials: .env.test. …"
 */
async function requireNoCredentialSources(includedSources, projectRoot) {
  const root = await realpath(projectRoot), credentialPaths = [];
  for (const { path } of includedSources) {
    if (isCredentialPath(path)) {
      credentialPaths.push(path);
      continue;
    }
    // A link (config/runtime.json pointing at .env.test) is refused by the file it resolves to, cited or not; a missing file holds nothing.
    const target = await resolvedPathOf(root, path);
    if (target !== undefined && isCredentialPath(target)) credentialPaths.push(`${path} (it resolves to ${target})`);
  }
  if (credentialPaths.length) throw new Error(credentialRefusal(credentialPaths.sort()));
}
/** The errors of `realpath` that mean a path reaches no file this user can open: missing, under a file, a link loop, too long, or behind a folder the user may not enter. The editor and the Wiki's answers resolve the path the same way and fail the same way, so such a path exposes nothing. */
const UNREACHABLE_PATH_ERRORS = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG', 'EACCES', 'EPERM']);
/** The path, relative to the repository root and with `/` separators, of the file a repository path resolves to through any link, as the editor's source handler opens it (`realpath` of the joined path); undefined for a path that reaches no file ({@link UNREACHABLE_PATH_ERRORS}). Called by {@link requireNoCredentialSources} and {@link credentialLinkTargetOf}. @param root - The repository root, already resolved. @example await resolvedPathOf('/repo', 'config/runtime.json') // => '.env.test' @example await resolvedPathOf('/repo', 'docs/removed.md') // => undefined */
async function resolvedPathOf(root, path) {
  const file = await realpath(join(root, path)).catch(error => {
    if (UNREACHABLE_PATH_ERRORS.has(error.code)) return undefined;
    throw error;
  });
  return file === undefined ? undefined : relative(root, file).split(sep).join('/');
}
/**
 * The credential-shaped path ({@link isCredentialPath}) an editor link's path reaches: the path as written, or the file the editor's source handler would open for it ({@link resolvedPathOf}), which folds `.` and `..` and follows links.
 * Called by {@link requireNoCredentialLinks} for each inline link of a page.
 * @param root - The repository root, already resolved.
 * @param path - The link's `path` parameter, as the page wrote it.
 * @returns
 * - the path itself, when its own name is credential-shaped (even when no such file exists);
 * - the file it opens, when that one is (`.env.test/x/..` or a link `config/runtime.json` reaches `.env.test`);
 * - undefined, when neither names a file that can hold credentials, or the path holds a NUL byte, which the editor refuses to open.
 * @example await credentialLinkTargetOf('/repo', '.env.test') // => '.env.test'
 * @example await credentialLinkTargetOf('/repo', '.env.test/x/..') // => '.env.test'
 * @example await credentialLinkTargetOf('/repo', 'src/a.ts') // => undefined
 */
async function credentialLinkTargetOf(root, path) {
  if (isCredentialPath(path)) return path;
  // The editor's handler refuses a path holding a NUL byte before resolving it, so such a link opens nothing; resolving it here would throw.
  if (path.includes('\0')) return undefined;
  const target = await resolvedPathOf(root, path);
  return target !== undefined && isCredentialPath(target) ? target : undefined;
}
/** How the refusal of {@link requireNoCredentialLinks} names one refused link: the page and the path it wrote, and the file it opens when the page spelled it otherwise, so the agent sees why the link is refused. @example credentialLinkLabel({ page: 'index.html', path: 'config/runtime.json' }, '.env.test') // => 'index.html → config/runtime.json (it resolves to .env.test)' */
const credentialLinkLabel = (link, target) => target === link.path ? `${link.page} → ${link.path}` : `${link.page} → ${link.path} (it resolves to ${target})`;
/**
 * Refuses a page whose text links to a file that can hold credentials, indexed or not, by the link's own name or the file it opens in the editor ({@link credentialLinkTargetOf}), so an update that moves such a file to `excludedPaths` cannot keep an old inline citation of it, with its path and hash, and no spelling or link opens one in the editor.
 * Called by {@link renderWikiPages} after {@link requireNoCredentialSources} and before any source is read.
 * @param manifest - The manifest's pages.
 * @param projectRoot - The repository root the links are opened in.
 * @throws When an editor source link in a page's text ({@link inlineSourceLinksOf}) reaches a credential-shaped path; the message names each page and path, and the file it reaches when that differs, up to {@link MAX_NAMED_UNCOVERED}.
 * @example await requireNoCredentialLinks({ pages: [{ path: 'index.html', contentHtml: '<a href="vscode://laststance.codebook/source?path=.env.test&amp;line=1">x</a>' }] }, '/repo') // throws "A page links to 1 file that can hold credentials: index.html → .env.test. …"
 */
async function requireNoCredentialLinks(manifest, projectRoot) {
  const root = await realpath(projectRoot);
  const pageLinks = manifest.pages.flatMap(page => inlineSourceLinksOf(page.contentHtml).filter(link => typeof link.path === 'string').map(link => ({ page: page.path, path: link.path })));
  const targets = await Promise.all(pageLinks.map(link => credentialLinkTargetOf(root, link.path)));
  const links = pageLinks.flatMap((link, index) => targets[index] === undefined ? [] : [credentialLinkLabel(link, targets[index])]);
  if (!links.length) return;
  const more = links.length > MAX_NAMED_UNCOVERED ? `, and ${links.length - MAX_NAMED_UNCOVERED} more` : '';
  throw new Error(`A page links to ${links.length} file${links.length === 1 ? '' : 's'} that can hold credentials: ${links.slice(0, MAX_NAMED_UNCOVERED).join(', ')}${more}. Remove each link; a Wiki never cites environment files, private keys or password files.`);
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
/** Renders shared offline pages for {@link publishWiki}; the agent still authors every article and diagram. @throws When the reader data are invalid ({@link validatePages}), the source index holds a file that can hold credentials or a page links to one ({@link requireNoCredentialSources}, {@link requireNoCredentialLinks}), a citation does not match its source, or a rendered page is larger than the reader opens ({@link PAGE_FILE_LIMIT_BYTES}). @example await renderWikiPages(manifest, { projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function renderWikiPages(manifest, { projectRoot, outputDirectory }) {
  validatePages(manifest);
  if (!Array.isArray(manifest.includedSources)) throw new Error('The Wiki needs an included-source index.');
  const indexedSources = new Map();
  for (const source of manifest.includedSources) {
    if (!source || !safePath(source.path) || !/^[a-f0-9]{64}$/.test(source.sha256) || indexedSources.has(source.path)) throw new Error('The Wiki source index has an invalid path, hash or duplicate.');
    indexedSources.set(source.path, source);
  }
  await requireNoCredentialSources(manifest.includedSources, projectRoot);
  await requireNoCredentialLinks(manifest, projectRoot);
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
  // A page's cited sources (its source list, diagram sources and inline links that name an indexed source at a line inside it, all read above) as quotable text, read once per file.
  const quotableTexts = new Map();
  const quotableTextOf = path => {
    if (!quotableTexts.has(path)) quotableTexts.set(path, quotableSourceTextOf(sourceLines.get(path) ?? []));
    return quotableTexts.get(path);
  };
  // An inline link counts for its page only as the coverage rule counts it (verifiedInlinePathsOf): a line past the end of the file cites nothing.
  const inlinePathsOf = page => inlineSourceLinksOf(page.contentHtml).filter(link => namesIndexedSource(link, indexedSources.get(link.path), projectRoot) && Number(link.line) <= (sourceLines.get(link.path) ?? []).length).map(link => link.path);
  const citedPathsOfPage = page => new Set([...[...page.sources, ...(page.diagrams ?? []).flatMap(diagram => [...diagram.nodes, ...diagram.edges].flatMap(element => element.sources))].map(reference => reference.path), ...inlinePathsOf(page)]);
  const citedTextsOf = page => [...citedPathsOfPage(page)].map(quotableTextOf);
  const textOf = async path => (await linesOf(indexedSources.get(path))).join('\n');
  await requireWikiDepthAndWorkspace(manifest, indexedSources, { citedTextsOf, citedPathsOf: citedPathsOfPage, textOf });
  return pages;
}
