import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

type MenuEntry = { command: string; when?: string; group?: string }
type Manifest = {
  contributes: {
    commands: Array<{
      command: string
      title: string
      category?: string
      icon?: string
    }>
    keybindings: Array<{ command: string; key: string; when?: string }>
    menus: Record<string, MenuEntry[]>
  }
}

const COMMAND = 'codebook.showKeyboardShortcuts'

async function readManifest(): Promise<Manifest> {
  return JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
}

// Value: protects=a learner finding Keyboard shortcuts as Codebook: Keyboard shortcuts with a question-mark icon; fails_when=the command, its title, its Codebook category or its question icon is missing or changed, or the Command Palette entry is hidden; no_claim=that the host shows the icon or lists the command (native checks own that)
test('the Command Palette offers Codebook: Keyboard shortcuts with the question-mark icon', async () => {
  // Arrange
  const manifest = await readManifest()

  // Act
  const commands = manifest.contributes.commands.filter(
    (entry) => entry.command === COMMAND,
  )
  const paletteEntries = (
    manifest.contributes.menus.commandPalette ?? []
  ).filter((entry) => entry.command === COMMAND)

  // Assert
  assert.deepEqual(commands, [
    {
      command: COMMAND,
      title: 'Keyboard shortcuts',
      category: 'Codebook',
      icon: '$(question)',
    },
  ])
  assert.deepEqual(paletteEntries, [{ command: COMMAND }])
})

// Value: protects=? typed in Codebook's three native views opening the list while ? still types in text boxes, the Study webviews and other editors; fails_when=the key is not shift+/, the clause names a webview view or any other view, or drops !inputFocus; no_claim=that the host honors the clause (native checks own that)
test('the ? key opens Keyboard shortcuts only in the three native views and outside inputs', async () => {
  // Arrange
  const manifest = await readManifest()

  // Act
  const bindings = manifest.contributes.keybindings.filter(
    (entry) => entry.command === COMMAND,
  )

  // Assert
  assert.deepEqual(bindings, [
    {
      command: COMMAND,
      key: 'shift+/',
      when: 'focusedView =~ /^codebook\\.(repositoryWiki|llmWiki|learningOutline)$/ && !inputFocus',
    },
  ])
})

// Value: protects=the visible ? control in the title bar of each of Codebook's three native views, last in the bar; fails_when=a view loses its control, the control moves from the last navigation slot, or it appears on another view; no_claim=how the host draws the control or its tooltip (native checks own that)
test('each native view has the Keyboard shortcuts control last in its title bar', async () => {
  // Arrange
  const manifest = await readManifest()

  // Act
  const titleEntries = (manifest.contributes.menus['view/title'] ?? []).filter(
    (entry) => entry.command === COMMAND,
  )

  // Assert
  assert.deepEqual(titleEntries, [
    {
      command: COMMAND,
      when: 'view == codebook.repositoryWiki',
      group: 'navigation@99',
    },
    {
      command: COMMAND,
      when: 'view == codebook.llmWiki',
      group: 'navigation@99',
    },
    {
      command: COMMAND,
      when: 'view == codebook.learningOutline',
      group: 'navigation@99',
    },
  ])
})
