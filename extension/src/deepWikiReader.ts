import { randomBytes } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { join, relative, sep } from 'node:path'

import {
  MS_PER_MINUTE,
  WIKI_ENTRY_FILE,
  WIKI_FRESHNESS_ROUTE,
  WIKI_HTTP_BODY_LIMIT_BYTES,
  WIKI_MANIFEST_FILE,
  WIKI_QUESTION_LIMIT_CHARS,
  WIKI_QUESTION_ROUTE,
  WIKI_UPDATE_IDLE_POLL_MS,
  WIKI_UPDATE_REASON_LIMIT_CHARS,
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
import { describeWikiUpdate } from './utils/describeWikiUpdate'
import { inspectDeepWikiFreshness } from './utils/inspectDeepWikiFreshness'
import { installShortcutHelp } from './utils/installShortcutHelp'
import {
  installWikiUpdateStatus,
  type WikiUpdateStatusAnswer,
} from './utils/installWikiUpdateStatus'
import { readWikiPublishedAt } from './utils/readWikiPublishedAt'
import { rebindDeepWikiEditorLinks } from './utils/rebindDeepWikiEditorLinks'
import type { WikiUpdateStatus } from './utils/wikiUpdateRun'

export type DeepWikiReader = { url: string; close(): Promise<void> }
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
  (${installWikiUpdateStatus.toString()})({ readerPrefix: prefix, updateStatusRoute: '${WIKI_UPDATE_STATUS_ROUTE}', freshnessRoute: '${WIKI_FRESHNESS_ROUTE}', describeUpdate: (${describeWikiUpdate.toString()}), statusPollMs: ${WIKI_UPDATE_STATUS_POLL_MS}, idlePollMs: ${WIKI_UPDATE_IDLE_POLL_MS}, startWaitMs: ${WIKI_UPDATE_START_WAIT_MS}, statusRetryLimit: ${WIKI_UPDATE_STATUS_RETRY_LIMIT}, pathLimit: ${WIKI_UPDATE_SHOWN_PATH_LIMIT}, reasonLimitChars: ${WIKI_UPDATE_REASON_LIMIT_CHARS}, msPerMinute: ${MS_PER_MINUTE} });
  var form = document.querySelector('#qa-form, [data-codebook-question]');
  if (!form) return;
  var status = document.querySelector('[data-codebook-status]');
  if (status) { status.textContent = '● Connected to Codebook reader'; status.classList.remove('unavailable'); }
  var submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = 'Ask Codebook';
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); event.stopImmediatePropagation();
    var input = form.querySelector('textarea, input[name="question"]');
    var output = form.querySelector('.qa-answer, [data-codebook-answer]');
    if (!input || !output) return;
    var question = input.value.trim();
    if (!question) return;
    output.style.display = 'block'; output.textContent = 'Asking the editor model…';
    try {
      var response = await fetch(prefix + '${WIKI_QUESTION_ROUTE}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The editor model could not answer.');
      if (result.handoff) { output.textContent = result.handoff; return; }
      output.textContent = result.answer;
      if (result.sourceChanged) { var stale = document.createElement('p'); stale.textContent = 'Some indexed source changed. Update LLM Wiki before relying on this answer.'; output.appendChild(stale); }
      var list = document.createElement('ul');
      result.citations.forEach(function (citation) { var item = document.createElement('li'); var link = document.createElement('a'); link.href = citation.uri; link.textContent = citation.path + ':' + citation.line; item.appendChild(link); list.appendChild(item); });
      output.appendChild(list);
    } catch (error) { output.textContent = String(error); }
  }, true);
})();`

/** Validates the generated output owner before the reader serves files or accepts repository questions. @param outputDirectory - Resolved Wiki output. @param projectRoot - Canonical opened repository. @returns The published file allowlist and included sources. @example await readDeepWikiManifest('/repo/.codebook/wiki', '/repo') */
export async function readDeepWikiManifest(
  outputDirectory: string,
  projectRoot: string,
): Promise<{
  files: Set<string>
  sources: WikiIncludedSource[]
  revision?: string
  excludedPaths: string[]
}> {
  const manifest: unknown = JSON.parse(
    await readFile(join(outputDirectory, WIKI_MANIFEST_FILE), 'utf8'),
  )
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

/** Serves one generated Wiki on loopback and binds its editor links when the current host opens it. @param outputDirectory - Generated Wiki directory. @param projectRoot - Canonical opened repository. @param answerQuestion - Editor model request with validated source context. @param editorScheme - Active editor URI scheme. @param readUpdateStatus - The window's Wiki update run state; served at `api/update-status` when the run is for this reader's folder, else the reader answers idle. @returns Loopback URL and owned close operation. @example const reader = await startDeepWikiReader('/repo/.codebook/wiki', '/repo', answer, 'cursor') */
export async function startDeepWikiReader(
  outputDirectory: string,
  projectRoot: string,
  answerQuestion: AnswerQuestion,
  editorScheme: 'vscode' | 'cursor' = 'vscode',
  readUpdateStatus: () => WikiUpdateStatus = () => ({ state: 'idle' }),
): Promise<DeepWikiReader> {
  await readDeepWikiManifest(outputDirectory, projectRoot)
  const canonicalOutput = await realpath(outputDirectory)
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
  /** Routes only owned pages and questions; every request must carry this reader's random path token. @example await handleRequest(request, response) */
  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    const url = new URL(request.url ?? '/', origin)
    if (!url.pathname.startsWith(prefix)) {
      sendJson(response, 404, { error: 'Unknown Wiki reader.' })
      return
    }
    const relativePath =
      decodeURIComponent(url.pathname.slice(prefix.length)) || WIKI_ENTRY_FILE
    // The update state needs no manifest, so it answers while a publish is replacing the site.
    if (relativePath === WIKI_UPDATE_STATUS_ROUTE) {
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
      } satisfies WikiUpdateStatusAnswer)
      return
    }
    // An agent may publish a new owned directory while this reader stays open.
    const { files, sources, revision, excludedPaths } =
      await readDeepWikiManifest(outputDirectory, projectRoot)
    if (relativePath === WIKI_FRESHNESS_ROUTE) {
      if (request.method !== 'GET') {
        sendGetOnly(response)
        return
      }
      sendJson(
        response,
        200,
        await inspectDeepWikiFreshness(
          projectRoot,
          sources,
          revision,
          excludedPaths,
          { outputDirectory },
        ),
      )
      return
    }
    if (relativePath === WIKI_QUESTION_ROUTE) {
      if (
        request.method !== 'POST' ||
        request.headers.origin !== origin ||
        request.headers['content-type']?.split(';')[0] !== 'application/json'
      ) {
        sendJson(response, 403, {
          error: 'This Wiki question must come from its reader.',
        })
        return
      }
      let rawBody = ''
      for await (const part of request) {
        rawBody += part.toString('utf8')
        if (Buffer.byteLength(rawBody) > WIKI_HTTP_BODY_LIMIT_BYTES) {
          sendJson(response, 413, { error: 'The Wiki question is too long.' })
          return
        }
      }
      const payload: unknown = JSON.parse(rawBody)
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('question' in payload) ||
        typeof payload.question !== 'string' ||
        !payload.question.trim() ||
        payload.question.length > WIKI_QUESTION_LIMIT_CHARS
      ) {
        sendJson(response, 400, { error: 'Enter a shorter Wiki question.' })
        return
      }
      const controller = new AbortController()
      response.on('close', () => {
        if (!response.writableFinished) controller.abort()
      })
      try {
        sendJson(
          response,
          200,
          await answerQuestion(payload.question, sources, controller.signal),
        )
      } catch (error) {
        if (!response.writableEnded)
          sendJson(response, 503, { error: String(error) })
      }
      return
    }
    if (request.method !== 'GET') {
      sendGetOnly(response)
      return
    }
    if (relativePath === 'codebook-qa.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      response.end(qaClient)
      return
    }
    if (!files.has(relativePath)) {
      // A page the last update removed or renamed sends the learner to the overview instead of a JSON error.
      if (relativePath.endsWith('.html')) {
        response.writeHead(302, { Location: `${prefix}${WIKI_ENTRY_FILE}` })
        response.end()
        return
      }
      sendJson(response, 404, {
        error: 'This file is not published by the Wiki.',
      })
      return
    }
    const filePath = await realpath(join(canonicalOutput, relativePath))
    const canonicalRelativePath = relative(canonicalOutput, filePath)
    // Published paths cannot follow a symlink out of the generated Wiki directory.
    if (
      !canonicalRelativePath ||
      canonicalRelativePath === '..' ||
      canonicalRelativePath.startsWith(`..${sep}`)
    ) {
      sendJson(response, 403, {
        error: 'The Wiki file is outside its output directory.',
      })
      return
    }
    const content = await readFile(filePath)
    if (relativePath.endsWith('.html')) {
      const html = content.toString('utf8')
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(
        rebindDeepWikiEditorLinks(html, editorScheme).replace(
          '</body>',
          `<script src="${prefix}codebook-qa.js"></script></body>`,
        ),
      )
      return
    }
    response.setHeader(
      'Content-Type',
      relativePath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : relativePath.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream',
    )
    response.end(content)
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
      close: (): Promise<void> =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    }
  } catch (error) {
    if (server.listening) server.close()
    throw error
  }
}

/** Refuses any other method on a read-only Wiki route and names the one that works, so a caller is told what to send instead. @param response - The answer to the refused request. @example sendGetOnly(response) // 405, Allow: GET */
function sendGetOnly(response: ServerResponse): void {
  response.setHeader('Allow', 'GET')
  sendJson(response, 405, { error: 'This Wiki route only answers GET.' })
}

/** Returns a no-store JSON result to the browser reader after a page or model request. @example sendJson(response, 404, { error: 'Missing' }) */
function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.writableEnded) return
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}
