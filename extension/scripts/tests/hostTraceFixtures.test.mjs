import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixtureFolder = fileURLToPath(
  new URL('../../src/tests/fixtures/host-traces/', import.meta.url),
)
const fixtureNames = readdirSync(fixtureFolder).filter((name) =>
  name.endsWith('.jsonl'),
)

/** Every string value and object key of a parsed JSON value. */
function strings(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...strings(item),
    ])
  return []
}

/** Names the first thing a string reveals that a public fixture must not hold, or `undefined`. */
function revealOf(text) {
  if (/(?:^|[\s"'(=:,;])\/[^\s/]+(?:\/|$)/.test(text)) return 'a POSIX path'
  if (/(?:^|[\s"'(=:,;])[A-Za-z]:[\\/]/.test(text)) return 'a Windows path'
  if (/\\\\[^\\\s]+\\/.test(text)) return 'a UNC path'
  if (/(?:^|[\s"'(=:,;])~[^\s/\\]*[\\/]/.test(text)) return 'a home path'
  if (text.includes('/Users/')) return '/Users/'
  if (/(?<![A-Za-z0-9_])lume(?![A-Za-z0-9_])/i.test(text)) return 'lume'
  return undefined
}

// Value: protects=every committed host trace fixture staying free of the recording machine's paths and names; fails_when=a fixture line holds an absolute path (POSIX, Windows, UNC, ~), /Users/ or the user lume; why_new=Cycle 0094 task 12 review finding (fixture scan); seam=the committed fixture files; no_claim=names the detector does not describe (the sanitizer command refuses a take with them)
test('no committed host trace fixture holds an absolute path, /Users/ or the recording machine user', () => {
  // Arrange
  const leaks = []

  // Act
  for (const name of fixtureNames)
    readFileSync(`${fixtureFolder}${name}`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line, index) => {
        for (const text of strings(JSON.parse(line))) {
          const reveal = revealOf(text)
          if (reveal) leaks.push(`${name}:${index + 1} ${reveal}`)
        }
      })

  // Assert
  assert.equal(fixtureNames.length, 4)
  assert.deepEqual(leaks, [])
})

// Value: protects=Cursor chat tab titles (user prompts) staying out of committed traces; fails_when=a fixture tab without a resource and of kind unknown or terminal keeps a label other than its kind; why_new=Cycle 0094 task 12 review finding (fixture scan); seam=the committed fixture files; no_claim=webview tab labels, which stay
test('no committed host trace fixture keeps the label of a resource-less unknown or terminal tab', () => {
  // Arrange
  const labelled = []
  const resourceLess = (kind) => kind === 'unknown' || kind === 'terminal'

  // Act
  for (const name of fixtureNames)
    readFileSync(`${fixtureFolder}${name}`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line, index) => {
        const { kind, data } = JSON.parse(line)
        // Only snapshots hold tabs (an editorLayout event has groups of sizes).
        const tabs =
          kind === 'tabGroups' ? data.groups.flatMap((group) => group.tabs) : []
        for (const tab of tabs)
          if (
            resourceLess(tab.input.kind) &&
            !tab.input.uri &&
            tab.label !== tab.input.kind
          )
            labelled.push(`${name}:${index + 1} ${tab.label}`)
        if (kind === 'tabsChanged')
          for (const entry of [...data.opened, ...data.closed, ...data.changed])
            if (
              resourceLess(entry.inputKind) &&
              entry.label !== entry.inputKind
            )
              labelled.push(`${name}:${index + 1} ${entry.label}`)
      })

  // Assert
  assert.deepEqual(labelled, [])
})
