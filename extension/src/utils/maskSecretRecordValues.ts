import {
  applyTextReplacements,
  findQuotedElement,
  isSecretHeaderName,
  unquotePreviewString,
  type TextReplacement,
} from './secretShapes'

/** A `name`, `key` or `value` member key, bare (`name:`) or quoted (`'name':`, `"value":`), with the blanks up to its value. Group 1 is a bare key, group 3 a quoted one. Sticky, so each attempt reads only from the position it is set to. */
const RECORD_MEMBER_KEY =
  /(?:(name|key|value)|(['"`])(name|key|value)\2)[ \t]*:[ \t]*/y

/** The characters a record key can start with; a position that starts with none of them is not tried. */
const RECORD_KEY_FIRST_CHARACTERS: ReadonlySet<string> = new Set([
  'n',
  'k',
  'v',
  "'",
  '"',
  '`',
])

/** The characters that end a bare member value (`42`, `true`, `undefined`). */
const BARE_VALUE_END = /[,}\]\r\n]/

/** What the scan knows about one `{…}` or `[…]` of the text: whether a `name` or `key` member in it names a secret, and where its `value` members are. */
type RecordScope = {
  namesASecret: boolean
  valueRanges: Array<{ start: number; end: number }>
}

/** One `name`, `key` or `value` member of a printed record, with the stretch of its value. */
type RecordMember = {
  keyName: string
  valueStart: number
  valueEnd: number
}

/**
 * Finds where a member's value ends: past its closing quote for a quoted string, at the next `,`, `}`, `]` or line break for a bare scalar.
 * Called by {@link readRecordMember}.
 * @param text - The text.
 * @param valueStart - The index right after the member key's colon and blanks.
 * @param noCloserBefore - The quote memo of {@link findQuotedElement}, shared by the whole scan.
 * @returns The index where the value ends, or `undefined` for an empty value or one that opens a nested `{` or `[` (its members are read on their own).
 * @example endOfMemberValue("name: 'sid'}", 6, new Map()) // => 11
 */
function endOfMemberValue(
  text: string,
  valueStart: number,
  noCloserBefore: Map<string, number>,
): number | undefined {
  const first = text.charAt(valueStart)
  if (first === '{' || first === '[') return undefined
  const element = findQuotedElement(text, valueStart, noCloserBefore)
  if (element !== undefined) return element.end
  let valueEnd = valueStart
  while (valueEnd < text.length && !BARE_VALUE_END.test(text.charAt(valueEnd)))
    valueEnd++
  // Trailing blanks belong to the gap, not to the value.
  while (valueEnd > valueStart && /\s/.test(text.charAt(valueEnd - 1)))
    valueEnd--
  return valueEnd > valueStart ? valueEnd : undefined
}

/**
 * Reads the `name`, `key` or `value` member that starts at a position, if one does.
 * Called by {@link maskSecretRecordValues} for each position of the text.
 * @param text - The text.
 * @param index - A position in it.
 * @param noCloserBefore - The quote memo of {@link findQuotedElement}.
 * @returns The member with the stretch of its value, or `undefined` when no such member starts there (a bare key must start a word: `rename:` and `my-key:` are no member).
 * @example readRecordMember("{ name: 'sid' }", 2, new Map()) // => { keyName: 'name', valueStart: 8, valueEnd: 13 }
 */
function readRecordMember(
  text: string,
  index: number,
  noCloserBefore: Map<string, number>,
): RecordMember | undefined {
  const character = text.charAt(index)
  if (!RECORD_KEY_FIRST_CHARACTERS.has(character)) return undefined
  const isBareKey = /[nkv]/.test(character)
  if (isBareKey && /[\w$-]/.test(text.charAt(index - 1))) return undefined
  RECORD_MEMBER_KEY.lastIndex = index
  const match = RECORD_MEMBER_KEY.exec(text)
  const keyName = match?.[1] ?? match?.[3]
  if (match === null || keyName === undefined) return undefined
  const valueStart = index + match[0].length
  const valueEnd = endOfMemberValue(text, valueStart, noCloserBefore)
  return valueEnd === undefined ? undefined : { keyName, valueStart, valueEnd }
}

/** What one pass over a text accumulates: the open scopes (the top level first), the quote memo of {@link findQuotedElement}, and the stretches to mask. */
type RecordScan = {
  scopes: RecordScope[]
  noCloserBefore: Map<string, number>
  replacements: TextReplacement[]
  mask: string
}

/**
 * Opens a scope for a member list.
 * @returns An empty scope.
 * @example newScope() // => { namesASecret: false, valueRanges: [] }
 */
function newScope(): RecordScope {
  return { namesASecret: false, valueRanges: [] }
}

/**
 * Ends a scope: when a member in it named a secret, every `value` member of it is masked.
 * Called when a bracket closes, at the end of a top-level line and at the end of the text.
 * @param scan - The pass in progress.
 * @param scope - The scope that ended.
 * @example closeScope(scan, { namesASecret: true, valueRanges: [{ start: 8, end: 13 }] }) // adds one replacement to scan.replacements
 */
function closeScope(scan: RecordScan, scope: RecordScope): void {
  if (!scope.namesASecret) return
  for (const range of scope.valueRanges)
    scan.replacements.push({ ...range, text: scan.mask })
}

/**
 * Records a member in the innermost scope: a `value` member is a candidate, a `name` or `key` member that holds a secret name makes the scope's candidates secret.
 * Called by {@link readAt}.
 * @param scope - The innermost scope.
 * @param text - The text.
 * @param member - The member just read.
 * @example noteMember(scope, "{ name: 'sid' }", { keyName: 'name', valueStart: 8, valueEnd: 13 }) // sets scope.namesASecret
 */
function noteMember(
  scope: RecordScope,
  text: string,
  member: RecordMember,
): void {
  if (member.keyName === 'value') {
    scope.valueRanges.push({ start: member.valueStart, end: member.valueEnd })
    return
  }
  const name = unquotePreviewString(
    text.slice(member.valueStart, member.valueEnd),
  )
  if (name !== undefined && isSecretHeaderName(name)) scope.namesASecret = true
}

/**
 * Reads what stands at one position: a bracket that opens or closes a scope, the line break that ends the top-level scope, a member, or a quoted string that is skipped whole so the brackets inside it count for nothing.
 * Called by {@link maskSecretRecordValues} for each position.
 * @param text - The text.
 * @param index - The position.
 * @param scan - The pass in progress.
 * @returns The index of the last character it consumed.
 * @example readAt("{ name: 'sid' }", 2, scan) // => 12 (the member `name: 'sid'`)
 */
function readAt(text: string, index: number, scan: RecordScan): number {
  const character = text.charAt(index)
  const innermost = scan.scopes[scan.scopes.length - 1]!
  if (character === '{' || character === '[') scan.scopes.push(newScope())
  else if (character === '}' || character === ']') {
    if (scan.scopes.length > 1) closeScope(scan, scan.scopes.pop()!)
  } else if (character === '\n') {
    // A line break ends only the top level, which has no bracket to close it.
    if (scan.scopes.length === 1) {
      closeScope(scan, innermost)
      scan.scopes[0] = newScope()
    }
  } else {
    const member = readRecordMember(text, index, scan.noCloserBefore)
    if (member !== undefined) {
      noteMember(innermost, text, member)
      return member.valueEnd - 1
    }
    const element = findQuotedElement(text, index, scan.noCloserBefore)
    if (element !== undefined && !element.isUnterminated) return element.end - 1
  }
  return index
}

/**
 * Masks the `value` member of a printed record whose `name` or `key` member holds a secret name (`{ name: 'sid', value: '…' }`, the records of a cookies array, their JSON), the shapes a debugger preview already masks.
 * Why: a data function logs `req.cookies` or a cookie jar; the value of a record is an opaque string that only its neighbour marks as a credential. Called by {@link maskSecretShapesInOutput} on each released run of lines. A record is judged inside one text: a record split over two writes is not paired. Each position is read once, so the time is linear.
 * @param text - Output of one or more lines.
 * @param mask - What replaces a masked value.
 * @returns The text with each such value replaced by `mask`; the `name` and the other members stay readable. A record named by a plain word (`{ name: 'theme', value: 'dark' }`) is unchanged.
 * @example
 * maskSecretRecordValues("{ name: 'sid', value: 'abc' }", '[masked]') // => "{ name: 'sid', value: [masked] }"
 * maskSecretRecordValues("{ name: 'theme', value: 'dark' }", '[masked]') // => "{ name: 'theme', value: 'dark' }"
 */
export function maskSecretRecordValues(text: string, mask: string): string {
  // The text's top level is one scope, for members printed without braces.
  const scan: RecordScan = {
    scopes: [newScope()],
    noCloserBefore: new Map<string, number>(),
    replacements: [],
    mask,
  }
  for (let index = 0; index < text.length; index++)
    index = readAt(text, index, scan)
  // A record the text leaves open is judged as far as it was read.
  for (const scope of scan.scopes) closeScope(scan, scope)
  return applyTextReplacements(text, scan.replacements, mask)
}
