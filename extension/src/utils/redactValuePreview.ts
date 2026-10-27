import { PREVIEW_VALUE_PREFIX_LIMIT_CHARS, REDACTION_MASK } from '../constants'

import { isSecretName } from './isSecretName'

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

/**
 * Masks the members of secret-named keys inside a debugger's value preview (`{apiKey: 'x', host: 'y'}`, `Map(1) {'authorization' => 'x'}`), so an expandable value's own text never carries what its secret-named children are masked for.
 * Why: the editor's debug adapter previews an object with its members' values; the redaction contract masks a secret-named member and everything inside it, wherever its value appears. Called by {@link redactInspectedValue} and {@link captureReplayDebugSnapshot} before the credential shapes of {@link redactSecretText}.
 * @param preview - A value as the debugger displays it.
 * @returns The preview with each secret-named member's value replaced by {@link REDACTION_MASK}; unchanged when it names none.
 * @example
 * redactValuePreview("{apiKey: 'plain-secret', host: 'x'}") // => "{apiKey: [masked], host: 'x'}"
 * redactValuePreview("{session: {id: 1}, n: 2}")           // => '{session: [masked], n: 2}'
 */
export function redactValuePreview(preview: string): string {
  let redacted = ''
  let copiedUntil = 0
  for (const match of preview.matchAll(PREVIEW_KEY)) {
    // A key inside a value already masked is gone with it.
    if (match.index < copiedUntil) continue
    const key = match[1] ?? match[2] ?? match[3] ?? ''
    if (!isSecretName(key)) continue
    const valueStart = match.index + match[0].length
    redacted += preview.slice(copiedUntil, valueStart) + REDACTION_MASK
    copiedUntil = endOfPreviewValue(preview, valueStart)
  }
  return redacted + preview.slice(copiedUntil)
}
