import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  watchWikiUpdateSigns,
  type WikiUpdateSignEvents,
} from '../utils/watchWikiUpdateSigns'

const PLACES = {
  outputDirectory: '/repo/.codebook/wiki',
  skillDirectory: '/extensions/codebook/skills/codebook',
}

type DocumentListener = Parameters<
  WikiUpdateSignEvents['onDidOpenTextDocument']
>[0]
type CommandListener = Parameters<
  WikiUpdateSignEvents['onDidStartTerminalShellExecution']
>[0]

/** An editor that keeps the listeners it was given and counts the disposed ones. */
function fakeEditor(): {
  events: WikiUpdateSignEvents
  documentListeners: DocumentListener[]
  commandListeners: CommandListener[]
  disposed: string[]
} {
  const documentListeners: DocumentListener[] = []
  const commandListeners: CommandListener[] = []
  const disposed: string[] = []
  return {
    documentListeners,
    commandListeners,
    disposed,
    events: {
      onDidOpenTextDocument: (listener) => {
        documentListeners.push(listener)
        return { dispose: (): number => disposed.push('documents') }
      },
      onDidStartTerminalShellExecution: (listener) => {
        commandListeners.push(listener)
        return { dispose: (): number => disposed.push('commands') }
      },
    },
  }
}

// Value: protects=the bound of the first sign against documents that are nobody's read of the Wiki; fails_when=a document that is no file (an output channel, an untitled buffer, a chat's code block) with a path like the manifest's counts as a sign, or the manifest opened as a file no longer does; why_new=Cycle 0046 row 150 (the filter on file documents was untested); seam=none
test('the Wiki’s manifest opened as a file is reported as a sign, and a document that is no file is not, whatever its path', () => {
  // Arrange
  const editor = fakeEditor()
  let signs = 0
  watchWikiUpdateSigns(editor.events, PLACES, () => {
    signs += 1
  })
  const openDocument = editor.documentListeners[0]

  // Act
  openDocument?.({
    uri: {
      scheme: 'output',
      fsPath: '/repo/.codebook/wiki/codebook-wiki.json',
    },
  })
  openDocument?.({
    uri: {
      scheme: 'untitled',
      fsPath: '/repo/.codebook/wiki/codebook-wiki.json',
    },
  })
  const signsOfDocumentsThatAreNoFiles = signs
  openDocument?.({
    uri: { scheme: 'file', fsPath: '/repo/.codebook/wiki/codebook-wiki.json' },
  })

  // Assert
  assert.equal(signsOfDocumentsThatAreNoFiles, 0)
  assert.equal(signs, 1)
})

// Value: protects=the bound of the first sign while the learner uses a terminal; fails_when=every command a terminal starts is reported, or the publisher's command is not; why_new=Cycle 0046 row 146; seam=none
test('a terminal that starts the publisher is reported as a sign, and one that starts the learner’s tests is not', () => {
  // Arrange
  const editor = fakeEditor()
  let signs = 0
  watchWikiUpdateSigns(editor.events, PLACES, () => {
    signs += 1
  })
  const startCommand = editor.commandListeners[0]

  // Act
  startCommand?.({ execution: { commandLine: { value: 'pnpm test' } } })
  const signsOfTheLearnersCommand = signs
  startCommand?.({
    execution: {
      commandLine: {
        value:
          'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project . --output .codebook/wiki',
      },
    },
  })

  // Assert
  assert.equal(signsOfTheLearnersCommand, 0)
  assert.equal(signs, 1)
})

// Value: protects=the editor's listeners when the second one cannot be registered (an editor without the terminal's shell events); fails_when=the listener for documents stays registered for good after the start failed; why_new=Cycle 0046 row 151; seam=none
test('when the listener for commands cannot be registered the listener for documents is disposed and the editor’s error is thrown', () => {
  // Arrange
  const editor = fakeEditor()
  const events: WikiUpdateSignEvents = {
    ...editor.events,
    onDidStartTerminalShellExecution: () => {
      throw new Error('The editor has no shell events.')
    },
  }

  // Act
  const thrown = ((): string => {
    try {
      watchWikiUpdateSigns(events, PLACES, () => {})
      return 'nothing was thrown'
    } catch (error) {
      return error instanceof Error ? error.message : 'no error object'
    }
  })()

  // Assert
  assert.equal(thrown, 'The editor has no shell events.')
  assert.deepEqual(editor.disposed, ['documents'])
})
