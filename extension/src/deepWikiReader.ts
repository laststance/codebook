import { randomBytes } from 'node:crypto'
import { lstat, realpath, type FileHandle } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { join, relative, sep } from 'node:path'

import {
  MS_PER_MINUTE,
  WIKI_ENTRY_FILE,
  WIKI_FRESHNESS_MIN_INTERVAL_MS,
  WIKI_FRESHNESS_ROUTE,
  WIKI_HTTP_BODY_LIMIT_BYTES,
  WIKI_LOOPBACK_HOSTS,
  WIKI_MANIFEST_FILE,
  WIKI_MISSING_PAGE_PATH_LIMIT_CHARS,
  WIKI_MISSING_PAGE_TEXT_DELAY_MS,
  WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE,
  WIKI_PAGE_FILE_LIMIT_BYTES,
  WIKI_PAGE_NAVIGATION_DESTINATIONS,
  WIKI_PAGE_SERVE_DEADLINE_MS,
  WIKI_QUESTION_LIMIT_CHARS,
  WIKI_QUESTION_ROUTE,
  WIKI_QUESTION_STATUS_STYLE,
  WIKI_REFUSED_STEP_ADVICE,
  WIKI_RESPONSE_PART_BYTES,
  WIKI_RESPONSE_SEND_LIMIT_MS,
  WIKI_SHELL_SCRIPT_HASHES,
  WIKI_SOURCE_CHANGE_DEBOUNCE_MS,
  WIKI_UPDATE_IDLE_POLL_MS,
  WIKI_UPDATE_REASON_LIMIT_CHARS,
  WIKI_UPDATE_RECOVERY_REQUEST,
  WIKI_UPDATE_SHOWN_PATH_LIMIT,
  WIKI_UPDATE_START_WAIT_MS,
  WIKI_UPDATE_STATUS_POLL_MS,
  WIKI_UPDATE_STATUS_RETRY_LIMIT,
  WIKI_UPDATE_STATUS_ROUTE,
} from './constants'
import type {
  WikiAnswer,
  WikiIncludedSource,
} from './utils/answerDeepWikiQuestion'
import { assertNoLinkOnWikiPath } from './utils/assertNoLinkOnWikiPath'
import { describeWikiUpdate } from './utils/describeWikiUpdate'
import {
  inspectDeepWikiFreshness,
  type WikiFreshness,
} from './utils/inspectDeepWikiFreshness'
import { installShortcutHelp } from './utils/installShortcutHelp'
import {
  installWikiUpdateStatus,
  type WikiUpdateStatusAnswer,
} from './utils/installWikiUpdateStatus'
import { isInsideFolder } from './utils/isInsideFolder'
import { isWikiSourceCandidate } from './utils/isWikiSourceCandidate'
import { labelQuestionField } from './utils/labelQuestionField'
import { openWithoutFollowing } from './utils/openWithoutFollowing'
import { readUpToLimit } from './utils/readUpToLimit'
import { readWikiFileToOpen } from './utils/readWikiFileToOpen'
import { readWikiPublicationIdentity } from './utils/readWikiPublicationIdentity'
import { readWikiPublishedAt } from './utils/readWikiPublishedAt'
import { takeWikiPagePlace } from './utils/takeWikiPagePlace'
import {
  wikiPageRefusalHtml,
  type WikiPageRefusalReason,
} from './utils/wikiPageRefusalHtml'
import type { WikiUpdateStatus } from './utils/wikiUpdateRun'
import { servedWikiPageOffThread } from './wikiPageWorker'

/** A started Wiki reader: where the browser opens it, how it is told where the editor forwards it and that a project file changed, and how it is closed. */
export type DeepWikiReader = {
  url: string
  /** Tells the reader which address the editor forwards it to (a remote window forwards the loopback port, often to another one), so a question from its own page at that address is answered. Only an address on this machine is accepted; any other is ignored. @param address - The reader's URL as `vscode.env.asExternalUri` resolved it. */
  acceptForwardedOrigin(address: string): void
  /** Tells the reader that a file of the project was changed, created or deleted, whoever wrote it; the reader raises its source-change stamp when the file can change the Wiki's freshness. @param path - Absolute path of the file. */
  noteSourceChange(path: string): void
  close(): Promise<void>
}
type WikiQuestionResult = WikiAnswer | { handoff: string }
type AnswerQuestion = (
  question: string,
  sources: WikiIncludedSource[],
  signal: AbortSignal,
) => Promise<WikiQuestionResult>

const qaClient = `(function () {
  var path = window.location.pathname;
  var prefix = path.slice(0, path.indexOf('/', 3) + 1);
  var helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.setAttribute('data-shortcut-help', '');
  helpButton.setAttribute('aria-label', 'Keyboard shortcuts');
  helpButton.setAttribute('aria-keyshortcuts', '?');
  helpButton.append(document.createTextNode('Keyboard shortcuts '));
  var helpKey = document.createElement('kbd'); helpKey.textContent = '?'; helpButton.append(helpKey);
  (document.querySelector('.repo-meta') || document.querySelector('.site-header') || document.body).append(helpButton);
  var helpStyle = document.createElement('style');
  helpStyle.textContent = '[data-shortcut-help]{cursor:pointer;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;padding:4px 8px}[data-shortcut-help] kbd,.shortcut-row kbd{border:1px solid currentColor;border-radius:4px;padding:1px 5px}.shortcut-dialog{max-width:min(36rem,90vw);width:100%;padding:1.5rem;border:1px solid var(--border,#777);border-radius:12px;color:var(--text,CanvasText);background:var(--panel,Canvas);box-shadow:0 16px 48px #0005}.shortcut-dialog::backdrop{background:#0008}.shortcut-dialog input{display:block;width:100%;margin:1rem 0;padding:.5rem;border:1px solid var(--border,#777);background:var(--panel-2,Canvas);color:var(--text,CanvasText)}.shortcut-row{display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0}.shortcut-dialog button{cursor:pointer;border:1px solid var(--border,ButtonBorder);border-radius:4px;padding:.3rem .6rem;background:var(--panel-2,ButtonFace);color:var(--text,ButtonText)}.shortcut-tooltip{position:fixed;z-index:1000;bottom:1rem;right:1rem;padding:.4rem .7rem;border-radius:5px;background:var(--panel-2,CanvasText);color:var(--text,Canvas);box-shadow:0 2px 12px #0004}';
  document.head.append(helpStyle);
  (${installShortcutHelp.toString()})([
    { action: 'Keyboard shortcuts', keys: '?', context: 'DeepWiki, outside text inputs', selector: '[data-shortcut-help]' },
    { action: 'Close keyboard shortcuts', keys: 'Esc', context: 'Keyboard shortcuts dialog' }
  ], 'body');
  (${installWikiUpdateStatus.toString()})({ readerPrefix: prefix, pagePublication: (document.currentScript && document.currentScript.getAttribute('data-codebook-publication')) || undefined, updateStatusRoute: '${WIKI_UPDATE_STATUS_ROUTE}', freshnessRoute: '${WIKI_FRESHNESS_ROUTE}', describeUpdate: (${describeWikiUpdate.toString()}), statusPollMs: ${WIKI_UPDATE_STATUS_POLL_MS}, idlePollMs: ${WIKI_UPDATE_IDLE_POLL_MS}, freshnessMinIntervalMs: ${WIKI_FRESHNESS_MIN_INTERVAL_MS}, startWaitMs: ${WIKI_UPDATE_START_WAIT_MS}, statusRetryLimit: ${WIKI_UPDATE_STATUS_RETRY_LIMIT}, pathLimit: ${WIKI_UPDATE_SHOWN_PATH_LIMIT}, reasonLimitChars: ${WIKI_UPDATE_REASON_LIMIT_CHARS}, msPerMinute: ${MS_PER_MINUTE}, recoveryRequest: ${JSON.stringify(WIKI_UPDATE_RECOVERY_REQUEST)}, outsideOutputApprovalsNote: ${JSON.stringify(WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE)}, refusedStepAdvice: ${JSON.stringify(WIKI_REFUSED_STEP_ADVICE)}, missingPageTextDelayMs: ${WIKI_MISSING_PAGE_TEXT_DELAY_MS}, missingPagePathLimitChars: ${WIKI_MISSING_PAGE_PATH_LIMIT_CHARS} });
  // The shell's form by its element and its id together: a page published before the publisher kept the ids of a page's content apart from the reader's may carry the id on a heading of its article, which stands before the form.
  var form = document.querySelector('form#qa-form, [data-codebook-question]');
  if (!form) return;
  // On such a page the label of the question field may name that heading instead; a field nothing names gets the label's words itself.
  var field = form.querySelector('textarea, input[name="question"]');
  if (field) (${labelQuestionField.toString()})(field);
  var status = document.querySelector('[data-codebook-status]');
  if (status) { status.textContent = '● Connected to Codebook reader'; status.classList.remove('unavailable'); }
  var submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = 'Ask Codebook';
  // The question's progress is told by a status line that is in the page, drawn and empty, before its first text: the answer's own status region waits in a disclosure that stays hidden until the first question, and a region shown together with its first text is not announced. A page published before the shell carried the line gets one here, in front of the answer's disclosure.
  var questionStatus = form.querySelector('[data-codebook-question-status]');
  if (!questionStatus) {
    questionStatus = document.createElement('p');
    questionStatus.className = 'qa-status';
    questionStatus.setAttribute('role', 'status');
    questionStatus.setAttribute('aria-live', 'polite');
    questionStatus.setAttribute('data-codebook-question-status', '');
    var answerRegion = form.querySelector('.qa-answer, [data-codebook-answer]');
    var answerDisclosure = answerRegion && answerRegion.closest('details');
    var answerPlace = answerDisclosure && form.contains(answerDisclosure) ? answerDisclosure : answerRegion;
    if (answerPlace) answerPlace.parentNode.insertBefore(questionStatus, answerPlace); else form.append(questionStatus);
    var questionStatusStyle = document.createElement('style');
    questionStatusStyle.textContent = ${JSON.stringify(WIKI_QUESTION_STATUS_STYLE)};
    document.head.append(questionStatusStyle);
  }
  // Only the latest question writes the status line and the answer when its reply comes.
  var questionsAsked = 0;
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); event.stopImmediatePropagation();
    var input = form.querySelector('textarea, input[name="question"]');
    var output = form.querySelector('.qa-answer, [data-codebook-answer]');
    if (!input || !output) return;
    var question = input.value.trim();
    if (!question) return;
    // The answer's disclosure is opened here too: the page's own script opens the element with the disclosure's id, which on such a page may be a heading of the article.
    var disclosure = output.closest('details');
    if (disclosure) { disclosure.hidden = false; disclosure.open = true; }
    // The answer's region is shown and emptied now, so the answer written after the request changes a region already in the page; the progress goes to the status line, which was there before it.
    output.style.display = 'block'; output.textContent = '';
    var asked = ++questionsAsked;
    questionStatus.textContent = 'Asking the editor model…';
    // A hand-off or a failure can come back within the frame that showed the answer's region, which would enter the page together with that text: the sentence is the status line's, which was in the page before it, and the answer's empty disclosure leaves again. A newer question keeps its own progress and disclosure.
    var tell = function (sentence) {
      if (asked !== questionsAsked) return;
      questionStatus.textContent = sentence;
      if (disclosure) disclosure.hidden = true;
    };
    try {
      var response = await fetch(prefix + '${WIKI_QUESTION_ROUTE}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The editor model could not answer.');
      if (result.handoff) { tell(result.handoff); return; }
      // An earlier question's answer that comes after a newer question was asked writes nothing: the region shows, and announces, the newer question's answer alone.
      if (asked !== questionsAsked) return;
      questionStatus.textContent = '';
      output.textContent = result.answer;
      if (result.sourceChanged) { var stale = document.createElement('p'); stale.textContent = 'Some indexed source changed. Update LLM Wiki before relying on this answer.'; output.appendChild(stale); }
      var list = document.createElement('ul');
      result.citations.forEach(function (citation) { var item = document.createElement('li'); var link = document.createElement('a'); link.href = citation.uri; link.textContent = citation.path + ':' + citation.line; item.appendChild(link); list.appendChild(item); });
      output.appendChild(list);
    } catch (error) { tell(String(error)); }
  }, true);
})();`

/** The fetch directives of every page the reader serves: a page fetches its images (and `data:` images), media, styles, fonts and requests from the reader's own address alone, opens no frame and submits a form only to that address. An address of another host (`//host`, `http://other`) or a frame that the filter left therefore fetches nothing under the reader; the reader's own features (the question route, the update panel, the theme, the keyboard help, inline styles and the Wiki's images) all stay on its address. */
const SERVED_PAGE_FETCH_DIRECTIVES =
  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'"
/** The policy of every page the reader serves, a refusal page included: a script runs only from a file of this origin, where the reader's own is the one served as script, or as the shell's own, by its hash; never one the page's content or a hand-written file carries. Everything else the page fetches, frames or submits stays on this origin ({@link SERVED_PAGE_FETCH_DIRECTIVES}). */
const SERVED_PAGE_POLICY = `${SERVED_PAGE_FETCH_DIRECTIVES}; script-src 'self' ${WIKI_SHELL_SCRIPT_HASHES.map((hash) => `'sha256-${hash}'`).join(' ')}; object-src 'none'; base-uri 'none'`

/** Validates the generated output owner before the reader serves files or accepts repository questions; the manifest is read as a regular file of bounded size and never through a link ({@link readWikiFileToOpen}), and only when there is none at the Wiki folder or on its path in the project (a link, a file, or a folder whose real path leaves the project; {@link assertNoLinkOnWikiPath}), which the publisher refuses too. @param outputDirectory - Resolved Wiki output. @param projectRoot - Canonical opened repository. @returns The published file allowlist and included sources. @throws When the Wiki folder or a folder on its path in the project is a link, a file, or a folder whose real path leaves the project, and when the manifest is missing, no regular file, no JSON or does not identify a complete Wiki of this project. @example await readDeepWikiManifest('/repo/.codebook/wiki', '/repo') */
export async function readDeepWikiManifest(
  outputDirectory: string,
  projectRoot: string,
): Promise<{
  files: Set<string>
  sources: WikiIncludedSource[]
  revision?: string
  excludedPaths: string[]
}> {
  await assertNoLinkOnWikiPath(outputDirectory, projectRoot)
  // The manifest is read as a file of the Wiki folder, never through a link and never past its bound.
  const manifestBytes = await readWikiFileToOpen(
    join(outputDirectory, WIKI_MANIFEST_FILE),
    'manifest',
  )
  const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'))
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('schemaVersion' in manifest) ||
    manifest.schemaVersion !== 1 ||
    !('repositoryRoot' in manifest) ||
    manifest.repositoryRoot !== projectRoot ||
    !('pages' in manifest) ||
    !Array.isArray(manifest.pages) ||
    !('assets' in manifest) ||
    !Array.isArray(manifest.assets) ||
    !('includedSources' in manifest) ||
    !Array.isArray(manifest.includedSources)
  )
    throw new Error(
      'The DeepWiki manifest does not identify a complete Wiki for this opened project.',
    )
  const pages = manifest.pages,
    assets = manifest.assets,
    includedSources = manifest.includedSources
  const paths = [
    WIKI_ENTRY_FILE,
    ...pages.map((page) =>
      typeof page === 'object' && page !== null && 'path' in page
        ? page.path
        : undefined,
    ),
    ...assets,
  ]
  if (
    paths.some(
      (path) =>
        typeof path !== 'string' ||
        !path ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.includes('\0') ||
        path.split('/').includes('..'),
    )
  )
    throw new Error('The DeepWiki manifest contains an invalid output path.')
  const sources = includedSources.filter(
    (source) =>
      typeof source === 'object' &&
      source !== null &&
      'path' in source &&
      typeof source.path === 'string' &&
      'sha256' in source &&
      typeof source.sha256 === 'string' &&
      /^[a-f0-9]{64}$/i.test(source.sha256),
  )
  if (
    sources.length !== includedSources.length ||
    new Set(sources.map((source) => source.path)).size !== sources.length
  )
    throw new Error(
      'The DeepWiki manifest contains invalid or duplicate included source identities.',
    )
  const generated =
    'generated' in manifest &&
    typeof manifest.generated === 'object' &&
    manifest.generated !== null
      ? manifest.generated
      : undefined
  const revision =
    generated &&
    'revision' in generated &&
    typeof generated.revision === 'string'
      ? generated.revision
      : undefined
  const excludedPaths =
    'excludedPaths' in manifest && Array.isArray(manifest.excludedPaths)
      ? manifest.excludedPaths.filter(
          (path: unknown): path is string => typeof path === 'string',
        )
      : []
  return { files: new Set(paths), sources, revision, excludedPaths }
}

/** Serves one generated Wiki on loopback and binds its editor links when the current host opens it. @param outputDirectory - Generated Wiki directory. @param projectRoot - Canonical opened repository. @param answerQuestion - Editor model request with validated source context. @param editorScheme - Active editor URI scheme. @param readUpdateStatus - The window's Wiki update run state; served at `api/update-status` when the run is for this reader's folder, else the reader answers idle. @returns The loopback URL, the entries for the forwarded address and for reported file changes, and the owned close operation. @example const reader = await startDeepWikiReader('/repo/.codebook/wiki', '/repo', answer, 'cursor') */
export async function startDeepWikiReader(
  outputDirectory: string,
  projectRoot: string,
  answerQuestion: AnswerQuestion,
  editorScheme: 'vscode' | 'cursor' = 'vscode',
  readUpdateStatus: () => WikiUpdateStatus = () => ({ state: 'idle' }),
): Promise<DeepWikiReader> {
  /** What the manifest last read says the Wiki covers: its indexed paths and its exclusions. A reported file change is weighed against them. */
  let coveredSource: { indexedPaths: Set<string>; excludedPaths: string[] } = {
    indexedPaths: new Set(),
    excludedPaths: [],
  }
  /** Reads the manifest for a request and keeps what it says the Wiki covers. @throws When the manifest is missing or does not identify this project's Wiki. */
  const readManifest = async (): ReturnType<typeof readDeepWikiManifest> => {
    const manifest = await readDeepWikiManifest(outputDirectory, projectRoot)
    coveredSource = {
      indexedPaths: new Set(manifest.sources.map((source) => source.path)),
      excludedPaths: manifest.excludedPaths,
    }
    return manifest
  }
  /**
   * Says whether a changed file is one the freshness check weighs, against what the manifest last read covers; asked by {@link DeepWikiReader.noteSourceChange} for every reported change, before it arms the burst timer.
   * @param projectPath - The changed file relative to the project, with forward slashes; it begins with `../` for a file outside the project.
   * @returns `true` for an indexed source, and for a file of the project the freshness check would count as added; `false` for a file outside the project, in the Wiki folder or excluded.
   * @example
   * isWeighedByFreshness('src/new.ts')      // => true
   * isWeighedByFreshness('../other/app.ts') // => false
   */
  const isWeighedByFreshness = (projectPath: string): boolean =>
    coveredSource.indexedPaths.has(projectPath) ||
    (!projectPath.startsWith('../') &&
      isWikiSourceCandidate(
        projectPath,
        relative(projectRoot, outputDirectory).split(sep).join('/'),
        coveredSource.excludedPaths,
      ))
  await readManifest()
  const canonicalOutput = await realpath(outputDirectory)
  /** Rises once per burst of file changes that can change the Wiki's freshness; the page reads freshness again when its update state answers a higher one. */
  let sourceChangeStamp = 0
  let sourceChangeTimer: NodeJS.Timeout | undefined
  const token = randomBytes(24).toString('hex')
  const prefix = `/w/${token}/`
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response)
    } catch (error) {
      if (!response.writableEnded && !response.headersSent)
        sendJson(response, 500, { error: String(error) })
      else response.destroy(error instanceof Error ? error : undefined)
    }
  })
  let origin = ''
  /** The origin of the address the editor forwards this reader to, when that is another loopback address than its own. */
  let forwardedOrigin: string | undefined
  /** The freshness inspection in flight and the generation of the site it reads; requests of that generation that overlap await it. */
  let freshnessInspection:
    { generation: string; result: Promise<WikiFreshness> } | undefined
  /** Inspects the Wiki's freshness once for every request that overlaps, because one inspection hashes each indexed source and runs Git; called by the freshness route. A request made after a publish names another generation and starts its own inspection, so it is never answered from the older manifest. @returns The freshness of the site on disk against the source. @throws When the manifest cannot be read (a publish is replacing the site). @example sendJson(response, 200, await inspectFreshnessShared()) */
  async function inspectFreshnessShared(): Promise<WikiFreshness> {
    // Named before the manifest is read, so an inspection a request joins has read a manifest at least as new as the one that request saw.
    const generation = `${await readWikiPublishedAt(outputDirectory)}|${sourceChangeStamp}`
    if (freshnessInspection?.generation === generation)
      return freshnessInspection.result
    const result = (async (): Promise<WikiFreshness> => {
      const { sources, revision, excludedPaths } = await readManifest()
      return inspectDeepWikiFreshness(
        projectRoot,
        sources,
        revision,
        excludedPaths,
        { outputDirectory },
      )
    })()
    const inspection = { generation, result }
    freshnessInspection = inspection
    try {
      return await result
    } finally {
      if (freshnessInspection === inspection) freshnessInspection = undefined
    }
  }
  /** The manifest read in flight for the requests that are no page, which every such request that comes meanwhile joins ({@link readManifestShared}). */
  let sharedManifestRead: ReturnType<typeof readDeepWikiManifest> | undefined
  /**
   * Reads the manifest for a request that is no page ({@link readManifest}): a request that comes while such a read is in flight joins it instead of reading and parsing the manifest once more, so the style sheets, images and fonts a page asks for at once cost one read between them, on the extension host's thread, however many they are.
   * Called by the reader for a file of the Wiki that is no page and for a question; a page reads the manifest itself, under its place among the pages in hand ({@link takeWikiPagePlace}). A request that joins gets the manifest of a read that began before it came, as a read that ended just before it came would have given it.
   * @returns The manifest, as {@link readDeepWikiManifest} answers it.
   * @throws What the read throws, to every request that joined it.
   * @example const { files } = await readManifestShared()
   */
  const readManifestShared = (): ReturnType<typeof readDeepWikiManifest> => {
    sharedManifestRead ??= readManifest().finally(() => {
      sharedManifestRead = undefined
    })
    return sharedManifestRead
  }
  /**
   * Answers the page asked for with the refusal page of its reason, status 503, under the page policy.
   * @param response - The page's answer.
   * @param relativePath - The page's path in the Wiki; the overview's refusal page has no link to itself.
   * @param reason - Why the page is not served.
   * @example refusePage(response, 'guide.html', 'busy')
   */
  const refusePage = (
    response: ServerResponse,
    relativePath: string,
    reason: WikiPageRefusalReason,
  ): void => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Content-Security-Policy', SERVED_PAGE_POLICY)
    response.statusCode = 503
    endWithinSendLimit(
      response,
      wikiPageRefusalHtml(
        reason,
        WIKI_PAGE_SERVE_DEADLINE_MS,
        prefix,
        relativePath,
      ),
    )
  }
  /** Routes only owned pages and questions; every request must carry this reader's random path token. @example await handleRequest(request, response) */
  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Referrer-Policy', 'no-referrer')
    // Every response says nosniff, its pages, its answers and the reader's own script included: a browser then runs as script only a response typed as JavaScript, and the reader's own script is the one.
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    const url = new URL(request.url ?? '/', origin)
    if (!url.pathname.startsWith(prefix)) {
      sendJson(response, 404, { error: 'Unknown Wiki reader.' })
      return
    }
    const relativePath =
      decodeURIComponent(url.pathname.slice(prefix.length)) || WIKI_ENTRY_FILE
    // The update state needs no valid manifest, so it answers while a publish is replacing the site.
    if (relativePath === WIKI_UPDATE_STATUS_ROUTE) {
      await answerUpdateStatus(request, response)
      return
    }
    if (relativePath === WIKI_FRESHNESS_ROUTE) {
      if (request.method !== 'GET') {
        sendGetOnly(response)
        return
      }
      sendJson(response, 200, await inspectFreshnessShared())
      return
    }
    if (relativePath === WIKI_QUESTION_ROUTE) {
      await answerQuestionRequest(request, response)
      return
    }
    if (request.method !== 'GET') {
      sendGetOnly(response)
      return
    }
    // The reader's own script needs no manifest.
    if (relativePath === 'codebook-qa.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      endWithinSendLimit(response, qaClient)
      return
    }
    if (relativePath.endsWith('.html')) {
      await answerPageRequest(request, response, relativePath)
      return
    }
    // An agent may publish a new owned directory while this reader stays open.
    const { files } = await readManifestShared()
    await answerWikiFile(response, relativePath, files)
  }
  /**
   * Answers the update state of the Wiki: the window's Wiki update run when it is for this reader's folder, when the site on disk was published, its publication identity and the source-change stamp. The manifest is neither parsed nor checked here, so the route answers while a publish is replacing the site: only the publication identity ({@link readWikiPublicationIdentity}) looks at the manifest's file, and reads and hashes its bytes once a publish has changed it, with no identity while the manifest is missing or mid-replacement.
   * Called by {@link handleRequest} for the update state route, which the page's script asks at every look.
   * @param request - The request; only GET is answered.
   * @param response - Its answer.
   * @example await answerUpdateStatus(request, response)
   */
  async function answerUpdateStatus(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET') {
      sendGetOnly(response)
      return
    }
    const windowStatus = readUpdateStatus()
    // The window holds one run state whatever folder that run is for; after the output setting changed, a reader of another folder has no run of its own.
    const ownStatus: WikiUpdateStatus =
      windowStatus.state === 'idle' ||
      windowStatus.outputDirectory === outputDirectory
        ? windowStatus
        : { state: 'idle' }
    // The publish time lets the page tell a publish after the run ended from a source that went back by itself.
    sendJson(response, 200, {
      ...ownStatus,
      sitePublishedAt: await readWikiPublishedAt(outputDirectory),
      // The page compares it with the publication it was served from: a difference means newer pages are on disk.
      publication: await readWikiPublicationIdentity(outputDirectory),
      // Cheap to answer at every look: the page asks for the costly freshness check only when it rose.
      sourceChangeStamp,
    } satisfies WikiUpdateStatusAnswer)
  }
  /**
   * Answers a question of the reader's own page with the editor model's answer, from the included sources of the manifest; a request that is no such question is refused before the manifest is read.
   * Called by {@link handleRequest} for the question route.
   * @param request - The question's request.
   * @param response - Its answer.
   * @example await answerQuestionRequest(request, response)
   */
  async function answerQuestionRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isQuestionOfOwnPage(request)) {
      sendJson(response, 403, {
        error: 'This Wiki question must come from its reader.',
      })
      return
    }
    const bodyParts: Buffer[] = []
    let bodyBytes = 0
    for await (const part of request) {
      bodyParts.push(part)
      bodyBytes += part.length
      if (bodyBytes > WIKI_HTTP_BODY_LIMIT_BYTES) {
        sendJson(response, 413, { error: 'The Wiki question is too long.' })
        return
      }
    }
    // The body is decoded whole: a character whose bytes two parts share is one character, not two replacement characters.
    const question = questionOf(Buffer.concat(bodyParts).toString('utf8'))
    if (question === undefined) {
      sendJson(response, 400, { error: 'Enter a shorter Wiki question.' })
      return
    }
    // An agent may publish a new owned directory while this reader stays open: the question is answered from the sources the manifest names now.
    const { sources } = await readManifestShared()
    // A client that went while the body or the manifest was read is closed already, and no model is asked for it; one that goes later stops its question when its answer closes. Both are looked at in one step, so no close falls between them.
    if (response.destroyed) return
    const controller = new AbortController()
    response.on('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    try {
      sendJson(
        response,
        200,
        await answerQuestion(question, sources, controller.signal),
      )
    } catch (error) {
      if (!response.writableEnded)
        sendJson(response, 503, { error: String(error) })
    }
  }
  /**
   * Says whether a request to the question route is a question of this reader's own page: a POST of JSON from the reader's address, or from the one the editor forwards it to.
   * Called by {@link answerQuestionRequest} before it reads the request's body.
   * @param request - The request.
   * @returns `true` for such a question; `false` for any other request, also one without an origin, which comes from no page of this reader.
   * @example isQuestionOfOwnPage(request) // => false for a request from another origin
   */
  function isQuestionOfOwnPage(request: IncomingMessage): boolean {
    const askedFrom = request.headers.origin
    // The reader's own page asks from the reader's address, or from the one the editor forwards it to; a request without an origin is no page of this reader.
    const isOwnPage =
      askedFrom !== undefined &&
      (askedFrom === origin || askedFrom === forwardedOrigin)
    return (
      request.method === 'POST' &&
      isOwnPage &&
      request.headers['content-type']?.split(';')[0] === 'application/json'
    )
  }
  /**
   * Answers a request for a page of the Wiki: a page opened as a page is read, prepared off the host's thread and served under its place among the pages in hand ({@link takeWikiPagePlace}); a page asked for as a part of a page is refused, before any file is read for it.
   * Called by {@link handleRequest} for every GET of a path that ends with `.html`.
   * @param request - The page's request; its `Sec-Fetch-Dest` says how the browser opens it.
   * @param response - Its answer.
   * @param relativePath - The page's path in the Wiki.
   * @example await answerPageRequest(request, response, 'index.html')
   */
  async function answerPageRequest(
    request: IncomingMessage,
    response: ServerResponse,
    relativePath: string,
  ): Promise<void> {
    const destination = request.headers['sec-fetch-dest']
    // A page is prepared only for a browser that opens it: one asked for as an image, a style sheet or another part of a page would start a page worker for nothing, many at a time from one page; a client that names no destination is no browser and is served.
    if (
      destination !== undefined &&
      !(
        typeof destination === 'string' &&
        WIKI_PAGE_NAVIGATION_DESTINATIONS.includes(destination)
      )
    ) {
      sendJson(response, 403, {
        error: 'A Wiki page is served only to be opened as a page.',
      })
      return
    }
    // A page takes its place among the pages in hand before any file is read for it, the manifest and the publication identity included.
    const givePlaceBack = takeWikiPagePlace()
    // Every place for pages in hand is taken: no file is read, as the page could only be refused after it.
    if (!givePlaceBack) {
      refusePage(response, relativePath, 'busy')
      return
    }
    // The place is held until the page's answer has closed and the reader's work for the page has ended: a browser that does not read its page keeps the page's bytes in the host until its answer closes, and one that goes while the reader reads for it closes its answer before the reads end, so a place given back at that close let a further page in while the gone one still read (Codex's probe held 12 open files and 24 MiB against six). The close is watched before anything is awaited for the page, so none is missed: the answer has not closed yet, as nothing was awaited since the request came.
    const answerClosed = new Promise<void>((resolveClosed) => {
      response.once('close', () => resolveClosed())
    })
    const work = servePage(response, relativePath)
    // The later of the two ends gives the place back, whichever way the work ended; the request's handler does not wait for the close, so a failed page is answered at once.
    void Promise.allSettled([work, answerClosed]).then(() => givePlaceBack())
    await work
  }
  /**
   * Reads what a page needs (the manifest, its file's look, the publication identity) and serves it ({@link prepareAndSendPage}), and stops after the read in hand once the page's browser has gone, so a gone request holds its place only while that read ends.
   * Called by {@link answerPageRequest} once the page has taken its place.
   * @param response - The page's answer.
   * @param relativePath - The page's path in the Wiki.
   * @example await servePage(response, 'index.html')
   */
  async function servePage(
    response: ServerResponse,
    relativePath: string,
  ): Promise<void> {
    // An agent may publish a new owned directory while this reader stays open.
    const { files } = await readManifest()
    // A browser that went while the manifest was read gets no page: nothing more is read for it.
    if (response.destroyed) return
    // A page the last update removed or renamed sends the learner to the overview instead of a JSON error, and the overview is told which page was asked for, so it can say so.
    if (!files.has(relativePath)) {
      response.writeHead(302, {
        Location: `${prefix}${WIKI_ENTRY_FILE}?missing=${encodeURIComponent(relativePath)}`,
      })
      endWithinSendLimit(response)
      return
    }
    const servedFile = await lookAtServedFile(response, relativePath)
    if (!servedFile || response.destroyed) return
    // Read before the page itself: a publish between the two reads then leaves the page with the older identity, and it offers a reload instead of hiding one.
    const publication = await readWikiPublicationIdentity(outputDirectory)
    if (response.destroyed) return
    await prepareAndSendPage(response, relativePath, servedFile, publication)
  }
  /**
   * Reads a page file of the Wiki within the page file limit, prepares it on a page worker under its deadline and sends the page as served, or the refusal page of why it is not; the file is closed before the page is prepared.
   * Called by {@link servePage} once the page's place is taken and its file was looked at.
   * @param response - The page's answer.
   * @param relativePath - The page's path in the Wiki.
   * @param servedFile - The page file's real path and its size at the look.
   * @param publication - The publication identity read for the page, which the reader's script compares with the one on disk.
   * @example await prepareAndSendPage(response, 'index.html', { filePath: '/repo/.codebook/wiki/index.html', sizeBytes: 2021 }, publication)
   */
  async function prepareAndSendPage(
    response: ServerResponse,
    relativePath: string,
    { filePath, sizeBytes }: { filePath: string; sizeBytes: number },
    publication: Awaited<ReturnType<typeof readWikiPublicationIdentity>>,
  ): Promise<void> {
    // The page's place is taken, and given back once its answer has left the host or its connection has closed, and the reader's work for it has ended.
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Content-Security-Policy', SERVED_PAGE_POLICY)
    if (sizeBytes > WIKI_PAGE_FILE_LIMIT_BYTES) {
      refusePage(response, relativePath, 'too-large')
      return
    }
    const pageFile = await openServedWikiFile(filePath)
    // Another entry took the path between the look and the open.
    if (!pageFile) {
      sendNoRegularFile(response)
      return
    }
    let content: Buffer | undefined
    try {
      // A browser that went while the page was opened gets no page: its file is closed unread.
      if (response.destroyed) return
      content = await readUpToLimit(
        pageFile.file,
        pageFile.sizeBytes,
        WIKI_PAGE_FILE_LIMIT_BYTES,
      )
    } finally {
      await pageFile.file.close()
    }
    if (!content) {
      refusePage(response, relativePath, 'too-large')
      return
    }
    // The page is prepared on a worker thread under a deadline, so a page built to make the parser slow stops no extension of the window.
    const preparation = new AbortController()
    // A request that went while the reader read the files above is closed already, and its page is not prepared; one that goes later stops the preparation when its response closes. Both are looked at in one step, so no close falls between them.
    if (response.destroyed) preparation.abort()
    else
      response.on('close', () => {
        if (!response.writableFinished) preparation.abort()
      })
    const served = await servedWikiPageOffThread(
      content.toString('utf8'),
      {
        editorScheme,
        clientAddress: `${prefix}codebook-qa.js`,
        publication,
      },
      {
        deadlineMs: WIKI_PAGE_SERVE_DEADLINE_MS,
        signal: preparation.signal,
      },
    )
    if (served.state === 'served') {
      endWithinSendLimit(response, served.html)
      return
    }
    // A page the worker did not prepare is never served as the folder holds it.
    refusePage(response, relativePath, served.state)
  }
  /**
   * Sends a file of the Wiki that is no page (a style sheet, a script as plain text, an image) when the manifest lists it, in parts, each read through an open of its own ({@link sendWikiFileInParts}).
   * Called by {@link handleRequest} for every GET of such a file, after the manifest was read ({@link readManifestShared}).
   * @param response - The file's answer.
   * @param relativePath - The file's path in the Wiki.
   * @param files - The files the manifest lists.
   * @example await answerWikiFile(response, 'wiki.css', files)
   */
  async function answerWikiFile(
    response: ServerResponse,
    relativePath: string,
    files: Set<string>,
  ): Promise<void> {
    if (!files.has(relativePath)) {
      sendJson(response, 404, {
        error: 'This file is not published by the Wiki.',
      })
      return
    }
    const servedFile = await lookAtServedFile(response, relativePath)
    if (!servedFile) return
    // No file of the Wiki folder is served as script: under `nosniff` a browser runs no script of another type, so a `.js` file there is plain text, and the reader's own script stays the one script file of this origin.
    response.setHeader(
      'Content-Type',
      relativePath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : relativePath.endsWith('.js')
          ? 'text/plain; charset=utf-8'
          : 'application/octet-stream',
    )
    const openedFile = await openServedWikiFile(servedFile.filePath)
    // Another entry took the path between the look and the open.
    if (!openedFile) {
      sendNoRegularFile(response)
      return
    }
    await sendWikiFileInParts(servedFile.filePath, openedFile, response)
  }
  /**
   * Resolves a file the manifest lists to its real path in the Wiki folder and looks at it there without opening it, and refuses a file outside the folder or one that is no regular file.
   * Called by {@link servePage} and {@link answerWikiFile} before they open the file.
   * @param response - The file's answer, which the refusals go to.
   * @param relativePath - The file's path in the Wiki.
   * @returns The real path and the size at the look; `undefined` when the file was refused (status 403).
   * @throws What the real path or the look throws, such as a missing file.
   * @example await lookAtServedFile(response, 'wiki.css') // => { filePath: '/repo/.codebook/wiki/wiki.css', sizeBytes: 812 }
   */
  async function lookAtServedFile(
    response: ServerResponse,
    relativePath: string,
  ): Promise<{ filePath: string; sizeBytes: number } | undefined> {
    const filePath = await realpath(join(canonicalOutput, relativePath))
    // Published paths cannot follow a symlink out of the generated Wiki directory, also not to another drive or a share on Windows.
    if (!isInsideFolder(canonicalOutput, filePath)) {
      sendJson(response, 403, {
        error: 'The Wiki file is outside its output directory.',
      })
      return undefined
    }
    // A page file larger than any page costs the editor's process nothing of its size: its size is looked at on the resolved path before it is opened, and the read stops one byte past the limit, also when the file grew since.
    const look = await lstat(filePath)
    // Only a regular file is opened, a page or any other file: the open of a named pipe would hold a thread of the host's file system until a writer comes, a device may never end, and a folder has no bytes.
    if (!look.isFile()) {
      sendNoRegularFile(response)
      return undefined
    }
    return { filePath, sizeBytes: look.size }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('DeepWiki reader did not acquire a loopback address.')
    origin = `http://127.0.0.1:${address.port}`
    return {
      url: `${origin}${prefix}${WIKI_ENTRY_FILE}`,
      acceptForwardedOrigin(address: string): void {
        const forwarded = new URL(address)
        // A forwarded address that is not on this machine is somebody else's page.
        if (WIKI_LOOPBACK_HOSTS.includes(forwarded.hostname))
          forwardedOrigin = forwarded.origin
      },
      noteSourceChange(path: string): void {
        const projectPath = relative(projectRoot, path).split(sep).join('/')
        // Only a file the freshness check weighs can change the label: an indexed source, or a file of the project it would count as added.
        if (!isWeighedByFreshness(projectPath)) return
        // The first change of a burst arms the timer and the rest of the burst is gathered into its one rise, so steady writing cannot hold the stamp back.
        sourceChangeTimer ??= setTimeout(() => {
          sourceChangeTimer = undefined
          sourceChangeStamp += 1
        }, WIKI_SOURCE_CHANGE_DEBOUNCE_MS).unref()
      },
      close: (): Promise<void> => {
        clearTimeout(sourceChangeTimer)
        return new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          // A question in flight keeps its connection open, and the server would wait for it: ending the connections aborts the question and lets the close finish.
          server.closeAllConnections()
        })
      },
    }
  } catch (error) {
    if (server.listening) server.close()
    throw error
  }
}

/**
 * Reads the question out of the body the reader's page sent to its question route.
 * Called by the reader for every question of its own page, once the body was read within {@link WIKI_HTTP_BODY_LIMIT_BYTES}.
 * @param rawBody - The request's body.
 * @returns The question, when the body is JSON whose `question` is text that is not blank and has at most {@link WIKI_QUESTION_LIMIT_CHARS} characters; `undefined` for any other JSON.
 * @throws What `JSON.parse` throws for a body that is no JSON; the reader answers it with status 500.
 * @example
 * questionOf('{"question":"Where is it?"}') // => 'Where is it?'
 * questionOf('{"question":"  "}')           // => undefined
 */
function questionOf(rawBody: string): string | undefined {
  const payload: unknown = JSON.parse(rawBody)
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('question' in payload) ||
    typeof payload.question !== 'string' ||
    !payload.question.trim() ||
    payload.question.length > WIKI_QUESTION_LIMIT_CHARS
  )
    return undefined
  return payload.question
}

/** A file of the Wiki by its device and its inode number, read exactly, so the reader tells it from another file that took its path. */
type ServedFileIdentity = { dev: bigint; ino: bigint }

/**
 * Opens a file the Wiki reader serves without following a link at its path and without waiting on a named pipe ({@link openWithoutFollowing}), and keeps it open only when it is a regular file.
 * Called by the reader for every file it serves, a page file or any other, after its look at the path found a regular file; the opened file is looked at again, because another entry can take the path between the look and the open.
 * @param path - The file's real path in the Wiki folder.
 * @returns The open regular file, its size at its `stat` and its identity, by which a later open of the path tells whether it opened the same file ({@link readPartOfWikiFile}); `undefined` when the opened entry is no regular file, after it was closed.
 * @throws What the open or the status throws: a missing file, or a link that took the path (`ELOOP`).
 * @example
 * await openServedWikiFile('/repo/.codebook/wiki/index.html') // => { file: <FileHandle>, sizeBytes: 2021, identity: { dev: 2049n, ino: 131076n } }
 */
async function openServedWikiFile(path: string): Promise<
  | {
      file: FileHandle
      sizeBytes: number
      identity: ServedFileIdentity
    }
  | undefined
> {
  const file = await openWithoutFollowing(path)
  const status = await file
    .stat({ bigint: true })
    .catch(async (error: unknown) => {
      await file.close()
      throw error
    })
  if (status.isFile())
    return {
      file,
      sizeBytes: Number(status.size),
      identity: { dev: status.dev, ino: status.ino },
    }
  await file.close()
  return undefined
}

/**
 * Sends a file of the Wiki folder that is no page (a style sheet, a script as plain text, an image) in parts ({@link sendInParts}), never read whole, and only as far as its size at its `stat`: the editor's process holds one part of it at a time, however large the file is and however often it is asked for at once, and a file that grows meanwhile is not followed.
 * The file is open only while one part of it is read: the file opened for its look is closed before the first part, and each part opens it again ({@link readPartOfWikiFile}). So a browser that reads slowly or stops reading keeps no file of the Wiki open, which on Windows refuses the publisher's swap of the folder, and the swap gives up after about 2.25 s.
 * Called by the reader for every file it serves that is no page, after {@link openServedWikiFile} opened it.
 * @param path - The file's real path in the Wiki folder.
 * @param servedFile - The open regular file, its size and its identity at its `stat`; the file is closed here, before any part is sent.
 * @param response - The answer, whose headers are set; it is sent under the send limit ({@link sendInParts}).
 * @throws What an open or a read of a part throws, and an error when another file took the path since the answer began (a publish moved a new Wiki folder into place); the reader's request handler ends the answer then.
 * @example
 * await sendWikiFileInParts('/repo/.codebook/wiki/wiki.css', await openServedWikiFile('/repo/.codebook/wiki/wiki.css'), response)
 */
async function sendWikiFileInParts(
  path: string,
  servedFile: {
    file: FileHandle
    sizeBytes: number
    identity: ServedFileIdentity
  },
  response: ServerResponse,
): Promise<void> {
  await servedFile.file.close()
  await sendInParts(response, (position) =>
    readPartOfWikiFile(path, servedFile, position),
  )
}

/**
 * Reads one part of a file of the Wiki through an open of its own, which it closes before it answers, so the file is open only while the part is read.
 * Called by {@link sendWikiFileInParts} for each part it sends.
 * @param path - The file's real path in the Wiki folder.
 * @param sentFile - The file's size and its identity when its answer began.
 * @param position - Where the part starts in the file.
 * @returns At most {@link WIKI_RESPONSE_PART_BYTES} bytes from the position on; `undefined` at the file's size at its `stat`, and where a file that shrank since then ends.
 * @throws What the open, the status or the read throws, such as a missing file while a publish swaps the folder; an error when another file took the path since the answer began, whose bytes would not go on with this file's.
 * @example
 * await readPartOfWikiFile('/repo/.codebook/wiki/diagram.png', { sizeBytes: 300_000, identity }, 0) // => <Buffer of 65,536 bytes>
 */
async function readPartOfWikiFile(
  path: string,
  sentFile: { sizeBytes: number; identity: ServedFileIdentity },
  position: number,
): Promise<Buffer | undefined> {
  // The file is sent only as far as its size at its stat.
  if (position >= sentFile.sizeBytes) return undefined
  const file = await openWithoutFollowing(path)
  try {
    const status = await file.stat({ bigint: true })
    // Another file took the path since the answer began, as when a publish moved a new Wiki folder into place.
    if (
      status.dev !== sentFile.identity.dev ||
      status.ino !== sentFile.identity.ino
    )
      throw new Error(
        `Another file took the path of a Wiki file while it was sent: ${path}`,
      )
    const part = Buffer.allocUnsafe(
      Math.min(WIKI_RESPONSE_PART_BYTES, sentFile.sizeBytes - position),
    )
    const { bytesRead } = await file.read(part, 0, part.length, position)
    // A file that shrank since its stat ends where its bytes end.
    return bytesRead === 0 ? undefined : part.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

/** Refuses a Wiki file that is no regular file: a named pipe, a device or a folder at a path the manifest lists is never opened or read. @param response - The answer to the refused request. @example sendNoRegularFile(response) // 403 */
function sendNoRegularFile(response: ServerResponse): void {
  sendJson(response, 403, {
    error:
      'The Wiki file is no regular file; a pipe, a device or a folder at its path is not served.',
  })
}

/** Refuses any other method on a read-only Wiki route and names the one that works, so a caller is told what to send instead. @param response - The answer to the refused request. @example sendGetOnly(response) // 405, Allow: GET */
function sendGetOnly(response: ServerResponse): void {
  response.setHeader('Allow', 'GET')
  sendJson(response, 405, { error: 'This Wiki route only answers GET.' })
}

/** Returns a no-store JSON result to the browser reader after a page or model request, under the send limit ({@link endWithinSendLimit}). @example sendJson(response, 404, { error: 'Missing' }) */
function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.writableEnded) return
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  endWithinSendLimit(response, JSON.stringify(value))
}

/**
 * Ends an answer of the Wiki reader that has made no progress for {@link WIKI_RESPONSE_SEND_LIMIT_MS}: its connection is closed. The limit counts from when the reader starts to send the answer, and again from each part of it the connection takes ({@link sendInParts}), so an answer whose browser keeps reading, however slowly, is not ended.
 * Why: a client that stops reading kept the answer in the extension host for as long as its connection lived: a prepared page's bytes and its place among the pages in hand ({@link takeWikiPagePlace}). A limit on the whole send instead cut every answer larger than a slow link carries within it, such as an image over a remote window's forwarded port.
 * Not the socket's idle timeout (`response.setTimeout`): it counts every byte the client sends as progress, so a client that reads nothing but sends a byte now and then kept its answer past the limit.
 * Called for every answer when the reader starts to send it: by {@link endWithinSendLimit} for an answer of one part, and by {@link sendInParts} for one sent in parts.
 * @param response - The answer.
 * @returns The limit's timer, which {@link sendInParts} starts again at each part the connection takes.
 * @example armSendLimit(response) // the answer is ended once 30 s pass in which its connection takes nothing
 */
function armSendLimit(response: ServerResponse): NodeJS.Timeout {
  const sendLimit = setTimeout(() => {
    // The connection has taken nothing for the limit, and the browser has not received the whole answer: it ends here, with its connection.
    if (!response.writableFinished) response.destroy()
  }, WIKI_RESPONSE_SEND_LIMIT_MS)
  // The send limit alone holds neither the editor's process nor a test's open.
  sendLimit.unref()
  response.once('close', () => clearTimeout(sendLimit))
  return sendLimit
}

/**
 * Waits until the connection of an answer has taken what was written to it, or until the answer has closed; at once for an answer that is ended already, for which no event may come.
 * Called by {@link sendInParts} after each part the connection did not take at once.
 * @param response - The answer.
 * @example await connectionTook(response)
 */
function connectionTook(response: ServerResponse): Promise<void> {
  return new Promise((resolveTaken) => {
    // An answer destroyed already may have closed already.
    if (response.destroyed) {
      resolveTaken()
      return
    }
    const settle = (): void => {
      response.off('drain', settle)
      response.off('close', settle)
      resolveTaken()
    }
    response.on('drain', settle)
    response.on('close', settle)
  })
}

/**
 * Sends an answer's body part by part under the send limit, each part once its connection has taken the one before, and ends the answer after the last; an answer whose browser went, or that the send limit ended, gets no further part, and no further part is read for it.
 * Why: the send limit counts the time in which an answer makes no progress ({@link armSendLimit}), and an answer handed to its connection whole shows none until all of it is taken; each part taken is progress, so a browser that keeps reading, however slowly, receives the whole answer.
 * Not a stream pipeline (`Readable.from` piped into the answer): it reads one part ahead, so an answer whose browser stopped reading holds two parts in the host instead of one, and a part whose read fails before the first byte destroys the answer, so the browser gets a broken connection instead of the reader's error answer.
 * Called by {@link endWithinSendLimit} for a body larger than one part ({@link WIKI_RESPONSE_PART_BYTES}), and by {@link sendWikiFileInParts} for every file of the Wiki that is no page.
 * @param response - The answer, whose status and headers are set.
 * @param partAt - Reads the part of the body that starts at a position; `undefined` once the body is sent whole.
 * @throws What `partAt` throws; the answer is not ended then.
 * @example
 * await sendInParts(response, async (position) => (position < body.length ? body.subarray(position, position + WIKI_RESPONSE_PART_BYTES) : undefined))
 */
async function sendInParts(
  response: ServerResponse,
  partAt: (position: number) => Promise<Buffer | undefined>,
): Promise<void> {
  const sendLimit = armSendLimit(response)
  for (let position = 0; !response.destroyed;) {
    const part = await partAt(position)
    // The whole body is sent.
    if (!part) break
    position += part.length
    if (!response.write(part)) await connectionTook(response)
    // The connection took the part: the answer moves, and its send limit counts from now.
    if (!response.destroyed) sendLimit.refresh()
  }
  if (!response.destroyed) response.end()
}

/**
 * Sends an answer whose status and headers are set, under the send limit: a body of one part ({@link WIKI_RESPONSE_PART_BYTES}) or none whole and at once ({@link armSendLimit}), a larger one in parts ({@link sendInParts}) with its length named, as an answer sent at once names it. Called by the reader for every answer but a file of the Wiki, which {@link sendWikiFileInParts} sends.
 * @param response - The answer.
 * @param body - Its body; none when left out.
 * @example endWithinSendLimit(response, qaClient)
 */
function endWithinSendLimit(response: ServerResponse, body?: string): void {
  // A body of one part, or none, goes to the connection at once.
  if (
    body === undefined ||
    Buffer.byteLength(body) <= WIKI_RESPONSE_PART_BYTES
  ) {
    armSendLimit(response)
    response.end(body)
    return
  }
  const bytes = Buffer.from(body)
  // A JSON answer has its head written already; any other gets its length, as when it is sent at once.
  if (!response.headersSent) response.setHeader('Content-Length', bytes.length)
  sendInParts(response, async (position) =>
    position < bytes.length
      ? bytes.subarray(position, position + WIKI_RESPONSE_PART_BYTES)
      : undefined,
  ).catch(() => response.destroy())
}
