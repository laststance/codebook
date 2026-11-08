/**
 * The Chrome DevTools Protocol `Input.dispatchKeyEvent` fields of one key press on a US keyboard layout.
 * `type` is always `keyDown` (never `rawKeyDown` or `char`); `text` and `unmodifiedText` are present only for a key that types a character and carries no Control, Alt or Meta.
 */
export type PressKeyEvent = {
  readonly type: 'keyDown'
  readonly key: string
  readonly code: string
  readonly windowsVirtualKeyCode: number
  readonly nativeVirtualKeyCode: number
  /** Bitmask: Alt 1, Control 2, Meta 4, Shift 8. */
  readonly modifiers: number
  readonly text?: string
  readonly unmodifiedText?: string
}

/** The result of {@link parsePressKey}: the canonical spelling with its event, or the sentence that tells what is wrong and the allowed form. */
export type PressKeyParse =
  | {
      readonly ok: true
      readonly canonical: string
      readonly event: PressKeyEvent
    }
  | { readonly ok: false; readonly message: string }

/** What one key contributes to the event before the modifiers are applied. */
type KeyFacts = {
  /** The spelling the canonical form keeps for this key. */
  readonly canonicalName: string
  /** The `key` field without Shift. */
  readonly key: string
  /** The `key` field with Shift; equals `key` when Shift changes nothing. */
  readonly shiftedKey: string
  readonly code: string
  readonly virtualKeyCode: number
  /** The character a printable key types, `"\r"` for Enter; absent for other named keys. */
  readonly typed?: string
  /** True when the written key is itself the shifted form (`A`, `!`) or always shifted (`Plus`). */
  readonly isShifted: boolean
  /** True for an ASCII character written in its shifted form (`A`, `!`): refused beside Control, Alt or Meta. */
  readonly isShiftedCharacter: boolean
}

type ModifierName = 'Control' | 'Alt' | 'Shift' | 'Meta'
const MODIFIER_BITS: Readonly<Record<ModifierName, number>> = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
}
/** The canonical order of modifiers in a spelling. */
const MODIFIER_ORDER: readonly ModifierName[] = [
  'Control',
  'Alt',
  'Shift',
  'Meta',
]

/** Spellings people write that the grammar refuses; read only to word the first sentence of a refusal. */
const MODIFIER_ALIASES: Readonly<Record<string, ModifierName>> = {
  Ctrl: 'Control',
  Cmd: 'Meta',
  Command: 'Meta',
  Option: 'Alt',
}
const KEY_NAME_ALIASES: Readonly<Record<string, string>> = {
  Esc: 'Escape',
  Return: 'Enter',
  Del: 'Delete',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  ' ': 'Space',
}

/** Named keys with a fixed virtual key code, built from one short string; `Plus` and `F1` to `F12` are added by {@link namedKeyFacts}. */
const NAMED_KEY_CODES: ReadonlyMap<string, number> = new Map(
  'Enter:13 Escape:27 Tab:9 Backspace:8 Delete:46 Space:32 ArrowLeft:37 ArrowUp:38 ArrowRight:39 ArrowDown:40 Home:36 End:35 PageUp:33 PageDown:34'
    .split(' ')
    .map((pair) => {
      const [name = '', code = ''] = pair.split(':')
      return [name, Number(code)] as const
    }),
)
const FUNCTION_KEY_PATTERN = /^F([1-9]|1[0-2])$/

/** The US punctuation keys, aligned by index: unshifted, shifted, `code`, virtual key code. */
const PUNCTUATION_UNSHIFTED = "`-=[]\\;',./"
const PUNCTUATION_SHIFTED = '~_+{}|:"<>?'
const PUNCTUATION_CODES = [
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
]
const PUNCTUATION_VIRTUAL_KEY_CODES = [
  192, 189, 187, 219, 221, 220, 186, 222, 188, 190, 191,
]
/** The shifted character of each digit, indexed by the digit. */
const DIGITS_SHIFTED = ')!@#$%^&*('

const ALLOWED_FORM =
  'Write optional modifiers (Control, Alt, Shift, Meta, each at most once) each followed by "+", then one key: a single character from "!" to "~" other than "+", or one of Enter, Escape, Tab, Backspace, Delete, Space, Plus, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, F1 to F12.'

/**
 * Builds the facts of a letter of the US layout.
 * Called by {@link printableKeyFacts}.
 * @param character - One letter `A`-`Z` or `a`-`z`.
 * @returns The key facts; an uppercase letter is the shifted form of its lowercase key.
 * @example letterKeyFacts('A').code // => 'KeyA'
 */
function letterKeyFacts(character: string): KeyFacts {
  const lower = character.toLowerCase()
  const upper = lower.toUpperCase()
  return {
    canonicalName: character,
    key: lower,
    shiftedKey: upper,
    code: `Key${upper}`,
    virtualKeyCode: upper.charCodeAt(0),
    typed: lower,
    isShifted: character !== lower,
    isShiftedCharacter: character !== lower,
  }
}

/**
 * Builds the facts of a digit or of the symbol typed with Shift on that digit.
 * Called by {@link printableKeyFacts}.
 * @param digit - The digit `0`-`9` of the key.
 * @param isShifted - True when the written character is the shifted symbol (`!` for `1`).
 * @param character - The character as written.
 * @returns The key facts of the digit key.
 * @example digitKeyFacts(1, true, '!').key // => '1'
 */
function digitKeyFacts(
  digit: number,
  isShifted: boolean,
  character: string,
): KeyFacts {
  return {
    canonicalName: character,
    key: String(digit),
    shiftedKey: DIGITS_SHIFTED.charAt(digit),
    code: `Digit${digit}`,
    virtualKeyCode: 48 + digit,
    typed: character,
    isShifted,
    isShiftedCharacter: isShifted,
  }
}

/**
 * Builds the facts of a printable ASCII character on the US layout, or `undefined` for a character the table does not hold.
 * Called by {@link readKey} for a one-character key.
 * @param character - One character, `!` to `~` except `+`.
 * @returns The key facts, or `undefined` for a character outside the table.
 * @example printableKeyFacts('?')?.code // => 'Slash'
 */
function printableKeyFacts(character: string): KeyFacts | undefined {
  if (/^[A-Za-z]$/.test(character)) return letterKeyFacts(character)
  if (/^[0-9]$/.test(character))
    return digitKeyFacts(Number(character), false, character)
  const shiftedDigit = DIGITS_SHIFTED.indexOf(character)
  if (shiftedDigit >= 0) return digitKeyFacts(shiftedDigit, true, character)
  const unshiftedIndex = PUNCTUATION_UNSHIFTED.indexOf(character)
  const index =
    unshiftedIndex >= 0
      ? unshiftedIndex
      : PUNCTUATION_SHIFTED.indexOf(character)
  if (index < 0) return undefined
  return {
    canonicalName: character,
    key: PUNCTUATION_UNSHIFTED.charAt(index),
    shiftedKey: PUNCTUATION_SHIFTED.charAt(index),
    code: PUNCTUATION_CODES[index] ?? '',
    virtualKeyCode: PUNCTUATION_VIRTUAL_KEY_CODES[index] ?? 0,
    typed: character,
    isShifted: unshiftedIndex < 0,
    isShiftedCharacter: unshiftedIndex < 0,
  }
}

/**
 * Builds the facts of a named key (`Enter`, `ArrowUp`, `F5`, `Plus`, `Space`), or `undefined` for an unknown name.
 * Called by {@link readKey} for a key longer than one character and for the folded literal space.
 * @param name - The key name as written (aliases are folded before this call).
 * @returns The key facts, or `undefined` for a name outside the grammar.
 * @example namedKeyFacts('Space')?.key // => ' '
 */
function namedKeyFacts(name: string): KeyFacts | undefined {
  // Plus is the shifted `=` key: Shift is always sent, even beside Control, Alt or Meta.
  if (name === 'Plus')
    return {
      canonicalName: name,
      key: '+',
      shiftedKey: '+',
      code: 'Equal',
      virtualKeyCode: 187,
      typed: '+',
      isShifted: true,
      isShiftedCharacter: false,
    }
  const functionNumber = FUNCTION_KEY_PATTERN.exec(name)?.[1]
  const virtualKeyCode =
    functionNumber === undefined
      ? NAMED_KEY_CODES.get(name)
      : 111 + Number(functionNumber)
  if (virtualKeyCode === undefined) return undefined
  const key = name === 'Space' ? ' ' : name
  // Enter types a carriage return and Space a space; every other named key types nothing.
  const typed = { Enter: '\r', Space: ' ' }[name as 'Enter' | 'Space']
  return {
    canonicalName: name,
    key,
    shiftedKey: key,
    code: name,
    virtualKeyCode,
    typed,
    isShifted: false,
    isShiftedCharacter: false,
  }
}

/**
 * Splits a spelling into its modifier tokens and its key token; a `+` after at least one modifier is the `Plus` key.
 * Called by {@link readSpelling}.
 * @param spelling - The non-empty spelling.
 * @returns The tokens, or the refusal sentence for an empty part, a trailing `+` or a bare `+`.
 * @example splitSpelling('Control+k') // => { modifierTokens: ['Control'], keyToken: 'k' }
 */
function splitSpelling(
  spelling: string,
): { modifierTokens: string[]; keyToken: string } | string {
  const modifierTokens: string[] = []
  let rest = spelling
  // Take one `Modifier+` prefix per round until only the key token is left.
  while (rest.length > 1 && rest.includes('+')) {
    const separator = rest.indexOf('+')
    if (separator === 0)
      return `"${spelling}" has an empty part before a "+"; to press the plus key write "Plus" (for example "Control+Plus").`
    modifierTokens.push(rest.slice(0, separator))
    rest = rest.slice(separator + 1)
  }
  if (rest === '')
    return `"${spelling}" ends with "+" and names no key after the modifiers.`
  if (rest === '+' && modifierTokens.length === 0)
    return '"+" alone is not a key; write "Plus".'
  return { modifierTokens, keyToken: rest === '+' ? 'Plus' : rest }
}

/**
 * Reads the key token into facts, folding aliases and refusing unknown names, whitespace and non-ASCII characters.
 * Called by {@link readSpelling}.
 * @param token - The key as written.
 * @returns The facts with whether an alias was folded, or the refusal sentence.
 * @example readKey('Esc') // => { facts: { canonicalName: 'Escape', … }, didFoldAlias: true }
 */
function readKey(
  token: string,
): { facts: KeyFacts; didFoldAlias: boolean } | string {
  const alias = KEY_NAME_ALIASES[token]
  const name = alias ?? token
  if (/\s/.test(name))
    return `"${token}" contains whitespace; write "Space" for the space key.`
  const facts =
    name.length === 1 ? printableKeyFacts(name) : namedKeyFacts(name)
  if (facts === undefined) return `"${token}" is not a key. ${ALLOWED_FORM}`
  return { facts, didFoldAlias: alias !== undefined }
}

/**
 * Reads the modifier tokens into a set, refusing an unknown or repeated modifier.
 * Called by {@link readSpelling}.
 * @param tokens - The tokens before the key.
 * @param spelling - The whole spelling, for the sentence.
 * @returns The modifiers with whether an alias was folded, or the refusal sentence.
 * @example readModifiers(['Ctrl'], 'Ctrl+k') // => { modifiers: Set { 'Control' }, didFoldAlias: true }
 */
function readModifiers(
  tokens: readonly string[],
  spelling: string,
): { modifiers: Set<ModifierName>; didFoldAlias: boolean } | string {
  const modifiers = new Set<ModifierName>()
  let didFoldAlias = false
  for (const token of tokens) {
    const alias = MODIFIER_ALIASES[token]
    const modifier = alias ?? MODIFIER_ORDER.find((name) => name === token)
    if (modifier === undefined)
      return `"${token}" in "${spelling}" is not a modifier. ${ALLOWED_FORM}`
    // A repeated modifier (also through an alias) would send one flag twice.
    if (modifiers.has(modifier))
      return `"${spelling}" repeats the modifier "${modifier}"; write each modifier once.`
    modifiers.add(modifier)
    didFoldAlias ||= alias !== undefined
  }
  return { modifiers, didFoldAlias }
}

/** The modifiers, the key and whether an alias was folded, as {@link readSpelling} finds them. */
type ReadSpelling = {
  readonly modifiers: ReadonlySet<ModifierName>
  readonly facts: KeyFacts
  readonly didFoldAlias: boolean
}

/**
 * Reads a whole spelling into modifiers and key facts, or the refusal sentence.
 * Called by {@link parsePressKey}.
 * @param spelling - The `key` as written.
 * @returns The reading, or the first refusal sentence.
 * @example readSpelling('Alt+F4') // => { modifiers: Set { 'Alt' }, facts: { code: 'F4', … }, didFoldAlias: false }
 */
function readSpelling(spelling: string): ReadSpelling | string {
  if (spelling === '') return `The key is empty. ${ALLOWED_FORM}`
  const split = splitSpelling(spelling)
  if (typeof split === 'string') return split
  const read = readModifiers(split.modifierTokens, spelling)
  if (typeof read === 'string') return read
  const key = readKey(split.keyToken)
  if (typeof key === 'string') return key
  return {
    modifiers: read.modifiers,
    facts: key.facts,
    didFoldAlias: read.didFoldAlias || key.didFoldAlias,
  }
}

/** Joins the modifiers in canonical order with the key name. */
function canonicalOf(
  modifiers: ReadonlySet<ModifierName>,
  keyName: string,
): string {
  return [
    ...MODIFIER_ORDER.filter((name) => modifiers.has(name)),
    keyName,
  ].join('+')
}

/** Says whether the modifiers include Control, Alt or Meta, which suppress the typed character. */
function hasCommandModifier(modifiers: ReadonlySet<ModifierName>): boolean {
  return (
    modifiers.has('Control') || modifiers.has('Alt') || modifiers.has('Meta')
  )
}

/**
 * Builds the key event of the modifiers and key facts.
 * Called by {@link parsePressKey} once the spelling is accepted.
 * @param modifiers - The modifiers written.
 * @param facts - The key facts.
 * @returns The event; Shift is sent when written or when the key is itself a shifted form.
 * @example eventOf(new Set(['Shift']), letterKeyFacts('a')).key // => 'A'
 */
function eventOf(
  modifiers: ReadonlySet<ModifierName>,
  facts: KeyFacts,
): PressKeyEvent {
  const sendsShift = modifiers.has('Shift') || facts.isShifted
  const mask =
    MODIFIER_ORDER.filter((name) => name !== 'Shift' && modifiers.has(name))
      .map((name) => MODIFIER_BITS[name])
      .reduce((sum, bit) => sum + bit, 0) +
    (sendsShift ? MODIFIER_BITS.Shift : 0)
  const key = sendsShift ? facts.shiftedKey : facts.key
  // Control, Alt and Meta chords type nothing; a printable key or Enter otherwise carries its character.
  const text =
    hasCommandModifier(modifiers) || facts.typed === undefined
      ? undefined
      : facts.typed === '\r'
        ? '\r'
        : key
  const event = {
    type: 'keyDown' as const,
    key,
    code: facts.code,
    windowsVirtualKeyCode: facts.virtualKeyCode,
    nativeVirtualKeyCode: facts.virtualKeyCode,
    modifiers: mask,
  }
  return text === undefined ? event : { ...event, text, unmodifiedText: text }
}

/**
 * Parses the spelling of a `press` operation's `key` (`Control+k`, `Enter`, `F5`) into its canonical spelling and the key event the run sends.
 *
 * Why it exists: the schema rule, the canonicaliser and the engine need one reading of the grammar. Called by `validatePressOperations`, `canonicalizePressKeys` and the press engine.
 * An alias (`Ctrl`, `Esc`, a literal space) is refused with a sentence that names the canonical spelling; an uppercase letter or shifted symbol beside Control, Alt or Meta is refused too.
 * @param spelling - The `key` as the configuration wrote it.
 * @returns `{ ok: true, canonical, event }`, or `{ ok: false, message }` with a message that stands alone.
 * @example
 * parsePressKey('Control+k') // => { ok: true, canonical: 'Control+k', event: { type: 'keyDown', key: 'k', … } }
 * parsePressKey('Ctrl+k') // => { ok: false, message: '"Ctrl+k" is not a key; write "Control+k".' }
 */
export function parsePressKey(spelling: string): PressKeyParse {
  const read = readSpelling(spelling)
  if (typeof read === 'string') return { ok: false, message: read }
  const { modifiers, facts, didFoldAlias } = read
  // `Control+K` would hide that Shift is meant; the written form must say which chord is wanted.
  if (hasCommandModifier(modifiers) && facts.isShiftedCharacter) {
    const withoutShift = canonicalOf(modifiers, facts.key)
    const withShift = canonicalOf(new Set([...modifiers, 'Shift']), facts.key)
    return {
      ok: false,
      message: `"${spelling}" is not a key; write "${withoutShift}" or "${withShift}".`,
    }
  }
  const canonical = canonicalOf(modifiers, facts.canonicalName)
  // An alias is refused, and the sentence names the canonical spelling to write instead.
  if (didFoldAlias)
    return {
      ok: false,
      message: `"${spelling}" is not a key; write "${canonical}".`,
    }
  return { ok: true, canonical, event: eventOf(modifiers, facts) }
}
