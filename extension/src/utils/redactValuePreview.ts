import { PREVIEW_VALUE_PREFIX_LIMIT_CHARS, REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'
import {
  applyTextReplacements,
  findLabelledAuthorizations,
  findShapedLiterals,
  isSecretHeaderName,
  unquotePreviewString,
  type TextReplacement,
} from './secretShapes'

/** A member key in a debugger's value preview, bare or quoted, followed by `:` (objects) or `=>` (maps). A bare key starts where no word character, `$` or `-` comes before it, so a long `a-a-a-…` run is tried once, not once per `a`. */
const PREVIEW_KEY =
  /(?<![\w$-])(?:([A-Za-z_$][\w$-]*)|'([^'\\]*)'|"([^"\\]*)")\s*(?::|=>)\s*/g
/** A type name and/or a parenthesized length that a debugger writes before a value's body (`Map(1) `, `Array(2) `, `(2) `, `Object `). */
const VALUE_PREFIX = /^(?:[A-Za-z_$][\w$]*)?(?:\(\d+\))?\s*(?=[{[(])/
/** Closing characters for the opening ones a preview value can start with. */
const CLOSING: Readonly<Record<string, string>> = {
  '{': '}',
  '[': ']',
  '(': ')',
}
/** The characters that end a bare member value (`undefined`, `42`, `true`) outside of quotes. */
const BARE_VALUE_TERMINATORS: ReadonlySet<string> = new Set([
  ',',
  '}',
  ']',
  ')',
])

/** The characters after which a member of an object printed in a string can start: the opening bracket of the object, array or call, and the separator between two members. */
const STRING_MEMBER_PREFIXES: ReadonlySet<string> = new Set([
  '{',
  '[',
  '(',
  ',',
  ';',
])

/** A stretch of a preview. */
type PreviewRange = { start: number; end: number }

/** One `key: value` or `key => value` member of a preview: where its value is and which bracketed value holds it. */
type PreviewMember = {
  key: string
  /** Where the member's key starts. */
  index: number
  valueStart: number
  valueEnd: number
  /** The index of the innermost opening bracket around the member, or -1 for a member at the top level. A member inside a quoted string has a container of its own, below -1. */
  container: number
}

/** Where a preview's quoted texts and bracketed values are, found in one pass so no member rescans them. */
type PreviewStructure = {
  /** The quoted texts in order of position, from the opening quote to past the closing one. */
  quoted: readonly PreviewRange[]
  /** For each opening bracket, the index past its matching closing bracket; a bracket without one is absent. */
  bracketEnds: ReadonlyMap<number, number>
}

/**
 * Tells whether a character opens a quoted text in a preview.
 * @param character - One character.
 * @returns `true` for `'`, `"` and a backtick.
 * @example isQuote("'") // => true
 */
function isQuote(character: string): boolean {
  return character === "'" || character === '"' || character === '`'
}

/**
 * Finds where a quoted value that starts at `start` ends, past its closing quote; an unclosed one runs to the end.
 * @param text - The preview.
 * @param start - The index of the opening quote.
 * @returns The index after the closing quote, or `text.length`.
 * @example endOfQuoted("'a\\'b', x", 0) // => 6
 */
function endOfQuoted(text: string, start: number): number {
  const quote = text[start]
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++
    else if (text[index] === quote) return index + 1
  }
  return text.length
}

/**
 * Finds the quoted texts and the matching brackets of a preview in one pass, skipping quoted text when it counts brackets.
 * Why: the members of a preview are found by pattern; a member-looking text inside a quoted string (`'Invalid session: expired'`) must be skipped, and a member's bracketed value must end without rescanning the rest of the preview for each member. Called by {@link readPreviewMembers}.
 * @param preview - A value as the debugger displays it.
 * @returns The quoted texts and the end of every bracketed value that closes.
 * @example readPreviewStructure("{a: 'x'}").bracketEnds.get(0) // => 8
 */
function readPreviewStructure(preview: string): PreviewStructure {
  const quoted: PreviewRange[] = []
  const bracketEnds = new Map<number, number>()
  const opened: { closing: string; at: number }[] = []
  for (let index = 0; index < preview.length; index++) {
    const character = preview.charAt(index)
    if (isQuote(character)) {
      const end = endOfQuoted(preview, index)
      quoted.push({ start: index, end })
      index = end - 1
      continue
    }
    const closing = CLOSING[character]
    const innermost = opened.at(-1)
    if (closing) opened.push({ closing, at: index })
    // A closing bracket that does not match the innermost opening one is ignored.
    else if (innermost !== undefined && character === innermost.closing) {
      opened.pop()
      bracketEnds.set(innermost.at, index + 1)
    }
  }
  return { quoted, bracketEnds }
}

/**
 * Builds the finder of where a bare member value (`undefined`, `42`, `Symbol(x)`) ends: at the next `,`, `}`, `]` or `)` outside quotes, without its trailing blanks.
 * Why: a preview of many bare members (`a: a: a: …`) would scan to the end for each one; the finder remembers the terminator it found, so every member before it reuses the scan. Called by {@link readPreviewMembers}.
 * @param text - The preview.
 * @returns A function from the index where a bare value starts to the index where it ends. Starts must not decrease between calls.
 * @example createBareValueEnd('{a: 1 , b: 2}')(4) // => 5
 */
function createBareValueEnd(text: string): (start: number) => number {
  // Every start from `coveredFrom` to `coveredUntil` has the terminator at `coveredUntil`.
  let coveredFrom = 0,
    coveredUntil = -1,
    trimmedEnd = 0
  return (start) => {
    if (start < coveredFrom || start > coveredUntil) {
      coveredFrom = start
      coveredUntil = start
      // A quoted part belongs to the value whole, so a terminator inside it does not end the value.
      while (
        coveredUntil < text.length &&
        !BARE_VALUE_TERMINATORS.has(text.charAt(coveredUntil))
      )
        coveredUntil = isQuote(text.charAt(coveredUntil))
          ? endOfQuoted(text, coveredUntil)
          : coveredUntil + 1
      trimmedEnd = coveredUntil
      while (trimmedEnd > coveredFrom && /\s/.test(text.charAt(trimmedEnd - 1)))
        trimmedEnd--
    }
    return Math.max(start, trimmedEnd)
  }
}

/**
 * Finds where one member value of a preview ends: a quoted string, a bracketed object, array or map (with any type name or length before it), or a bare token up to the next separator.
 * @param text - The preview.
 * @param start - Where the value starts, after its key's `:` or `=>`.
 * @param structure - The preview's quoted texts and brackets.
 * @param endOfBareValue - The finder of {@link createBareValueEnd}.
 * @returns The index where the value ends.
 * @example endOfPreviewValue("{a: 'x', b: 1}", 4, readPreviewStructure("{a: 'x', b: 1}"), createBareValueEnd("{a: 'x', b: 1}")) // => 7
 */
function endOfPreviewValue(
  text: string,
  start: number,
  structure: PreviewStructure,
  endOfBareValue: (start: number) => number,
): number {
  const first = text.charAt(start)
  if (isQuote(first)) return endOfQuoted(text, start)
  // A type name or a length before a body (`Array(2) [...]`, `(2) [...]`, `Object {...}`) belongs to the value, which ends with that body.
  const prefix = VALUE_PREFIX.exec(
    text.slice(start, start + PREVIEW_VALUE_PREFIX_LIMIT_CHARS),
  )
  if (prefix && prefix[0].length > 0)
    return structure.bracketEnds.get(start + prefix[0].length) ?? text.length
  if (CLOSING[first]) return structure.bracketEnds.get(start) ?? text.length
  return endOfBareValue(start)
}

/**
 * Tells in which bracketed value of a preview each member sits, so `{name: 'sid', value: '…'}` pairs its own members and no other object's.
 * @param preview - A value as the debugger displays it.
 * @param members - The members in order of position; each gets its `container`.
 * @example assignContainers("{a: {b: 1}}", members) // `b` sits in the bracket opened at index 4
 */
function assignContainers(preview: string, members: PreviewMember[]): void {
  const opened: number[] = []
  let next = 0
  for (
    let index = 0;
    index < preview.length && next < members.length;
    index++
  ) {
    while (next < members.length && members[next]!.index <= index) {
      // A member inside a quoted string already has its own container.
      if (members[next]!.container === -1)
        members[next]!.container = opened.at(-1) ?? -1
      next++
    }
    const character = preview.charAt(index)
    if (isQuote(character)) index = endOfQuoted(preview, index) - 1
    else if (CLOSING[character]) opened.push(index)
    else if (character === '}' || character === ']' || character === ')')
      opened.pop()
  }
}

/**
 * Finds where the value of a quoted key inside a quoted string ends, never past the string's closing quote.
 * Called by {@link readPreviewMembers} for the members of a serialised object (`'{"token":"abc","n":1}'`).
 * @param text - The preview.
 * @param start - Where the value starts, after its key's `:`.
 * @param limit - The index of the string's closing quote.
 * @returns The end of a quoted value or of a bare one (a number, `true`, `null`) at its `,`, `}`, `]` or `)`, without the blanks before it; a bracketed value, or a bare one with no end within {@link PREVIEW_VALUE_PREFIX_LIMIT_CHARS} characters, runs to `limit`, so it is masked whole.
 * @example endOfValueInString(`'{"a":1,"b":2}'`, 6, 13) // => 7
 */
function endOfValueInString(
  text: string,
  start: number,
  limit: number,
): number {
  const first = text.charAt(start)
  if (isQuote(first)) return Math.min(endOfQuoted(text, start), limit)
  if (CLOSING[first]) return limit
  const scanEnd = Math.min(limit, start + PREVIEW_VALUE_PREFIX_LIMIT_CHARS)
  let index = start
  while (index < scanEnd && !BARE_VALUE_TERMINATORS.has(text.charAt(index)))
    index++
  if (index === scanEnd && scanEnd < limit) return limit
  // The blanks before the terminator (`{ password: x }`) stay readable.
  while (index > start && /\s/.test(text.charAt(index - 1))) index--
  return index
}

/**
 * Builds the finder of the quoted text a position lies inside, after its opening quote.
 * Called by {@link readPreviewMembers}.
 * @param quoted - The quoted texts of a preview, in order of position.
 * @returns A function from a position to the quoted text around it, or `undefined`. Positions must not decrease between calls.
 * @example createEnclosingQuotedText([{ start: 3, end: 9 }])(5) // => { start: 3, end: 9 }
 */
function createEnclosingQuotedText(
  quoted: readonly PreviewRange[],
): (index: number) => PreviewRange | undefined {
  let position = 0
  return (index) => {
    // The positions come in order, so the quoted texts are passed once.
    while (position < quoted.length && quoted[position]!.end <= index)
      position++
    const quotedText = quoted[position]
    return quotedText !== undefined && quotedText.start < index
      ? quotedText
      : undefined
  }
}

/**
 * Tells whether a bare key inside a quoted string starts a member of an object printed in that string (`'{ password: x, n: 1 }'`, `util.inspect` output kept in a string) and not a word of prose (`'Invalid session: expired'`).
 * Why: a bare key and a colon in a string are prose, unless the text before the key shows the key is a member: only blanks, then `{`, `[`, `(`, `,` or `;`, come before it inside the string. Called by {@link readPreviewMembers} for each bare key inside a string.
 * @param preview - A value as the debugger displays it.
 * @param keyIndex - Where the bare key starts.
 * @param quotedStart - The index of the opening quote of the string that holds the key.
 * @returns `true` when the first character before the key, after blanks and inside the string, is a member prefix; `false` at the start of the string and after a word.
 * @example
 * startsStringMember("'{ password: x }'", 3, 0) // => true
 * startsStringMember("'Invalid session: expired'", 9, 0) // => false
 */
function startsStringMember(
  preview: string,
  keyIndex: number,
  quotedStart: number,
): boolean {
  let before = keyIndex - 1
  while (before > quotedStart && /\s/.test(preview.charAt(before))) before--
  return (
    before > quotedStart && STRING_MEMBER_PREFIXES.has(preview.charAt(before))
  )
}

/**
 * Reads every member of a preview with the end of its value and the bracket it sits in.
 * A key-shaped text inside a quoted string is prose when its key is bare and nothing shows it starts a member (`'Invalid session: expired'`), and is skipped. A bare key that starts a member of an object printed in the string (`'{ password: x }'`) stays a member whose value ends before the string's closing quote, like a quoted key (`'{"token":"abc"}'`, the JSON of a serialised object); it pairs only with the members of the same string.
 * @param preview - A value as the debugger displays it.
 * @param structure - The quoted texts and brackets of the preview ({@link readPreviewStructure}).
 * @returns The members, in order of position.
 * @example readPreviewMembers("{a: 1, b: 'x'}", readPreviewStructure("{a: 1, b: 'x'}")).map((member) => member.key) // => ['a', 'b']
 */
function readPreviewMembers(
  preview: string,
  structure: PreviewStructure,
): PreviewMember[] {
  const endOfBareValue = createBareValueEnd(preview)
  const enclosingQuotedText = createEnclosingQuotedText(structure.quoted)
  const members: PreviewMember[] = []
  for (const match of preview.matchAll(PREVIEW_KEY)) {
    // A quoted key starts at its own opening quote, which is not inside the quoted text it opens.
    const enclosing = enclosingQuotedText(match.index)
    // A bare key inside a string is prose unless it starts a member of an object printed there.
    if (
      enclosing !== undefined &&
      match[1] !== undefined &&
      !startsStringMember(preview, match.index, enclosing.start)
    )
      continue
    const valueStart = match.index + match[0].length
    const memberKey = match[1] ?? match[2] ?? match[3] ?? ''
    members.push({
      key: memberKey,
      index: match.index,
      valueStart,
      // A value inside a string never runs past the string's closing quote.
      valueEnd:
        enclosing === undefined
          ? endOfPreviewValue(preview, valueStart, structure, endOfBareValue)
          : endOfValueInString(
              preview,
              valueStart,
              Math.max(valueStart, enclosing.end - 1),
            ),
      container: enclosing === undefined ? -1 : -2 - enclosing.start,
    })
  }
  assignContainers(preview, members)
  return members
}

/**
 * Finds the values of the members whose own key is a secret name.
 * @param members - The members of a preview.
 * @returns One range per member.
 * @example secretNamedRanges(readPreviewMembers("{apiKey: 'x'}")) // => [{ start: 9, end: 12 }]
 */
function secretNamedRanges(members: readonly PreviewMember[]): PreviewRange[] {
  return members
    .filter((member) => isSecretName(member.key))
    .map((member) => ({ start: member.valueStart, end: member.valueEnd }))
}

/**
 * Finds the `value` members that sit beside a `name` or `key` member holding a secret name: the cookie record `{name: 'sid', value: '…'}` and a Map entry's `key` and `value`.
 * @param preview - A value as the debugger displays it.
 * @param members - The members of the preview.
 * @returns One range per such `value` member.
 * @example pairValueRanges("{name: 'sid', value: 'abc'}", readPreviewMembers("{name: 'sid', value: 'abc'}")) // => [{ start: 21, end: 26 }]
 */
function pairValueRanges(
  preview: string,
  members: readonly PreviewMember[],
): PreviewRange[] {
  const containersNamingASecret = new Set(
    members
      .filter((member) => {
        if (member.key !== 'name' && member.key !== 'key') return false
        const text = unquotePreviewString(
          preview.slice(member.valueStart, member.valueEnd),
        )
        return text !== undefined && isSecretHeaderName(text)
      })
      .map((member) => member.container),
  )
  return members
    .filter(
      (member) =>
        member.key === 'value' && containersNamingASecret.has(member.container),
    )
    .map((member) => ({ start: member.valueStart, end: member.valueEnd }))
}

/**
 * Finds the values after an Authorization label in a preview or a fact string, whatever the scheme: `'Authorization: ApiKey …'` held in a string, `Authorization=…`, a header line a fact keeps bare.
 * Why: a header line held in a string is no member (its bare key is prose to the member rule), and the member rule ends a bare value at its first comma, which a credential such as AWS4-HMAC-SHA256's `Credential=…,Signature=…` holds. The label rule ({@link findLabelledAuthorizations}) ends a value at the closing quote of the string that holds it, so the quote stays. The value of an object's own `authorization` member is left to the member rule, which ends a bare value at its comma and keeps the members after it. Called by {@link redactValuePreview} and {@link previewShowsCredentialShape}.
 * @param preview - A value as the debugger displays it.
 * @param structure - The quoted texts and brackets of the preview.
 * @param members - The members of the preview.
 * @returns One replacement per value.
 * @example findAuthorizationLabelValues("{h: 'Authorization: ApiKey abc'}", structure, members) // => [{ start: 20, end: 30, text: '[masked]' }]
 */
function findAuthorizationLabelValues(
  preview: string,
  structure: PreviewStructure,
  members: readonly PreviewMember[],
): TextReplacement[] {
  const enclosingQuotedText = createEnclosingQuotedText(structure.quoted)
  // The value of a member inside an object starts where the member's value starts, or one character on when it is quoted.
  const memberValueStarts = new Set(
    members
      .filter((member) => member.container >= 0)
      .map((member) => member.valueStart),
  )
  return findLabelledAuthorizations(preview, REDACTION_MASK, (labelIndex) => {
    const enclosing = enclosingQuotedText(labelIndex)
    if (enclosing === undefined) return preview.length
    // An unclosed string runs to the end of the preview.
    const isClosed =
      preview.charAt(enclosing.end - 1) === preview.charAt(enclosing.start)
    return isClosed ? enclosing.end - 1 : enclosing.end
  }).filter(
    (replacement) =>
      !memberValueStarts.has(replacement.start) &&
      !memberValueStarts.has(replacement.start - 1),
  )
}

/**
 * Masks the members of secret-named keys inside a debugger's value preview (`{apiKey: 'x', host: 'y'}`, `Map(1) {'authorization' => 'x'}`), the value beside a secret `name` or `key` member (`{name: 'sid', value: 'x'}`), and every quoted element that holds a credential shape (a Cookie header, an Authorization value, the element after `'Cookie'` in a flat header array, a URL's secret query values), so an expandable value's own text never carries what its children are masked for.
 * Why: the editor's debug adapter previews an object with its members' values; the redaction contract masks a secret-named member and everything inside it, wherever its value appears. Called by {@link redactInspectedValue} and {@link captureReplayDebugSnapshot} before the credential shapes of {@link redactSecretText}, and by {@link maskSavedDebugSnapshot} for every saved preview. The member ranges and the quoted credential elements are both found on the original preview and put in together, so no stretch shifts the quote pairing of the others.
 * @param preview - A value as the debugger displays it.
 * @returns The preview with each such value replaced by {@link REDACTION_MASK}; unchanged when it names none.
 * @example
 * redactValuePreview("{apiKey: 'plain-secret', host: 'x'}") // => "{apiKey: [masked], host: 'x'}"
 * redactValuePreview("{session: {id: 1}, n: 2}")           // => '{session: [masked], n: 2}'
 * redactValuePreview("{name: 'sid', value: 'abc'}")        // => "{name: 'sid', value: [masked]}"
 * redactValuePreview("['Cookie', 'sid=abc']")              // => "['Cookie', [masked]]"
 * redactValuePreview("{msg: 'Invalid session: expired', h: 'sid=1; theme=dark'}") // => "{msg: 'Invalid session: expired', h: [masked]}"
 */
export function redactValuePreview(preview: string): string {
  const structure = readPreviewStructure(preview)
  const members = readPreviewMembers(preview, structure)
  const memberReplacements: TextReplacement[] = [
    ...secretNamedRanges(members),
    ...pairValueRanges(preview, members),
  ].map((range) => ({ ...range, text: REDACTION_MASK }))
  return applyTextReplacements(preview, [
    ...memberReplacements,
    ...findAuthorizationLabelValues(preview, structure, members),
    ...findShapedLiterals(preview, false, REDACTION_MASK).replacements,
  ])
}

/**
 * Tells whether a preview shows a credential by its shape rather than by a member's own name: a `name`/`value` pair, a Cookie header, an Authorization value, the element after a secret header name or a secret query value.
 * Why: a parent whose children the capture masked or could not read keeps its preview only when the preview shows no such shape; otherwise the preview is the parent's class name. Called by {@link maskSavedDebugSnapshot}.
 * @param preview - A value as the debugger displays it.
 * @returns `true` when {@link redactValuePreview} would mask a shape in it.
 * @example
 * previewShowsCredentialShape("{name: 'sid', value: 'abc'}") // => true
 * previewShowsCredentialShape("{id: 7, theme: 'dark'}") // => false
 */
export function previewShowsCredentialShape(preview: string): boolean {
  const structure = readPreviewStructure(preview)
  const members = readPreviewMembers(preview, structure)
  return (
    pairValueRanges(preview, members).length > 0 ||
    findAuthorizationLabelValues(preview, structure, members).length > 0 ||
    findShapedLiterals(preview, false, REDACTION_MASK).replacements.length > 0
  )
}
