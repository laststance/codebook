import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hideTrailingRootPrefix } from '../utils/hideTrailingRootPrefix'
import { hidePrivateRoots } from '../utils/sanitizeCause'

const POSIX_ROOTS = { storage: [], home: '/Users/ada' }

// protects=a text the capture did not cut is returned as it came, even when it shows a root's start; fails_when=an uncut text is rewritten; no_claim=whole roots (those are hidden by the root hider)
test('a text without the truncation marker is returned unchanged', () => {
  // Arrange
  const text = 'x /Users/ad'

  // Act
  const result = hideTrailingRootPrefix(text, POSIX_ROOTS)

  // Assert
  assert.equal(result, 'x /Users/ad')
})

// protects=a cut inside the home path past the shared folder reads as the home placeholder; fails_when=the visible start of a private name survives the cut; no_claim=Windows roots
test('a home path cut inside the user name is replaced by the home placeholder', () => {
  // Arrange
  const text = 'x /Users/ad… [truncated]'

  // Act
  const result = hideTrailingRootPrefix(text, POSIX_ROOTS)

  // Assert
  assert.equal(result, 'x ~… [truncated]')
})

// protects=a tail that shows only the shared folder is kept; fails_when=ordinary text ending in the shared folder is rewritten; no_claim=roots without a shared folder
test('a cut that stays within the shared users folder is kept', () => {
  // Arrange
  const text = 'x /Users/… [truncated]'

  // Act
  const result = hideTrailingRootPrefix(text, POSIX_ROOTS)

  // Assert
  assert.equal(result, 'x /Users/… [truncated]')
})

// protects=a fragment that begins both the home and a workspace inside it reads as the most general placeholder; fails_when=the workspace placeholder is chosen for a fragment that is also the home; no_claim=fragments past the home
test('a fragment that begins nested roots reads as the most general placeholder', () => {
  // Arrange
  const roots = {
    storage: [],
    home: '/Users/ada',
    workspace: '/Users/ada/repo',
  }

  // Act
  const result = hideTrailingRootPrefix('x /Users/ad… [truncated]', roots)

  // Assert
  assert.equal(result, 'x ~… [truncated]')
})

// protects=a fragment past the home that begins only the workspace reads as the workspace placeholder; fails_when=the cut workspace name survives; no_claim=nested roots reached by the home
test('a workspace cut past the home reads as the workspace placeholder', () => {
  // Arrange
  const roots = {
    storage: [],
    home: '/Users/ada',
    workspace: '/Users/ada/repo',
  }

  // Act
  const result = hideTrailingRootPrefix('x /Users/ada/re… [truncated]', roots)

  // Assert
  assert.equal(result, 'x <workspace>… [truncated]')
})

// protects=a candidate that starts inside a longer name is not taken for a root; fails_when=text such as abc/Users/ad is rewritten; no_claim=names after a separator
test('a candidate that starts inside a name is not hidden', () => {
  // Arrange
  const text = 'abc/Users/ad… [truncated]'

  // Act
  const result = hideTrailingRootPrefix(text, POSIX_ROOTS)

  // Assert
  assert.equal(result, 'abc/Users/ad… [truncated]')
})

// protects=a Windows root matches without case and with mixed separators; fails_when=a differently cased or slashed fragment of the user name survives; no_claim=doubled separators
test('a Windows root fragment with other case and mixed separators is hidden', () => {
  // Arrange
  const roots = { storage: [], home: 'C:\\Users\\ada' }

  // Act
  const result = hideTrailingRootPrefix('v c:/USERS\\ad… [truncated]', roots)

  // Assert
  assert.equal(result, 'v ~… [truncated]')
})

// protects=a storage root's cut start reads as the storage placeholder; fails_when=the storage folder's name or id fragment survives; no_claim=Windows storage roots
test('a storage root fragment is replaced by the storage placeholder', () => {
  // Arrange
  const roots = { storage: ['/tmp/store/abc123'] }

  // Act
  const result = hideTrailingRootPrefix('s /tmp/store/ab… [truncated]', roots)

  // Assert
  assert.equal(result, 's <storage>… [truncated]')
})

// protects=an escaped Windows path (every separator doubled) cut inside the storage id hides the whole fragment even when its raw length passes the longest root; fails_when=the scan window is measured before the separator runs collapse and the id fragment abc12 survives; no_claim=roots without Windows spelling
test('a doubled-separator storage fragment is hidden whole', () => {
  // Arrange
  const roots = {
    home: 'C:\\Users\\ada',
    workspace: 'C:\\Users\\ada\\repo',
    storage: ['C:\\Users\\ada\\AppData\\Code\\workspaceStorage\\abc123'],
  }
  const tail = String.raw`C:\\Users\\ada\\AppData\\Code\\workspaceStorage\\abc12`
  const text = `pad ${tail}… [truncated]`

  // Act
  const result = hidePrivateRoots(hideTrailingRootPrefix(text, roots), roots)

  // Assert
  assert.equal(result, 'pad <storage>… [truncated]')
})

// protects=an escaped workspace path cut inside a folder name hides the partial name; fails_when=the doubled separators push the start of the root out of the scan window and sr survives; no_claim=roots without Windows spelling
test('a doubled-separator workspace fragment is hidden whole', () => {
  // Arrange
  const roots = {
    storage: [],
    workspace: 'C:\\Users\\ada\\proj\\src',
  }
  const tail = String.raw`C:\\Users\\ada\\proj\\sr`
  const text = `see ${tail}… [truncated]`

  // Act
  const result = hideTrailingRootPrefix(text, roots)

  // Assert
  assert.equal(result, 'see <workspace>… [truncated]')
})
