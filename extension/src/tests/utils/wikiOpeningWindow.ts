import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type * as ExtensionModule from '../../extension'
import type {
  WikiAnswer,
  WikiIncludedSource,
} from '../../utils/answerDeepWikiQuestion'

import { keepLocalAddress, parseFakeUri } from './fakeEditorAddresses'
import { createFakeFileWatching, FakeRelativePattern } from './fakeFileWatching'
import { loadModule } from './loadModule'
import { writeMinimalWiki } from './writeMinimalWiki'

/** A step of opening or asking that a test can keep open: the start of a reader, the editor's answer to which chat models it has, or the learner's choice among them. */
export type HeldOpeningStep = 'reader-start' | 'model-list' | 'model-choice'

/** A reader the window started, as a stand-in records it. */
export type StartedWikiReader = {
  url: string
  /** Files the window reported to this reader as changed. */
  notedSourceChanges: string[]
  /** Origins the window told this reader to accept beside its own. */
  acceptedOrigins: string[]
  isClosed: boolean
  /** Hands the window's question handler a question, as the reader does for one from its page. */
  ask(question: string, signal: AbortSignal): Promise<WikiAnswer | unknown>
}

/** What a test asked of the window: how the editor forwards a reader's address, and the chat models it exposes. */
type WikiOpeningWindowOptions = {
  forwardTo?: (url: string) => string
  models?: Array<{ id: string; name: string; vendor: string }>
}

/** An opened window of {@link openWikiOpeningWindow}: what it did so far, and the test's hands on it. */
type WikiOpeningWindow = {
  projectRoot: string
  readers: StartedWikiReader[]
  openedUrls: string[]
  errors: string[]
  modelQuestions: string[]
  /** Every command the window executed with a chat query: the command's name and the query's text. */
  chatDrafts: Array<{ name: string; query: string }>
  files: ReturnType<typeof createFakeFileWatching>
  open(): Promise<void>
  hold(step: HeldOpeningStep): { started: Promise<void>; release(): void }
  close(): Promise<void>
}

/**
 * Opens an editor window (the real extension with a stubbed `vscode`) on a temporary project with a one-page Wiki, with stand-in readers, so a test can drive "Codebook: Open DeepWiki in Browser" and see what the window does around a reader.
 *
 * Why: opening spans the command, the reader's start, the editor's address forwarding, the file watcher and the question handler; the reader itself has its own tests.
 * Used by the Wiki opening tests.
 *
 * @param options.forwardTo - The address the editor forwards a reader's URL to (a remote window); the URL itself when omitted (a local window).
 * @param options.models - The chat models the editor exposes to the question handler; none when omitted. The learner picks the first one when the editor asks.
 * @returns What the window did (`readers` it started, `openedUrls` it handed to the browser, `errors` it showed, `modelQuestions` it sent to a chat model, `chatDrafts` it put into the editor chat, each with the command's name and the drafted text), the fake file watching, `open` (runs the command), `hold` (keeps one step of the next open or question open until `release()`) and `close` (deactivates and removes the project).
 * @throws When the Wiki cannot be written or the extension does not load or activate; the temporary project is removed before the error is passed on.
 *
 * @example
 * ```ts
 * const window = await openWikiOpeningWindow()
 * await window.open()
 * window.files.report('change', join(window.projectRoot, 'src/a.ts'))
 * window.readers[0]?.notedSourceChanges // => ['<project>/src/a.ts']
 * await window.close()
 * ```
 */
export async function openWikiOpeningWindow(
  options: WikiOpeningWindowOptions = {},
): Promise<WikiOpeningWindow> {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-opening-'),
  )
  try {
    const projectRoot = await realpath(projectDirectory)
    await writeMinimalWiki(projectRoot)
    return await activateWindowOn(projectRoot, options)
  } catch (error) {
    // A fixture that failed hands no `close` to its caller, so it removes its own temporary project.
    await rm(projectDirectory, { recursive: true, force: true })
    throw error
  }
}

/**
 * Loads and activates the extension on a prepared project, for {@link openWikiOpeningWindow}; it creates nothing on disk, so its caller owns the project's removal when it throws.
 * @param projectRoot - The temporary project's real path, with its one-page Wiki already written.
 * @param options - What the test asked of the window.
 * @returns The activated window.
 * @throws When the extension does not load or activate.
 * @example
 * const window = await activateWindowOn('/tmp/codebook-wiki-opening-x', {})
 */
async function activateWindowOn(
  projectRoot: string,
  options: WikiOpeningWindowOptions,
): Promise<WikiOpeningWindow> {
  const readers: StartedWikiReader[] = []
  const openedUrls: string[] = []
  const errors: string[] = []
  const modelQuestions: string[] = []
  const chatDrafts: WikiOpeningWindow['chatDrafts'] = []
  const files = createFakeFileWatching()
  const commands = new Map<string, () => Promise<void>>()
  const holds = new Map<
    HeldOpeningStep,
    { reached(): void; released: Promise<void> }
  >()
  /** Waits at a step a test holds open; a step nobody holds passes at once. */
  const passHold = async (step: HeldOpeningStep): Promise<void> => {
    const hold = holds.get(step)
    if (!hold) return
    hold.reached()
    await hold.released
  }
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        CancellationTokenSource: class {
          token = { isCancellationRequested: false }
          cancel(): void {
            this.token.isCancellationRequested = true
          }
          dispose(): void {}
        },
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          executeCommand: async (name: string, argument?: unknown) => {
            // Only a command that carries a chat query is a draft.
            if (
              typeof argument === 'object' &&
              argument !== null &&
              'query' in argument &&
              typeof argument.query === 'string'
            )
              chatDrafts.push({ name, query: argument.query })
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher: files.createFileSystemWatcher,
        },
        lm: {
          selectChatModels: async () => {
            await passHold('model-list')
            return options.models ?? []
          },
        },
        env: {
          asExternalUri: async (uri: { toString(): string }) =>
            options.forwardTo
              ? parseFakeUri(options.forwardTo(uri.toString()))
              : keepLocalAddress(uri),
          openExternal: async (uri: { toString(): string }) => {
            openedUrls.push(uri.toString())
            return true
          },
        },
        Uri: { parse: parseFakeUri },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
          showQuickPick: async <Item>(items: Item[]) => {
            await passHold('model-choice')
            return items[0]
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './deepWikiReader': {
        readDeepWikiManifest: async () => undefined,
        startDeepWikiReader: async (
          _output: string,
          _root: string,
          answerQuestion: (
            question: string,
            sources: WikiIncludedSource[],
            signal: AbortSignal,
          ) => Promise<unknown>,
        ) => {
          await passHold('reader-start')
          const reader: StartedWikiReader = {
            url: `http://127.0.0.1:${4100 + readers.length}/w/reader-token/index.html`,
            notedSourceChanges: [],
            acceptedOrigins: [],
            isClosed: false,
            ask: (question, signal) => answerQuestion(question, [], signal),
          }
          readers.push(reader)
          return {
            url: reader.url,
            noteSourceChange(path: string): void {
              reader.notedSourceChanges.push(path)
            },
            acceptForwardedOrigin(origin: string): void {
              reader.acceptedOrigins.push(origin)
            },
            close: async (): Promise<void> => {
              reader.isClosed = true
            },
          }
        },
      },
      './utils/answerDeepWikiQuestion': {
        answerDeepWikiQuestion: async (
          _model: unknown,
          _root: string,
          _sources: WikiIncludedSource[],
          question: string,
        ): Promise<WikiAnswer> => {
          modelQuestions.push(question)
          return { answer: 'Answered.', citations: [], sourceChanged: false }
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose(): Promise<void> {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  return {
    projectRoot,
    readers,
    openedUrls,
    errors,
    modelQuestions,
    chatDrafts,
    files,
    async open(): Promise<void> {
      const command = commands.get('codebook.openDeepWiki')
      if (!command) throw new Error('The window registered no open command.')
      await command()
    },
    hold(step) {
      let reached = (): void => {}
      let release = (): void => {}
      const started = new Promise<void>((resolveStarted) => {
        reached = resolveStarted
      })
      const released = new Promise<void>((resolveReleased) => {
        release = resolveReleased
      })
      holds.set(step, { reached, released })
      return {
        started,
        release(): void {
          holds.delete(step)
          release()
        },
      }
    },
    async close(): Promise<void> {
      try {
        await boundary.deactivate()
      } finally {
        await rm(projectRoot, { recursive: true, force: true })
      }
    },
  }
}
