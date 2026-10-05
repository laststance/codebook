import { readlinkSync } from 'node:fs'

import {
  LINUX_PID_NAMESPACE_PATH,
  PROCESS_START_FORMS,
  PROCESS_START_NAMESPACE_MARK,
} from '../constants'

/** What {@link processStartFormHere} reads with; each is the real one unless a caller or a test names its own. */
export type ProcessStartFormInputs = {
  /** The system whose form is asked for; `process.platform` when left out. */
  platform?: NodeJS.Platform
  /** Reads where a link points (Linux: {@link LINUX_PID_NAMESPACE_PATH}), at once, and throws when it cannot. A test's own read is asked every time; the real one is asked once per process. */
  readLink?: (path: string) => string
}

/** The form of the starts each platform's query answers, for a platform that is looked up by name; a platform without a query has none. */
const FORMS_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> =
  PROCESS_START_FORMS
/** What the link of a pid namespace points to: `pid:[4026531836]`, whose number names the namespace. */
const PID_NAMESPACE_LINK = /^pid:\[(\d+)\]$/

/** The pid namespace of this process as the real read gave it, kept for the process: a namespace does not change while a process runs, and a form that changed would keep this process from knowing its own records. A read that failed is kept too. */
let ownPidNamespace: { number: string | undefined } | undefined

/**
 * Reads which pid namespace the reading process is in; called by {@link pidNamespaceHere} with the real read or a test's own.
 * @param readLink - Reads where a link points and throws when it cannot.
 * @returns The namespace's number as text; `undefined` when the link cannot be read (a system without `/proc`, a sandbox that hides it) and when it points to something else.
 * @example
 * readPidNamespace(() => 'pid:[4026531836]') // => '4026531836'
 * readPidNamespace(() => { throw new Error('ENOENT') }) // => undefined
 */
function readPidNamespace(
  readLink: NonNullable<ProcessStartFormInputs['readLink']>,
): string | undefined {
  try {
    return PID_NAMESPACE_LINK.exec(readLink(LINUX_PID_NAMESPACE_PATH))?.[1]
  } catch {
    return undefined
  }
}

/**
 * Gives the pid namespace of this process, read once and kept; called by {@link processStartFormHere} on Linux.
 * @param readLink - A test's own read, which is asked every time and whose answer is not kept; the real read when left out.
 * @returns The namespace's number as text, or `undefined` when it cannot be read.
 * @example
 * pidNamespaceHere() // => '4026531836'
 */
function pidNamespaceHere(
  readLink?: ProcessStartFormInputs['readLink'],
): string | undefined {
  if (readLink) return readPidNamespace(readLink)
  ownPidNamespace ??= {
    number: readPidNamespace((path) => readlinkSync(path)),
  }
  return ownPidNamespace.number
}

/**
 * Names the space of process ids this process reads starts in and probes, as the form of every process start it answers: the text before the first colon of what {@link readProcessStart} gives here. Called by {@link readProcessStart} for each Linux start, and by {@link canJudgeOwnerHere} for a window whose own start is unknown.
 * A process id means a process only inside one such space. Each system has its own (`ps` on macOS, `win` on Windows), and on Linux each pid namespace has: two WSL distributions of one computer, or a container and its host, run on one kernel under one boot id, while a process id of one names another process, or none, in the other. The Linux form therefore names the namespace, `linux@<number>`.
 * @param inputs - The platform and the read of the namespace link; the real ones when left out.
 * @returns
 * - `linux@<number>` on Linux, with the number of this process's pid namespace; `linux` when the namespace cannot be read
 * - `ps` on macOS and `win` on Windows
 * - `undefined` on a platform whose process starts cannot be read
 * @example
 * processStartFormHere()                                                            // => 'linux@4026531836'
 * processStartFormHere({ platform: 'win32' })                                       // => 'win'
 * processStartFormHere({ platform: 'linux', readLink: () => { throw new Error() } }) // => 'linux'
 */
export function processStartFormHere(
  inputs: ProcessStartFormInputs = {},
): string | undefined {
  const form = FORMS_BY_PLATFORM[inputs.platform ?? process.platform]
  if (form !== PROCESS_START_FORMS.linux) return form
  const pidNamespace = pidNamespaceHere(inputs.readLink)
  return pidNamespace === undefined
    ? form
    : `${form}${PROCESS_START_NAMESPACE_MARK}${pidNamespace}`
}
