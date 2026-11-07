import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const recorderPath = fileURLToPath(
  new URL(
    '../../../../tools/host-event-recorder/extension.js',
    import.meta.url,
  ),
)

/** A Memento like the editor's: `get`/`update` over a plain map, shared by whoever holds the same object. */
export function createMemento() {
  const values = new Map()
  return {
    get: (key) => values.get(key),
    update: async (key, value) => {
      if (value === undefined) values.delete(key)
      else values.set(key, value)
    },
  }
}

/**
 * Loads the development-only host event recorder (`tools/host-event-recorder/extension.js`) against a fake `vscode` module.
 *
 * Used by the recorder's extension tests, which cannot start a real editor host. Each call loads a fresh copy of the module (its open take is module state), the way a new window loads it.
 *
 * @param {{ workspacePath: string, globalState: object, workspaceState: object, inputs?: string[] }} options - The workspace folder this "window" opened, the two mementos its context holds (share `globalState` between windows as the editor does) and the answers the input box gives in order.
 * @returns {{ recorder: object, context: object, commands: Map<string, Function>, messages: { kind: string, text: string }[], inputOptions: object[], fire: Record<string, Function> }} The module, its context, the registered commands, shown messages, input box options and the listeners the editor events would call.
 * @example
 * const { recorder, context } = loadRecorder({ workspacePath, globalState, workspaceState })
 * await recorder.activate(context)
 */
export function loadRecorder({
  workspacePath,
  globalState,
  workspaceState,
  inputs = [],
}) {
  const commands = new Map()
  const messages = []
  const inputOptions = []
  const fire = {}
  const listener = (name) => (handler) => {
    fire[name] = handler
    return { dispose() {} }
  }
  class TabInput {}
  const vscode = {
    TabInputText: class extends TabInput {},
    TabInputTextDiff: class extends TabInput {},
    TabInputCustom: class extends TabInput {},
    TabInputWebview: class extends TabInput {},
    TabInputNotebook: class extends TabInput {},
    TabInputNotebookDiff: class extends TabInput {},
    TabInputTerminal: class extends TabInput {},
    version: '1.0.0',
    env: { appName: 'Fake Host', appRoot: `${workspacePath}/no-app-root` },
    extensions: { getExtension: () => undefined },
    workspace: {
      workspaceFolders: [
        {
          uri: {
            scheme: 'file',
            path: workspacePath,
            fsPath: workspacePath,
          },
        },
      ],
    },
    window: {
      tabGroups: {
        all: [],
        onDidChangeTabs: listener('tabs'),
        onDidChangeTabGroups: listener('groups'),
      },
      onDidChangeActiveTextEditor: listener('activeEditor'),
      onDidChangeVisibleTextEditors: listener('visibleEditors'),
      onDidChangeTextEditorSelection: listener('selection'),
      showInputBox: async (options) => {
        inputOptions.push(options)
        return inputs.shift()
      },
      showWarningMessage: async (text) =>
        messages.push({ kind: 'warning', text }),
      showInformationMessage: async (text) =>
        messages.push({ kind: 'information', text }),
      showErrorMessage: async (text) => messages.push({ kind: 'error', text }),
    },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler)
        return { dispose() {} }
      },
      executeCommand: async () => ({ orientation: 0, groups: [{ size: 1 }] }),
    },
  }
  const originalLoad = Module._load
  Module._load = function load(request, ...rest) {
    return request === 'vscode'
      ? vscode
      : originalLoad.call(this, request, ...rest)
  }
  let recorder
  try {
    delete require.cache[recorderPath]
    recorder = require(recorderPath)
  } finally {
    Module._load = originalLoad
  }
  const context = {
    subscriptions: [],
    globalState,
    workspaceState,
    extension: { packageJSON: { version: '0.1.0' } },
  }
  return { recorder, context, commands, messages, inputOptions, fire }
}
