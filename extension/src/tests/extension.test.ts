import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { connectionSchema } from '../client'
import { startServer } from '../server'
import type { StudyService } from '../service'
import { createHarness } from './helpers'
import { loadModule } from './utils/loadModule'

test('browser Wiki opening rejects a manifest from another checkout and opens a matching generated site', async () => {
  // Arrange
  const projectRoot = await mkdtemp(join(tmpdir(), 'codebook-wiki-project-'))
  const canonicalProjectRoot = await realpath(projectRoot)
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  const commands = new Map<string, () => Promise<void>>(),
    opened: string[] = [],
    messages: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        env: {
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: (value: string) => ({ value }),
          file: (fsPath: string) => ({ fsPath }),
        },
        window: {
          showErrorMessage(message: string) {
            messages.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act / Assert
    await writeFile(
      join(outputDirectory, 'codebook-wiki.json'),
      JSON.stringify({ schemaVersion: 1, repositoryRoot: '/another/checkout' }),
    )
    await assert.rejects(
      commands.get('codebook.openDeepWiki')!(),
      /does not identify this opened project/,
    )
    assert.deepEqual(opened, [])
    assert.equal(messages.length, 1)
    await writeFile(
      join(outputDirectory, 'codebook-wiki.json'),
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: canonicalProjectRoot,
        pages: [{ path: 'index.html' }],
        assets: [],
        includedSources: [],
      }),
    )
    await commands.get('codebook.openDeepWiki')!()
    assert.match(
      opened[0]!,
      /^http:\/\/127\.0\.0\.1:\d+\/w\/[a-f0-9]{48}\/index\.html$/,
    )
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('shutting down releases the Study workspace before the DeepWiki reader even when the reader cannot close', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-shutdown-')),
  )
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  const commands = new Map<string, () => Promise<void>>()
  const releases: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        env: { openExternal: async () => true },
        Uri: {
          parse: (value: string) => ({ value }),
          file: (fsPath: string) => ({ fsPath }),
        },
        window: { showErrorMessage: async () => undefined },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './deepWikiReader': {
        readDeepWikiManifest: async () => undefined,
        startDeepWikiReader: async () => ({
          url: 'http://127.0.0.1:9/reader/index.html',
          close: async () => {
            releases.push('deepwiki-reader')
            throw new Error('reader close failed')
          },
        }),
      },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async open() {}
          async dispose() {
            releases.push('study-workspace')
          }
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    await commands.get('codebook.openStudyWorkspace')!()
    await commands.get('codebook.openDeepWiki')!()

    // Act
    const stopping = boundary.deactivate()

    // Assert
    await assert.rejects(stopping, /reader close failed/)
    assert.deepEqual(releases, ['study-workspace', 'deepwiki-reader'])
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a Wiki question opens a source-cited editor chat draft when VS Code exposes no reader model', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-no-model-')),
  )
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  const commands = new Map<string, () => Promise<void>>()
  const opened: string[] = []
  const chatDrafts: unknown[] = []
  let pickCount = 0
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
          executeCommand: async (name: string, options: unknown) => {
            chatDrafts.push({ name, options })
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        env: {
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: (value: string) => ({ value }),
          file: (fsPath: string) => ({ fsPath }),
        },
        lm: { selectChatModels: async () => [] },
        window: {
          showQuickPick: async () => {
            pickCount += 1
            return undefined
          },
          showErrorMessage: async () => undefined,
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    await commands.get('codebook.openDeepWiki')!()
    const question = 'Where is invoice creation validated?'
    const readerUrl = new URL(opened[0]!)
    // Act
    const response = await fetch(new URL('api/ask', readerUrl), {
      method: 'POST',
      headers: { Origin: readerUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    // Assert
    assert.equal(response.status, 200)
    assert.match(
      JSON.stringify(await response.json()),
      /question is ready in the editor chat/,
    )
    assert.equal(pickCount, 0)
    assert.equal(chatDrafts.length, 1)
    assert.match(JSON.stringify(chatDrafts[0]), /workbench\.action\.chat\.open/)
    assert.match(
      JSON.stringify(chatDrafts[0]),
      /Where is invoice creation validated/,
    )
    assert.match(JSON.stringify(chatDrafts[0]), /isPartialQuery":true/)
    assert.match(
      JSON.stringify(chatDrafts[0]),
      /Do not edit files, start the application or use a debugger/,
    )
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a Cursor Wiki question returns a source-cited browser answer when the editor model API is empty', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-cursor-question-')),
  )
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  const source = 'export const database = "Drizzle ORM";\n'
  await writeFile(join(projectRoot, 'source.ts'), source)
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [
        {
          path: 'source.ts',
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
    }),
  )
  const commands = new Map<string, () => Promise<void>>()
  const opened: string[] = []
  const prompts: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        env: {
          appName: 'Cursor',
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: (value: string) => ({ value }),
          file: (fsPath: string) => ({ fsPath }),
        },
        lm: { selectChatModels: async () => [] },
        CancellationTokenSource: class {
          token = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose() {} }),
          }
          cancel() {}
          dispose() {}
        },
        window: { showErrorMessage: async () => undefined },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
      './utils/requestCursorWikiText': {
        requestCursorWikiText: async (prompt: string) => {
          prompts.push(prompt)
          return JSON.stringify({
            answer: 'It uses Drizzle ORM.',
            citations: [{ id: 'S1', line: 1 }],
          })
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    await commands.get('codebook.openDeepWiki')!()
    const readerUrl = new URL(opened[0]!)
    // Act
    const response = await fetch(new URL('api/ask', readerUrl), {
      method: 'POST',
      headers: { Origin: readerUrl.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Which database does it use?' }),
    })
    // Assert
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.answer, 'It uses Drizzle ORM.')
    assert.match(
      result.citations[0].uri,
      /^cursor:\/\/laststance\.codebook\/source\?/,
    )
    assert.equal(prompts.length, 1)
    assert.match(prompts[0]!, /source\.ts/)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('browser source citations activate only the matching checkout and report changed source', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-link-'))
  const projectRoot = await realpath(projectDirectory)
  const sourcePath = join(projectRoot, 'source.ts')
  await writeFile(sourcePath, 'export const answer = 42;\n')
  const sourceHash = createHash('sha256')
    .update('export const answer = 42;\n')
    .digest('hex')
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const opened: string[] = [],
    warnings: string[] = [],
    errors: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose() {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
          openTextDocument: async (uri: { fsPath: string }) => ({
            uri,
            lineCount: 2,
          }),
        },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        Position: class {
          constructor(
            readonly line: number,
            readonly character: number,
          ) {}
        },
        Range: class {
          constructor(
            readonly start: unknown,
            readonly end: unknown,
          ) {}
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showTextDocument: async (document: { uri: { fsPath: string } }) => {
            opened.push(document.uri.fsPath)
          },
          showWarningMessage: (message: string) => {
            warnings.push(message)
            return Promise.resolve(undefined)
          },
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)
    const query = (root: string, sha256: string) =>
      new URLSearchParams({
        root,
        path: 'source.ts',
        line: '1',
        sha256,
      }).toString()
    // Act / Assert
    await handleUri({
      path: '/source',
      query: query('/other/checkout', sourceHash),
    })
    assert.deepEqual(opened, [])
    assert.match(errors[0]!, /another checkout/)
    await handleUri({ path: '/source', query: query(projectRoot, sourceHash) })
    assert.deepEqual(opened, [sourcePath])
    assert.deepEqual(warnings, [])
    await handleUri({
      path: '/source',
      query: query(projectRoot, '0'.repeat(64)),
    })
    assert.deepEqual(opened, [sourcePath, sourcePath])
    assert.equal(warnings.length, 1)
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('browser Update LLM Wiki starts the shared skill only for its opened repository', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-update-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot }),
  )
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const commands = new Map<string, () => Promise<void>>(),
    submissions: unknown[] = [],
    errors: string[] = [],
    confirmations: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
          executeCommand: async (name: string, options: unknown) => {
            submissions.push({ name, options })
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          // The learner confirms each browser request in the editor.
          showWarningMessage: (
            message: string,
            _options: unknown,
            ...choices: string[]
          ) => {
            confirmations.push(message)
            return Promise.resolve(choices[0])
          },
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)
    // Act
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: '/another/checkout' }).toString(),
    })
    await writeFile(
      join(outputDirectory, 'codebook-wiki.json'),
      JSON.stringify({ schemaVersion: 1, repositoryRoot: '/another/checkout' }),
    )
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })
    await writeFile(
      join(outputDirectory, 'codebook-wiki.json'),
      JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot }),
    )
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })
    // Assert
    assert.equal(errors.length, 2)
    assert.equal(
      confirmations.length,
      2,
      'only requests for the opened checkout ask for confirmation',
    )
    assert.equal(submissions.length, 1)
    assert.match(
      JSON.stringify(submissions[0]),
      /workbench\.action\.chat\.open/,
    )
    assert.match(JSON.stringify(submissions[0]), /Update LLM Wiki/)
    assert.match(JSON.stringify(submissions[0]), /isPartialQuery":false/)
    await commands.get('codebook.updateDeepWiki')!()
    assert.equal(submissions.length, 2)
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('browser Change location opens this project’s Wiki output setting and refuses another checkout', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-settings-'),
  )
  const projectRoot = await realpath(projectDirectory)
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const settingsCommands: Array<{ name: string; query: string }> = []
  const errors: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand: () => ({ dispose() {} }),
          executeCommand: async (name: string, query: string) => {
            settingsCommands.push({ name, query })
          },
        },
        workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)
    // Act
    await handleUri({
      path: '/settings',
      query: new URLSearchParams({ root: '/another/checkout' }).toString(),
    })
    await handleUri({ path: '/settings', query: '' })
    await handleUri({
      path: '/settings',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })

    // Assert
    assert.deepEqual(settingsCommands, [
      {
        name: 'workbench.action.openSettings',
        query: '@id:codebook.wikiOutputDirectory',
      },
    ])
    assert.equal(errors.length, 2)
    assert.match(errors[0]!, /Wiki output settings.*another checkout/)
    assert.match(errors[1]!, /Wiki output settings.*another checkout/)
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('Cursor Wiki update starts its project-bound agent without leaving an unsent chat draft', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-wiki-update-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const agentRuns: Array<{ root: string; prompt: string }> = [],
    chatCommands: string[] = [],
    messages: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose() {} }),
          executeCommand: async (name: string) => {
            chatCommands.push(name)
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showInformationMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
          showWarningMessage: (
            _message: string,
            _options: unknown,
            ...choices: string[]
          ) => Promise.resolve(choices[0]),
          showErrorMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string, prompt: string) => {
          agentRuns.push({ root, prompt })
          return 'Updated'
        },
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async () => ({
          status: 'current',
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
  try {
    assert.ok(handleUri)
    // Act
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })
    // Assert
    assert.equal(agentRuns.length, 1)
    assert.equal(agentRuns[0]?.root, projectRoot)
    assert.match(agentRuns[0]?.prompt ?? '', /\/codebook Update LLM Wiki/)
    assert.deepEqual(chatCommands, [])
    assert.match(messages[0] ?? '', /updated this project/)
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test(
  'a cold Wiki refusal is visible and still rejects while its notification remains open',
  { timeout: 1_000 },
  async () => {
    // Arrange
    const commands = new Map<string, () => Promise<void>>(),
      messages: string[] = []
    const refusal = new Error(
      'Timed out waiting for identifiable primary editor focus',
    )
    let requests = 0
    const boundary = await loadModule<typeof import('../extension')>(
      resolve(__dirname, '../extension.js'),
      {
        vscode: {
          commands: {
            registerCommand(name: string, action: () => Promise<void>) {
              commands.set(name, action)
              return { dispose() {} }
            },
          },
          workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
          window: {
            showErrorMessage(message: string) {
              messages.push(message)
              return new Promise<undefined>(() => {})
            },
          },
        },
        './environment': {},
        './repositoryReader': {
          RepositoryReader: class {
            async open() {
              requests += 1
              throw refusal
            }
            async dispose() {}
          },
        },
        './studyWorkspace': {
          StudyWorkspace: class {
            async dispose() {}
          },
        },
      },
    )
    boundary.activate({
      extensionPath: resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: __dirname },
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
    })
    try {
      // Act
      await assert.rejects(
        commands.get('codebook.openRepositoryWiki')!(),
        (error) => error === refusal,
      )
      // Assert
      assert.deepEqual(messages, [
        'Codebook could not open Repository Wiki: Error: Timed out waiting for identifiable primary editor focus',
      ])
      assert.equal(requests, 1)
    } finally {
      await boundary.deactivate()
    }
  },
)

test('a successful Wiki command opens once without displaying a failure notification', async () => {
  // Arrange
  const commands = new Map<string, () => Promise<void>>(),
    messages: string[] = []
  let requests = 0
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
        window: {
          showErrorMessage(message: string) {
            messages.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': {},
      './repositoryReader': {
        RepositoryReader: class {
          async open() {
            requests += 1
          }
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: __dirname },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await commands.get('codebook.openRepositoryWiki')!()
    // Assert
    assert.equal(requests, 1)
    assert.deepEqual(messages, [])
  } finally {
    await boundary.deactivate()
  }
})

test('a released study with failed evidence can retire its dead connection and explicitly start a fresh reachable instance', async () => {
  // Arrange
  const harness = await createHarness(),
    services: StudyService[] = [],
    commands = new Map<string, () => Promise<string | void>>()
  let environments = 0,
    disposed = 0
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<string | void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage() {
            return undefined
          }
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach() {}
          async retire() {}
          async dispose() {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => {
          environments += 1
          return {
            ...harness.service.environment,
            dispose() {
              disposed += 1
            },
          }
        },
      },
      './server': {
        startServer: async (service: StudyService) => {
          service.repository = harness.service.repository
          services.push(service)
          return startServer(service)
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: harness.directory },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    const firstPath = await commands.get('codebook.startAgentServer')!()
    assert.equal(typeof firstPath, 'string')
    assert.ok(firstPath)
    const first = connectionSchema.parse(
        JSON.parse(await readFile(firstPath, 'utf8')),
      ),
      service = services[0]!
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'failed-evidence',
    })
    await service.record(receipt).preparation
    harness.runtimes[0]!.evidence.failure = 'Injected persistent write failure'
    // Act
    await assert.rejects(
      commands.get('codebook.stopAgentServer')!(),
      /shutdown remains incomplete/,
    )
    const secondPath = await commands.get('codebook.startAgentServer')!()
    assert.ok(secondPath)
    const second = connectionSchema.parse(
      JSON.parse(await readFile(secondPath, 'utf8')),
    )
    const response = await fetch(second.url, {
      headers: { Authorization: `Bearer ${second.token}` },
    })
    await response.body?.cancel()
    // Assert
    await assert.rejects(access(firstPath))
    assert.notEqual(second.instanceId, first.instanceId)
    assert.notEqual(second.token, first.token)
    assert.equal(response.status, 405)
    assert.equal(environments, 2)
    assert.equal(disposed, 1)
    assert.equal(service.state(service.record(receipt)).cleaned, false)
    assert.equal(service.state(service.record(receipt)).resourcesReleased, true)
    assert.equal(
      service.state(service.record(receipt)).finalOutcome,
      'not-demonstrated',
    )
    assert.equal(
      harness.runtimes[0]!.evidence.failure,
      'Injected persistent write failure',
    )
  } finally {
    await boundary.deactivate()
    await harness.close()
  }
})

test('a failed physical release keeps its owner and rejects starting or copying a dead endpoint until explicit cleanup succeeds', async () => {
  // Arrange
  const harness = await createHarness(),
    services: StudyService[] = [],
    commands = new Map<string, () => Promise<string | void>>()
  let disposed = 0,
    copied = 0
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<string | void>) {
            commands.set(name, action)
            return { dispose() {} }
          },
        },
        workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) },
        env: {
          clipboard: {
            writeText: async () => {
              copied += 1
            },
          },
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage() {
            return undefined
          }
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach() {}
          async retire() {}
          async dispose() {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => ({
          ...harness.service.environment,
          dispose() {
            disposed += 1
          },
        }),
      },
      './server': {
        startServer: async (service: StudyService) => {
          service.repository = harness.service.repository
          services.push(service)
          return startServer(service)
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: harness.directory },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  let restore: (() => Promise<void>) | undefined
  try {
    const firstPath = await commands.get('codebook.startAgentServer')!()
    assert.ok(firstPath)
    const service = services[0]!,
      receipt = service.start({
        instanceId: service.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'live-owner',
      })
    await service.record(receipt).preparation
    const runtime = harness.runtimes[0]!
    restore = runtime.stop.bind(runtime)
    runtime.stop = async () => {
      throw new Error('Owned process still alive')
    }
    // Act / Assert
    await assert.rejects(
      commands.get('codebook.stopAgentServer')!(),
      /shutdown remains incomplete/,
    )
    await assert.rejects(
      commands.get('codebook.startAgentServer')!(),
      /shutdown is incomplete/,
    )
    await assert.rejects(
      commands.get('codebook.copyAgentConnection')!(),
      /shutdown is incomplete/,
    )
    await access(firstPath)
    assert.equal(disposed, 0)
    assert.equal(copied, 0)
    assert.equal(services.length, 1)
    runtime.stop = restore
    await commands.get('codebook.stopAgentServer')!()
    await assert.rejects(access(firstPath))
    const freshPath = await commands.get('codebook.startAgentServer')!()
    assert.notEqual(freshPath, firstPath)
    assert.equal(services.length, 2)
  } finally {
    if (restore) harness.runtimes[0]!.stop = restore
    await boundary.deactivate()
    await harness.close()
  }
})

test('a browser citation with an invalid line opens no source and explains the refusal', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-invalid-line-'),
  )
  const projectRoot = await realpath(projectDirectory)
  await writeFile(join(projectRoot, 'source.ts'), 'export const answer = 42;\n')
  const sourceHash = createHash('sha256')
    .update('export const answer = 42;\n')
    .digest('hex')
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const opened: string[] = [],
    errors: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose() {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
          openTextDocument: async (uri: { fsPath: string }) => ({
            uri,
            lineCount: 2,
          }),
        },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        Position: class {
          constructor(
            readonly line: number,
            readonly character: number,
          ) {}
        },
        Range: class {
          constructor(
            readonly start: unknown,
            readonly end: unknown,
          ) {}
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showTextDocument: async (document: { uri: { fsPath: string } }) => {
            opened.push(document.uri.fsPath)
          },
          showWarningMessage: () => Promise.resolve(undefined),
          showErrorMessage: (message: string) => {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)

    // Act
    for (const line of ['0', '-3', 'first']) {
      await handleUri({
        path: '/source',
        query: new URLSearchParams({
          root: projectRoot,
          path: 'source.ts',
          line,
          sha256: sourceHash,
        }).toString(),
      })
    }

    // Assert
    assert.deepEqual(opened, [])
    assert.equal(errors.length, 3)
    assert.match(
      errors[0]!,
      /could not open the Wiki citation: Error: The Wiki citation has an invalid line number/,
    )
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('a Cursor Wiki update that leaves source changed reports a failure instead of claiming the Wiki was updated', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-wiki-stale-update-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const agentRuns: string[] = [],
    messages: string[] = []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose() {} }),
          executeCommand: async () => undefined,
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showInformationMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
          showWarningMessage: (
            _message: string,
            _options: unknown,
            ...choices: string[]
          ) => Promise.resolve(choices[0]),
          showErrorMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string) => {
          agentRuns.push(root)
          return 'Updated'
        },
      },
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async () => ({
          status: 'changed',
          changedPaths: ['source.ts'],
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
  try {
    assert.ok(handleUri)

    // Act
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })

    // Assert
    assert.deepEqual(agentRuns, [projectRoot])
    assert.equal(messages.length, 1)
    assert.match(
      messages[0]!,
      /could not start the Wiki update: Error: Cursor Agent finished, but the published Wiki is not verified current/,
    )
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('a browser Wiki update link starts no Cursor Agent unless the learner confirms it in the editor', async () => {
  // Arrange: any web page can open the update link, and the project root is printed in every generated page.
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-wiki-update-declined-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><title>Project Wiki</title>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const agentRuns: string[] = [],
    messages: string[] = [],
    confirmations: Array<{ message: string; modal: boolean; detail: string }> =
      []
  const boundary = await loadModule<typeof import('../extension')>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose() {} }),
          executeCommand: async () => undefined,
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose() {} }
          },
          showInformationMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
          // The learner dismisses the modal instead of choosing Update LLM Wiki.
          showWarningMessage: (
            message: string,
            options: { modal: boolean; detail: string },
          ) => {
            confirmations.push({ message, ...options })
            return Promise.resolve(undefined)
          },
          showErrorMessage: (message: string) => {
            messages.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose() {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose() {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string) => {
          agentRuns.push(root)
          return 'Updated'
        },
      },
    },
  )
  boundary.activate({
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)

    // Act
    await handleUri({
      path: '/update',
      query: new URLSearchParams({ root: projectRoot }).toString(),
    })

    // Assert
    assert.deepEqual(agentRuns, [])
    assert.deepEqual(messages, [])
    assert.equal(confirmations.length, 1)
    assert.equal(confirmations[0]!.modal, true)
    assert.match(
      confirmations[0]!.detail,
      /can edit files and run commands in this project/,
    )
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})
