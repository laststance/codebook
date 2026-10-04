import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

import configuration from '../../eslint.config.mjs'

const extensionRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Lints one text as a source of the extension with the repository's rule on editor texts alone, so a case needs neither a file on disk nor the type-aware rules.
 * @param code - The TypeScript text.
 * @param filePath - Where the text would stand, from the extension folder; the rule's own `files` and `ignores` decide whether it applies.
 * @returns The reported message ids in the order of the text.
 * @example
 * await reportedBy('vscode.window.showErrorMessage(text)') // => ['notice']
 */
async function reportedBy(code, filePath = 'src/sample.ts') {
  // The parser comes from the shared configuration and the rule from the repository's own block, so the test follows both.
  const parser = configuration.find((block) => block.languageOptions?.parser)
    .languageOptions.parser
  const ruleBlock = configuration.find(
    (block) => block.rules?.['codebook/plain-editor-texts'],
  )
  const eslint = new ESLint({
    cwd: extensionRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser } },
      ruleBlock,
    ],
  })
  const [result] = await eslint.lintText(code, { filePath })
  assert.deepEqual(
    result.messages.filter((message) => message.fatal),
    [],
  )
  return result.messages.map((message) => message.messageId)
}

test('a notification the extension shows directly is reported, and a modal confirmation is not', async () => {
  // Act
  const reported = {
    plainError: await reportedBy('vscode.window.showErrorMessage(text)'),
    plainWithButtons: await reportedBy(
      "vscode.window.showInformationMessage(text, 'Open')",
    ),
    nonModalOptions: await reportedBy(
      "vscode.window.showWarningMessage(text, { detail }, 'Update')",
    ),
    modalConfirmation: await reportedBy(
      "vscode.window.showWarningMessage(text, { modal: true, detail }, 'Update')",
    ),
  }

  // Assert
  assert.deepEqual(reported, {
    plainError: ['notice'],
    plainWithButtons: ['notice'],
    nonModalOptions: ['notice'],
    modalConfirmation: [],
  })
})

// Value: protects=the rule that only showNotice and registerPlainCommand hand a text to the editor, which keeps `[label](command:…)` in a path, a setting or an error from becoming a link that runs a command; fails_when=the rule matches the plain member call only, so a bracketed, destructured or bound call, registerTextEditorCommand, and a notification with `modal: true` somewhere inside its message pass; why_new=Cycle 0045 local review other-1 #5; seam=none
test('a notification or a command registration that reaches the editor by another form of the same call is reported too', async () => {
  // Act
  const reported = {
    modalInsideTheMessage: await reportedBy(
      'vscode.window.showErrorMessage(describe({ modal: true }))',
    ),
    bracketed: await reportedBy("vscode.window['showErrorMessage'](text)"),
    destructured: await reportedBy(
      'const { showErrorMessage } = vscode.window\nshowErrorMessage(text)',
    ),
    bound: await reportedBy(
      'const show = vscode.window.showErrorMessage.bind(vscode.window)',
    ),
    command: await reportedBy('vscode.commands.registerCommand(id, run)'),
    textEditorCommand: await reportedBy(
      'vscode.commands.registerTextEditorCommand(id, run)',
    ),
  }

  // Assert
  assert.deepEqual(reported, {
    modalInsideTheMessage: ['notice'],
    bracketed: ['notice'],
    destructured: ['notice'],
    bound: ['notice'],
    command: ['command'],
    textEditorCommand: ['command'],
  })
})

test('the two helpers and the tests may call the editor directly, and a helper call in a source is not reported', async () => {
  // Act
  const reported = {
    noticeHelper: await reportedBy(
      'vscode.window.showErrorMessage(text)',
      'src/utils/showPlainNotice.ts',
    ),
    commandHelper: await reportedBy(
      'vscode.commands.registerCommand(id, run)',
      'src/utils/registerPlainCommand.ts',
    ),
    test: await reportedBy(
      'vscode.window.showErrorMessage(text)',
      'src/tests/sample.test.ts',
    ),
    throughTheHelpers: await reportedBy(
      "showNotice('error', text)\nregisterCommand('codebook.open', open)",
    ),
  }

  // Assert
  assert.deepEqual(reported, {
    noticeHelper: [],
    commandHelper: [],
    test: [],
    throughTheHelpers: [],
  })
})
