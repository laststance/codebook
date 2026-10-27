import { basename } from 'node:path'

import { WIKI_UPDATE_RECOVERY_REQUEST } from '../constants'

import type { WikiAgentExit } from './agentExitOf'
import { describeWikiGenerateBlock } from './describeWikiGenerateBlock'
import type { WikiUpdateStartBlock } from './findWikiUpdateStartBlock'
import type { AwaitedWikiChat } from './hasWikiPublishEndedWait'
import type {
  WikiUpdateMarker,
  WikiUpdateMarkerLook,
} from './readLiveWikiUpdateMarker'
import type {
  LlmWikiStoppedGeneration,
  LlmWikiViewFacts,
} from './readLlmWikiViewState'
import { wikiGenerateNotice } from './wikiGenerateNotice'
import { wikiOutputLabel } from './wikiOutputLabel'
import { wikiRunBoundMs } from './wikiRunBoundMs'
import { wikiUpdateNotice } from './wikiUpdateNotice'
import type { WikiUpdateHost, WikiUpdateStatus } from './wikiUpdateRun'

/** What {@link readLlmWikiViewFacts} asks of the editor window, each as a closure of the extension's activation, so host tests pass the real ones and unit tests stand-ins. */
export type LlmWikiViewFactsDependencies = {
  /** The editor this window runs in. */
  host: WikiUpdateHost
  /** Whether the window has a folder open. */
  isFolderOpen: () => boolean
  /** Whether the editor trusts the folder. */
  isTrusted: () => boolean
  /** The project and the Wiki folder its setting names, without reading the folder. */
  wikiLocation: () => Promise<{ projectRoot: string; outputDirectory: string }>
  /** The publish token of the manifest; `undefined` while there is none. */
  readPublishToken: (outputDirectory: string) => Promise<string | undefined>
  /** The publisher's receipt that names the manifest; `undefined` while there is none. */
  readPublication: (outputDirectory: string) => Promise<string | undefined>
  /** What makes the publisher refuse an update before it stages anything. */
  findStartBlock: (
    outputDirectory: string,
    projectRoot: string,
  ) => Promise<WikiUpdateStartBlock | undefined>
  /** Reads the manifest as a Wiki of this project: the revision it records and when it was written. @throws When the manifest is no Wiki of this project. */
  readGeneration: (
    projectRoot: string,
    outputDirectory: string,
  ) => Promise<{ revision?: string; publishedAtMs?: number }>
  /** Says whether the manifest names this project. @throws When the manifest cannot be read. */
  isWikiOwnedBy: (
    projectRoot: string,
    outputDirectory: string,
  ) => Promise<boolean>
  /** Looks at the run marker as a window that owns none, so this window's own reservation is seen too. */
  readMarker: (outputDirectory: string) => Promise<WikiUpdateMarkerLook>
  /** This window's own id in the marker. */
  ownWindowId: string
  /** Whether a start of this window is under way that has not begun its run. */
  isStartUnderWay: () => boolean
  /** Whether a publication after a stopped watch's end ended its wait. */
  hasPublishEndedWait: (
    outputDirectory: string,
    awaited: AwaitedWikiChat,
  ) => Promise<boolean>
  /** This window's run state. */
  runStatus: () => WikiUpdateStatus
  /** Whether this window's change of the output's marker (its removal, or its turn into a stopped watch's reservation) is still pending: from the run's end until it is made or given up, retries included. */
  isMarkerChangePending: (outputDirectory: string) => boolean
  /** Whether a VS Code run still waits for the chat's first sign. */
  isAwaitingChat: () => boolean
  /** How the Cursor agent of this window's last run exited. */
  lastAgentExit: () => WikiAgentExit | undefined
  /** The present (epoch milliseconds). */
  now: () => number
}

/** What a read of the facts found about the marker. */
type MarkerFacts = Pick<
  Extract<LlmWikiViewFacts, { kind: 'ready' }>,
  'elsewhere' | 'reservation' | 'isMarkerSettling'
>

/**
 * Words the sentence of a start block for the attention row: the update's sentence where a Wiki stands, the generation's where none does.
 * @param block - The cause and the paths the start check named.
 * @param isWikiPresent - Whether a manifest stands in the folder.
 * @param location - The Wiki folder and its label.
 * @param host - The editor host.
 * @param nowMs - The present, for the sentence's time.
 * @returns The full sentence.
 * @example sentenceOfBlock({ cause: 'held-publish-lock', paths: ['wiki.publish-lock.json'] }, false, location, 'vscode', 0)
 */
function sentenceOfBlock(
  block: WikiUpdateStartBlock,
  isWikiPresent: boolean,
  location: { outputDirectory: string; outputLabel: string },
  host: WikiUpdateHost,
  nowMs: number,
): string {
  if (!isWikiPresent)
    return describeWikiGenerateBlock(block, location.outputLabel)
  const notice = wikiUpdateNotice({
    state: 'conflict',
    host,
    finishedAt: new Date(nowMs).toISOString(),
    paths: block.paths,
    cause: block.cause,
    site: 'kept',
    ...location,
  })
  return (
    notice?.message ?? describeWikiGenerateBlock(block, location.outputLabel)
  )
}

/**
 * Says whether this window's own marker, which still stands as a run's, is being removed or turned into a reservation after its run ended.
 *
 * Why: a run's end reaches the view before the file work that removes its marker or turns it into the reservation of a stopped watch, and a change that failed waits for its retry, so a read in that time sees neither a run nor a reservation. The change is pending from the turn the run's end is recorded until it is made or given up, and either end makes the view read again; a marker still standing after that is not settling, so the view shows what the facts say.
 * Trigger: {@link readMarkerFacts} asks it for this window's own live marker.
 *
 * @param dependencies - The editor window's closures.
 * @param outputDirectory - The Wiki folder whose marker it is.
 * @returns `true` while this window has no running run and its change of this marker is pending; `false` while a run runs, and once the change was made or given up.
 * @example isOwnMarkerSettling({ ...dependencies, runStatus: () => ({ state: 'idle' }), isMarkerChangePending: () => true }, '/repo/.codebook/wiki') // => true
 */
function isOwnMarkerSettling(
  dependencies: LlmWikiViewFactsDependencies,
  outputDirectory: string,
): boolean {
  // A running run's marker is row 2's.
  if (dependencies.runStatus().state === 'running') return false
  return dependencies.isMarkerChangePending(outputDirectory)
}

/**
 * Reads the marker beside the Wiki into this window's view of the other windows: a live run of another window, or the reservation of a stopped watch.
 * @param dependencies - The editor window's closures.
 * @param outputDirectory - The Wiki folder.
 * @returns Row 2b or row 2c facts; none for this window's own running marker (row 2 shows it), for a reservation whose wait a publication ended, and for a look that failed.
 * @example await readMarkerFacts(dependencies, '/repo/.codebook/wiki') // => { elsewhere: { kind: 'update', startedAtMs: 1_790_000_000_000 } }
 */
async function readMarkerFacts(
  dependencies: LlmWikiViewFactsDependencies,
  outputDirectory: string,
): Promise<MarkerFacts> {
  const look = await dependencies
    .readMarker(outputDirectory)
    .catch(() => undefined)
  if (look?.kind === 'being-written') {
    // This window's own claim is written for a moment before its run begins.
    return dependencies.isStartUnderWay()
      ? {}
      : { elsewhere: { startedAtMs: look.heldBy.beingWrittenSinceMs } }
  }
  if (look?.kind !== 'live') return {}
  const held: WikiUpdateMarker = look.heldBy
  if (held.watchEndedAtMs === undefined) {
    // This window's own live marker is row 2's, never "another window".
    if (held.windowId === dependencies.ownWindowId)
      return isOwnMarkerSettling(dependencies, outputDirectory)
        ? { isMarkerSettling: true }
        : {}
    return { elsewhere: { kind: held.runKind, startedAtMs: held.startedAtMs } }
  }
  // A start refuses for this reservation only until its own deadline, the same one the start check uses; a live owner process does not extend it.
  const retryAtMs = held.watchEndedAtMs + wikiRunBoundMs(held.runKind, 'vscode')
  if (dependencies.now() >= retryAtMs) return {}
  const hasWaitEnded = await dependencies
    .hasPublishEndedWait(outputDirectory, {
      watchEndedAtMs: held.watchEndedAtMs,
      candidateNames: [],
    })
    .catch(() => false)
  if (hasWaitEnded) return {}
  return {
    reservation: {
      kind: held.runKind,
      host: held.host,
      startedAtMs: held.startedAtMs,
      retryAtMs,
    },
  }
}

/**
 * Reads this window's run: the running one, or the generation that ended without a publication.
 * @param dependencies - The editor window's closures.
 * @param outputDirectory - The Wiki folder the view shows.
 * @returns Row 2 or row 3 facts.
 * @example readRunFacts(dependencies, '/repo/.codebook/wiki') // => { run: { kind: 'generate', startedAtMs: 1_790_000_000_000, timeoutMs: 3_300_000, isAwaitingChat: false } }
 */
function readRunFacts(
  dependencies: LlmWikiViewFactsDependencies,
  outputDirectory: string,
): Pick<Extract<LlmWikiViewFacts, { kind: 'ready' }>, 'run' | 'lastAttempt'> {
  const status = dependencies.runStatus()
  if (status.state === 'running')
    return {
      run: {
        kind: status.runKind ?? 'update',
        startedAtMs: Date.parse(status.startedAt),
        timeoutMs: status.timeoutMs,
        isAwaitingChat: dependencies.isAwaitingChat(),
      },
    }
  if (
    status.state === 'idle' ||
    status.state === 'succeeded' ||
    status.state === 'already-current' ||
    status.runKind !== 'generate' ||
    status.outputDirectory !== outputDirectory
  )
    return {}
  const sentence = wikiGenerateNotice(status)?.message
  if (sentence === undefined) return {}
  const exitCode = dependencies.lastAgentExit()?.exitCode ?? undefined
  const lastAttempt: LlmWikiStoppedGeneration = {
    state: status.state,
    host: status.host,
    sentence,
    ...(status.state === 'timed-out' ? { timeoutMs: status.timeoutMs } : {}),
    ...(exitCode === undefined ? {} : { agentExitCode: exitCode }),
  }
  return { lastAttempt }
}

/**
 * Reads the manifest and the start block into the Wiki and attention facts.
 * @param dependencies - The editor window's closures.
 * @param location - The project, the Wiki folder and its label.
 * @returns The published Wiki (its freshness still `checking`), its generation and the attention cause, where there is one.
 * @example await readManifestFacts(dependencies, location) // => { wiki: { freshness: { status: 'checking' }, generation: {} } }
 */
async function readManifestFacts(
  dependencies: LlmWikiViewFactsDependencies,
  location: {
    projectRoot: string
    outputDirectory: string
    outputLabel: string
  },
): Promise<
  Pick<Extract<LlmWikiViewFacts, { kind: 'ready' }>, 'wiki' | 'attention'>
> {
  const { projectRoot, outputDirectory, outputLabel } = location
  const nowMs = dependencies.now()
  // The start check and the token read do not depend on each other, so both are under way together.
  const blockRead = dependencies.findStartBlock(outputDirectory, projectRoot)
  // A token that cannot be read still means a manifest stands there.
  const tokenRead = dependencies.readPublishToken(outputDirectory).then(
    (token) => ({ didReadFail: false, token }),
    () => ({ didReadFail: true, token: undefined }),
  )
  const [block, tokenLook] = await Promise.all([blockRead, tokenRead])
  const isManifestPresent =
    tokenLook.didReadFail || tokenLook.token !== undefined
  const generation = isManifestPresent
    ? await dependencies
        .readGeneration(projectRoot, outputDirectory)
        .catch(() => undefined)
    : undefined
  const wiki = generation
    ? { wiki: { freshness: { status: 'checking' as const }, generation } }
    : {}
  if (block)
    return {
      ...wiki,
      attention: {
        cause: block.cause,
        sentence: sentenceOfBlock(
          block,
          isManifestPresent,
          { outputDirectory, outputLabel },
          dependencies.host,
          nowMs,
        ),
      },
    }
  // A manifest that stands but reads as no Wiki of this project is another checkout's, or cannot be read.
  if (isManifestPresent && !generation) {
    const isOwned = await dependencies
      .isWikiOwnedBy(projectRoot, outputDirectory)
      .catch(() => undefined)
    return isOwned === false
      ? {
          attention: {
            cause: 'foreign-manifest',
            sentence: `The manifest in ${outputLabel} belongs to another checkout, not to this project. Set codebook.wikiOutputDirectory to a folder of this project.`,
          },
        }
      : {
          attention: {
            cause: 'unreadable-manifest',
            sentence: `The manifest in ${outputLabel} cannot be read as an LLM Wiki of this project. Ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}" to recover it.`,
          },
        }
  }
  return wiki
}

/**
 * Reads every fact the LLM Wiki view's rows are made of, without the slow freshness check: folder and trust, the manifest, the start block, the marker beside the Wiki and this window's run.
 *
 * Why: the view must show a published Wiki at once and read its freshness afterwards, so the read that decides the rows stays fast.
 * Trigger: {@link LlmWikiView} calls it for every refresh.
 *
 * @param dependencies - The editor window's closures ({@link LlmWikiViewFactsDependencies}).
 * @returns The facts for {@link readLlmWikiViewState}; the Wiki's freshness is `checking`.
 * @throws What the folder, the manifest or the start check threw; the view shows its error row.
 * @example
 * await readLlmWikiViewFacts(dependencies) // => { kind: 'ready', host: 'vscode', repositoryName: 'nextjs-dashboard', … }
 */
export async function readLlmWikiViewFacts(
  dependencies: LlmWikiViewFactsDependencies,
): Promise<LlmWikiViewFacts> {
  if (!dependencies.isFolderOpen()) return { kind: 'no-folder' }
  if (!dependencies.isTrusted()) return { kind: 'untrusted' }
  const { projectRoot, outputDirectory } = await dependencies.wikiLocation()
  const outputLabel = wikiOutputLabel(projectRoot, outputDirectory)
  // The receipt is read before the manifest: a publication between the two reads then pairs the newer manifest with the older receipt, which the next refresh corrects, and never an old Wiki with the new receipt.
  const publication = await dependencies
    .readPublication(outputDirectory)
    .catch(() => undefined)
  // Once the receipt is read, the manifest facts and the marker do not depend on each other, so they are read together.
  const [manifestFacts, markerFacts] = await Promise.all([
    readManifestFacts(dependencies, {
      projectRoot,
      outputDirectory,
      outputLabel,
    }),
    readMarkerFacts(dependencies, outputDirectory),
  ])
  return {
    kind: 'ready',
    host: dependencies.host,
    projectRoot,
    repositoryName: basename(projectRoot),
    outputLabel,
    outputDirectory,
    nowMs: dependencies.now(),
    publication,
    ...manifestFacts,
    ...readRunFacts(dependencies, outputDirectory),
    ...markerFacts,
  }
}
