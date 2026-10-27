import {
  OUTPUT_REDACTION_CARRY_CHARS,
  OUTPUT_REDACTION_END_MARKER_TAIL_CHARS,
  OUTPUT_REDACTION_HOLD_LIMIT_CHARS,
  REDACTION_MASK,
} from '../constants'

import { redactSecretText } from './redactSecretText'

/** One channel's streaming redactor: feed chunks to `write`, call `end` once at the stream's end. */
export type OutputRedactor = {
  /** Returns the redacted text that is safe to release now. */
  write(text: string): string
  /** Releases whatever is still held, redacted. */
  end(): string
}

/** A private-key block's end marker, searched while a block's body is being dropped. */
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/
/** Where any secret shape this contract masks begins; a run of 8 KiB with none of these cannot be a secret yet. */
const SECRET_START =
  /eyJ|Bearer|:\/\/|sk-|gh[pousr]_|github_pat_|AKIA|-----BEGIN/i

/**
 * Finds where the text that may still grow into a secret begins; everything before it can be released.
 * Why: a token, a `Bearer` header or a PEM block can be split over chunks; called by {@link createOutputRedactor}.
 * @param text - Held text plus the new chunk.
 * @returns The index of the earliest possibly incomplete secret, or `text.length` when nothing needs holding.
 * @example holdStart('ok ghp_abc') // => 3
 */
function holdStart(text: string): number {
  let start = text.length
  // A trailing run without whitespace may be the front of a longer token.
  // Scanned backwards by hand: a regular expression would rescan a long run from every start.
  let runStart = text.length
  while (runStart > 0 && !/\s/.test(text.charAt(runStart - 1))) runStart--
  if (runStart < text.length) start = runStart
  // `Bearer` and its token may arrive in separate chunks.
  const bearer = /\bBearer(?:[ \t]+\S*)?$/i.exec(text)
  if (bearer) start = Math.min(start, bearer.index)
  // A private-key block is held from its BEGIN marker until its END marker arrived.
  const begin = text.lastIndexOf('-----BEGIN')
  if (begin !== -1) {
    const header = /^-----BEGIN ([A-Z0-9 ]*)-----/.exec(text.slice(begin))
    const isUnfinishedHeader = header === null && !/\n/.test(text.slice(begin))
    const isOpenPrivateKey =
      header !== null &&
      header[1]!.includes('PRIVATE KEY') &&
      !PRIVATE_KEY_END.test(text.slice(begin))
    if (isUnfinishedHeader || isOpenPrivateKey) start = Math.min(start, begin)
  }
  return start
}

/**
 * Makes the stateful redactor of one output channel (stdout or stderr), so a secret split over chunks is still masked before the output is cut, split or saved.
 * Holds back at most {@link OUTPUT_REDACTION_HOLD_LIMIT_CHARS} of an incomplete trailing token or private-key block; past that, a run that may be a secret fails closed (released as {@link REDACTION_MASK}, the rest of that token or block dropped) and a run showing no secret shape is released with a short carry. Called by {@link captureProcessOutput} for each channel of an owned test or server, before any truncation or event split.
 * @returns A fresh {@link OutputRedactor}; one per channel, never shared.
 * @example
 * const redactor = createOutputRedactor()
 * redactor.write('key ghp_') + redactor.write('abcdefghijklmnopqrstuvwxyz\n') + redactor.end()
 * // => 'key [masked]\n'
 */
export function createOutputRedactor(): OutputRedactor {
  let held = ''
  // Set after an overflow: the rest of the oversized token (until whitespace) or block (until its END marker) is dropped.
  let dropping: 'token' | 'block' | undefined

  const write = (text: string): string => {
    let combined = held + text
    held = ''
    // Finish dropping what a previous overflow began.
    if (dropping === 'block') {
      const end = PRIVATE_KEY_END.exec(combined)
      if (!end) {
        held = combined.slice(-OUTPUT_REDACTION_END_MARKER_TAIL_CHARS)
        return ''
      }
      combined = combined.slice(end.index + end[0].length)
      dropping = undefined
    } else if (dropping === 'token') {
      const rest = /^\S*/.exec(combined)![0]
      combined = combined.slice(rest.length)
      if (combined) dropping = undefined
      else return ''
    }
    const split = holdStart(combined)
    let released = combined.slice(0, split)
    held = combined.slice(split)
    if (held.length > OUTPUT_REDACTION_HOLD_LIMIT_CHARS) {
      if (SECRET_START.test(held)) {
        // Fail closed: a possible secret outgrew the hold, so mask it and drop the rest of that token or block.
        dropping = held.includes('-----BEGIN') ? 'block' : 'token'
        held = ''
        released += REDACTION_MASK
      } else {
        // No secret shape in the run: release it, keeping a short carry so a marker cut by the release is still seen whole.
        released += held.slice(0, -OUTPUT_REDACTION_CARRY_CHARS)
        held = held.slice(-OUTPUT_REDACTION_CARRY_CHARS)
      }
    }
    return redactSecretText(released)
  }

  const end = (): string => {
    const rest = dropping === undefined ? held : ''
    held = ''
    dropping = undefined
    return redactSecretText(rest)
  }

  return { write, end }
}
