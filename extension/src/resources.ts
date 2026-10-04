import { join } from 'node:path'

import { z } from 'zod'

import { CONFIGURED_PROFILE } from './configuredProfile'
import {
  API_VERSION,
  CONFIGURED_MINIMUM_EXTENSION_VERSION,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  BOOK_INPUT_LIMIT_BYTES,
  HTTP_BODY_LIMIT_BYTES,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  REPOSITORY_SOURCE_EXTENSIONS,
  REPOSITORY_EXCLUDED_DIRECTORIES,
  EVENT_DETAIL_LIMIT_BYTES,
  EVENT_PAGE_SIZE,
  IMAGE_LIMIT_BYTES,
  REPOSITORY_RUN_TIMEOUT_MS,
  SOURCE_LIMIT_BYTES,
  NODE_TEST_PROFILE,
  ACTIVE_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
} from './constants'
import { ERROR_RECOVERY, EvidenceIntegrityError, StudyError } from './errors'
import { nodeTestConfigSchema } from './nodeTestConfigSchemas'
import { retainedRepositoryConfigSchema } from './repositoryConfigSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import type { StudyService } from './service'
import { describeStudy } from './utils/describeStudy'
import { omittedDetail } from './utils/omittedDetail'
import { readBoundedFile } from './utils/readBoundedFile'
import { readJsonPage } from './utils/readJsonPage'
import { readRecordingResource } from './utils/readRecordingResource'
import { readRepositoryResource } from './utils/readRepositoryResource'
import { snapshotSourceHashes } from './utils/snapshotSourceHashes'

/** The active-progress deadline in the whole seconds the repository-browser help names, so the help follows {@link ACTIVE_TIMEOUT_MS}. */
const ACTIVE_TIMEOUT_SECONDS = ACTIVE_TIMEOUT_MS / MILLISECONDS_PER_SECOND

export type ResourceContent =
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string }

/** Resolves only canonical instance/run resources, preserving historical captured bytes after runtime exit. @example await readResource(service, runUri) */
export async function readResource(
  service: StudyService,
  uri: string,
): Promise<ResourceContent> {
  const json = (value: unknown): ResourceContent => ({
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(value),
  })
  if (uri === 'codebook://help/errors') return json(ERROR_RECOVERY)
  // The catalog pages like every other JSON resource, so its returned page URIs must route back here.
  const nodeHistoryCatalogMatch =
    /^codebook:\/\/node-history(?:\/(pages\/[a-f0-9]{64}\/\d+))?$/.exec(uri)
  if (nodeHistoryCatalogMatch) {
    if (!service.nodeHistoryStore)
      throw new StudyError(
        'NOT_FOUND',
        'Node history storage is unavailable for this workspace.',
      )
    const histories = await service.nodeHistoryStore.list()
    return readJsonPage(
      'codebook://node-history',
      histories.map((history) => ({
        ...history,
        historyUri: `codebook://node-history/${history.studyId}`,
        eventsUri: `codebook://node-history/${history.studyId}/events`,
        learningMaterialUri: `codebook://node-history/${history.studyId}/learning-material`,
      })),
      nodeHistoryCatalogMatch[1],
    )
  }
  const nodeHistoryMatch =
    /^codebook:\/\/node-history\/([0-9a-f-]{36}_[0-9a-f-]{36})(?:\/(events(?:\/pages\/[a-f0-9]{64}\/\d+)?|learning-material(?:\/pages\/[a-f0-9]{64}\/\d+)?|pages\/[a-f0-9]{64}\/\d+))?$/.exec(
      uri,
    )
  if (nodeHistoryMatch?.[1]) {
    if (!service.nodeHistoryStore)
      throw new StudyError(
        'NOT_FOUND',
        'Node history storage is unavailable for this workspace.',
      )
    const history = await service.nodeHistoryStore.read(nodeHistoryMatch[1])
    const baseUri = `codebook://node-history/${nodeHistoryMatch[1]}`
    if (nodeHistoryMatch[2] === 'events')
      return readJsonPage(`${baseUri}/events`, history.entries)
    if (nodeHistoryMatch[2]?.startsWith('events/pages/'))
      return readJsonPage(
        `${baseUri}/events`,
        history.entries,
        nodeHistoryMatch[2].slice('events/'.length),
      )
    if (
      nodeHistoryMatch[2] === 'learning-material' ||
      nodeHistoryMatch[2]?.startsWith('learning-material/pages/')
    ) {
      const material = await service.nodeHistoryStore.readLearningMaterial(
        nodeHistoryMatch[1],
      )
      const data = material ?? {
        studyId: nodeHistoryMatch[1],
        revision: 0,
        status: 'not-saved',
        content: undefined,
      }
      const cursor = nodeHistoryMatch[2].startsWith('learning-material/pages/')
        ? nodeHistoryMatch[2].slice('learning-material/'.length)
        : undefined
      return readJsonPage(`${baseUri}/learning-material`, data, cursor)
    }
    if (nodeHistoryMatch[2])
      return readJsonPage(
        baseUri,
        {
          header: history.header,
          status: history.status,
          reason: history.reason,
          seal: history.seal,
          entryCount: history.entries.length,
          eventsUri: `${baseUri}/events`,
        },
        nodeHistoryMatch[2],
      )
    return readJsonPage(baseUri, {
      header: history.header,
      status: history.status,
      reason: history.reason,
      seal: history.seal,
      entryCount: history.entries.length,
      eventsUri: `${baseUri}/events`,
    })
  }
  if (uri === 'codebook://help/repository-browser')
    return json({
      profile: CONFIGURED_PROFILE,
      configurationSchema: z.toJSONSchema(retainedRepositoryConfigSchema, {
        io: 'input',
      }),
      entry: `API ${API_VERSION}, extension ${CONFIGURED_MINIMUM_EXTENSION_VERSION} or later. Read actual workspace source and publish an immutable source-only article first. Use its default repository/<bookId>/<nodeId> identity, exact revision, selected citation, path/hash and one-based source line/column. Leave learningItemId absent to preserve the article identity.`,
      additionalStops: `Version 1 appends up to seven {line,column,inspections} browser stops within the first selected citation. Version 2 declares participant (browser or server) for the first source/book.anchorIndex/inspections; each additionalStops entry has participant, source {path,hash,line,column}, anchorIndex and inspections, using its own retained article citation. Each stop needs a required value inspection and must be reached in order by the single action. Server stops use the owned Next worker and sealed action-browser modules; pending breakpoint registration is not a verified pause. Codebook arms only the next expected stop: the first stop before input, and each later stop inside the codebook_continue that follows the stop before it. A later stop's line can therefore execute earlier without pausing; declare stops in the order the action executes them. If a later stop is not hit within ${ACTIVE_TIMEOUT_SECONDS} seconds of the preceding continuation, the run fails with 'Repository continuation reached no next declared pause' and names that stop. If a later stop cannot be armed, that codebook_continue answers 'Continue was not confirmed.' with the arming error as its cause and sends no resume; the run ends with the reason 'Next declared stop was not armed and no resume was sent' (read the run resource), and earlier observations stay. Explain each committed pause and copy that participant's current continueArguments. All declared stops are required before after-condition success. Chronological order alone does not establish an async causal link.`,
      inspections:
        'Declare unique value:<path> or type:<path> inspections, at least one required value. Paths contain one to four ASCII identifier segments, excluding reserved roots and prototype access. Values are observed primitives, including the explicit {type:"undefined"} marker, not expected values. A value that is an object or a function is captured as the marker {type:"object"} or {type:"function"} and the run goes on: objects are not bounded, so its members are not captured facts; declare type:<path> or a primitive member such as value:credentials.email to capture one, and read the members in the native debugger state of the observation. Required unavailable/unsafe/oversized inspections fail; optional unavailability remains explicit. DOM conditions use literals, never patterns, and all conditions must hold: a text condition compares the element\'s whole textContent, trimmed and with whitespace runs collapsed on both sides; the texts of child elements are joined without a space, and CSS white-space, zero-width spaces and soft hyphens are not applied; an attribute condition compares the entire value exactly.',
      sourceBinding: `Choose a one-based source line/column for an executable statement reached by the requested action, such as the handler body or a state-driven render after a library callback. JSX attributes, declarations, or source proximity alone do not establish a bindable action stop. The line is the declaration and the column is a request: Codebook accepts the debugger's verified binding anywhere on the declared line in the sealed executed module and uses that bound position for every check, for saved evidence and for display. Each observation's inspection resource reports it as source {line,column} beside requestedSource {line,column}; cite source. Request the column where the statement begins: a browser stop that the debugger moves to a later line although the declared line has a break location before the requested column fails while it is armed. A declared line without a mapped position (a blank line, or a comment the generated module kept) is requested at the first mapped position after it within the stop's citation, because the debugger verifies no breakpoint on such a line, and is accepted there under the next rule; preparation fails before input only when no later line of the stop's citation can carry a position either. The sealed map decides that; when it is too large to scan completely, the source text does: a line that is blank or only a comment carries none. When the debugger cannot pause on the declared line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the two has a mapped position (a kept comment is not one), and uses it like a moved column: the inspection's source names the bound line, so cite and explain source. Let the citation cover every line of the statement the stop is in, so that a moved binding stays inside it. A moved binding can lie in a branch the action skips; the stop then fails at the ${ACTIVE_TIMEOUT_SECONDS} second deadline, whose text names the bound place once the adapter has reported it (a server stop still registered as pending gets it from the adapter's breakpoint event when its module loads). Any other binding on another line fails, naming the condition that refused it: a browser stop at once while it is armed, a server stop when the adapter acknowledges it on that line or, while its registration is pending, only at its pause, about 3 seconds after it, and never when that line does not run (the stop then ends at the ${ACTIVE_TIMEOUT_SECONDS} second deadline); declare the bound place instead, in a citation that covers it. Two declared stops that bind on one place fail when the second binds; declare that place once. A browser stop whose binding never verifies times out after ${ACTIVE_TIMEOUT_SECONDS} seconds while it is being armed; a server stop may stay registered as pending and fails only when no verified pause arrives within ${ACTIVE_TIMEOUT_SECONDS} seconds of the input or of the preceding continuation. Binding failures name the declared stop, and run error.cause may list one-based positions from the frozen source map within that stop's citation. They are mapping hints, not verified debugger bindings or proof the action reaches them; inspect source and retry only a relevant executable statement before claiming an observed pause.`,
      initialState:
        "Optional configuration.entryPath selects a same-origin application path; redirects require selecting the actual path. Codebook checks action.before on the fresh managed page before applying optional initialInputs, then inserts those distinct selector/text pairs before breakpoint arming; uncertain input is never retried. All action, condition and initial-input selectors must be browser-native CSS accepted by querySelectorAll; Playwright-only pseudos such as :has-text() are invalid. Do not require an initialInputs value in action.before. Use a condition observable before input, such as the form heading or a visible control, and reserve filled-value checks for action.after only if the application still shows that value after the click. Do not assume system appearance or prior localStorage state. Use configuration.initialStorage only when the app source establishes the key/value needed for a deterministic initial state. A visible condition requires nonzero element geometry. A button with an icon or a hidden label often holds more text than its visible label: for a before condition prefer visible unless the text itself matters, and for an after condition keep the text check on a selector whose element holds only that text. A text-mismatch timeout says when the element holds the expected text beside other text, without exposing page text. For class membership, use a CSS class selector rather than exact class-attribute equality when other class tokens may exist. An invalid CSS selector immediately identifies the failing one-based condition or click target. A condition timeout identifies the failing one-based predicate and its phase without exposing page values: correct a before condition against the fresh page before input, an after condition against the page the action leaves. Codebook also reads action.after just before the click; when the after conditions already hold there, the run ends with 'Configured after conditions were already true before application input' and sends no input, because such a result cannot prove the action caused it; declare an after condition only the action makes true. If preparation fails, read the returned run resource error.cause before changing configuration; a lock removed by cleanup does not establish the original failure.",
      sequence: [
        'codebook_start with profile repository-browser, full configuration and a stable key returns immediately. Reuse the complete identical input on response loss; never retry input with a new key. A start the library refused can be repeated with the same key after room was made; it begins a new run.',
        "Poll the returned run resource until it becomes ready or terminal, or reaches preparationDeadlineAt. While preparing, preparationRemainingMs is computed from Codebook's clock; a positive value means the deadline has not passed even if a local time-zone display differs. An unchanged preparing state while the app loads is not a reason to stop it. Once repository-click appears in nextActions, read manifestUri and verify its configurationHash, accepted configuration, complete citation identity and exact source/JS/map hashes before input.",
        "Send repository-click once with a stable action key. Read inspectionUri and sourceUri returned by the observation for actual declared values. The inspection's source is the bound position to cite; requestedSource is the position you declared. declaredSource is the position you declared (requestedSource is its older name), armed the place Codebook requested the breakpoint at when that differs, source where it bound and paused: cite source. A saved study's learning resource gives armed as {line} only, and only when the requested line differs from the declared line; a request moved to another column of the declared line is in the live inspection and the journal only. When the debugger bound a stop on another line than you declared, its inspection carries place, one sentence that names the line the stop paused on: name that line as the place of the pause in the interpretation, in the learning summary and in your answer to the learner. codebook_explain refuses the first interpretation of such a stop when it does not contain the paused line's number; send it again under the same key with the line named. Bounded resources provide content chunks and nextUri; concatenate every chunk in order and parse JSON before claiming complete inspection. Call codebook_explain with the exact source.hash and captured fact keys, including value: or type: prefixes; wait for its committed explanationUri before continuing. Chat prose alone is not saved in Study. Include learningSummary for saved question, processing summary and sequence steps; classify each relationship as observed, source-derived or unknown. Bind source steps to exact same-run snapshot/source references. After the run is stopped and demonstrated, its terminalReference can bind an observed final-result step in a newly committed full summary.",
        "Use codebook_reveal for the immutable Study source, then copy the current paused participant continueArguments. That continue arms the next declared stop before it resumes. Earlier observations remain immutable. A manual or competing resume of a captured pause, or a second stop the debugger announces, invalidates this operation. A pause the debugger makes for itself away from the next declared stop's bound place and resumes by itself is retired: the journal records it as cdp.adapter-pause-retired with its place and pausedForMs (the first 100 such pauses of a run; the rest are counted), and the run goes on. A pause no stop announced that is resumed only after more than 3 seconds, or after more than 1 second while a stop of that participant is announced and still waits for its own pause, ends the run as a manual or competing resume. A stop announced for a pause that came before its turn (before the input was sent or before the preceding continuation was requested) fails naming that early pause.",
        `After continuation, poll for observed.afterVerified or explicit failure. A Continue response alone does not establish input acknowledgement, after conditions or renderer confirmation. A run does not complete while a pause the debugger made for itself is still open; if it stays open, the run fails at its ${ACTIVE_TIMEOUT_SECONDS} second deadline. A deadline that expires while a participant is paused with no announced stop adds where, for example "The server is paused at auth.ts:18 without a debugger stop." The place is <repository path>:<line> in a declared stop's module, <script URL> <line>:<column> in another announced script, "an unknown script <line>:<column>" in one never announced, and "an unknown place" for an empty stack. The journal records every pause as cdp.pause-observed (url, line, column, functionName, hitBreakpoints, stopIndex, continuation receipts) and every resume as cdp.resumed or cdp.adapter-pause-retired with pausedForMs. Stop/seal and wait for current history/recording receipts.`,
        "Publish a new complete article revision containing the exact saved studyId/observationId/sourceHash link. Copy studyId from the terminal run resource and observationId from that resource's observations[].id; a debugger runtimeRunId is not a saved Study identity. Its default learning identity and full citation context stay the same. Open the linked observation or recording; replay after shutdown through the discovered recordingUri and playbackUri.",
      ],
      recovery:
        'Source drift, an existing Next lock, ambiguous target or missing source-map binding reject the attempt. Keep its partial evidence. If the reader is showing saved history or Recording while the new run needs its live app, use codebook_return_current with the current presentation reader revision; saved evidence remains. Correct the prerequisite and explicitly start a new run only when you intend another execution. Cancellation releases owned resources and preserves raw tabs, drafts and user breakpoints. Never rerun application input to repair saved history or recording. Only the learner removes a saved study, in the Study workspace; an agent reports a full library and never deletes files.',
      retainedFormats:
        'Configured Study v3/v4, books v1/v2, progress v1-v4, recordings v1/v2/v3. Version 2 intent saves Study v4 and recording v3 with per-stop source and participant identity. Corrupt or unsupported preferred formats fail without fallback or deletion. Direct entry offers Open article; Return to Wiki requires a saved actual origin.',
    })
  if (uri === 'codebook://help/node-test')
    return json({
      profile: NODE_TEST_PROFILE,
      configurationSchema: z.toJSONSchema(nodeTestConfigSchema, {
        io: 'input',
      }),
      entry:
        'Use codebook_start with profile node-test and one stable key. Select the exact retained book revision/node and cited executable source positions, plus one tracked Vitest test file, its SHA-256 and testTitles naming one test in it. The service verifies all citations and hashes before creating the owned Node debugger run. No arbitrary command, executable, path root, or test arguments are accepted.',
      testSelection:
        'testTitles cites exactly one test: every enclosing describe title, outermost first, then the test title, exactly as Vitest reports them, for example ["invoice data queries", "converts stored invoice cents to dollars for the edit form"]. A title alone matches only a top-level test. testName is retired and refused for new runs. The repository needs Vitest 4 or later. Before launch, Codebook asks Vitest which files its file filter would run, excludes every other file and passes the titles as one literal anchored name pattern; a file listed by several Vitest projects is refused. After the process exits, Vitest\'s JSON report must show exactly the cited test executed in the cited file, otherwise the run fails. A title path that selects no test ends the run before its first declared stop with the exit code.',
      sequence: [
        'Read the returned manifest to verify the accepted configuration, complete article citation and test file/hash. Poll the run URI until a checked source stop appears. Read nodeTest.stops and the immutable node-stops/<index> snapshot, source and facts.',
        'Copy the current participants.server.continueArguments to continue. Every declared stop is required and captured in order. The final continuation runs the actual test and returns its exit code and bounded output.',
        'Stop releases the owned Node process and debugger. A private workspace-bound history journal preserves ordered output, source/facts/debugger stops and the actual result; discover it at codebook://node-history, then read the returned history URI and follow its events pages. Use codebook_explain_node_history to save an agent-authored question, summary and sequence with exact stop/output/result sequence references; read learningMaterialUri first and use its revision as expectedRevision. This is learning material for test history, not application video or synchronized application replay.',
      ],
      learnerPauses:
        'The learner may keep their own breakpoints. When one pauses the test before a declared stop, Codebook does not resume it: the run events show node-test.learner-paused with its repository path, line, column and reason, and the run waits. Ask the learner to continue it in the native debugger; time held there does not count against the stop budget. A breakpoint on the declared line itself does not block the final continuation.',
      recovery:
        'A missing article, changed test/source hash, unsupported Node/debugger, changed pause or failed process produces an explicit terminal error. Read the same run URI; never retry execution with a new key to recover a response.',
      limits: {
        stops: 8,
        runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
        output: 'Bounded by the owned Node process adapter.',
      },
    })
  if (uri === 'codebook://help/repository')
    return json({
      entry:
        'Read codebook_status.repository, then codebook_sources and exact codebook_source paths. Author structured plain-text sections, verified path/hash/inclusive line citations and source-derived relations. Publish a complete document with expectedRevision and a stable key; open only the returned retained revision.',
      boundaries: {
        sourceBytes: REPOSITORY_SOURCE_LIMIT_BYTES,
        documentBytes: BOOK_INPUT_LIMIT_BYTES,
        httpEnvelopeBytes: HTTP_BODY_LIMIT_BYTES,
        extensions: REPOSITORY_SOURCE_EXTENSIONS,
        excludedDirectories: REPOSITORY_EXCLUDED_DIRECTORIES,
        rules:
          'Trusted local selected Git root. Tracked regular UTF-8 files; no symlinks, hidden paths, secret/key names or lockfiles. This is not a secret-content detector. Nothing runs and no remote repository is fetched.',
      },
      recovery:
        'Source mismatch: reread the exact path and update citations explicitly. Revision conflict: read the current book. Lost response: reuse identical key/input to recover the original receipt even after source changes. Missing history: discover saved studies in the library; never run application input as recovery.',
      understanding:
        'Only an explicit learner action changes understanding. v4 progress retains typed runtime source decisions, complete citation contexts, configured selections and actual article return origins; old v1/v2/v3 bytes remain. Older-format writes are not merged automatically after v4 exists.',
      evidence:
        'Agent text and relations are interpretation. Optional observation links must name exact saved study/observation/source identities; partial or unavailable evidence stays visible. Source reading does not prove this repository has a runtime adapter.',
      tutorial: 'extension/README.md: Learn this repository',
      configuredRuntimeHelpUri: 'codebook://help/repository-browser',
    })
  if (uri === 'codebook://help/studies')
    return json({
      entry:
        'Call codebook_status, prepare a returned repository profile from the open workspace, then start with a stable key and source-bound configuration.',
      configuredRuntimeHelpUri: 'codebook://help/repository-browser',
      sequence: [
        'Read the returned manifestUri once ready; it freezes source hashes and expected actions/stops.',
        'Send only the action named in nextActions, with a stable key unique to that action.',
        'For each current pause, read its returned inspectionUri and sourceUri. Read all content pages through nextUri before parsing the JSON. Call codebook_explain with that snapshot, its exact TypeScript source hash and only present captured value paths. Wait for its committed explanationUri, then copy the current continueArguments. Chat prose alone is not saved in Study. Include learningSummary for saved question, processing summary and sequence steps; classify each relationship as observed, source-derived or unknown. Bind source steps to exact same-run snapshot/source references.',
        'Read the terminal state and stop result. If terminalReference is present, save a new complete learningSummary through codebook_explain with an observed final-result step citing that exact terminalReference and a new explanation key. Preserve earlier unknown-at-pause claims as historical uncertainty. Separate runtime/capture evidence from saved learning history and personal understanding.',
      ],
      recording: {
        discovery:
          'API 1.2: follow codebook_status.recording.libraryUri, select a saved study recordingUri, then follow framesUri/nextUri and hash-bound learningUri for saved explanations/summary. Read every returned content page through nextUri; contextUri retains full raw history. Catalog entries are not verified playback.',
        controls:
          'Read playbackUri and call codebook_playback with the current instanceId, studyId, action open/play/pause/seek and expectedRevision. Seek additionally requires positionMs. Poll readiness; requestedMs is not presentedMs. Stale revisions reject without executing application code.',
        recovery:
          'After restart copy new credentials and rediscover. Saved study IDs persist, instance URIs do not. No live run is needed for playback. A changed context hash needs explicit rediscovery/reload. Missing or corrupt recording data remains unavailable; never retry input to repair history.',
        timing:
          'Only facts available at the selected recorded time appear in the main projection. Later annotations remain labeled separately. Playback does not mark understanding.',
      },
      identity:
        'Read each observation imageUri for immutable pause-specific pixels. Legacy phase image resources identify the latest phase only. Observations are historical item/action references. A later stop on the same participant does not replace them. Follow current continuation arguments, never an old observation.',
      recovery:
        'On a lost action response, repeat identical action/key. Wrong order or a new key for an accepted action dispatches nothing. Missing values/images stay unavailable; never fill them from a later stop.',
      limits:
        'Discovery gives profile-specific limits. Paused time is excluded from active progress time; the whole-run deadline remains.',
      outcomes:
        'finalOutcome is the compatibility runtime/capture evidence result. historyOutcome qualifies the latest materialSignature/checkpointRevision as unavailable, pending, saved or failed. Only a terminal matching saved checkpoint and demonstrated runtime evidence yield studyOutcome demonstrated. An explanation added after Stop requires a newer saved checkpoint. Read the same run again while history is pending; never replay input to recover storage. recordedStudyOutcome separately qualifies the complete recording and its exact saved context; studyOutcome alone does not certify recording.',
    })
  const url = new URL(uri)
  if (
    url.protocol !== 'codebook:' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new StudyError('INVALID_REFERENCE', 'Use a canonical resource URI.')
  if (url.pathname === '/presentation')
    return json(await service.presentationState(url.hostname))
  if (url.pathname === '/repository' || url.pathname.startsWith('/books/'))
    return readRepositoryResource(service, uri)
  if (
    url.pathname === '/library' ||
    url.pathname === '/playback' ||
    url.pathname.startsWith('/studies/')
  )
    return readRecordingResource(service, uri)
  const match = /^\/runs\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname)
  if (!match?.[1]) throw new StudyError('NOT_FOUND', 'Unknown resource.')
  const record = service.record({ instanceId: url.hostname, runId: match[1] })
  const suffix = match[2]
  if (!suffix) return json(service.state(record))
  // Everything below a run reads its raw evidence, which went to the Trash with a removed study.
  service.assertEvidenceReadable(record)
  const manifestPage = /^manifest\/pages\/([a-f0-9]{64})\/(0|[1-9]\d*)$/.exec(
    suffix,
  )
  if (suffix === 'manifest' || manifestPage) {
    if (record.profile === NODE_TEST_PROFILE && record.nodePrepared)
      return readJsonPage(
        service.uri(record.id, 'manifest'),
        {
          profile: NODE_TEST_PROFILE,
          configurationHash: record.nodePrepared.configurationHash,
          configuration: record.nodePrepared.configuration,
          descriptor: record.nodePrepared.descriptor,
          testFile: record.nodePrepared.configuration.testFile,
          testHash: record.nodePrepared.configuration.testHash,
        },
        manifestPage
          ? `pages/${manifestPage[1]}/${manifestPage[2]}`
          : undefined,
      )
    const manifest = record.runtime?.view().manifest
    if (!manifest)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'The run has not frozen its source and scenario manifest.',
      )
    return json(manifest)
  }
  if (suffix.startsWith('events/')) {
    const cursorText = suffix.slice('events/'.length)
    if (
      !/^(0|[1-9]\d*)$/.test(cursorText) ||
      !Number.isSafeInteger(Number(cursorText))
    )
      throw new StudyError(
        'INVALID_REFERENCE',
        'Event cursor must be a nonnegative sequence number.',
      )
    const cursor = Number(cursorText),
      events =
        record.profile === NODE_TEST_PROFILE
          ? (record.nodeEvents ?? [])
          : (record.runtime?.view().events ?? [])
    const page = events
      .filter((event) => event.sequence > cursor)
      .slice(0, EVENT_PAGE_SIZE)
    const last = page.at(-1)?.sequence ?? cursor
    return json({
      events: page.map((event) => ({
        ...event,
        detail:
          Buffer.byteLength(JSON.stringify(event.detail)) >
          EVENT_DETAIL_LIMIT_BYTES
            ? omittedDetail(event.detail)
            : event.detail,
      })),
      nextUri: events.some((event) => event.sequence > last)
        ? service.uri(record.id, `events/${last}`)
        : undefined,
      afterSequence: cursor,
      lastSequence: last,
    })
  }
  const nodeStopMatch =
    /^node-stops\/(0|[1-9]\d*)(?:\/source\/typescript)?(?:\/pages\/([a-f0-9]{64})\/(0|[1-9]\d*))?$/.exec(
      suffix,
    )
  if (nodeStopMatch) {
    if (record.profile !== NODE_TEST_PROFILE || !record.nodePrepared)
      throw new StudyError(
        'NOT_FOUND',
        'No Node test source stop exists for this run.',
      )
    const index = Number(nodeStopMatch[1]),
      stop = record.nodeStops?.[index]
    if (!stop)
      throw new StudyError(
        'NOT_FOUND',
        'The requested Node test source stop has not been committed.',
      )
    const sourceUri = service.uri(
      record.id,
      `node-stops/${index}/source/typescript`,
    )
    if (suffix.includes('/source/typescript')) {
      const source = record.nodePrepared.descriptor.sources.find(
        (candidate) => candidate.path === stop.source.path,
      )
      if (
        !source ||
        source.hash !== stop.source.hash ||
        sha256(source.text) !== stop.source.hash
      )
        throw new EvidenceIntegrityError(
          'The cited Node source no longer matches its retained hash.',
        )
      return { uri, mimeType: 'text/typescript', text: source.text }
    }
    const data = {
      index,
      historical: true,
      participant: 'server',
      source: { ...stop.source, uri: sourceUri },
      frame: {
        name: stop.frame.name,
        line: stop.frame.line,
        column: stop.frame.column,
      },
      variables: stop.variables,
      facts: stop.facts,
      debuggerSnapshot: stop.debuggerSnapshot,
    }
    return readJsonPage(
      service.uri(record.id, `node-stops/${index}`),
      data,
      nodeStopMatch[2]
        ? `pages/${nodeStopMatch[2]}/${nodeStopMatch[3]}`
        : undefined,
    )
  }
  if (suffix.startsWith('explanations/')) {
    const explanation = record.explanations.get(
      suffix.slice('explanations/'.length),
    )
    if (!explanation)
      throw new StudyError(
        'NOT_FOUND',
        'No committed explanation with that ID.',
      )
    return json(explanation)
  }
  if (suffix.startsWith('images/')) {
    if (record.profile === NODE_TEST_PROFILE)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Node test images are unavailable until video capture is implemented for this profile.',
      )
    const phase = describeStudy(record).capturePhases.find(
      (value) => `images/${value}` === suffix,
    )
    const capture = phase && record.runtime?.view().captures[phase]
    if (
      !phase ||
      !record.runtime ||
      capture?.status !== 'captured' ||
      !capture.renderer
    )
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'The requested phase has no confirmed image.',
      )
    const bytes = await readBoundedFile(
      join(record.runtime.evidence.directory, capture.file ?? `${phase}.png`),
      IMAGE_LIMIT_BYTES,
    )
    if (sha256(bytes) !== capture.renderer.hash)
      throw new EvidenceIntegrityError(
        'Captured image no longer matches its sealed hash.',
      )
    return { uri, mimeType: 'image/png', blob: bytes.toString('base64') }
  }
  const imageMatch = /^(snapshots\/[^/]+)\/image$/.exec(suffix)
  if (imageMatch?.[1]) {
    const snapshot = service.snapshot(
      record,
      service.uri(record.id, imageMatch[1]),
    )
    const capture = record.runtime?.view().snapshotCaptures?.[snapshot.id]
    if (
      !record.runtime ||
      capture?.status !== 'captured' ||
      !capture.file ||
      !capture.renderer
    )
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'This snapshot has no confirmed image.',
      )
    const bytes = await readBoundedFile(
      join(record.runtime.evidence.directory, capture.file),
      IMAGE_LIMIT_BYTES,
    )
    if (sha256(bytes) !== capture.renderer.hash)
      throw new EvidenceIntegrityError(
        'Snapshot image no longer matches its sealed hash.',
      )
    return { uri, mimeType: 'image/png', blob: bytes.toString('base64') }
  }
  const inspectionMatch =
    /^(snapshots\/[^/]+)\/inspection(?:\/(pages\/[a-f0-9]{64}\/(?:0|[1-9]\d*)))?$/.exec(
      suffix,
    )
  if (inspectionMatch?.[1]) {
    const snapshotUri = service.uri(record.id, inspectionMatch[1]),
      snapshot = service.snapshot(record, snapshotUri)
    // The declared, requested and bound places of the stop this snapshot answers, from the run itself.
    const boundPlace = service.boundPlace(record, snapshot),
      declaredPlace = boundPlace && {
        line: boundPlace.declaredLine,
        column: boundPlace.declaredColumn,
      }
    return readJsonPage(
      `${snapshotUri}/inspection`,
      {
        snapshotUri,
        historical: true,
        pause: snapshot.pause,
        elapsedMs: snapshot.elapsedMs,
        // Only for a stop the debugger bound on another line than declared: the sentence that names the paused line.
        ...(boundPlace?.place && { place: boundPlace.place }),
        // The position the debugger bound and paused at; it lies on the declared line or a later line the stop's binding rule accepts, and may differ from the requested column.
        source: {
          hash: snapshot.source.hash,
          line: snapshot.source.line,
          column: snapshot.source.column,
          uri: `${snapshotUri}/source/typescript`,
        },
        // requestedSource keeps its meaning (the declared position); declaredSource says it under its own name, and armed is where the breakpoint was requested when that differs.
        ...(declaredPlace && {
          requestedSource: declaredPlace,
          declaredSource: declaredPlace,
        }),
        ...(boundPlace?.armed && { armed: boundPlace.armed }),
        values: snapshot.values,
        unavailableValues: snapshot.unavailableValues,
      },
      inspectionMatch[2],
    )
  }
  const sourceMatch =
    /^(snapshots\/[^/]+)(?:\/source\/(typescript|javascript|map))?$/.exec(
      suffix,
    )
  if (sourceMatch?.[1]) {
    const snapshotUri = service.uri(record.id, sourceMatch[1])
    const snapshot = service.snapshot(record, snapshotUri)
    if (!sourceMatch[2])
      return json({
        ...snapshot,
        snapshotUri,
        historical: true,
        sourceUri: `${snapshotUri}/source/typescript`,
      })
    const source = record.runtime?.source(snapshot.itemId, snapshot.id)
    if (!source)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'The sealed source is unavailable.',
      )
    const hashes = snapshotSourceHashes(snapshot)
    const selection =
      sourceMatch[2] === 'typescript'
        ? {
            text: source.source,
            hash: hashes.typescript,
            mimeType: 'text/typescript',
          }
        : sourceMatch[2] === 'javascript'
          ? {
              text: source.javascript,
              hash: hashes.javascript,
              mimeType: 'text/javascript',
            }
          : {
              text: source.sourceMap,
              hash: hashes.sourceMap,
              mimeType: 'application/json',
            }
    const limit =
      snapshot.actionId !== REPOSITORY_BROWSER_ACTION
        ? SOURCE_LIMIT_BYTES
        : sourceMatch[2] === 'typescript'
          ? REPOSITORY_SOURCE_LIMIT_BYTES
          : sourceMatch[2] === 'javascript'
            ? REPOSITORY_JAVASCRIPT_LIMIT_BYTES
            : REPOSITORY_MAP_LIMIT_BYTES
    if (
      Buffer.byteLength(selection.text) > limit ||
      sha256(selection.text) !== selection.hash
    )
      throw new EvidenceIntegrityError(
        'Captured source exceeds limits or its sealed hash changed.',
      )
    return { uri, mimeType: selection.mimeType, text: selection.text }
  }
  throw new StudyError('NOT_FOUND', 'Unknown resource kind.')
}
