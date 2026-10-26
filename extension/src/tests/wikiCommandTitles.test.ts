import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

// Value: protects=AC 13 and 3b, the LLM Wiki commands a learner finds in the Command Palette; fails_when=the open command keeps the DeepWiki title beside the LLM Wiki commands, the generate or stop command is not contributed, or the open command's id changes (keybindings and scripts use it); no_claim=what the commands do (host tests); seam=the packaged manifest
test('the Command Palette names the LLM Wiki commands Open LLM Wiki in Browser, Generate LLM Wiki, Update LLM Wiki, Stop LLM Wiki Run and Show LLM Wiki Output', async () => {
  // Arrange
  const manifest = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )

  // Act
  const titles = Object.fromEntries(
    manifest.contributes.commands
      .filter((command: { command: string }) =>
        [
          'codebook.openDeepWiki',
          'codebook.generateDeepWiki',
          'codebook.updateDeepWiki',
          'codebook.cancelWikiRun',
          'codebook.showWikiOutput',
        ].includes(command.command),
      )
      .map((command: { command: string; title: string }) => [
        command.command,
        command.title,
      ]),
  )

  // Assert
  assert.deepEqual(titles, {
    'codebook.openDeepWiki': 'Codebook: Open LLM Wiki in Browser',
    'codebook.generateDeepWiki': 'Codebook: Generate LLM Wiki',
    'codebook.updateDeepWiki': 'Codebook: Update LLM Wiki',
    'codebook.cancelWikiRun': 'Codebook: Stop LLM Wiki Run',
    'codebook.showWikiOutput': 'Codebook: Show LLM Wiki Output',
  })
})
