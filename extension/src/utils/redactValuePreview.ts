import { PREVIEW_VALUE_PREFIX_LIMIT_CHARS, REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'
import {
  isSecretHeaderName,
  maskShapedLiterals,
  unquotePreviewString,
} from './secretShapes'

/** A member key in a debugger's value preview, bare or quoted, followed by `:` (objects) or `=>` (maps). */
const PREVIEW_KEY =
  /(?<![\w$])(?:([A-Za-z_$][\w$-]*)|'([^'\\]*)'|"([^"\\]*)")\s*(?::|=>)\s*/g
/** A type name and/or a parenthesized length that a debugger writes before a value's body (`Map(1) `, `Array(2) `, `(2) `, `Object `). */
const VALUE_PREFIX = /^(?:[A-Za-z_$][\w$]*)?(?:\(\d+\))?\s*(?=[{[(])/
/** Closing characters for the opening ones a preview value can start with. */
const CLOSING: Readonly<Record<string, string>> = {
  '{': '}',
  '[': ']',
  '(': ')',
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
 * Finds where a bracketed value that starts at `start` ends, past its matching closing bracket, skipping quoted text; a value the preview cut off runs to the end.
 * @param text - The preview.
 * @param start - The index of the opening bracket.
 * @returns The index after the matching bracket, or `text.length`.
 * @example endOfBracketed('{id: 1}, n: 2', 0) // => 7
 */
function endOfBracketed(text: string, start: number): number {
  const opened: string[] = []
  for (let index = start; index < text.length; index++) {
    const character = text.charAt(index)
    if (character === "'" || character === '"' || character === '`') {
      index = endOfQuoted(text, index) - 1
      continue
    }
    const closing = CLOSING[character]
    if (closing) opened.push(closing)
    else if (character === opened.at(-1)) opened.pop()
    // The value ends once its own opening bracket is closed.
    if (opened.length === 0) return index + 1
  }
  return text.length
}

/**
 * Finds where one member value of a preview ends: a quoted string, a bracketed object, array or map (with any type name or length before it), or a bare token up to the next separator.
 * @param text - The preview.
 * @param start - Where the value starts, after its key's `:` or `=>`.
 * @returns The index where the value ends.
 * @example endOfPreviewValue("{a: 'x', b: 1}", 4) // => 7
 */
function endOfPreviewValue(text: string, start: number): number {
  const first = text.charAt(start)
  if (first === "'" || first === '"' || first === '`')
    return endOfQuoted(text, start)
  // A type name or a length before a body (`Array(2) [...]`, `(2) [...]`, `Object {...}`) belongs to the value, which ends with that body.
  const prefix = VALUE_PREFIX.exec(
    text.slice(start, start + PREVIEW_VALUE_PREFIX_LIMIT_CHARS),
  )
  if (prefix && prefix[0].length > 0)
    return endOfBracketed(text, start + prefix[0].length)
  if (CLOSING[first]) return endOfBracketed(text, start)
  const bareToken = /^[^,}\])]*/.exec(text.slice(start))?.[0] ?? ''
  return start + bareToken.trimEnd().length
}

/** One `key: value` or `key => value` member of a preview: where its value is and which bracketed value holds it. */
type PreviewMember = {
  key: string
  /** Where the member's key starts. */
  index: number
  valueStart: number
  valueEnd: number
  /** The index of the innermost opening bracket around the member, or -1 for a member at the top level. */
  container: number
}

/** A stretch of a preview to replace with {@link REDACTION_MASK}. */
type MaskRange = { start: number; end: number }

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
    // A member inside a quoted text is skipped over below and takes the bracket around that text.
    while (next < members.length && members[next]!.index <= index) {
      members[next]!.container = opened.at(-1) ?? -1
      next++
    }
    const character = preview.charAt(index)
    if (character === "'" || character === '"' || character === '`')
      index = endOfQuoted(preview, index) - 1
    else if (CLOSING[character]) opened.push(index)
    else if (character === '}' || character === ']' || character === ')')
      opened.pop()
  }
}

/**
 * Reads every member of a preview with the end of its value and the bracket it sits in.
 * @param preview - A value as the debugger displays it.
 * @returns The members, in order of position.
 * @example readPreviewMembers("{a: 1, b: 'x'}").map((member) => member.key) // => ['a', 'b']
 */
function readPreviewMembers(preview: string): PreviewMember[] {
  const members: PreviewMember[] = []
  for (const match of preview.matchAll(PREVIEW_KEY)) {
    const valueStart = match.index + match[0].length
    members.push({
      key: match[1] ?? match[2] ?? match[3] ?? '',
      index: match.index,
      valueStart,
      valueEnd: endOfPreviewValue(preview, valueStart),
      container: -1,
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
function secretNamedRanges(members: readonly PreviewMember[]): MaskRange[] {
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
): MaskRange[] {
  const containersNamingASecret = new Set(
    members
      .filter((member) => {
        const text = unquotePreviewString(
          preview.slice(member.valueStart, member.valueEnd),
        )
        return (
          (member.key === 'name' || member.key === 'key') &&
          text !== undefined &&
          isSecretHeaderName(text)
        )
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
 * Replaces the given stretches of a preview with {@link REDACTION_MASK}; a stretch inside one already replaced is gone with it.
 * @param preview - A value as the debugger displays it.
 * @param ranges - The stretches to replace.
 * @returns The preview with the stretches replaced.
 * @example maskRanges('{a: 1}', [{ start: 4, end: 5 }]) // => '{a: [masked]}'
 */
function maskRanges(preview: string, ranges: readonly MaskRange[]): string {
  let redacted = ''
  let copiedUntil = 0
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    // A range inside a value already masked is gone with it.
    if (range.start < copiedUntil) continue
    redacted += preview.slice(copiedUntil, range.start) + REDACTION_MASK
    copiedUntil = range.end
  }
  return redacted + preview.slice(copiedUntil)
}

/**
 * Masks the members of secret-named keys inside a debugger's value preview (`{apiKey: 'x', host: 'y'}`, `Map(1) {'authorization' => 'x'}`), the value beside a secret `name` or `key` member (`{name: 'sid', value: 'x'}`), and every quoted element that holds a credential shape (a Cookie header, an Authorization value, the element after `'Cookie'` in a flat header array, a URL's secret query values), so an expandable value's own text never carries what its children are masked for.
 * Why: the editor's debug adapter previews an object with its members' values; the redaction contract masks a secret-named member and everything inside it, wherever its value appears. Called by {@link redactInspectedValue} and {@link captureReplayDebugSnapshot} before the credential shapes of {@link redactSecretText}, and by {@link maskSavedDebugSnapshot} for every saved preview.
 * @param preview - A value as the debugger displays it.
 * @returns The preview with each such value replaced by {@link REDACTION_MASK}; unchanged when it names none.
 * @example
 * redactValuePreview("{apiKey: 'plain-secret', host: 'x'}") // => "{apiKey: [masked], host: 'x'}"
 * redactValuePreview("{session: {id: 1}, n: 2}")           // => '{session: [masked], n: 2}'
 * redactValuePreview("{name: 'sid', value: 'abc'}")        // => "{name: 'sid', value: [masked]}"
 * redactValuePreview("['Cookie', 'sid=abc']")              // => "['Cookie', [masked]]"
 */
export function redactValuePreview(preview: string): string {
  const members = readPreviewMembers(preview)
  return maskShapedLiterals(
    maskRanges(preview, [
      ...secretNamedRanges(members),
      ...pairValueRanges(preview, members),
    ]),
  ).text
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
  const pairs = pairValueRanges(preview, readPreviewMembers(preview))
  return pairs.length > 0 || maskShapedLiterals(preview).text !== preview
}
