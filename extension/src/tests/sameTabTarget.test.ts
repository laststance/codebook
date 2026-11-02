import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Tab } from 'vscode'

import { sameTabTarget } from '../utils/sameTabTarget'

/** A resource as far as {@link sameTabTarget} reads it: its text. */
type FakeUri = { toString: () => string }

/** A diff editor's tab input, as the editors export it: both sides' resources. */
class FakeDiffInput {
  constructor(
    readonly original: FakeUri,
    readonly modified: FakeUri,
  ) {}
}

/** A webview's or custom editor's tab input: the kind of view and, for a custom editor, its resource. */
class FakeViewInput {
  constructor(
    readonly viewType: string,
    readonly uri?: FakeUri,
  ) {}
}

/**
 * Builds a resource whose text is the given address.
 * @param address - The resource's text.
 * @returns A resource with that text; two calls with one address give two objects, as the editors give new objects for the same resource.
 * @example uri('file:///app/index.ts').toString() // => 'file:///app/index.ts'
 */
function uri(address: string): FakeUri {
  return { toString: () => address }
}

/**
 * Builds a tab as far as {@link sameTabTarget} reads it: its label and its input.
 * @param label - The tab's label.
 * @param input - The tab's input, `undefined` for a tab the editor gives none (Cursor's chat).
 * @returns The tab.
 * @example tab('index.ts (Working Tree)', new FakeDiffInput(uri('git:///a'), uri('file:///a')))
 */
function tab(label: string, input?: object): Tab {
  // The editor's tab has a group and flags the comparison never reads; the test needs the label and the input.
  return { label, input } as Tab
}

// Value: protects=the return's lookup of the learner's tab finds the very tab object first; fails_when=an object is compared by label and input again and a tab is told apart from itself once its input has no member to compare; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a tab object is the same editor as itself', () => {
  // Arrange
  const chat = tab('New Agent')
  // Act
  const same = sameTabTarget(chat, chat)
  // Assert
  assert.equal(same, true)
})

// Value: protects=a tab the editor re-created as a new object (Cursor does for every change of a group) is still the learner's pick; fails_when=tabs are told apart by object alone, so the return's own re-show of the pick is recorded as a newer pick; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a new tab object for the same diff of the same files is the same editor', () => {
  // Arrange
  const before = tab(
    'index.ts (Working Tree)',
    new FakeDiffInput(uri('git:///app/index.ts'), uri('file:///app/index.ts')),
  )
  const after = tab(
    'index.ts (Working Tree)',
    new FakeDiffInput(uri('git:///app/index.ts'), uri('file:///app/index.ts')),
  )
  // Act
  const same = sameTabTarget(before, after)
  // Assert
  assert.equal(same, true)
})

// Value: protects=two text-resource tabs of one label stay two editors; fails_when=tabs are compared by label and kind of input alone, so the second of two index.ts of different folders is taken for the first; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('two custom editors of the same label for different files are different editors', () => {
  // Arrange
  const first = tab(
    'diagram.png',
    new FakeViewInput(
      'imagePreview.previewEditor',
      uri('file:///docs/diagram.png'),
    ),
  )
  const second = tab(
    'diagram.png',
    new FakeViewInput(
      'imagePreview.previewEditor',
      uri('file:///assets/diagram.png'),
    ),
  )
  // Act
  const same = sameTabTarget(first, second)
  // Assert
  assert.equal(same, false)
})

// Value: protects=two diffs of the same label whose originals differ stay two editors; fails_when=a diff is compared by its modified side or its label alone, so the diff against another commit or folder is taken for this one; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('two diffs of the same label with different originals are different editors', () => {
  // Arrange
  const againstHead = tab(
    'index.ts (Working Tree)',
    new FakeDiffInput(
      uri('git:///app/index.ts?HEAD'),
      uri('file:///app/index.ts'),
    ),
  )
  const againstIndex = tab(
    'index.ts (Working Tree)',
    new FakeDiffInput(
      uri('git:///app/index.ts?index'),
      uri('file:///app/index.ts'),
    ),
  )
  // Act
  const same = sameTabTarget(againstHead, againstIndex)
  // Assert
  assert.equal(same, false)
})

// Value: protects=two webviews of one label are told apart by their view type; fails_when=a webview is compared by its label alone, so another extension's page of the same title is taken for the learner's pick; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('two webviews of the same label with different view types are different editors', () => {
  // Arrange
  const preview = tab('Preview', new FakeViewInput('markdown.preview'))
  const other = tab(
    'Preview',
    new FakeViewInput('mainThreadWebview-other.preview'),
  )
  // Act
  const same = sameTabTarget(preview, other)
  // Assert
  assert.equal(same, false)
})

// Value: protects=a webview the editor re-created keeps its identity by its view type; fails_when=webviews are never equal unless one object, so the return's re-show of a webview pick is recorded as a newer pick; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a new tab object for the same webview view type is the same editor', () => {
  // Arrange
  const before = tab('Preview', new FakeViewInput('markdown.preview'))
  const after = tab('Preview', new FakeViewInput('markdown.preview'))
  // Act
  const same = sameTabTarget(before, after)
  // Assert
  assert.equal(same, true)
})

// Value: protects=tabs of one label but another kind of input are two editors; fails_when=the kind of input is dropped from the comparison, so a webview titled like a diff is taken for it; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a diff and a webview of the same label are different editors', () => {
  // Arrange
  const diff = tab(
    'index.ts',
    new FakeDiffInput(uri('git:///app/index.ts'), uri('file:///app/index.ts')),
  )
  const webview = tab('index.ts', new FakeViewInput('markdown.preview'))
  // Act
  const same = sameTabTarget(diff, webview)
  // Assert
  assert.equal(same, false)
})

// Value: protects=Cursor's chat tab, which has no input, is still found again by its label; fails_when=a tab without input is never equal to another object, so the learner's chat pick cannot be brought back after the editor re-created it; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a new tab object without input and with the same label is the same editor', () => {
  // Arrange
  const before = tab('New Agent')
  const after = tab('New Agent')
  // Act
  const same = sameTabTarget(before, after)
  // Assert
  assert.equal(same, true)
})

// Value: protects=a missing tab is no editor; fails_when=two missing tabs are taken for the same editor, so a pick without a tab is counted as the re-show of another; why_new=Cycle 0072 /ship pass 1 (Codex structured P2, outside 3); seam=none; no_claim=none
test('a missing tab is not the same editor as another missing tab', () => {
  // Arrange
  const missing = undefined
  // Act
  const same = sameTabTarget(missing, undefined)
  // Assert
  assert.equal(same, false)
})
