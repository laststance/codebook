import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parsePressKey } from '../utils/pressKey'

/** Reads the event of an accepted spelling, failing the test with the refusal otherwise. */
function eventOf(spelling: string) {
  const parsed = parsePressKey(spelling)
  assert.equal(parsed.ok, true, JSON.stringify(parsed))
  return parsed.ok ? parsed.event : undefined
}

/** Reads the refusal message of a spelling, failing the test when it is accepted. */
function messageOf(spelling: string): string {
  const parsed = parsePressKey(spelling)
  assert.equal(parsed.ok, false, `${spelling} was accepted`)
  return parsed.ok ? '' : parsed.message
}

// Value: protects=the key, code, virtual key code, modifier flags and typed text a US keyboard sends for each printable and named key; fails_when=a table entry, a modifier bit or the text rule drifts; no_claim=other layouts or what a page does with the event
test('every printable and named key sends the fields a US keyboard sends', () => {
  // Arrange
  const expected: Record<string, unknown> = {
    a: { key: 'a', code: 'KeyA', vk: 65, modifiers: 0, text: 'a' },
    z: { key: 'z', code: 'KeyZ', vk: 90, modifiers: 0, text: 'z' },
    A: { key: 'A', code: 'KeyA', vk: 65, modifiers: 8, text: 'A' },
    '0': { key: '0', code: 'Digit0', vk: 48, modifiers: 0, text: '0' },
    '9': { key: '9', code: 'Digit9', vk: 57, modifiers: 0, text: '9' },
    '!': { key: '!', code: 'Digit1', vk: 49, modifiers: 8, text: '!' },
    ')': { key: ')', code: 'Digit0', vk: 48, modifiers: 8, text: ')' },
    '(': { key: '(', code: 'Digit9', vk: 57, modifiers: 8, text: '(' },
    '`': { key: '`', code: 'Backquote', vk: 192, modifiers: 0, text: '`' },
    '-': { key: '-', code: 'Minus', vk: 189, modifiers: 0, text: '-' },
    '=': { key: '=', code: 'Equal', vk: 187, modifiers: 0, text: '=' },
    '[': { key: '[', code: 'BracketLeft', vk: 219, modifiers: 0, text: '[' },
    ']': { key: ']', code: 'BracketRight', vk: 221, modifiers: 0, text: ']' },
    '\\': { key: '\\', code: 'Backslash', vk: 220, modifiers: 0, text: '\\' },
    ';': { key: ';', code: 'Semicolon', vk: 186, modifiers: 0, text: ';' },
    "'": { key: "'", code: 'Quote', vk: 222, modifiers: 0, text: "'" },
    ',': { key: ',', code: 'Comma', vk: 188, modifiers: 0, text: ',' },
    '.': { key: '.', code: 'Period', vk: 190, modifiers: 0, text: '.' },
    '/': { key: '/', code: 'Slash', vk: 191, modifiers: 0, text: '/' },
    '?': { key: '?', code: 'Slash', vk: 191, modifiers: 8, text: '?' },
    '~': { key: '~', code: 'Backquote', vk: 192, modifiers: 8, text: '~' },
    '<': { key: '<', code: 'Comma', vk: 188, modifiers: 8, text: '<' },
    '>': { key: '>', code: 'Period', vk: 190, modifiers: 8, text: '>' },
    ':': { key: ':', code: 'Semicolon', vk: 186, modifiers: 8, text: ':' },
    '"': { key: '"', code: 'Quote', vk: 222, modifiers: 8, text: '"' },
    '|': { key: '|', code: 'Backslash', vk: 220, modifiers: 8, text: '|' },
    _: { key: '_', code: 'Minus', vk: 189, modifiers: 8, text: '_' },
    '{': { key: '{', code: 'BracketLeft', vk: 219, modifiers: 8, text: '{' },
    '}': { key: '}', code: 'BracketRight', vk: 221, modifiers: 8, text: '}' },
    Plus: { key: '+', code: 'Equal', vk: 187, modifiers: 8, text: '+' },
    Enter: { key: 'Enter', code: 'Enter', vk: 13, modifiers: 0, text: '\r' },
    Escape: { key: 'Escape', code: 'Escape', vk: 27, modifiers: 0 },
    Tab: { key: 'Tab', code: 'Tab', vk: 9, modifiers: 0 },
    Backspace: { key: 'Backspace', code: 'Backspace', vk: 8, modifiers: 0 },
    Delete: { key: 'Delete', code: 'Delete', vk: 46, modifiers: 0 },
    Space: { key: ' ', code: 'Space', vk: 32, modifiers: 0, text: ' ' },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37, modifiers: 0 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38, modifiers: 0 },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39, modifiers: 0 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40, modifiers: 0 },
    Home: { key: 'Home', code: 'Home', vk: 36, modifiers: 0 },
    End: { key: 'End', code: 'End', vk: 35, modifiers: 0 },
    PageUp: { key: 'PageUp', code: 'PageUp', vk: 33, modifiers: 0 },
    PageDown: { key: 'PageDown', code: 'PageDown', vk: 34, modifiers: 0 },
    F1: { key: 'F1', code: 'F1', vk: 112, modifiers: 0 },
    F5: { key: 'F5', code: 'F5', vk: 116, modifiers: 0 },
    F12: { key: 'F12', code: 'F12', vk: 123, modifiers: 0 },
  }
  // Act
  const actual = Object.fromEntries(
    Object.keys(expected).map((spelling) => {
      const event = eventOf(spelling)
      return [
        spelling,
        {
          key: event?.key,
          code: event?.code,
          vk: event?.windowsVirtualKeyCode,
          modifiers: event?.modifiers,
          ...(event?.text === undefined ? {} : { text: event.text }),
        },
      ]
    }),
  )
  // Assert
  assert.deepEqual(actual, expected)
  assert.equal(eventOf('F5')?.type, 'keyDown')
  assert.equal(eventOf('F5')?.nativeVirtualKeyCode, 116)
  assert.equal(eventOf('a')?.unmodifiedText, 'a')
})

// Value: protects=the canonical spelling order and the refusal of every alias with the spelling to write; fails_when=modifiers are not ordered Control, Alt, Shift, Meta, an alias is accepted, or its message omits the canonical form; no_claim=the schema path of the message
test('a key spelling is canonicalised and each alias is refused with the spelling to write', () => {
  // Arrange
  const accepted = [
    ['Meta+Shift+p', 'Shift+Meta+p'],
    ['Alt+Control+x', 'Control+Alt+x'],
    ['Meta+Alt+Shift+Control+Enter', 'Control+Alt+Shift+Meta+Enter'],
    ['Shift+a', 'Shift+a'],
    ['A', 'A'],
    ['Shift+A', 'Shift+A'],
    ['Control++', 'Control+Plus'],
    ['Control+Plus', 'Control+Plus'],
    ['F5', 'F5'],
  ]
  const aliases = [
    ['Ctrl+k', '"Ctrl+k" is not a key; write "Control+k".'],
    ['Cmd+k', '"Cmd+k" is not a key; write "Meta+k".'],
    ['Command+k', '"Command+k" is not a key; write "Meta+k".'],
    ['Option+k', '"Option+k" is not a key; write "Alt+k".'],
    ['Esc', '"Esc" is not a key; write "Escape".'],
    ['Return', '"Return" is not a key; write "Enter".'],
    ['Del', '"Del" is not a key; write "Delete".'],
    ['Up', '"Up" is not a key; write "ArrowUp".'],
    ['Down', '"Down" is not a key; write "ArrowDown".'],
    ['Left', '"Left" is not a key; write "ArrowLeft".'],
    ['Right', '"Right" is not a key; write "ArrowRight".'],
    [' ', '" " is not a key; write "Space".'],
    [
      'Ctrl+Meta+Esc',
      '"Ctrl+Meta+Esc" is not a key; write "Control+Meta+Escape".',
    ],
  ]
  // Act
  const canonical = accepted.map(([spelling = '']) => {
    const parsed = parsePressKey(spelling)
    return [spelling, parsed.ok ? parsed.canonical : parsed.message]
  })
  const messages = aliases.map(([spelling = '']) => [
    spelling,
    messageOf(spelling),
  ])
  // Assert
  assert.deepEqual(canonical, accepted)
  assert.deepEqual(messages, aliases)
})

// Value: protects=the Shift rules: uppercase and shifted symbols imply Shift, an explicit Shift shifts the character, and Control, Alt or Meta chords type nothing; fails_when=a shifted key loses its flag, Shift is sent twice, or a chord carries text; no_claim=what a page does with the chord
test('Shift is implied by a shifted character, explicit Shift shifts the character, and chords type no text', () => {
  // Arrange
  const cases: [string, { key: string; modifiers: number; text?: string }][] = [
    ['Shift+a', { key: 'A', modifiers: 8, text: 'A' }],
    ['Shift+A', { key: 'A', modifiers: 8, text: 'A' }],
    ['Shift+1', { key: '!', modifiers: 8, text: '!' }],
    ['Shift+!', { key: '!', modifiers: 8, text: '!' }],
    ['Shift+=', { key: '+', modifiers: 8, text: '+' }],
    ['Shift+Plus', { key: '+', modifiers: 8, text: '+' }],
    ['Shift+Tab', { key: 'Tab', modifiers: 8 }],
    ['Control+k', { key: 'k', modifiers: 2 }],
    ['Alt+k', { key: 'k', modifiers: 1 }],
    ['Meta+k', { key: 'k', modifiers: 4 }],
    ['Control+Shift+k', { key: 'K', modifiers: 10 }],
    ['Meta+Alt+Shift+Control+x', { key: 'X', modifiers: 15 }],
    ['Control+Enter', { key: 'Enter', modifiers: 2 }],
    ['Control+Plus', { key: '+', modifiers: 10 }],
    ['Shift+Enter', { key: 'Enter', modifiers: 8, text: '\r' }],
  ]
  // Act
  const actual = cases.map(([spelling]) => {
    const event = eventOf(spelling)
    return {
      key: event?.key,
      modifiers: event?.modifiers,
      ...(event?.text === undefined ? {} : { text: event.text }),
    }
  })
  const uppercaseChord = messageOf('Control+K')
  const symbolChord = messageOf('Alt+!')
  // Assert
  assert.deepEqual(
    actual,
    cases.map(([, expected]) => expected),
  )
  assert.equal(
    uppercaseChord,
    '"Control+K" is not a key; write "Control+k" or "Control+Shift+k".',
  )
  assert.equal(
    symbolChord,
    '"Alt+!" is not a key; write "Alt+1" or "Alt+Shift+1".',
  )
})

// Value: protects=the refusal of every spelling outside the grammar with a sentence that stands alone and gives the allowed form; fails_when=an empty, bare plus, repeated modifier, lone modifier, whitespace, non-ASCII, multi-character or unknown key is accepted or its message loses the allowed form; no_claim=the path the schema attaches
test('spellings outside the grammar are refused with a message that names the problem and the allowed form', () => {
  // Arrange
  const refused: [string, string][] = [
    ['', 'The key is empty.'],
    ['+', '"+" alone is not a key; write "Plus".'],
    [
      'Control+',
      '"Control+" ends with "+" and names no key after the modifiers.',
    ],
    ['Control', '"Control" is not a key.'],
    [
      'Control+Control+k',
      '"Control+Control+k" repeats the modifier "Control"; write each modifier once.',
    ],
    [
      'Ctrl+Control+k',
      '"Ctrl+Control+k" repeats the modifier "Control"; write each modifier once.',
    ],
    ['Control+ k', '" k" contains whitespace'],
    ['a b', '"a b" contains whitespace'],
    ['é', '"é" is not a key.'],
    ['ab', '"ab" is not a key.'],
    ['Enterr', '"Enterr" is not a key.'],
    ['F13', '"F13" is not a key.'],
    ['Hyper+k', '"Hyper" in "Hyper+k" is not a modifier.'],
    ['Control+Shift', '"Shift" is not a key.'],
    [
      '+k',
      '"+k" has an empty part before a "+"; to press the plus key write "Plus" (for example "Control+Plus").',
    ],
  ]
  // Act
  const messages = refused.map(([spelling]) => messageOf(spelling))
  // Assert
  for (const [index, [spelling, start]] of refused.entries()) {
    assert.ok(
      messages[index]?.startsWith(start),
      `${spelling} -> ${messages[index]}`,
    )
  }
  assert.match(
    messageOf('Hyper+k'),
    /Write optional modifiers \(Control, Alt, Shift, Meta, each at most once\) each followed by "\+", then one key/,
  )
})
