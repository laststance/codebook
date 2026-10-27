import {
  OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS,
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
/** Where a secret shape this contract masks begins, each anchored as {@link redactSecretText} matches it (a URL only with a userinfo colon, a prefix only at a word start), so an ordinary long run that merely mentions `https://` or a `task-` word is not taken for one. */
const SECRET_START =
  /eyJ[A-Za-z0-9_-]|[Bb][Ee][Aa][Rr][Ee][Rr][ \t]|:\/\/[^\s/@]*:|(?<![A-Za-z0-9])(?:sk-|[sr]k_|gh[pousr]_|github_pat_|xox[abprs]-|npm_|AIza|AKIA|ASIA)|-----BEGIN/

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

/** An oversized private-key block being dropped: how many of its characters were dropped, and its last characters, kept only to find an END marker split across chunks (never released, never counted again). */
type DroppedBlock = { droppedChars: number; tail: string }

/**
 * Drops one more chunk of an oversized private-key block and finds where the output after it resumes: past its END marker, or, once {@link OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS} characters were dropped without one, past the next line break after that point.
 * Only the fresh chunk is counted and only it can end the block at a line break; the kept tail serves the END search alone, so a key written in small chunks cannot reach the limit early or release its body.
 * Accepted limit: a key longer than the drop limit (four times a 4096-bit RSA key's PEM) releases the body lines after the limit; the limit trades that rare case for never silencing a channel whose header has no END.
 * Why: a channel that prints a private-key header and never its end must not lose all later output; called by {@link createOutputRedactor} while it drops an oversized block, starting with the overflowing text itself.
 * @param block - The block's drop state, updated in place while the chunk still belongs to it.
 * @param chunk - The new text.
 * @returns The text after the block, or `undefined` while the whole chunk still belongs to it.
 * @example dropBlockChunk({ droppedChars: 0, tail: '' }, 'QUJD\n-----END PRIVATE KEY-----\nready\n') // => '\nready\n'
 */
function dropBlockChunk(
  block: DroppedBlock,
  chunk: string,
): string | undefined {
  const searched = block.tail + chunk
  const end = PRIVATE_KEY_END.exec(searched)
  if (end) return searched.slice(end.index + end[0].length)
  const remaining = OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS - block.droppedChars
  // Past the limit the block ends at the first line break of this chunk that lies beyond it.
  const lineBreak =
    remaining < chunk.length ? chunk.indexOf('\n', Math.max(0, remaining)) : -1
  if (lineBreak !== -1) return chunk.slice(lineBreak + 1)
  block.droppedChars += chunk.length
  block.tail = searched.slice(-OUTPUT_REDACTION_END_MARKER_TAIL_CHARS)
  return undefined
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
  // Set after an overflow: the rest of the oversized token (until whitespace) or block (until its END marker or the drop limit) is dropped; `held` stays empty meanwhile.
  let dropping: 'token' | 'block' | undefined
  const block: DroppedBlock = { droppedChars: 0, tail: '' }

  /**
   * Releases what can be released of `text`, holding a possibly incomplete secret and failing closed past the hold limit.
   * @param text - Held text plus new text, outside any drop.
   * @returns The redacted text safe to release now.
   * @example release('ok ghp_abc') // => 'ok ' (the token is held)
   */
  const release = (text: string): string => {
    const split = holdStart(text)
    const released = text.slice(0, split)
    held = text.slice(split)
    if (held.length <= OUTPUT_REDACTION_HOLD_LIMIT_CHARS)
      return redactSecretText(released)
    // No secret shape in the run: release it, keeping a short carry so a marker cut by the release is still seen whole.
    if (!SECRET_START.test(held)) {
      const run = held
      held = run.slice(-OUTPUT_REDACTION_CARRY_CHARS)
      return redactSecretText(
        released + run.slice(0, -OUTPUT_REDACTION_CARRY_CHARS),
      )
    }
    // Fail closed: a possible secret outgrew the hold, so mask it and drop the rest of that token or block.
    const overflow = held
    held = ''
    const masked = redactSecretText(released) + REDACTION_MASK
    if (!overflow.includes('-----BEGIN')) {
      dropping = 'token'
      return masked
    }
    dropping = 'block'
    block.droppedChars = 0
    block.tail = ''
    // The overflowing text is the block's first dropped chunk; a later line it already holds resumes the output.
    const rest = dropBlockChunk(block, overflow)
    if (rest === undefined) return masked
    dropping = undefined
    return masked + release(rest)
  }

  const write = (text: string): string => {
    // Finish dropping what a previous overflow began.
    if (dropping === 'block') {
      const rest = dropBlockChunk(block, text)
      if (rest === undefined) return ''
      dropping = undefined
      return release(rest)
    }
    if (dropping === 'token') {
      const tokenRest = /^\S*/.exec(text)?.[0] ?? ''
      const after = text.slice(tokenRest.length)
      if (!after) return ''
      dropping = undefined
      return release(after)
    }
    return release(held + text)
  }

  const end = (): string => {
    const rest = dropping === undefined ? held : ''
    held = ''
    dropping = undefined
    return redactSecretText(rest)
  }

  return { write, end }
}
