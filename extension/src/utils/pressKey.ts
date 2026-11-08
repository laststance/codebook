// fallow-ignore-file unused-file -- Wave 0 leaf; remove this line when the grammar lane first imports it
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

/**
 * Parses the spelling of a `press` operation's `key` (`Control+k`, `Enter`, `F5`) into its canonical spelling and the key event the run sends.
 *
 * Why it exists: the schema rule, the canonicaliser and the engine need one reading of the grammar. Called by `validatePressOperations`, `canonicalizePressKeys` and the press engine.
 * Wave 0 declares the signature only; the body arrives with the grammar work.
 * @param spelling - The `key` as the configuration wrote it.
 * @returns `{ ok: true, canonical, event }`, or `{ ok: false, message }` with a message that stands alone.
 * @throws Error in Wave 0, until the grammar is implemented.
 * @example
 * parsePressKey('Control+k') // => { ok: true, canonical: 'Control+k', event: { type: 'keyDown', key: 'k', … } }
 * parsePressKey('Ctrl+k') // => { ok: false, message: '"Ctrl+k" is not a key; write "Control+k".' }
 */
export function parsePressKey(spelling: string): PressKeyParse {
  throw new Error(`parsePressKey is not implemented in Wave 0: ${spelling}`)
}
