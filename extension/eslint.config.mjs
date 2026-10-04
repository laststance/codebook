import { defineConfig } from 'eslint/config'
import tsPrefixer from 'eslint-config-ts-prefixer'

/** The editor's notification calls, whose message the editor renders with link syntax. */
const NOTICE_CALL_NAMES = /^show(Information|Warning|Error)Message$/
/** The editor's command registrations, whose handler's rejection the editor shows as a notification. */
const COMMAND_REGISTRATION_NAMES = /^register(TextEditor)?Command$/

/**
 * Reads the name a member access or a destructured property names, so `window.showErrorMessage`, `window['showErrorMessage']` and `{ showErrorMessage }` are told alike; called by {@link plainEditorTexts} for every member access and every destructured property.
 * @param key - The `property` of a member access or the `key` of a property.
 * @param isComputed - Whether the name is written in brackets.
 * @returns The identifier's name, or the text of a bracketed string; `undefined` for a name that is computed at run time.
 * @example
 * accessedName({ type: 'Identifier', name: 'showErrorMessage' }, false) // => 'showErrorMessage'
 * accessedName({ type: 'Literal', value: 'showErrorMessage' }, true)    // => 'showErrorMessage'
 */
function accessedName(key, isComputed) {
  if (!isComputed) return key.type === 'Identifier' ? key.name : undefined
  return key.type === 'Literal' && typeof key.value === 'string'
    ? key.value
    : undefined
}

/**
 * Says whether a member access is the callee of a modal confirmation, the one direct notification call that renders no link; called by {@link plainEditorTexts} before it reports a notification call.
 * @param member - A member access whose name is one of the notification calls.
 * @returns `true` only when the access is called and the call's own second argument is an object that holds `modal: true`; an object deeper inside an argument does not count.
 * @example
 * isCalleeOfModalConfirmation(memberOf('vscode.window.showWarningMessage(text, { modal: true }, "Update")')) // => true
 * isCalleeOfModalConfirmation(memberOf('vscode.window.showErrorMessage(describe({ modal: true }))'))        // => false
 */
function isCalleeOfModalConfirmation(member) {
  const call = member.parent
  if (call.type !== 'CallExpression' || call.callee !== member) return false
  const options = call.arguments[1]
  return (
    options?.type === 'ObjectExpression' &&
    options.properties.some(
      (property) =>
        property.type === 'Property' &&
        accessedName(property.key, property.computed) === 'modal' &&
        property.value.type === 'Literal' &&
        property.value.value === true,
    )
  )
}

/**
 * Keeps every text the extension hands to the editor behind the two helpers that take link syntax out of it; used by the configuration block below for the extension's sources.
 *
 * Why: a selector on the member call alone let the same call through as `window['showErrorMessage'](…)`, as a destructured or bound function and as `registerTextEditorCommand`, and it took a `modal: true` anywhere inside the arguments for a modal confirmation.
 *
 * Reports every access to `show(Information|Warning|Error)Message` that is not the callee of a modal confirmation, every access to `registerCommand` and `registerTextEditorCommand`, and every destructuring of one of them.
 *
 * @example
 * // reported: vscode.window.showErrorMessage(text), const { showErrorMessage } = vscode.window, vscode.commands.registerTextEditorCommand(id, run)
 * // allowed:  vscode.window.showWarningMessage(text, { modal: true, detail }, 'Update')
 */
const plainEditorTexts = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      notice:
        'Show a notification through showNotice(severity, message, ...actions) inside activate() of extension.ts, or through showPlainNotice(vscode.window, severity, message, ...actions) elsewhere: it takes link syntax out of the message. Only a modal confirmation ({ modal: true } as the second argument) calls the editor directly.',
      command:
        'Register a command through registerCommand(command, handler) inside activate() of extension.ts (registerPlainCommand): a failed command then rejects with a message the editor cannot turn into a link.',
    },
  },
  create(context) {
    /** Reports a name of the editor's API that must be reached through a helper; `isAllowed` exempts the modal confirmation. */
    const check = (node, name, isAllowed) => {
      if (name === undefined) return
      if (COMMAND_REGISTRATION_NAMES.test(name))
        context.report({ node, messageId: 'command' })
      else if (NOTICE_CALL_NAMES.test(name) && !isAllowed)
        context.report({ node, messageId: 'notice' })
    }
    return {
      MemberExpression(member) {
        check(
          member,
          accessedName(member.property, member.computed),
          isCalleeOfModalConfirmation(member),
        )
      },
      // `const { showErrorMessage } = vscode.window` reaches the editor without a member call.
      'ObjectPattern > Property'(property) {
        check(property, accessedName(property.key, property.computed), false)
      },
    }
  },
}

export default defineConfig([
  {
    // Generated/private outputs and the standalone example are not extension source;
    // bundled skill files are identity-tracked by content hash and version.
    ignores: [
      'dist/**',
      'coverage/**',
      'artifacts/**',
      'examples/**',
      '.fallow/**',
      'skills/**',
    ],
  },
  ...tsPrefixer,
  {
    languageOptions: {
      parserOptions: {
        // scripts/tsconfig.json covers the package/QA scripts; this config file has no project.
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // VS Code, DAP and webview callbacks here distinguish a synchronous throw or an `undefined` return
      // from a returned Promise (for example webview message intercepts). Wrapping them in `async`
      // changes that contract, so this autofix is not behavior-preserving in this codebase.
      '@typescript-eslint/promise-function-async': 'off',
      // Cleanup hooks (for example `context.after`) deliberately close over a binding assigned later.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // Shared editor/server state here is guarded by explicit generation, lifetime and stopping checks; the rule
    // reports every plain post-await assignment of such state, not only read-modify-write races.
    files: [
      'src/extension.ts',
      'src/nativeRepositoryBootstrap.ts',
      'src/ownedNodeTestRun.ts',
      'src/server.ts',
      'src/studyWorkspace.ts',
      'src/tests/studyWorkspaceHarness.ts',
    ],
    rules: {
      'require-atomic-updates': 'off',
    },
  },
  {
    // The editor turns `[label](command:…)` in a notification into a link that runs a command, and it shows a rejected
    // command's message in a notification of its own. Both texts can quote outside text (a path, a setting, an error),
    // so only the two helpers reach the editor; a modal confirmation renders no link and stays a direct call. A third
    // text reaches the editor without a helper, the title of a progress notification (`withProgress`): it is built
    // from constants only, and no rule checks that.
    files: ['src/**/*.ts'],
    ignores: [
      'src/tests/**',
      'src/utils/showPlainNotice.ts',
      'src/utils/registerPlainCommand.ts',
    ],
    plugins: {
      codebook: { rules: { 'plain-editor-texts': plainEditorTexts } },
    },
    rules: { 'codebook/plain-editor-texts': 'error' },
  },
  {
    // Package and native-QA scripts deliberately load the compiled extension from dist after `pnpm build`.
    files: ['scripts/**/*.mjs'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^\\.\\./dist/'] }],
    },
  },
])
