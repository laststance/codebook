import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isEditorOfDebugSource } from '../runtimeSupport/utils/isEditorOfDebugSource'

// Value: protects=the hand-over at the opening of a paused file on disk; fails_when=the document the editor opens for a source with an absolute path is not recognized, so the hand-over waits for the frame and the keyboard stays on the window body longer, or another file is taken for it and gets the keyboard; why_new=Cycle 0046, the fast path of finding 603's hand-over (lvt: VS Code 1.140.0 workbench line 694 col 16858); seam=none
test('a source with an absolute path is the file of that path, with case only where the file system keeps it', () => {
  // Arrange: one file on Linux, macOS and Windows, and another file on Linux.
  const cases = [
    {
      uri: {
        scheme: 'file',
        path: '/app/actions.ts',
        query: '',
        fsPath: '/app/actions.ts',
      },
      source: { path: '/app/actions.ts' },
      platform: 'linux' as const,
    },
    {
      uri: {
        scheme: 'file',
        path: '/app/Actions.ts',
        query: '',
        fsPath: '/app/Actions.ts',
      },
      source: { path: '/app/actions.ts' },
      platform: 'linux' as const,
    },
    {
      uri: {
        scheme: 'file',
        path: '/Users/learner/App/actions.ts',
        query: '',
        fsPath: '/Users/learner/App/actions.ts',
      },
      source: { path: '/Users/learner/app/actions.ts' },
      platform: 'darwin' as const,
    },
    {
      uri: {
        scheme: 'file',
        path: '/c:/app/actions.ts',
        query: '',
        fsPath: 'c:\\app\\actions.ts',
      },
      source: { path: 'C:\\app\\actions.ts' },
      platform: 'win32' as const,
    },
    {
      uri: {
        scheme: 'file',
        path: '/app/notes.ts',
        query: '',
        fsPath: '/app/notes.ts',
      },
      source: { path: '/app/actions.ts' },
      platform: 'linux' as const,
    },
  ]

  // Act
  const shown = cases.map(({ uri, source, platform }) =>
    isEditorOfDebugSource(uri, source, 'learner-node', platform),
  )

  // Assert
  assert.deepEqual(shown, [true, false, true, true, false])
})

// Value: protects=the hand-over at the opening of a paused file the adapter serves by reference (Node's own code, a page script without a file); fails_when=the debug: document of that session and reference is not recognized, or one of another session or reference is taken for it; why_new=Cycle 0046, the fast path of finding 603's hand-over; seam=none
test('a source served by reference is the debug document of that session and reference', () => {
  // Arrange: js-debug's source of Node's timers, by reference 9 of the learner's session.
  const source = { path: '<node_internals>/timers', sourceReference: 9 }
  const documents = [
    {
      scheme: 'debug',
      path: '<node_internals>/timers',
      query: 'session=learner-node&ref=9',
      fsPath: '<node_internals>/timers',
    },
    {
      scheme: 'debug',
      path: '<node_internals>/timers',
      query: 'session=learner-worker&ref=9',
      fsPath: '<node_internals>/timers',
    },
    {
      scheme: 'file',
      path: '<node_internals>/timers',
      query: '',
      fsPath: '<node_internals>/timers',
    },
  ]

  // Act
  const shown = documents.map((uri) =>
    isEditorOfDebugSource(uri, source, 'learner-node', 'linux'),
  )

  // Assert
  assert.deepEqual(shown, [true, false, false])
})

// Value: protects=the keyboard at the opening of a document whose source the editor maps by a rule the reader does not compare; fails_when=a path the editor parses as a URI, or a relative path, is matched against a file, and an unrelated document gets the keyboard before the frame; why_new=Cycle 0046, the fast path of finding 603's hand-over (such a stop waits for its frame); seam=none
test('a source whose path is a URI or relative is no file the reader recognizes at its opening', () => {
  // Arrange
  const uri = {
    scheme: 'file',
    path: '/app/webpack:/src/page.tsx',
    query: '',
    fsPath: '/app/webpack:/src/page.tsx',
  }
  const sources = [
    { path: 'webpack://app/src/page.tsx' },
    { path: 'src/page.tsx' },
  ]

  // Act
  const shown = sources.map((source) =>
    isEditorOfDebugSource(uri, source, 'learner-node', 'linux'),
  )

  // Assert
  assert.deepEqual(shown, [false, false])
})
