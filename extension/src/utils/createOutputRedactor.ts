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
  /** Releases whatever is still held, a possible secret masked. */
  end(): string
}

/** A private-key block's header and end markers; the label words are bounded, so a crafted run of labels cannot make the search backtrack quadratically. */
const PRIVATE_KEY_BEGIN =
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z0-9 ]{0,40}-----/
const PRIVATE_KEY_END =
  /-----END [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z0-9 ]{0,40}-----/
/** A BEGIN marker whose label has not been closed yet, at the start of the held text. */
const UNFINISHED_BEGIN_AT_START = /^-----BEGIN(?![A-Z0-9 ]{0,100}-----)/
/** A complete BEGIN header, its label captured. */
const BEGIN_HEADER = /^-----BEGIN ([A-Z0-9 ]{0,100})-----/
/**
 * Where a secret this contract masks starts, anchored exactly as {@link redactSecretText} anchors it, or a URL whose authority has not ended (its password may still follow); the URL scheme is bounded to 32 characters so a long run cannot make the search quadratic.
 * A held run containing one is a possible secret: it waits for more text and fails closed when it outgrows the hold.
 */
const SECRET_START =
  /eyJ[A-Za-z0-9_-]|[Bb][Ee][Aa][Rr][Ee][Rr][ \t]|[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s/@]*(?::|$)|(?<![A-Za-z0-9])(?:sk-|[sr]k_|gh[pousr]_|github_pat_|xox[abprs]-|npm_|AIza)|(?<![A-Z0-9])A(?:KI|SI)A|-----BEGIN/
/** The starts a chunk boundary can cut: a trailing run ending in two or more of their first characters may become a secret with the next chunk. */
const SECRET_START_MARKERS = [
  'eyJ',
  'Bearer',
  'bearer',
  'sk-',
  'sk_',
  'rk_',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'github_pat_',
  'xoxa-',
  'xoxb-',
  'xoxp-',
  'xoxr-',
  'xoxs-',
  'npm_',
  'AIza',
  'AKIA',
  'ASIA',
  '-----BEGIN',
]
/** A trailing scheme (`postgres:`, `https:/`) whose `//user:password@` may come with the next chunk; a scheme is at most 32 characters, which also keeps the search linear on a long run. */
const TRAILING_SCHEME = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/{0,2}$/
/** A line no private-key body can be: it holds a character outside base64 and whitespace. */
const NOT_KEY_BODY = /[^A-Za-z0-9+/=\s]/

/**
 * Says whether a trailing run without whitespace may still become a secret: it contains a secret start, ends in the first characters of one, or ends in a URL scheme.
 * Why: only such a run waits for the next chunk; any other text is released at once, so output keeps its arrival order and time around a debugger stop.
 * @param run - The trailing run of the text seen so far.
 * @returns `true` when the run must wait for more text.
 * @example
 * mayBecomeSecret('listening') // => false
 * mayBecomeSecret('tokenghp')  // => true
 */
function mayBecomeSecret(run: string): boolean {
  if (SECRET_START.test(run) || TRAILING_SCHEME.test(run)) return true
  // A chunk boundary inside a start leaves its first characters at the run's end.
  return SECRET_START_MARKERS.some((marker) => {
    for (let length = 2; length < marker.length; length++)
      if (run.endsWith(marker.slice(0, length))) return true
    return false
  })
}

/**
 * Finds where the text that may still grow into a secret begins; everything before it can be released.
 * Why: a token, a URL password, a `Bearer` header or a PEM block can be split over chunks; called by {@link createOutputRedactor}.
 * @param text - Held text plus the new chunk.
 * @returns The index of the earliest possibly incomplete secret, or `text.length` when nothing needs holding.
 * @example
 * holdStart('ok ghp_abc') // => 3
 * holdStart('ok plain')   // => 8
 */
function holdStart(text: string): number {
  let start = text.length
  // A trailing run without whitespace waits only if it may still become a secret.
  // Scanned backwards by hand: a regular expression would rescan a long run from every start.
  let runStart = text.length
  while (runStart > 0 && !/\s/.test(text.charAt(runStart - 1))) runStart--
  if (runStart < text.length && mayBecomeSecret(text.slice(runStart)))
    start = runStart
  // `Bearer` and its token may arrive in separate chunks.
  const bearer = /\bBearer(?:[ \t]+\S*)?$/i.exec(text)
  if (bearer) start = Math.min(start, bearer.index)
  // A private-key block is held from its BEGIN marker until its END marker arrived.
  const begin = text.lastIndexOf('-----BEGIN')
  if (begin !== -1) {
    const fromBegin = text.slice(begin)
    const header = BEGIN_HEADER.exec(fromBegin)
    const isUnfinishedHeader = header === null && !/\n/.test(fromBegin)
    const isOpenPrivateKey =
      header !== null &&
      (header[1] ?? '').includes('PRIVATE KEY') &&
      !PRIVATE_KEY_END.test(fromBegin)
    if (isUnfinishedHeader || isOpenPrivateKey) start = Math.min(start, begin)
  }
  return start
}

/**
 * Finds where a released run's carry starts, never between the two halves of a surrogate pair.
 * @param run - The run being released.
 * @returns {@link OUTPUT_REDACTION_CARRY_CHARS} from the end, or one earlier when that would split a pair.
 * @example carryStart('x'.repeat(20)) // => 4
 */
function carryStart(run: string): number {
  const cut = Math.max(0, run.length - OUTPUT_REDACTION_CARRY_CHARS)
  const before = run.charCodeAt(cut - 1)
  // A high surrogate just before the cut means the cut falls inside one character.
  return before >= 0xd800 && before <= 0xdbff ? cut - 1 : cut
}

/** An oversized private-key block being dropped: how many of its characters were dropped, its last characters (kept only to find an END marker split across chunks, never released or counted again), and whether the dropped text ended at a line break. */
type DroppedBlock = { droppedChars: number; tail: string; atLineStart: boolean }

/**
 * Finds the first line of a chunk, from a given point, that no private-key body line can be (one with a character outside base64 and whitespace).
 * @param chunk - The fresh text.
 * @param from - Where the search may start: the drop limit inside this chunk, or `0`.
 * @param atLineStart - Whether `from` is the start of a line (the dropped text before it ended at a line break).
 * @returns The index where that line starts, or `undefined` when the chunk has none (an unfinished last line is judged by what it holds so far).
 * @example firstPlainLine('QUJD\nready: ok\n', 0, true) // => 5
 */
function firstPlainLine(
  chunk: string,
  from: number,
  atLineStart: boolean,
): number | undefined {
  let lineStart = atLineStart ? from : chunk.indexOf('\n', from) + 1
  // Without a line break after `from`, no line of this chunk starts past the limit.
  if (lineStart === 0 && !atLineStart) return undefined
  while (lineStart < chunk.length) {
    const lineEnd = chunk.indexOf('\n', lineStart)
    const line = chunk.slice(lineStart, lineEnd === -1 ? chunk.length : lineEnd)
    if (NOT_KEY_BODY.test(line)) return lineStart
    if (lineEnd === -1) return undefined
    lineStart = lineEnd + 1
  }
  return undefined
}

/**
 * Drops one more chunk of an oversized private-key block and finds where the output after it resumes: past its END marker, or, once {@link OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS} characters were dropped without one, at the first later line no key body can be.
 * Only fresh text is counted and searched for that line; the kept tail serves the END search alone. Padding a key with spaces or newlines therefore cannot release its body, and a channel whose header has no END resumes at its next punctuated line.
 * Why: called by {@link createOutputRedactor} while it drops an oversized block, starting with the overflowing text itself.
 * @param block - The block's drop state, updated in place while the chunk still belongs to it.
 * @param chunk - The new text.
 * @returns The text after the block, or `undefined` while the whole chunk still belongs to it.
 * @example dropBlockChunk({ droppedChars: 0, tail: '', atLineStart: false }, 'QUJD\n-----END PRIVATE KEY-----\nready\n') // => '\nready\n'
 */
function dropBlockChunk(
  block: DroppedBlock,
  chunk: string,
): string | undefined {
  const searched = block.tail + chunk
  const end = PRIVATE_KEY_END.exec(searched)
  if (end) return searched.slice(end.index + end[0].length)
  const remaining = OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS - block.droppedChars
  if (remaining < chunk.length) {
    const from = Math.max(0, remaining)
    const resumeAt = firstPlainLine(
      chunk,
      from,
      from === 0 && block.atLineStart,
    )
    if (resumeAt !== undefined) return chunk.slice(resumeAt)
  }
  block.droppedChars += chunk.length
  block.tail = searched.slice(-OUTPUT_REDACTION_END_MARKER_TAIL_CHARS)
  block.atLineStart = chunk.endsWith('\n')
  return undefined
}

/** A URL whose numeric port and a following path, query or fragment close its authority (`http://db.internal:5432/app`): no password can follow, so the stream's end releases it. */
const URL_CLOSED_BY_PORT =
  /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/(?:\[[\dA-Fa-f:.]+\]|[^\s/@:[]*):\d{1,5}(?=[/?#])/

/** A loopback or IP-literal URL whose numeric port ends the held run (`http://127.0.0.1:4100`): no user name is written as such a host, so the stream's end releases it. */
const URL_ENDING_IN_HOST_PORT =
  /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\dA-Fa-f:.]+\]):\d{1,5}$/

/**
 * Masks a held run from its first secret start when the stream ends, so a token cut off by the end of output is never released in part; a URL whose port already closes its authority is complete, so it is released and only what follows it is judged again.
 * @param held - The text still held.
 * @returns The held text redacted, with any part from a secret start on replaced by {@link REDACTION_MASK}, except a complete host:port URL.
 * @example
 * maskHeldStart('token ghp_abc') // => 'token [masked]'
 * maskHeldStart('on http://127.0.0.1:4100') // => 'on http://127.0.0.1:4100'
 * maskHeldStart('on http://admin:1234') // => 'on [masked]'
 */
function maskHeldStart(held: string): string {
  const start = SECRET_START.exec(held)
  if (!start) return redactSecretText(held)
  const fromStart = held.slice(start.index)
  const completeUrl =
    URL_CLOSED_BY_PORT.exec(fromStart) ??
    URL_ENDING_IN_HOST_PORT.exec(fromStart)
  // A URL that a port closes holds no password once no more output can come; only the rest may still be a cut secret.
  if (completeUrl)
    return (
      redactSecretText(held.slice(0, start.index + completeUrl[0].length)) +
      maskHeldStart(fromStart.slice(completeUrl[0].length))
    )
  return redactSecretText(held.slice(0, start.index)) + REDACTION_MASK
}

/**
 * Makes the stateful redactor of one output channel (stdout or stderr), so a secret split over chunks is still masked before the output is cut, split or saved.
 * Only a trailing run that may still become a secret waits for the next chunk (at most {@link OUTPUT_REDACTION_HOLD_LIMIT_CHARS}); past that, a run holding a secret start fails closed (released as {@link REDACTION_MASK}, the rest of that token or private-key block dropped) and any other run is released with a short carry. Called by {@link captureProcessOutput} and the development server launcher for each channel, before any truncation or event split.
 * @returns A fresh {@link OutputRedactor}; one per channel, never shared.
 * @example
 * const redactor = createOutputRedactor()
 * redactor.write('key ghp_') + redactor.write('abcdefghijklmnopqrstuvwxyz\n') + redactor.end()
 * // => 'key [masked]\n'
 */
export function createOutputRedactor(): OutputRedactor {
  let held = ''
  // Set after an overflow: the rest of the oversized token (until whitespace) or private-key block is dropped; `held` stays empty meanwhile.
  let dropping: 'token' | 'block' | undefined
  const block: DroppedBlock = { droppedChars: 0, tail: '', atLineStart: false }

  /**
   * Releases what can be released of `text`, holding a possible secret and failing closed past the hold limit.
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
    // No secret start in the run: release it, keeping a short carry so a start cut by the release is still seen whole.
    if (!SECRET_START.test(held)) {
      const run = held
      const cut = carryStart(run)
      held = run.slice(cut)
      return redactSecretText(released + run.slice(0, cut))
    }
    // Fail closed: a possible secret outgrew the hold, so mask it and drop the rest of that token or block.
    const overflow = held
    held = ''
    const masked = redactSecretText(released) + REDACTION_MASK
    // Only a private-key header (or one not yet closed) opens a block; any other run is a token, dropped to the next whitespace.
    if (
      !PRIVATE_KEY_BEGIN.test(overflow) &&
      !UNFINISHED_BEGIN_AT_START.test(overflow)
    ) {
      dropping = 'token'
      return masked
    }
    dropping = 'block'
    block.droppedChars = 0
    block.tail = ''
    block.atLineStart = false
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
    return maskHeldStart(rest)
  }

  return { write, end }
}
