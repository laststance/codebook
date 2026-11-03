import {
  OUTPUT_REDACTION_BLOCK_DROP_LIMIT_CHARS,
  OUTPUT_REDACTION_CARRY_CHARS,
  OUTPUT_REDACTION_END_MARKER_TAIL_CHARS,
  OUTPUT_REDACTION_FIRST_WORD_HOLD_CHARS,
  OUTPUT_REDACTION_HOLD_LIMIT_CHARS,
  OUTPUT_REDACTION_PREFIX_HOLD_MIN_CHARS,
  REDACTION_MASK,
} from '../constants'

import { isSecretName } from './isSecretName'
import {
  maskSecretShapesInOutput,
  startsWithCredential,
} from './maskSecretShapesInOutput'
import { redactSecretText } from './redactSecretText'
import { maskShapedLiterals, type ShapedLiteralsCarry } from './secretShapes'

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
/** The marks of a URL's query and fragment: the secret name and value that follow one may come with the next chunk, and a query holds no blank, so the run ends where the query does. */
const QUERY_OR_FRAGMENT_MARK = /[?#]/

/** The bracket that closes a prompt's choices (`(y/n)`, `[Y/n]`) right before its question mark. */
const CLOSING_BRACKET = /[)\]]/

/** A trailing scheme (`postgres:`, `https:/`) whose `//user:password@` may come with the next chunk; a scheme is at most 32 characters, which also keeps the search linear on a long run. */
const TRAILING_SCHEME = /[A-Za-z][A-Za-z0-9+.-]{0,31}:\/{0,2}$/
/** What a trailing line without its break may still become once the rest of it arrives: a Cookie or Authorization value (an `=`, a `;`, a quote that opens a printed list element, the words themselves). Such a line waits for its break, so a pair or an element split over writes is judged whole. */
const PARTIAL_LINE_MAY_BE_SHAPED =
  /['"`=;]|authoriz|cookie|^\s*(?:basic|negotiate|ntlm|token|digest)\b/i

/** The Cookie and Authorization words that mark a line as a credential header, wherever they stand in it. */
const CREDENTIAL_LABEL_WORD = /cookie|authoriz/i

/** The header labels whose first letters a chunk boundary can cut (`Coo` + `kie:`), in lowercase; matched at a word start, which a hyphen also is (`X-Cookie`). */
const CREDENTIAL_LABEL_WORDS: readonly string[] = [
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
]

/** The Authorization schemes that start a line which is a credential by itself, in lowercase. `Bearer` is left out: its first characters are held by {@link SECRET_START_MARKERS}. */
const CREDENTIAL_SCHEME_WORDS: readonly string[] = [
  'basic',
  'negotiate',
  'ntlm',
  'token',
  'digest',
]

/** A line's trailing letters and hyphens are read back no further than the longest label. */
const LONGEST_LABEL_CHARS = Math.max(
  ...CREDENTIAL_LABEL_WORDS.map((label) => label.length),
)

/** A line no private-key body can be: it holds a character outside base64 and whitespace. */
const NOT_KEY_BODY = /[^A-Za-z0-9+/=\s]/

/**
 * Finds where the last line of a text starts: right after its last line break, a newline or a lone carriage return (a progress line rewrites itself with one and is complete at it).
 * @param text - The text seen so far.
 * @returns The index of the last line's first character; `0` without a break, `text.length` when the text ends in one.
 * @example
 * lastLineStart('a=1\nb=2') // => 4
 * lastLineStart('[==>  ] 40%\r') // => 12
 */
function lastLineStart(text: string): number {
  return Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r')) + 1
}

/**
 * Says whether a text is the first letters, or all, of one of the words.
 * Called by {@link endsInLabelStart} and {@link mayBecomeShapedLine}.
 * @param words - Lowercase words.
 * @param candidate - A text in lowercase.
 * @returns `true` for a non-empty text that is a prefix of one of the words.
 * @example startsAnyWord(['cookie'], 'coo') // => true
 */
function startsAnyWord(words: readonly string[], candidate: string): boolean {
  return candidate !== '' && words.some((word) => word.startsWith(candidate))
}

/**
 * Says whether a line ends in the first letters of a Cookie or Authorization label, so the next chunk may complete it.
 * Why: `[info] Coo` + `kie: sid=…` is one header; the line shows no quote, `=`, `;` or label word yet, so nothing else holds it. A single trailing letter holds the line only when it can begin a label (`c`, `a`, `s` or `p`, so `request headers -> C` waits and a leak of `ookie: sid=…` is closed, at the cost of a prompt such as `Option C` waiting for the next write); a letter that begins no label (`Type X`) is released at once. Called by {@link mayBecomeShapedLine}.
 * @param line - The text after the last line break.
 * @returns `true` when its trailing letters and hyphens, or what follows a hyphen in them, begin `cookie`, `set-cookie`, `authorization` or `proxy-authorization` in any letter case.
 * @example
 * endsInLabelStart('request headers -> C') // => true
 * endsInLabelStart('x-api-Authori') // => true
 * endsInLabelStart('Type X') // => false
 * endsInLabelStart('compiled 12 modules') // => false
 */
function endsInLabelStart(line: string): boolean {
  let runStart = line.length
  // Read back over the trailing letters and hyphens by hand, no further than the longest label: a long word is not rescanned from every letter.
  while (
    runStart > 0 &&
    line.length - runStart < LONGEST_LABEL_CHARS &&
    /[A-Za-z-]/.test(line.charAt(runStart - 1))
  )
    runStart--
  const words = line.slice(runStart).toLowerCase().split('-')
  // A label starts the run or follows a hyphen in it.
  return words.some((_word, position) =>
    startsAnyWord(CREDENTIAL_LABEL_WORDS, words.slice(position).join('-')),
  )
}

/**
 * Says whether a text is one word of at most {@link OUTPUT_REDACTION_FIRST_WORD_HOLD_CHARS} characters, with or without indentation.
 * Called by {@link mayBecomeShapedLine} and {@link createOutputRedactor}.
 * @param partialLine - The text after the last line break.
 * @returns `true` for a short run of non-blank characters that nothing follows.
 * @example
 * isOneShortWord('  loading') // => true
 * isOneShortWord('server ready') // => false
 */
function isOneShortWord(partialLine: string): boolean {
  const word = partialLine.trimStart()
  return (
    word !== '' &&
    partialLine.length <= OUTPUT_REDACTION_FIRST_WORD_HOLD_CHARS &&
    !/\s/.test(word)
  )
}

/**
 * Says whether an unfinished line may still become a Cookie or Authorization line once the rest of it arrives.
 * Why: such a line waits for its break, so a pair, a label or an element split over writes is judged whole; called by {@link holdStart}. A line of plain words, or one plain word, is not held: it is released at once, so output keeps its order around a debugger stop.
 * @param partialLine - The text after the last line break.
 * @returns `true` when it holds a quote, `=` or `;`, a Cookie or Authorization word or scheme ({@link PARTIAL_LINE_MAY_BE_SHAPED}), when it ends in the first letters of a header label ({@link endsInLabelStart}), or when its only word begins an Authorization scheme or is a secret cookie name that an `=` may follow.
 * @example
 * mayBecomeShapedLine('port=3000') // => true
 * mayBecomeShapedLine('[info] Coo') // => true
 * mayBecomeShapedLine('Bas') // => true
 * mayBecomeShapedLine('sid') // => true
 * mayBecomeShapedLine('loading') // => false
 * mayBecomeShapedLine('server ready') // => false
 */
function mayBecomeShapedLine(partialLine: string): boolean {
  if (PARTIAL_LINE_MAY_BE_SHAPED.test(partialLine)) return true
  if (endsInLabelStart(partialLine)) return true
  if (!isOneShortWord(partialLine)) return false
  const word = partialLine.trimStart()
  return (
    startsAnyWord(CREDENTIAL_SCHEME_WORDS, word.toLowerCase()) ||
    isSecretName(word)
  )
}

/**
 * Says whether a trailing run may be cut inside the name of a query or fragment parameter, or just before it.
 * Why: the `code=…` or `token=…` after a `?` or `#` may come with the next chunk, and a name cut in two (`?to` + `ken=…`) is not a secret name in either half. A run that starts with the mark, or holds characters after one (`app.html?tok`, `#access_to`), is held whether or not a `/` comes before it. A run that ends in a bare mark is held only when it reads like a path or a URL (a `/` before the mark): a word such as `Ready?` or `C#` is no URL, and a prompt such as `(y/n)?` or `[Y/n]?` closes with a bracket, so holding either would move it behind later output. The marks are found by one linear search, so a long run is never rescanned from every start. Called by {@link mayBecomeSecret}.
 * @param run - The trailing run without whitespace.
 * @returns `true` when the run starts with a `?` or `#`, holds one that more characters follow, or ends in one that a `/` (and no closing bracket right before it) precedes.
 * @example
 * mayBeCutInQuery('?to') // => true
 * mayBeCutInQuery('app.html?tok') // => true
 * mayBeCutInQuery('/cb?') // => true
 * mayBeCutInQuery('Ready?') // => false
 * mayBeCutInQuery('(y/n)?') // => false
 */
function mayBeCutInQuery(run: string): boolean {
  const mark = run.search(QUERY_OR_FRAGMENT_MARK)
  if (mark === -1) return false
  // The mark starts the run or more characters follow it: the parameter name may end anywhere in them.
  if (mark === 0 || mark < run.length - 1) return true
  // A bare mark ends the run: a prompt closes with a bracket before it, and a word has no slash.
  return !CLOSING_BRACKET.test(run.charAt(mark - 1)) && run.includes('/')
}

/**
 * Says whether a trailing run without whitespace may still become a secret: it contains a secret start, ends in the first characters of one (at least {@link OUTPUT_REDACTION_PREFIX_HOLD_MIN_CHARS} of them), ends in a URL scheme, or holds the `?` or `#` of a query or fragment whose `code=…` or `token=…` may follow ({@link mayBeCutInQuery}).
 * Why: only such a run waits for the next chunk; any other text is released at once, so output keeps its arrival order and time around a debugger stop.
 * @param run - The trailing run of the text seen so far.
 * @returns `true` when the run must wait for more text.
 * @example
 * mayBecomeSecret('listening') // => false
 * mayBecomeSecret('Ready?')    // => false
 * mayBecomeSecret('tokenghp')  // => true
 * mayBecomeSecret('/cb?co')    // => true
 * mayBecomeSecret('?to')       // => true
 */
function mayBecomeSecret(run: string): boolean {
  if (
    SECRET_START.test(run) ||
    TRAILING_SCHEME.test(run) ||
    mayBeCutInQuery(run)
  )
    return true
  // A chunk boundary inside a start leaves its first characters at the run's end.
  return SECRET_START_MARKERS.some((marker) => {
    for (
      let length = OUTPUT_REDACTION_PREFIX_HOLD_MIN_CHARS;
      length < marker.length;
      length++
    )
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
  // A trailing line that may become a Cookie or Authorization value waits for its line break (at most the hold limit, see `release`).
  const lineStart = lastLineStart(text)
  if (lineStart < text.length && mayBecomeShapedLine(text.slice(lineStart)))
    start = lineStart
  // A trailing run without whitespace waits only if it may still become a secret.
  // Scanned backwards by hand: a regular expression would rescan a long run from every start.
  let runStart = text.length
  while (runStart > 0 && !/\s/.test(text.charAt(runStart - 1))) runStart--
  // The line's earlier part waits too, so a line is judged whole, not in two halves.
  if (runStart < text.length && mayBecomeSecret(text.slice(runStart)))
    start = Math.min(start, runStart)
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
 * Removes from the output of a judged text the start that an earlier write already released.
 * Called by {@link createOutputRedactor} when a line that began with a word released earlier is judged again with the rest of its line.
 * @param output - The text the judgement of the first characters of the text released.
 * @param releasedHead - The characters at the start of that text that were already released, or `''`.
 * @param coveredChars - How many characters at the start of the text the output stands for.
 * @returns `''` when the output stands for no more than the released start; the output without that start when it begins with it; the output as it is when a mask replaced the start (what was released cannot be taken back).
 * @example
 * withoutReleasedHead('port=3000\n', 'port', 10) // => '=3000\n'
 * withoutReleasedHead('[masked]\n', 'theme', 24) // => '[masked]\n'
 * withoutReleasedHead('the', 'theme', 3) // => ''
 */
function withoutReleasedHead(
  output: string,
  releasedHead: string,
  coveredChars: number,
): string {
  if (releasedHead === '') return output
  if (coveredChars <= releasedHead.length) return ''
  return output.startsWith(releasedHead)
    ? output.slice(releasedHead.length)
    : output
}

/**
 * Makes the stateful redactor of one output channel (stdout or stderr), so a secret split over chunks is still masked before the output is cut, split or saved.
 * Only a trailing run that may still become a secret waits for the next chunk (at most {@link OUTPUT_REDACTION_HOLD_LIMIT_CHARS}); past that, a run holding a secret start, or a line that still looks like a credential, fails closed (released as {@link REDACTION_MASK}, the rest of that token, line or private-key block dropped) and any other run is released with a short carry. A one-word partial line that may not become a secret is released at once and kept as context, so the rest of its line is judged with it. Called by {@link captureProcessOutput} and the development server launcher for each channel, before any truncation or event split.
 * @returns A fresh {@link OutputRedactor}; one per channel, never shared.
 * @example
 * const redactor = createOutputRedactor()
 * redactor.write('key ghp_') + redactor.write('abcdefghijklmnopqrstuvwxyz\n') + redactor.end()
 * // => 'key [masked]\n'
 */
export function createOutputRedactor(): OutputRedactor {
  let held = ''
  // What the shape rules carry between two released runs: whether the output ended right after a quoted secret header name (a printed `rawHeaders` list), how many `[` of a header value's array are still open, and the position the next element takes in its list.
  let carry: ShapedLiteralsCarry = {
    afterHeaderName: false,
    headerArrayDepth: 0,
    listIndex: undefined,
  }
  // The characters at the start of `held` that were already released as an unfinished one-word line (`theme` before `=dark; sid=…`): the line is judged whole, and what it releases leaves them out.
  let releasedHead = ''
  // Set after an overflow: the rest of the oversized token (until whitespace), line (until its break) or private-key block is dropped; `held` stays empty meanwhile.
  let dropping: 'token' | 'line' | 'block' | undefined
  const block: DroppedBlock = { droppedChars: 0, tail: '', atLineStart: false }

  /**
   * Masks the Cookie, Authorization and header-list shapes of released lines, then the credential patterns of {@link redactSecretText}.
   * @param text - Text safe to release.
   * @returns The text with every such credential masked.
   * @example shapeAndRedact('sid=abc; theme=dark\n') // => '[masked]\n'
   */
  const shapeAndRedact = (text: string): string => {
    const shaped = maskSecretShapesInOutput(
      text,
      carry.afterHeaderName,
      REDACTION_MASK,
      carry.headerArrayDepth,
      carry.listIndex,
    )
    carry = {
      afterHeaderName: shaped.afterHeaderName,
      headerArrayDepth: shaped.headerArrayDepth,
      listIndex: shaped.listIndex,
    }
    return redactSecretText(shaped.text)
  }

  /**
   * Says whether an unfinished line outgrew the hold while it still looks like a credential: it names a Cookie or Authorization header, starts with a cookie pair or an Authorization scheme and its credential, or sits where the value of a secret header name is expected.
   * Why: such a line cannot be released in pieces, since a value cut by a release escapes both halves; any other long line (a JSON document with quotes) is released with a short carry.
   * @param line - The text after the last line break.
   * @param atLineStart - What the shape rules carried where the line starts.
   * @returns `true` when the line must fail closed.
   * @example looksLikeCredential('Cookie: sid=abc', { afterHeaderName: false, headerArrayDepth: 0, listIndex: undefined }) // => true
   */
  const looksLikeCredential = (
    line: string,
    atLineStart: ShapedLiteralsCarry,
  ): boolean =>
    CREDENTIAL_LABEL_WORD.test(line) ||
    startsWithCredential(line.trimStart()) ||
    atLineStart.afterHeaderName ||
    maskShapedLiterals(
      line,
      atLineStart.afterHeaderName,
      REDACTION_MASK,
      atLineStart.headerArrayDepth,
      atLineStart.listIndex,
    ).afterHeaderName

  /**
   * Releases what can be released of `text`, holding a possible secret and failing closed past the hold limit.
   * @param text - Held text plus new text, outside any drop; it may start with the already released {@link releasedHead}.
   * @returns The redacted text safe to release now.
   * @example release('ok ghp_abc') // => 'ok ' (the token is held)
   */
  const release = (text: string): string => {
    const emittedHead = releasedHead
    releasedHead = ''
    const split = holdStart(text)
    const released = text.slice(0, split)
    held = text.slice(split)
    /** Masks a start of `text` that is judged now, leaving out the characters an earlier write released. */
    const emit = (covered: string): string =>
      withoutReleasedHead(shapeAndRedact(covered), emittedHead, covered.length)
    if (held.length <= OUTPUT_REDACTION_HOLD_LIMIT_CHARS) {
      const partialLine = text.slice(lastLineStart(text))
      // A one-word unfinished line is released now; it stays as context, so `=dark; sid=…` that follows is judged with its first name.
      if (split === text.length && isOneShortWord(partialLine)) {
        held = partialLine
        releasedHead = partialLine
      } else if (split < emittedHead.length) {
        // The hold starts inside the characters released earlier, which stay the start of what is held.
        releasedHead = emittedHead.slice(split)
      }
      return emit(released)
    }
    // A line that may be a Cookie or Authorization line cannot be judged in pieces: a value cut by a release escapes both halves.
    const isCredentialLine = looksLikeCredential(
      text.slice(lastLineStart(text)),
      maskShapedLiterals(
        released,
        carry.afterHeaderName,
        REDACTION_MASK,
        carry.headerArrayDepth,
        carry.listIndex,
      ),
    )
    // No secret start in the run: release it, keeping a short carry so a start cut by the release is still seen whole.
    if (!isCredentialLine && !SECRET_START.test(held)) {
      const run = held
      const cut = carryStart(run)
      held = run.slice(cut)
      return emit(released + run.slice(0, cut))
    }
    // Fail closed: a possible secret outgrew the hold, so mask it and drop the rest of that token, line or block.
    const overflow = held
    held = ''
    // The dropped text may have held elements of a list, so the position of the next one is no longer known.
    carry = { ...carry, listIndex: undefined }
    const masked = emit(released) + REDACTION_MASK
    // Only a private-key header (or one not yet closed) opens a block; a credential line is dropped to its break, any other run is a token dropped to the next whitespace.
    if (
      !PRIVATE_KEY_BEGIN.test(overflow) &&
      !UNFINISHED_BEGIN_AT_START.test(overflow)
    ) {
      dropping = isCredentialLine ? 'line' : 'token'
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
    if (dropping === 'line') {
      // The line's break is released with the text after it.
      const lineEnd = text.search(/[\r\n]/)
      if (lineEnd === -1) return ''
      dropping = undefined
      return release(text.slice(lineEnd))
    }
    return release(held + text)
  }

  const end = (): string => {
    const emittedHead = releasedHead
    releasedHead = ''
    const rest = dropping === undefined ? held : ''
    held = ''
    dropping = undefined
    const shaped = maskSecretShapesInOutput(
      rest,
      carry.afterHeaderName,
      REDACTION_MASK,
      carry.headerArrayDepth,
      carry.listIndex,
    )
    return withoutReleasedHead(
      maskHeldStart(shaped.text),
      emittedHead,
      rest.length,
    )
  }

  return { write, end }
}
