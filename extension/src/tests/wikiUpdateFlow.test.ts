import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { readDeepWikiManifest } from '../deepWikiReader'
import type * as ExtensionModule from '../extension'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import { loadModule } from './utils/loadModule'

type CancellableProgress = {
  cancel(): void
}

/** Opens a window with a published Wiki and records what the learner sees of an update. */
async function openWikiWindow(options: {
  outputSetting?: string
  cursor?: boolean
  chatFails?: boolean
  cursorAgent?: (root: string) => Promise<string>
  cancellable?: CancellableProgress[]
}) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-'))
  const projectRoot = await realpath(projectDirectory)
  const outputSetting = options.outputSetting ?? '.codebook/wiki'
  const outputDirectory = join(projectRoot, outputSetting)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), '<title>Wiki</title>')
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  const publish = (sourceHash: string): Promise<void> =>
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        generated: { revision: 'a1b2c3d4e5f6a7b8' },
        pages: [],
        assets: [],
        includedSources: [{ path: 'src/a.ts', sha256: sourceHash }],
      }),
    )
  await publish('a'.repeat(64))
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  let readUpdateStatus: (() => WikiUpdateStatus) | undefined
  let wikiIsCurrent = false
  const chatRequests: string[] = []
  const notices: string[] = []
  const errors: string[] = []
  const commands = new Map<string, () => Promise<void>>()
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        ProgressLocation: { Notification: 15 },
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          executeCommand: async (name: string) => {
            if (options.chatFails) throw new Error('Chat is unavailable')
            chatRequests.push(name)
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => outputSetting }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        env: {
          ...(options.cursor ? { appName: 'Cursor' } : {}),
          openExternal: async () => true,
        },
        Uri: { parse: (value: string) => ({ value }) },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
          },
          showInformationMessage: (message: string) => {
            notices.push(message)
            return Promise.resolve(undefined)
          },
          showWarningMessage: (
            _message: string,
            _options: unknown,
            ...choices: string[]
          ) => Promise.resolve(choices[0]),
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
          ...(options.cancellable
            ? {
                withProgress: async (
                  _options: unknown,
                  task: (progress: unknown, token: unknown) => Promise<unknown>,
                ) => {
                  const listeners: Array<() => void> = []
                  const token = {
                    isCancellationRequested: false,
                    onCancellationRequested: (listener: () => void) => {
                      listeners.push(listener)
                      return { dispose(): void {} }
                    },
                  }
                  options.cancellable?.push({
                    cancel() {
                      token.isCancellationRequested = true
                      for (const listener of listeners) listener()
                    },
                  })
                  return task({}, token)
                },
              }
            : {}),
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './deepWikiReader': {
        readDeepWikiManifest,
        startDeepWikiReader: async (
          _output: string,
          _root: string,
          _answer: unknown,
          _scheme: string,
          statusProvider: () => WikiUpdateStatus,
        ) => {
          readUpdateStatus = statusProvider
          return {
            url: 'http://127.0.0.1:9/index.html',
            close: async (): Promise<void> => {},
          }
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
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string) =>
          options.cursorAgent ? options.cursorAgent(root) : 'Updated',
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async () => ({
          status: wikiIsCurrent ? 'current' : 'changed',
          changedPaths: [],
          addedPaths: [],
        }),
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  // The reader serves the update state, so the browser tab must be open first.
  await commands.get('codebook.openDeepWiki')!()
  assert.ok(handleUri && readUpdateStatus)
  const clickUpdate = (): Promise<void> =>
    handleUri!({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })
  return {
    projectRoot,
    outputDirectory,
    manifestPath,
    chatRequests,
    notices,
    errors,
    clickUpdate,
    status: () => readUpdateStatus!(),
    publish,
    setWikiCurrent(value: boolean): void {
      wikiIsCurrent = value
    },
    async close(): Promise<void> {
      await boundary.deactivate()
      await rm(projectDirectory, { recursive: true, force: true })
    },
  }
}

/** Waits until the update state leaves `running`, polling the way the reader page does. */
async function waitForEnd(
  status: () => WikiUpdateStatus,
  limitMs = 6_000,
): Promise<WikiUpdateStatus> {
  const deadline = Date.now() + limitMs
  while (status().state === 'running' && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  return status()
}

test('a VS Code Wiki update shows running, then the new identity once the editor agent publishes', async () => {
  // Arrange
  const wiki = await openWikiWindow({})
  try {
    // Act
    await wiki.clickUpdate()
    const whileWaiting = wiki.status()
    wiki.setWikiCurrent(true)
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(whileWaiting.state, 'running')
    assert.equal(ended.state, 'succeeded')
    assert.match(
      ended.state === 'succeeded' ? ended.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
    assert.deepEqual(wiki.chatRequests, ['workbench.action.chat.open'])
  } finally {
    await wiki.close()
  }
})

test('cancelling a VS Code Wiki update ends it as cancelled and leaves the published site byte-identical', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({ cancellable: progress })
  const manifestBefore = await readFile(wiki.manifestPath)
  const indexBefore = await readFile(join(wiki.outputDirectory, 'index.html'))
  try {
    await wiki.clickUpdate()

    // Act
    progress[0]!.cancel()
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'cancelled')
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
    assert.deepEqual(
      await readFile(join(wiki.outputDirectory, 'index.html')),
      indexBefore,
    )
  } finally {
    await wiki.close()
  }
})

test('a Wiki that already matches the source says so and opens no chat request', async () => {
  // Arrange
  const wiki = await openWikiWindow({})
  wiki.setWikiCurrent(true)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'already-current')
    assert.deepEqual(wiki.chatRequests, [])
    assert.deepEqual(wiki.notices, [
      'This project’s LLM Wiki already matches the current source; nothing to update.',
    ])
  } finally {
    await wiki.close()
  }
})

test('a chat that cannot open ends the update as failed with its reason instead of staying running', async () => {
  // Arrange
  const wiki = await openWikiWindow({ chatFails: true })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Chat is unavailable',
    )
    assert.equal(wiki.errors.length, 1)
  } finally {
    await wiki.close()
  }
})

test('a learner file the update candidate would overwrite ends the run as a conflict naming that file', async () => {
  // Arrange
  const wiki = await openWikiWindow({})
  await mkdir(join(wiki.outputDirectory, 'pages'), { recursive: true })
  await writeFile(join(wiki.outputDirectory, 'pages', 'overview.html'), 'mine')
  const stage = `${wiki.outputDirectory}.stage-1`
  await mkdir(stage)
  await writeFile(
    join(stage, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      pages: [{ path: 'pages/overview.html' }],
      assets: [],
    }),
  )
  // The candidate counts only when it was prepared after the click; its folder is dated ahead of it.
  const future = new Date(Date.now() + 60_000)
  await utimes(stage, future, future)
  try {
    // Act
    await wiki.clickUpdate()
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'conflict')
    assert.deepEqual(ended.state === 'conflict' ? ended.paths : [], [
      'pages/overview.html',
    ])
    assert.equal(
      await readFile(
        join(wiki.outputDirectory, 'pages', 'overview.html'),
        'utf8',
      ),
      'mine',
    )
  } finally {
    await wiki.close()
  }
})

test('a configured Wiki output folder is the one the update state names', async () => {
  // Arrange
  const wiki = await openWikiWindow({ outputSetting: 'docs/my-wiki' })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'running')
    assert.equal(
      status.state === 'running' ? status.outputDirectory : '',
      join(wiki.projectRoot, 'docs/my-wiki'),
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that fails ends as failed with the agent message and keeps the site', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      throw new Error('Cursor Agent exited with code 1.')
    },
  })
  const manifestBefore = await readFile(wiki.manifestPath)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent exited with code 1.',
    )
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update the learner cancels ends as cancelled, not failed', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({
    cursor: true,
    cancellable: progress,
    cursorAgent: async () => {
      progress[0]!.cancel()
      throw new Error('The Wiki update was cancelled.')
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'cancelled')
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that publishes ends as succeeded with the new identity', async () => {
  // Arrange
  let publishNew: (() => Promise<void>) | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishNew!()
      return 'Updated'
    },
  })
  publishNew = async (): Promise<void> => {
    wiki.setWikiCurrent(true)
    await wiki.publish('c'.repeat(64))
  }
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'succeeded')
    assert.match(
      status.state === 'succeeded' ? status.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
  } finally {
    await wiki.close()
  }
})
