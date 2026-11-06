import { open } from 'node:fs/promises'

import {
  LIBRARY_OBSERVATION_LIMIT_BYTES,
  REPOSITORY_PATH_LIMIT_CHARS,
} from '../constants'

import { cutTextToLength } from './cutTextToLength'

/** What a library run's script was seen to load. */
export type LibraryObservation = {
  /** Whether at least one module of the packed copy was loaded (not merely resolved). */
  loaded: boolean
  /** How many modules of the packed copy were loaded. */
  loadCount: number
  /** Whether a module of a package with the same name was loaded from any other real path. */
  otherCopyLoaded: boolean
  /** The first such path. */
  otherCopyPath?: string
  /** `complete` when at least one process wrote a start line, every process that wrote one also wrote its closing line, and no line is cut; `incomplete` otherwise (a process that did not end normally or could not write, a closing line without its start, a cut line); `unreadable` when the file cannot be read. Never a negative: counts of an incomplete observation are lower bounds. */
  observation: 'complete' | 'incomplete' | 'unreadable'
}

/** Reads the text of the observation file up to the limit; `undefined` when unreadable, `null` when the file passes the limit. */
async function readObservationText(
  file: string,
): Promise<string | null | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(file, 'r')
    const { size } = await handle.stat()
    if (size > LIBRARY_OBSERVATION_LIMIT_BYTES) return null
    return await handle.readFile('utf8')
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/** Reads one event line; `undefined` for a line that is not a JSON object with an `event`. */
function parseEventLine(
  line: string,
): { event: string; path?: string; pid?: number } | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) return undefined
    const event = Reflect.get(value, 'event')
    const path = Reflect.get(value, 'path')
    const pid = Reflect.get(value, 'pid')
    return typeof event === 'string'
      ? {
          event,
          path: typeof path === 'string' ? path : undefined,
          pid: typeof pid === 'number' ? pid : undefined,
        }
      : undefined
  } catch {
    return undefined
  }
}

/** Whether every process that wrote a start line also wrote its closing line, and at least one process started. */
function hasEveryProcessClosed(
  started: ReadonlySet<number | undefined>,
  closed: ReadonlySet<number | undefined>,
): boolean {
  return (
    started.size > 0 &&
    [...closed].every((pid) => started.has(pid)) &&
    [...started].every((pid) => closed.has(pid))
  )
}

/** Keeps a forged `other-copy` line without a string path out, and cuts a kept path like the history sink does. */
function keptOtherCopyPath(path: string | undefined): string | undefined {
  return path === undefined
    ? undefined
    : cutTextToLength(path, REPOSITORY_PATH_LIMIT_CHARS)
}

/**
 * Reads the observation file the library hook wrote and counts what the script loaded.
 *
 * Why it exists: the run may claim "ran on the checked-out library" only when a module of the packed copy was loaded and the observation is complete; a file without the closing line or with a cut line is `incomplete`, never a negative.
 * Called by `finishObservation` of {@link prepareLibraryPackage} after the process tree ended.
 * @param file - The observation file of the run.
 * @returns The loads seen so far and how far the file can be trusted.
 * @example
 * await readLibraryObservation('/tmp/run/observation.jsonl') // => { loaded: true, loadCount: 3, otherCopyLoaded: false, observation: 'complete' }
 */
export async function readLibraryObservation(
  file: string,
): Promise<LibraryObservation> {
  const text = await readObservationText(file)
  if (text === undefined)
    return {
      loaded: false,
      loadCount: 0,
      otherCopyLoaded: false,
      observation: 'unreadable',
    }
  if (text === null)
    return {
      loaded: false,
      loadCount: 0,
      otherCopyLoaded: false,
      observation: 'incomplete',
    }
  // Only lines ended by a line break are whole; the rest is a cut line.
  const lines = text.split('\n')
  lines.pop()
  let hasCut = !text.endsWith('\n') && text !== ''
  // Per process (a line without a pid counts as one unnamed process): whether it wrote its start and its closing line.
  const started = new Set<number | undefined>()
  const closed = new Set<number | undefined>()
  let loadCount = 0
  let otherCopyPath: string | undefined
  for (const line of lines) {
    const parsed = parseEventLine(line)
    if (parsed === undefined) hasCut = true
    else if (parsed.event === 'load') loadCount++
    else if (parsed.event === 'other-copy')
      otherCopyPath ??= keptOtherCopyPath(parsed.path)
    else if (parsed.event === 'start') started.add(parsed.pid)
    else if (parsed.event === 'closing') closed.add(parsed.pid)
  }
  return {
    loaded: loadCount > 0,
    loadCount,
    otherCopyLoaded: otherCopyPath !== undefined,
    ...(otherCopyPath === undefined ? {} : { otherCopyPath }),
    observation:
      hasEveryProcessClosed(started, closed) && !hasCut
        ? 'complete'
        : 'incomplete',
  }
}
