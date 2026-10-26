import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

import {
  CONTROL_CHARACTER_CODE_LIMIT,
  DELETE_CHARACTER_CODE,
} from '../constants'

import type { WikiAgentExit } from './agentExitOf'
import type { WikiRunKind, WikiUpdateStatus } from './wikiUpdateRun'

/** One ended run as its record takes it: the state the run ended in; its start and the Cursor agent's exit come beside it in {@link wikiRunRecord}'s `details`. */
type EndedWikiRun = Exclude<WikiUpdateStatus, { state: 'idle' | 'running' }>

/**
 * Says in Codebook's own words how a run ended, without any text an agent, its CLI, a chat or a thrown error supplied; called by {@link wikiRunRecord} for the record's summary.
 * @param ended - The ended state.
 * @returns A fixed phrase for the state; for a conflict also its cause, and for a success the count of sources that changed while a generation worked.
 * @example
 * endSummary({ state: 'conflict', cause: 'learner-file', … }) // => 'stopped by files the publisher will not overwrite (learner-file)'
 */
function endSummary(ended: EndedWikiRun): string {
  switch (ended.state) {
    case 'succeeded':
      return ended.changedSourceCount
        ? `published; ${ended.changedSourceCount} source files changed while it ran`
        : 'published'
    case 'already-current':
      return 'nothing to update: the Wiki matches the source'
    case 'cancelled':
      return 'stopped by the learner or the closing window'
    case 'timed-out':
      return 'stopped at its bound'
    case 'conflict':
      return `stopped by files the publisher will not overwrite (${ended.cause})`
    default:
      return failureSummary(ended)
  }
}

/**
 * Says in Codebook's own words where a failure's reason came from, never the reason itself, which may carry an agent's or a chat's text; called by {@link endSummary} for `failed`.
 * @param failed - The failed state.
 * @returns A fixed phrase: a publication that failed a check, a sentence Codebook wrote, or text Codebook does not record.
 * @example failureSummary({ state: 'failed', site: 'kept', isCodebookSentence: true, … }) // => 'failed; the notice names the cause'
 */
function failureSummary(
  failed: Extract<EndedWikiRun, { state: 'failed' }>,
): string {
  if (failed.site === 'replaced')
    return 'a publication appeared but failed a check'
  return failed.isCodebookSentence
    ? 'failed; the notice names the cause'
    : 'failed; the agent’s or the error’s text is not recorded'
}

/**
 * Shows a path with the home folder as `~`, so a record copied into an issue does not name the learner's account; called by {@link wikiRunRecord} for the output folder.
 * @param path - An absolute path or a project-relative label.
 * @param homeDirectory - The learner's home folder; tests pass their own.
 * @param platform - The system whose paths these are: Windows compares them without case (a drive letter or a folder may be written in another case than `homedir()` names it), every other system with case.
 * @returns The path with a leading home folder replaced by `~`, the rest as written; any other path as it is.
 * @example
 * pathWithHomeShortened('/Users/learner/repo/.codebook/wiki', '/Users/learner', 'darwin') // => '~/repo/.codebook/wiki'
 * pathWithHomeShortened('c:\\Users\\Learner\\repo', 'C:\\Users\\learner', 'win32')       // => '~\\repo'
 */
function pathWithHomeShortened(
  path: string,
  homeDirectory: string,
  platform: NodeJS.Platform,
): string {
  const isWindows = platform === 'win32'
  const separator = isWindows ? win32.sep : posix.sep
  // Only the comparison folds case on Windows; the record keeps the path as it was written.
  const comparable = (value: string): string =>
    isWindows ? value.toLowerCase() : value
  if (comparable(path) === comparable(homeDirectory)) return '~'
  return homeDirectory !== '' &&
    comparable(path).startsWith(comparable(homeDirectory + separator))
    ? `~${path.slice(homeDirectory.length)}`
    : path
}

/**
 * Writes the control characters of a path as `\u` escapes, so a folder name with a line break cannot add a line to the one-line record (a workspace setting names the folder; /ship review, Cycle 0055 pt1).
 * @param path - The path as the record shows it.
 * @returns The path with every control character escaped.
 * @example withoutControlCharacters('/repo/a\nb') // => '/repo/a\\u000ab'
 */
function withoutControlCharacters(path: string): string {
  return Array.from(path, (character) => {
    const code = character.charCodeAt(0)
    // C0 controls and DEL are written as escapes; every other character stays as it is.
    return code < CONTROL_CHARACTER_CODE_LIMIT || code === DELETE_CHARACTER_CODE
      ? `\\u${code.toString(16).padStart(4, '0')}`
      : character
  }).join('')
}

/**
 * Writes the one Output › Codebook record of an LLM Wiki generation or update that ended, from an allowlist of fields.
 *
 * Why: a learner who reports a stuck or failed run needs its kind, host, times, end and exit without reading the agent's work, and the agent's stdout, stderr, reply and a chat's error text may carry private source or credentials (Cycle 0055, Eng decision 81). So the record holds only fields Codebook knows as data and a summary in Codebook's own words; the output folder shows the home folder as `~`.
 * Trigger: the extension writes it at every generation's or update's end, a refused start included, and Show Output opens it.
 *
 * @param ended - The state the run ended in, as {@link WikiUpdateRun} recorded it.
 * @param details.runKind - The run's kind.
 * @param details.startedAt - When the run started, as an ISO timestamp; absent for a refused start.
 * @param details.agentExit - The Cursor agent's exit code or signal, where its process gave one.
 * @param homeDirectory - The learner's home folder; tests pass their own.
 * @param platform - The system whose paths these are; tests pass their own.
 * @returns One line: `LLM Wiki <kind> ended: host=… started=… ended=… end=… summary="…" [exit=…] output=…`.
 * @example
 * ```ts
 * wikiRunRecord({ state: 'failed', runKind: 'generate', host: 'cursor', finishedAt: '2026-10-26T05:00:00.000Z', reason: '…', site: 'kept', outputDirectory: '/Users/learner/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, { runKind: 'generate', startedAt: '2026-10-26T04:30:00.000Z', agentExit: { exitCode: 1, exitSignal: null } }, '/Users/learner')
 * // => 'LLM Wiki generate ended: host=cursor started=2026-10-26T04:30:00.000Z ended=2026-10-26T05:00:00.000Z end=failed summary="failed; the agent’s or the error’s text is not recorded" exit=1 output=~/repo/.codebook/wiki'
 * ```
 */
export function wikiRunRecord(
  ended: EndedWikiRun,
  details: {
    runKind: WikiRunKind
    startedAt?: string
    agentExit?: WikiAgentExit
  },
  homeDirectory: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const host = 'host' in ended ? ended.host : 'unknown'
  // An exit names its code, or the signal that ended the process when it had none.
  const exit = details.agentExit
    ? ` exit=${details.agentExit.exitCode ?? details.agentExit.exitSignal ?? 'unknown'}`
    : ''
  return `LLM Wiki ${details.runKind} ended: host=${host} started=${details.startedAt ?? 'not started'} ended=${ended.finishedAt} end=${ended.state} summary="${endSummary(ended)}"${exit} output=${withoutControlCharacters(pathWithHomeShortened(ended.outputDirectory, homeDirectory, platform))}`
}
