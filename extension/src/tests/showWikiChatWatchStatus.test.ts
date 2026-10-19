import assert from 'node:assert/strict'
import { test } from 'node:test'

import { showWikiChatWatchStatus } from '../utils/showWikiChatWatchStatus'

/** A status bar entry as a fake editor hands it out: what the utility sets on it, and whether it was shown or disposed. */
type FakeEntry = {
  name: string | undefined
  text: string
  tooltip: string | undefined
  accessibilityInformation: { label: string; role?: string } | undefined
  command: string | undefined
  isShown: boolean
  isDisposed: boolean
  show(): void
  dispose(): void
}

/**
 * Makes a fake editor window whose status bar records each entry it creates.
 * @returns The window to hand to the utility, and the entries it created with their identifier and side.
 * @example
 * const { window, created } = createFakeStatusBar()
 * created // => [] until the utility creates an entry
 */
function createFakeStatusBar(): {
  window: {
    createStatusBarItem(id: string, alignment: number): FakeEntry
  }
  created: Array<{ id: string; alignment: number; entry: FakeEntry }>
} {
  const created: Array<{ id: string; alignment: number; entry: FakeEntry }> = []
  return {
    created,
    window: {
      createStatusBarItem(id: string, alignment: number): FakeEntry {
        const entry: FakeEntry = {
          name: undefined,
          text: '',
          tooltip: undefined,
          accessibilityInformation: undefined,
          command: undefined,
          isShown: false,
          isDisposed: false,
          show(): void {
            entry.isShown = true
          },
          dispose(): void {
            entry.isShown = false
            entry.isDisposed = true
          },
        }
        created.push({ id, alignment, entry })
        return entry
      },
    },
  }
}

// Value: protects=the learner who answers the chat's approvals while Codebook watches a VS Code update, and who stops that watch; fails_when=the watch's entry is not shown, says something other than what is watched and that it is the Cancel, names a place of the request that is untrue for a chat the Chat view restored or for the chat that was open, runs another command than the watch's Cancel, or gives a screen reader the icon's name; why_new=Cycle 0046 row 592 (the watch's notification, stacked above another notification, covered the approval's Allow and Skip buttons; the watch moved into the status bar); seam=a fake window.createStatusBarItem
test('the watch of a VS Code update is one shown status bar entry on the right that says what is watched and names its Cancel, explains that Cancel stops watching and not the chat, and runs the watch’s Cancel when pressed', () => {
  // Arrange
  const { window, created } = createFakeStatusBar()

  // Act
  const shown = showWikiChatWatchStatus(window, 2)

  // Assert
  assert.deepEqual(
    created.map(({ id, alignment }) => ({ id, alignment })),
    [{ id: 'codebook.wikiChatWatch', alignment: 2 }],
  )
  assert.equal(shown, created[0]?.entry)
  assert.deepEqual(
    {
      name: shown.name,
      text: shown.text,
      tooltip: shown.tooltip,
      accessibilityInformation: shown.accessibilityInformation,
      command: shown.command,
      isShown: created[0]?.entry.isShown,
    },
    {
      name: 'Codebook LLM Wiki update',
      text: '$(sync~spin) Watching for the LLM Wiki update · Cancel',
      tooltip:
        'Watching the editor chat for the LLM Wiki update. Cancel stops watching, not the chat.',
      accessibilityInformation: {
        label:
          'Watching the editor chat for the LLM Wiki update. Cancel stops watching, not the chat.',
        role: 'button',
      },
      command: 'codebook.cancelWikiChatWatch',
      isShown: true,
    },
  )
  assert.deepEqual(
    ['new chat', 'chat that is open', 'restored'].filter(
      (place) =>
        shown.text.includes(place) || String(shown.tooltip).includes(place),
    ),
    [],
  )
})

// Value: protects=a status bar that holds no watch once the watch has ended; fails_when=the entry the utility hands back is another object than the one shown, so disposing it leaves the shown entry and its Cancel in the status bar; why_new=Cycle 0046 row 592; seam=a fake window.createStatusBarItem
test('disposing the entry of a VS Code watch takes it out of the status bar', () => {
  // Arrange
  const { window, created } = createFakeStatusBar()
  const shown = showWikiChatWatchStatus(window, 2)

  // Act
  shown.dispose()

  // Assert
  assert.deepEqual(
    created.map(({ entry }) => [entry.isShown, entry.isDisposed]),
    [[false, true]],
  )
})
