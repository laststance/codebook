import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { LLM_WIKI_ROW_ACTIONS } from '../constants'

type Manifest = {
  contributes: {
    viewsContainers: { activitybar: Array<{ id: string; icon: string }> }
    views: { codebook: Array<{ id: string; name: string }> }
    viewsWelcome: Array<{ view: string; when: string; contents: string }>
    commands: Array<{ command: string; title: string }>
    menus: Record<
      string,
      Array<{ command: string; when?: string; group?: string }>
    >
  }
}

const readManifest = async (): Promise<Manifest> =>
  JSON.parse(await readFile(resolve(__dirname, '../../package.json'), 'utf8'))

// Value: protects=AC 1, the empty state's welcome content by host; fails_when=a host's entry loses its none-state condition, the Generate LLM Wiki button on its own line, the host's runner sentence or the inline Change location settings link; no_claim=how the editor renders it (N55 step 1); seam=the packaged manifest
test('the LLM Wiki view’s welcome content shows only in the none state, per host, with a Generate button on its own line and a Change location link', async () => {
  // Arrange
  const manifest = await readManifest()

  // Act
  const entries = manifest.contributes.viewsWelcome.filter(
    (entry) => entry.view === 'codebook.llmWiki',
  )

  // Assert
  assert.deepEqual(
    entries.map((entry) => ({
      when: entry.when,
      lines: entry.contents.split('\n'),
    })),
    [
      {
        when: 'codebook.llmWiki.state == none && codebook.host == vscode',
        lines: [
          "Explore this project through source-linked chapters, diagrams and questions, written by your editor's AI.",
          '[Generate LLM Wiki](command:codebook.generateDeepWiki)',
          'It runs in a new Copilot Chat session and uses your chat plan. The chat asks you to approve its commands and may ask you to Continue; keep the Chat view open.',
          'The Wiki is written to the folder the setting codebook.wikiOutputDirectory names (default .codebook/wiki). [Change location](command:workbench.action.openSettings?%5B%22%40id%3Acodebook.wikiOutputDirectory%22%5D)',
        ],
      },
      {
        when: 'codebook.llmWiki.state == none && codebook.host == cursor',
        lines: [
          "Explore this project through source-linked chapters, diagrams and questions, written by your editor's AI.",
          '[Generate LLM Wiki](command:codebook.generateDeepWiki)',
          "It runs through Cursor's agent CLI (cursor-agent), uses your Cursor plan and can take several minutes. You can keep working.",
          'The Wiki is written to the folder the setting codebook.wikiOutputDirectory names (default .codebook/wiki). [Change location](command:workbench.action.openSettings?%5B%22%40id%3Acodebook.wikiOutputDirectory%22%5D)',
        ],
      },
    ],
  )
})

// Value: protects=task 5b and AC-ENTRY, two Activity Bar entries with one icon; fails_when=the Learning summary container uses the same icon file as the codebook container, or its file is missing; no_claim=how the icon looks (N55 step 1); seam=the packaged manifest
test('the two Activity Bar containers use different icon files', async () => {
  // Arrange
  const manifest = await readManifest()

  // Act
  const icons = Object.fromEntries(
    manifest.contributes.viewsContainers.activitybar.map((container) => [
      container.id,
      container.icon,
    ]),
  )
  const learningIcon = await readFile(
    resolve(__dirname, '../../src/assets/learning.svg'),
    'utf8',
  )

  // Assert
  assert.deepEqual(icons, {
    codebook: 'src/assets/book.svg',
    codebookLearning: 'src/assets/learning.svg',
  })
  assert.match(learningIcon, /viewBox="0 0 24 24"/)
  assert.match(learningIcon, /currentColor/)
})

// Value: protects=AC 2 (the view sits after Repository Wiki in the codebook container) and keyboard access; fails_when=the view is missing, comes before Repository Wiki, or a row action has no command, no inline entry or no context-menu entry; no_claim=the rows' when conditions at runtime (host tests); seam=the packaged manifest
test('the LLM Wiki view follows Repository Wiki and every row action is a contributed command with an inline and a context-menu entry', async () => {
  // Arrange
  const manifest = await readManifest()
  const commandIds = new Set(
    manifest.contributes.commands.map((command) => command.command),
  )
  const itemMenu = manifest.contributes.menus['view/item/context'] ?? []

  // Act
  const missing = Object.entries(LLM_WIKI_ROW_ACTIONS).flatMap(
    ([key, action]) => {
      const entries = itemMenu.filter(
        (entry) =>
          entry.command === action.command &&
          entry.when?.includes(`\\[${key}\\]`) === true,
      )
      return [
        commandIds.has(action.command) ? [] : [`${key}: no command`],
        entries.some((entry) => entry.group?.startsWith('inline@'))
          ? []
          : [`${key}: no inline entry`],
        entries.some((entry) => entry.group?.startsWith('llmWiki@'))
          ? []
          : [`${key}: no context-menu entry`],
      ].flat()
    },
  )

  // Assert
  assert.deepEqual(
    manifest.contributes.views.codebook.map((view) => view.id),
    ['codebook.repositoryWiki', 'codebook.llmWiki', 'codebook.learningOutline'],
  )
  assert.deepEqual(missing, [])
  assert.deepEqual(
    manifest.contributes.menus['view/title']?.filter(
      (entry) => entry.command === 'codebook.refreshLlmWiki',
    ),
    [
      {
        command: 'codebook.refreshLlmWiki',
        when: 'view == codebook.llmWiki',
        group: 'navigation',
      },
    ],
  )
})

// Value: protects=the Command Palette of an editor that offers no tree view; fails_when=Refresh LLM Wiki, Copy LLM Wiki Recovery Request or Reveal LLM Wiki Folder is listed in the palette without the view that registers it (the view sets codebook.llmWiki.state), so choosing one says "command not found"; no_claim=that the editor hides them (host trial); seam=the packaged manifest
test('the palette lists the commands that exist only with the LLM Wiki view only while the view has set its state key', async () => {
  // Arrange
  const manifest = await readManifest()
  const palette = manifest.contributes.menus.commandPalette ?? []

  // Act
  const whenByCommand = Object.fromEntries(
    [
      'codebook.refreshLlmWiki',
      'codebook.copyWikiRecoveryRequest',
      'codebook.revealWikiFolder',
    ].map((command) => [
      command,
      palette.find((entry) => entry.command === command)?.when,
    ]),
  )

  // Assert
  assert.deepEqual(whenByCommand, {
    'codebook.refreshLlmWiki': 'codebook.llmWiki.state',
    'codebook.copyWikiRecoveryRequest': 'codebook.llmWiki.state',
    'codebook.revealWikiFolder': 'codebook.llmWiki.state',
  })
})
