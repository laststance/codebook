import { open } from 'node:fs/promises'

import { LIBRARY_OBSERVATION_LIMIT_BYTES } from '../constants'

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
  /** `complete` when the hook's closing line was read; `incomplete` for a missing closing line or a truncated line; `unreadable` when the file cannot be read. Never a negative: counts of an incomplete observation are lower bounds. */
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
): { event: string; path?: string } | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null) return undefined
    const event = Reflect.get(value, 'event')
    const path = Reflect.get(value, 'path')
    return typeof event === 'string'
      ? { event, path: typeof path === 'string' ? path : undefined }
      : undefined
  } catch {
    return undefined
  }
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
  const endsWhole = text.endsWith('\n')
  const lines = text.split('\n')
  lines.pop()
  let hasCut = !endsWhole && text !== ''
  let hasClosing = false
  let loadCount = 0
  let otherCopyPath: string | undefined
  for (const line of lines) {
    const parsed = parseEventLine(line)
    if (parsed === undefined) hasCut = true
    else if (parsed.event === 'load') loadCount++
    else if (parsed.event === 'other-copy') otherCopyPath ??= parsed.path ?? ''
    else if (parsed.event === 'closing') hasClosing = true
  }
  return {
    loaded: loadCount > 0,
    loadCount,
    otherCopyLoaded: otherCopyPath !== undefined,
    ...(otherCopyPath === undefined ? {} : { otherCopyPath }),
    observation: hasClosing && !hasCut ? 'complete' : 'incomplete',
  }
}
