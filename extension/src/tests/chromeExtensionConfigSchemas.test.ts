import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromeExtensionConfigSchema } from '../chromeExtensionConfigSchemas'
import { StudyError } from '../errors'
import { parseChromeExtensionConfiguration } from '../utils/parseChromeExtensionConfiguration'

import { baselineConfiguration } from './utils/chromeExtensionFixture'

/** Parses a raw configuration and returns the StudyError it is refused with, failing the test when it is accepted. */
function refusalOf(raw: unknown): StudyError {
  try {
    parseChromeExtensionConfiguration(raw)
  } catch (error) {
    assert.ok(error instanceof StudyError, 'expected a StudyError')
    return error
  }
  throw new assert.AssertionError({ message: 'the configuration was accepted' })
}

/** A seed holding the given bookmark nodes. */
function seedOf(bookmarks: unknown) {
  return baselineConfiguration({ seed: { bookmarks } })
}

test('a baseline popup configuration parses with the click kind defaulting to click and an empty seed', () => {
  // protects=the documented defaults the executor relies on; fails_when=kind or seed lose their defaults; no_claim=the files exist
  // Arrange
  const raw = baselineConfiguration()
  // Act
  const configuration = chromeExtensionConfigSchema.parse(raw)
  // Assert
  assert.equal(configuration.clicks[0]?.kind, 'click')
  assert.deepEqual(configuration.seed, {})
  assert.equal(configuration.surface.kind, 'popup')
})

test('a dblclick with a dialog answer and ordered inputs is accepted', () => {
  // protects=TZ11 click additions and CR8 inputs; fails_when=kind, dialog or inputs are dropped or refused; no_claim=the selectors match anything
  // Arrange
  const raw = baselineConfiguration({
    clicks: [
      {
        title: 'Open the folder',
        selector: '.folder',
        kind: 'dblclick',
        dialog: 'accept',
        inputs: [
          { selector: '#a', text: 'one' },
          { selector: '#b', text: 'two' },
        ],
      },
    ],
  })
  // Act
  const configuration = chromeExtensionConfigSchema.parse(raw)
  // Assert
  assert.equal(configuration.clicks[0]?.kind, 'dblclick')
  assert.equal(configuration.clicks[0]?.dialog, 'accept')
  assert.equal(configuration.clicks[0]?.inputs?.length, 2)
})

test('an inspections key is refused as an unknown key', () => {
  // protects=SR11 no inspections; fails_when=the schema accepts or ignores inspections; no_claim=other unknown keys are worded the same
  // Arrange
  const raw = baselineConfiguration({ inspections: [] })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.equal(
    refusal.message,
    'configuration: Unrecognized key: "inspections". See codebook://help/chrome-extension.',
  )
})

test('a string book is refused naming configuration.book', () => {
  // protects=DXR1 shared book object; fails_when=a book string is accepted; no_claim=the book exists
  // Arrange
  const raw = baselineConfiguration({ book: 'interface' })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.match(refusal.message, /^configuration\.book: /)
})

test('a click without a title is refused naming the title field', () => {
  // protects=DR2 required title; fails_when=a click without title is accepted; no_claim=the title is meaningful
  // Arrange
  const raw = baselineConfiguration({ clicks: [{ selector: '#go' }] })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.match(refusal.message, /^configuration\.clicks\[0\]\.title: /)
})

test('a click title of 81 characters is refused and 80 is accepted', () => {
  // protects=DR2 title bound 1-80; fails_when=the bound moves; no_claim=display truncation
  // Arrange
  const withTitle = (title: string) =>
    baselineConfiguration({ clicks: [{ title, selector: '#go' }] })
  // Act
  const accepted = chromeExtensionConfigSchema.safeParse(
    withTitle('t'.repeat(80)),
  )
  const refusal = refusalOf(withTitle('t'.repeat(81)))
  // Assert
  assert.equal(accepted.success, true)
  assert.match(refusal.message, /^configuration\.clicks\[0\]\.title: /)
})

test('zero clicks and four clicks are both refused', () => {
  // protects=the 1-3 click range; fails_when=a bound moves; no_claim=nothing about the selectors
  // Arrange
  const click = { title: 'Press', selector: '#go' }
  // Act
  const none = refusalOf(baselineConfiguration({ clicks: [] }))
  const four = refusalOf(
    baselineConfiguration({ clicks: [click, click, click, click] }),
  )
  // Assert
  assert.match(none.message, /^configuration\.clicks: /)
  assert.match(four.message, /^configuration\.clicks: /)
})

test('two inputs on the same selector in one click are refused', () => {
  // protects=CR8 distinct selectors; fails_when=duplicates are accepted; no_claim=selectors are valid CSS
  // Arrange
  const raw = baselineConfiguration({
    clicks: [
      {
        title: 'Type',
        selector: '#go',
        inputs: [
          { selector: '#q', text: 'a' },
          { selector: '#q', text: 'b' },
        ],
      },
    ],
  })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(
    refusal.message,
    'configuration.clicks[0].inputs: Input selectors must be distinct. See codebook://help/chrome-extension.',
  )
})

test('a dialog answer other than accept or dismiss is refused', () => {
  // protects=TZ11 dialog values; fails_when=any string is accepted; no_claim=dialog behavior at run time
  // Arrange
  const raw = baselineConfiguration({
    clicks: [{ title: 'Delete', selector: '#del', dialog: 'ignore' }],
  })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.match(refusal.message, /^configuration\.clicks\[0\]\.dialog: /)
})

test('five stops, a line of zero and an unknown context are each refused', () => {
  // protects=stop bounds 1-4, 1-based lines, two contexts; fails_when=a bound moves; no_claim=the lines exist
  // Arrange
  const stop = { path: 'popup/popup.js', line: 2, context: 'page' }
  // Act
  const five = refusalOf(
    baselineConfiguration({
      stops: [1, 2, 3, 4, 5].map((line) => ({ ...stop, line })),
    }),
  )
  const zero = refusalOf(
    baselineConfiguration({ stops: [{ ...stop, line: 0 }] }),
  )
  const context = refusalOf(
    baselineConfiguration({ stops: [{ ...stop, context: 'content-script' }] }),
  )
  // Assert
  assert.match(five.message, /^configuration\.stops: /)
  assert.match(zero.message, /^configuration\.stops\[0\]\.line: /)
  assert.match(context.message, /^configuration\.stops\[0\]\.context: /)
})

test('observe accepts text, storage and popup and refuses another kind', () => {
  // protects=the three observation kinds; fails_when=a kind is lost or added; no_claim=reads work
  // Arrange
  const kinds = [
    { kind: 'text', selector: '#out' },
    { kind: 'storage', key: 'mode' },
    { kind: 'popup' },
  ]
  // Act
  const accepted = kinds.map(
    (observe) =>
      chromeExtensionConfigSchema.safeParse(baselineConfiguration({ observe }))
        .success,
  )
  const refusal = refusalOf(baselineConfiguration({ observe: { kind: 'dom' } }))
  // Assert
  assert.deepEqual(accepted, [true, true, true])
  assert.match(refusal.message, /^configuration\.observe/)
})

test('a seed node with both a url and children is refused as SEED_INVALID naming the node and the field', () => {
  // protects=SR5 seed edge; fails_when=both are accepted or the wrong code is used; no_claim=the tree is written to a profile
  // Arrange
  const raw = seedOf([
    {
      title: 'Work',
      children: [
        {
          title: 'Docs',
          url: 'https://example.com/',
          children: [{ title: 'Deep' }],
        },
      ],
    },
  ])
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'SEED_INVALID')
  assert.equal(
    refusal.message,
    'Seed node Work/Docs has both a url and children. Change configuration.seed.bookmarks[0].children[0]. See codebook://help/chrome-extension.',
  )
})

test('a seed url that is not http or https is refused as SEED_INVALID', () => {
  // protects=SR5 url scheme; fails_when=javascript: or file: urls are accepted; no_claim=url reachability
  // Arrange
  const raw = seedOf([{ title: 'Local', url: 'file:///etc/passwd' }])
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'SEED_INVALID')
  assert.equal(
    refusal.message,
    'Seed node Local needs an http or https url. Change configuration.seed.bookmarks[0].url. See codebook://help/chrome-extension.',
  )
})

test('a seed node with neither url nor children is an empty folder and is accepted', () => {
  // protects=SR25 empty folders; fails_when=an empty folder is refused; no_claim=Chrome shows it
  // Arrange
  const raw = seedOf([{ title: 'Empty' }])
  // Act
  const result = chromeExtensionConfigSchema.safeParse(raw)
  // Assert
  assert.equal(result.success, true)
})

test('201 seed nodes are refused and 200 are accepted', () => {
  // protects=the 200-node limit; fails_when=the limit moves; no_claim=memory use
  // Arrange
  const nodes = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ title: `n${index}` }))
  // Act
  const accepted = chromeExtensionConfigSchema.safeParse(seedOf(nodes(200)))
  const refusal = refusalOf(seedOf(nodes(201)))
  // Assert
  assert.equal(accepted.success, true)
  assert.equal(refusal.code, 'SEED_INVALID')
  assert.equal(
    refusal.message,
    'The seed holds more than 200 bookmark nodes. Change configuration.seed.bookmarks. See codebook://help/chrome-extension.',
  )
})

test('a seed tree nested seven levels deep is refused and six levels are accepted', () => {
  // protects=the depth limit of 6; fails_when=the limit moves; no_claim=nothing about width
  // Arrange
  const nested = (depth: number): unknown =>
    depth === 1
      ? { title: 'leaf' }
      : { title: `d${depth}`, children: [nested(depth - 1)] }
  // Act
  const accepted = chromeExtensionConfigSchema.safeParse(seedOf([nested(6)]))
  const refusal = refusalOf(seedOf([nested(7)]))
  // Assert
  assert.equal(accepted.success, true)
  assert.equal(refusal.code, 'SEED_INVALID')
  assert.match(
    refusal.message,
    /^Seed node d7\/d6\/d5\/d4\/d3\/d2\/leaf is nested deeper than 6 levels\./,
  )
})

test('a seed title of 257 characters and a url of 2049 characters are refused as SEED_INVALID', () => {
  // protects=title and url limits; fails_when=a limit moves; no_claim=display
  // Arrange
  const longTitle = seedOf([{ title: 't'.repeat(257) }])
  const longUrl = seedOf([
    { title: 'u', url: `https://example.com/${'p'.repeat(2_049)}` },
  ])
  // Act
  const titleRefusal = refusalOf(longTitle)
  const urlRefusal = refusalOf(longUrl)
  // Assert
  assert.equal(titleRefusal.code, 'SEED_INVALID')
  assert.equal(urlRefusal.code, 'SEED_INVALID')
})

test('seed storage with 51 keys or more than 64 KiB as JSON is refused as SEED_INVALID', () => {
  // protects=storage limits; fails_when=a limit moves; no_claim=the storage area accepts the values
  // Arrange
  const manyKeys = Object.fromEntries(
    Array.from({ length: 51 }, (_, index) => [`k${index}`, index]),
  )
  const bigValue = { big: 'x'.repeat(65_537) }
  // Act
  const keysRefusal = refusalOf(
    baselineConfiguration({ seed: { storage: manyKeys } }),
  )
  const sizeRefusal = refusalOf(
    baselineConfiguration({ seed: { storage: bigValue } }),
  )
  // Assert
  assert.equal(
    keysRefusal.message,
    'The seed storage holds more than 50 keys. Change configuration.seed.storage. See codebook://help/chrome-extension.',
  )
  assert.equal(
    sizeRefusal.message,
    'The seed storage is larger than 65536 bytes as JSON. Change configuration.seed.storage. See codebook://help/chrome-extension.',
  )
})

test('acknowledgedPermissions accepts a list of strings', () => {
  // protects=ER5 start argument; fails_when=the key is unknown; no_claim=the list matches the manifest
  // Arrange
  const raw = baselineConfiguration({ acknowledgedPermissions: ['debugger'] })
  // Act
  const configuration = chromeExtensionConfigSchema.parse(raw)
  // Assert
  assert.deepEqual(configuration.acknowledgedPermissions, ['debugger'])
})

test('a seed issue and a non-seed issue in one configuration are both worded and the code stays SEED_INVALID', () => {
  // protects=A11/CR-A2 one answer lets the agent fix every violation; fails_when=non-seed issues are dropped or the code changes; no_claim=other codes
  // Arrange
  const raw = baselineConfiguration({
    clicks: [{ title: 't'.repeat(81), selector: '#go' }],
    seed: { bookmarks: [{ title: 'Local', url: 'file:///etc/passwd' }] },
  })
  // Act
  const refusal = refusalOf(raw)
  // Assert
  assert.equal(refusal.code, 'SEED_INVALID')
  assert.match(
    refusal.message,
    /Seed node Local needs an http or https url\. Change configuration\.seed\.bookmarks\[0\]\.url\./,
  )
  assert.match(refusal.message, /configuration\.clicks\[0\]\.title: /)
})

test('acknowledgedPermissions allows 100 entries of 256 characters and refuses 101 entries or 257 characters', () => {
  // protects=CR-A1 limits keep their values after moving to constants; fails_when=a limit changes; no_claim=entries are real permissions
  // Arrange
  const accepts = (entries: string[]) =>
    chromeExtensionConfigSchema.safeParse(
      baselineConfiguration({ acknowledgedPermissions: entries }),
    ).success
  // Act
  const results = [
    accepts(Array.from({ length: 100 }, (_, index) => `p${index}`)),
    accepts(Array.from({ length: 101 }, (_, index) => `p${index}`)),
    accepts(['x'.repeat(256)]),
    accepts(['x'.repeat(257)]),
  ]
  // Assert
  assert.deepEqual(results, [true, false, true, false])
})
