import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
import { test } from 'node:test'

import { connectionSchema } from '../client'
import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import * as cursorSkillDeployment from '../cursorSkillDeployment'
import type * as ExtensionModule from '../extension'
import { startServer } from '../server'
import type { StudyService } from '../service'

import { createHarness } from './helpers'
import { keepLocalAddress, parseFakeUri } from './utils/fakeEditorAddresses'
import {
  createFakeFileWatching,
  FakeRelativePattern,
} from './utils/fakeFileWatching'
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: {
          asExternalUri: keepLocalAddress,
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: parseFakeUri,
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: {
          asExternalUri: keepLocalAddress,
          openExternal: async () => true,
        },
        Uri: {
          parse: parseFakeUri,
          file: (fsPath: string) => ({ fsPath }),
        },
        window: { showErrorMessage: async () => undefined },
      },
      './environment': { requireWorkspace: () => projectRoot },
      './deepWikiReader': {
        readDeepWikiManifest: async () => undefined,
        startDeepWikiReader: async () => ({
          url: 'http://127.0.0.1:9/reader/index.html',
          acceptForwardedOrigin(): void {},
          noteSourceChange(): void {},
          close: async () => {
            releases.push('deepwiki-reader')
            throw new Error('reader close failed')
          },
        }),
      },
      './repositoryReader': {
        RepositoryReader: class {
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async open(): Promise<void> {}
          async dispose(): Promise<void> {
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

// Value: protects=the retired presentation picker staying out of the Command Palette; fails_when=the manifest contributes or activation registers `codebook.selectPresentation`, which offered the removed Living book and Guided walkthrough layouts; why_new=Cycle 0044 (0031-U7); seam=vscode.commands.registerCommand stub
test('the retired Select Presentation command is neither contributed to the Command Palette nor registered at activation', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-retired-command-')),
  )
  const registered: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string) {
            registered.push(name)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
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
          close: async (): Promise<void> => {},
        }),
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
  const manifest: {
    contributes: { commands: Array<{ command: string; title: string }> }
  } = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
  try {
    // Act
    boundary.activate({
      extensionPath: resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: projectRoot },
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
    })

    // Assert
    assert.equal(registered.includes('codebook.openStudyWorkspace'), true)
    assert.equal(registered.includes('codebook.selectPresentation'), false)
    assert.deepEqual(
      manifest.contributes.commands.filter(
        (entry) =>
          entry.command === 'codebook.selectPresentation' ||
          entry.title === 'Codebook: Select Presentation',
      ),
      [],
    )
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

// Value: protects=the lasting way to move the Learning summary in Cursor; fails_when=the manifest loses the command, its title action on the Learning summary or its Command Palette entry, shows them outside Cursor, or activation no longer registers the command, so the title action would end in "command not found"; why_new=Cycle 0045 NF-25 as DR-9 (a notification Cursor removes after 15 s was the only way); seam=vscode.commands.registerCommand stub and the manifest file
test('Move Learning Summary… is contributed as a title action of the Learning summary and a Command Palette entry, both shown only while the reader turned them on, and is registered at activation', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-move-summary-command-')),
  )
  const registered: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string) {
            registered.push(name)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
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
          close: async (): Promise<void> => {},
        }),
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
  type MenuEntry = { command: string; when?: string; group?: string }
  const manifest: {
    contributes: {
      commands: Array<{ command: string; title: string; icon?: string }>
      menus: { 'view/title': MenuEntry[]; commandPalette?: MenuEntry[] }
    }
  } = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
  const ofMoveCommand = (entry: { command: string }): boolean =>
    entry.command === 'codebook.moveLearningSummary'
  try {
    // Act
    boundary.activate({
      extensionPath: resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: projectRoot },
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
    })

    // Assert
    assert.equal(registered.includes('codebook.moveLearningSummary'), true)
    assert.deepEqual(manifest.contributes.commands.filter(ofMoveCommand), [
      {
        command: 'codebook.moveLearningSummary',
        title: 'Codebook: Move Learning Summary…',
        icon: '$(move)',
      },
    ])
    assert.deepEqual(
      manifest.contributes.menus['view/title'].filter(ofMoveCommand),
      [
        {
          command: 'codebook.moveLearningSummary',
          when: 'view == codebook.learningSummary && codebook.learningSummaryMovable',
          group: 'navigation',
        },
      ],
    )
    assert.deepEqual(
      (manifest.contributes.menus.commandPalette ?? []).filter(ofMoveCommand),
      [
        {
          command: 'codebook.moveLearningSummary',
          when: 'codebook.learningSummaryMovable',
        },
      ],
    )
  } finally {
    await boundary.deactivate()
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          executeCommand: async (name: string, options: unknown) => {
            chatDrafts.push({ name, options })
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: {
          asExternalUri: keepLocalAddress,
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: parseFakeUri,
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: {
          asExternalUri: keepLocalAddress,
          appName: 'Cursor',
          openExternal: async (uri: { value: string }) => {
            opened.push(uri.value)
            return true
          },
        },
        Uri: {
          parse: parseFakeUri,
          file: (fsPath: string) => ({ fsPath }),
        },
        lm: { selectChatModels: async () => [] },
        CancellationTokenSource: class {
          token = {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose(): void {} }),
          }
          cancel(): void {}
          dispose(): void {}
        },
        window: { showErrorMessage: async () => undefined },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
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
            return { dispose(): void {} }
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

test('a citation link whose path is written as a command link shows an error without a clickable link', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-link-'))
  const projectRoot = await realpath(projectDirectory)
  let handleUri:
    ((uri: { path: string; query: string }) => Promise<void>) | undefined
  const opened: string[] = [],
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          openTextDocument: async (uri: { fsPath: string }) => ({
            uri,
            lineCount: 2,
          }),
        },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
          },
          showTextDocument: async (document: { uri: { fsPath: string } }) => {
            opened.push(document.uri.fsPath)
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(handleUri)
    // Act
    await handleUri({
      path: '/source',
      query: new URLSearchParams({
        root: projectRoot,
        path: '[Open cited line](command:workbench.action.terminal.new)',
        line: '1',
        sha256: '0'.repeat(64),
      }).toString(),
    })

    // Assert
    assert.deepEqual(opened, [])
    assert.equal(errors.length, 1)
    assert.match(errors[0]!, /^Codebook could not open the Wiki citation: /)
    assert.match(
      errors[0]!,
      /\[Open cited line\] \(command:workbench\.action\.terminal\.new\)/,
    )
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('browser Update LLM Wiki starts the shared skill only for its opened repository and refuses a second start while the first run is watched', async () => {
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
    confirmations: string[] = [],
    notices: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
          // The reveal of the chat and New Chat carry no options; only the request does. The chat asks for a confirmation at once, so it works on the request and the run is watched.
          executeCommand: async (name: string, options: unknown) => {
            if (options === undefined) return undefined
            submissions.push({ name, options })
            return { type: 'confirmation', kind: 'toolInvocation' }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          // The update watches for signs of its own steps; this chat shows none.
          onDidOpenTextDocument: () => ({ dispose(): void {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
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
          showInformationMessage: (message: string) => {
            notices.push(message)
            return Promise.resolve(undefined)
          },
          onDidOpenTerminal: () => ({ dispose(): void {} }),
          onDidStartTerminalShellExecution: () => ({ dispose(): void {} }),
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
    // A second start from the command while the first run is still watched is refused, not sent as a second chat request.
    await commands.get('codebook.updateDeepWiki')!()
    assert.equal(submissions.length, 1)
    assert.deepEqual(notices, [
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    ])
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand: () => ({ dispose(): void {} }),
          executeCommand: async (name: string, query: string) => {
            settingsCommands.push({ name, query })
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
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
  // The Wiki is stale until the agent publishes; a current Wiki would end the click as "already current".
  let publishedWikiIsCurrent = false
  const agentRuns: Array<{ root: string; prompt: string }> = [],
    chatCommands: string[] = [],
    messages: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose(): void {} }),
          executeCommand: async (name: string) => {
            chatCommands.push(name)
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
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
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose(): Promise<void> {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string, prompt: string) => {
          agentRuns.push({ root, prompt })
          // The agent publishes: the manifest file changes, and it now matches the source.
          const manifestText = JSON.stringify({
            schemaVersion: 1,
            repositoryRoot: projectRoot,
            pages: [],
            assets: [],
            includedSources: [],
            excludedPaths: ['scratch'],
          })
          await writeFile(
            join(outputDirectory, 'codebook-wiki.json'),
            manifestText,
          )
          // The publisher's receipt names the new manifest; a manifest rewritten without it is no publish.
          await writeFile(
            join(outputDirectory, 'codebook-publication.json'),
            JSON.stringify({
              kind: 'published',
              manifestSha256: createHash('sha256')
                .update(manifestText)
                .digest('hex'),
            }),
          )
          publishedWikiIsCurrent = true
          return 'Updated'
        },
      },
      './utils/inspectDeepWikiFreshness': {
        // What the real check answers for this project, which has no Git repository: changed while a source differs and current once the sources match, each time with added files not looked for.
        inspectDeepWikiFreshness: async () => ({
          status: publishedWikiIsCurrent ? 'current' : 'changed',
          changedPaths: publishedWikiIsCurrent ? [] : ['source.ts'],
          addedPaths: [],
          addedFilesUnchecked: true,
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
    // The request is the one of a folder without Git: no commit hash is asked for.
    assert.match(
      agentRuns[0]?.prompt ?? '',
      / every includedSources sha256 equals the file on disk\. This folder has no Git repository: record no revision and do not create one\. /,
    )
    assert.deepEqual(chatCommands, [])
    assert.match(
      messages[0] ?? '',
      /^Updated at \d{1,2}:\d{2}(?:\s?[AP]M)? \(index [0-9a-f]{8}; no Git revision recorded, so added files are not checked\)\. Reload the browser reader to read the new pages\.$/,
    )
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
    const boundary = await loadModule<typeof ExtensionModule>(
      resolve(__dirname, '../extension.js'),
      {
        vscode: {
          commands: {
            registerCommand(name: string, action: () => Promise<void>) {
              commands.set(name, action)
              return { dispose(): void {} }
            },
          },
          workspace: {
            onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          },
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
            async open(): Promise<void> {
              requests += 1
              throw refusal
            }
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
      extensionPath: resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: __dirname },
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
    })
    try {
      // Act
      await assert.rejects(
        commands.get('codebook.openRepositoryWiki')!(),
        (error: unknown) => {
          // A command rejects with its failure's plain message; the thrown value itself stays reachable as the cause.
          assert.ok(error instanceof Error)
          assert.equal(
            error.message,
            'Timed out waiting for identifiable primary editor focus',
          )
          assert.equal(error.cause, refusal)
          return true
        },
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
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
          async open(): Promise<void> {
            requests += 1
          }
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<string | void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage() {
            return undefined
          }
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => {
          environments += 1
          return {
            ...harness.service.environment,
            dispose(): void {
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<string | void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
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
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => ({
          ...harness.service.environment,
          dispose(): void {
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
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
            return { dispose(): void {} }
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose(): void {} }),
          executeCommand: async () => undefined,
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
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
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose(): Promise<void> {}
        },
      },
      './utils/runCursorWikiUpdate': {
        runCursorWikiUpdate: async (root: string) => {
          agentRuns.push(root)
          // The agent publishes a new site, but the source no longer matches it.
          const manifestText = JSON.stringify({
            schemaVersion: 1,
            repositoryRoot: projectRoot,
            pages: [],
            assets: [],
            includedSources: [],
            excludedPaths: ['scratch'],
          })
          await writeFile(
            join(outputDirectory, 'codebook-wiki.json'),
            manifestText,
          )
          // The publisher's receipt names the new manifest; a manifest rewritten without it is no publish.
          await writeFile(
            join(outputDirectory, 'codebook-publication.json'),
            JSON.stringify({
              kind: 'published',
              manifestSha256: createHash('sha256')
                .update(manifestText)
                .digest('hex'),
            }),
          )
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
      /^Update needs another run \(\d{1,2}:\d{2}(?:\s?[AP]M)?\): Cursor Agent published a new Wiki, but 1 source file changed while it worked \(first: source\.ts\)\. Press Update LLM Wiki again\. This run replaced the site on disk\.$/,
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
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand: () => ({ dispose(): void {} }),
          executeCommand: async () => undefined,
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          registerUriHandler: (handler: {
            handleUri(uri: { path: string; query: string }): Promise<void>
          }) => {
            handleUri = handler.handleUri
            return { dispose(): void {} }
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
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async dispose(): Promise<void> {}
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

// Value: protects=the editor's own notification for a rejected command showing plain text; fails_when=a command registered by activation rejects with its raw error, whose quoted setting or path the editor renders as a command link when the command ran from a keybinding, a menu or the status bar; why_new=Cycle 0045 (SEC-3); seam=vscode.commands.registerCommand stub
test('a failed Codebook command rejects with a message the editor cannot turn into a link', async () => {
  // Arrange: the setting `codebook.wikiOutputDirectory` carries link syntax, and no Wiki exists in the folder it names.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-command-rejection-')),
  )
  const commands = new Map<string, () => Promise<void>>()
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '[Open](command:x)' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: { showErrorMessage: async () => undefined },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    const rejection: unknown = await commands.get(
      'codebook.openDeepWiki',
    )!().then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(rejection instanceof Error)
    assert.equal(
      rejection.message,
      `The Wiki’s manifest (${projectRoot}/[Open] (command:x)/codebook-wiki.json) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
    )
    assert.equal(rejection.message.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

// Cycle 0045 (ST-9): one case per notification that quotes outside text. Each fails when its message reaches the editor without the plain-text wrapper of the notice helper.
test('a Cursor chat registration that fails with an error quoting a command link warns without a clickable link', async () => {
  // Arrange: a saved Cursor setup reconnects at activation; the skill check passes once and then names a redirected home folder.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-registration-notice-')),
  )
  const warnings: string[] = []
  let reportWarning!: () => void
  const warned = new Promise<void>((resolveWarned) => {
    reportWarning = resolveWarned
  })
  let skillChecks = 0
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showWarningMessage(message: string) {
            warnings.push(message)
            reportWarning()
            return Promise.resolve(undefined)
          },
        },
        cursor: {
          mcp: { registerServer(): void {}, unregisterServer(): void {} },
        },
      },
      './service': {
        StudyService: class {
          instanceId = 'instance-1'
        },
      },
      './environment': {
        requireWorkspace: () => directory,
        createEnvironment: async () => ({
          workspace: directory,
          dispose(): void {},
        }),
      },
      './server': {
        startServer: async () => ({
          listening: true,
          resourcesReleased: true,
          descriptor: {
            url: 'http://127.0.0.1/instance-1/mcp',
            token: 'token-instance-1',
            instanceId: 'instance-1',
            workspace: directory,
            apiVersion: '1.5',
          },
          close: async (): Promise<void> => {},
        }),
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => {
          skillChecks += 1
          if (skillChecks > 1)
            throw new Error(
              'Codebook will not follow a missing or redirected skill directory: /home/[Open](command:x)/.cursor',
            )
          return { status: 'current' }
        },
      },
    },
  )
  try {
    // Act
    boundary.activate({
      extensionPath: directory,
      globalStorageUri: { fsPath: directory },
      subscriptions: [],
      workspaceState: {
        get: () => ({ workspace: directory }),
        update: async () => {},
      },
    })
    await warned

    // Assert
    assert.deepEqual(warnings, [
      'Codebook agent server started, but Cursor MCP registration failed: Codebook will not follow a missing or redirected skill directory: /home/[Open] (command:x)/.cursor. Run Codebook: Set Up AI Chat to repair the connection.',
    ])
    assert.equal(warnings[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Update LLM Wiki without a Wiki, in an output folder named like a command link, shows no clickable link', async () => {
  // Arrange: the setting `codebook.wikiOutputDirectory` carries link syntax and the folder holds no manifest.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-no-wiki-notice-')),
  )
  const commands = new Map<string, () => Promise<void>>(),
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '[Open](command:x)' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await commands.get('codebook.updateDeepWiki')!()

    // Assert
    assert.deepEqual(errors, [
      'Codebook found no LLM Wiki in [Open] (command:x). Ask the editor chat "/codebook Generate the LLM Wiki for this project", then update it.',
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a managed Cursor skill removal whose catalog cleanup error quotes a command link warns without a clickable link', async () => {
  // Arrange: the learner confirms the removal; the skill is removed and the owned catalog cleanup fails on a path.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-removal-notice-')),
  )
  const commands = new Map<string, () => Promise<void>>(),
    warnings: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showWarningMessage(message: string, options?: { modal?: boolean }) {
            // The modal confirmation is answered; every other warning is a notification.
            if (typeof options === 'object' && options.modal)
              return Promise.resolve('Remove managed skill')
            warnings.push(message)
            return Promise.resolve(undefined)
          },
        },
        cursor: {
          mcp: { registerServer(): void {}, unregisterServer(): void {} },
        },
      },
      './environment': { requireWorkspace: () => directory },
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
      './cursorSkillDeployment': {
        removeManagedCursorSkill: async () => ({ status: 'removed' }),
      },
      './utils/refreshCursorMcpCatalog': {
        captureOwnedCursorMcpCatalogGeneration: async () => 'generation-1',
        removeOwnedCursorMcpCatalog: async () => {
          throw new Error(
            "EACCES: permission denied, unlink '/home/[Open](command:x)/.cursor/mcp.json'",
          )
        },
      },
    },
  )
  boundary.activate({
    extensionPath: directory,
    globalStorageUri: { fsPath: directory },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await commands.get('codebook.removeManagedCursorSkill')!()

    // Assert
    assert.deepEqual(warnings, [
      "Managed Cursor skill removed, but its empty MCP catalog config cleanup is incomplete: Error: EACCES: permission denied, unlink '/home/[Open] (command:x)/.cursor/mcp.json'. No unverified file was deleted; inspect the private recovery record, restore setup, then retry removal.",
    ])
    assert.equal(warnings[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a failed Open Repository Wiki whose error quotes a command link shows no clickable link', async () => {
  // Arrange
  const commands = new Map<string, () => Promise<void>>(),
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': {},
      './repositoryReader': {
        RepositoryReader: class {
          async open(): Promise<void> {
            throw new Error(
              "ENOENT: no such file or directory, open '/repo/[Open](command:x)/book.json'",
            )
          }
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: __dirname },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await assert.rejects(commands.get('codebook.openRepositoryWiki')!())

    // Assert
    assert.deepEqual(errors, [
      "Codebook could not open Repository Wiki: Error: ENOENT: no such file or directory, open '/repo/[Open] (command:x)/book.json'",
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
  }
})

test('a failed Open DeepWiki in Browser whose error quotes a command link shows no clickable link', async () => {
  // Arrange: the setting `codebook.wikiOutputDirectory` carries link syntax, and no Wiki exists in the folder it names.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-open-wiki-notice-')),
  )
  const commands = new Map<string, () => Promise<void>>(),
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '[Open](command:x)' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await assert.rejects(commands.get('codebook.openDeepWiki')!())

    // Assert
    assert.deepEqual(errors, [
      `Codebook could not open DeepWiki: Error: The Wiki’s manifest (${projectRoot}/[Open] (command:x)/codebook-wiki.json) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first. Generate it through /codebook in this project, then retry.`,
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a failed Update LLM Wiki whose error quotes a command link shows no clickable link', async () => {
  // Arrange: the output folder is named like a link and holds no Wiki yet, so the notice quotes the folder.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-update-wiki-notice-')),
  )
  const outputDirectory = join(projectRoot, '[Open cited line](x)')
  await mkdir(outputDirectory)
  const commands = new Map<string, () => Promise<void>>(),
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          getConfiguration: () => ({ get: () => '[Open cited line](x)' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => projectRoot },
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: projectRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    // Act
    await commands.get('codebook.updateDeepWiki')!()

    // Assert
    assert.deepEqual(errors, [
      'Codebook found no LLM Wiki in [Open cited line] (x). Ask the editor chat "/codebook Generate the LLM Wiki for this project", then update it.',
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a failed Save Learning Replay whose error quotes a command link shows no clickable link', async () => {
  // Arrange
  const commands = new Map<string, () => Promise<void>>(),
    errors: string[] = []
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: {
          registerCommand(name: string, action: () => Promise<void>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': {},
      './repositoryReader': {
        RepositoryReader: class {
          async dispose(): Promise<void> {}
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          async saveLearningReplay(): Promise<void> {
            throw new Error(
              "EACCES: permission denied, open '/library/[Open](command:x).json'",
            )
          }
          async dispose(): Promise<void> {}
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
    await assert.rejects(commands.get('codebook.saveLearningReplay')!())

    // Assert
    assert.deepEqual(errors, [
      "Codebook could not save learning: Error: EACCES: permission denied, open '/library/[Open] (command:x).json'",
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
  }
})

test('a workspace folder change whose cleanup error quotes a command link shows no clickable link', async () => {
  // Arrange: the Repository Wiki reader cannot be released once, on a path named like a link.
  const errors: string[] = []
  let reportError!: () => void
  const reported = new Promise<void>((resolveReported) => {
    reportError = resolveReported
  })
  let changeWorkspaceFolders: (() => void) | undefined
  let releases = 0
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: (listener: () => void) => {
            changeWorkspaceFolders = listener
            return { dispose(): void {} }
          },
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            reportError()
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': {},
      './repositoryReader': {
        RepositoryReader: class {
          async dispose(): Promise<void> {
            releases += 1
            if (releases === 1)
              throw new Error(
                "EBUSY: resource busy or locked, rmdir '/storage/[Open](command:x)'",
              )
          }
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
    extensionPath: resolve(__dirname, '../..'),
    globalStorageUri: { fsPath: __dirname },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    assert.ok(changeWorkspaceFolders)
    // Act
    changeWorkspaceFolders()
    await reported

    // Assert
    assert.deepEqual(errors, [
      "Codebook cleanup incomplete: Error: EBUSY: resource busy or locked, rmdir '/storage/[Open] (command:x)'",
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
  }
})

// Value: protects=the one sentence a Cursor learner reads when the chat does not reconnect; fails_when=the notice prints "Error:", names the setup step twice or ends with two full stops; why_new=Cycle 0045 (SM-14 as DX-16); seam=the real skill check against a temporary home folder
test('a reconnect that finds the Cursor skill edited says once what happened and once to run Set Up AI Chat', async () => {
  // Arrange: Cursor chat was set up for this workspace, and the deployed skill was edited afterwards.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reconnect-notice-')),
  )
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home')
  await mkdir(join(extensionPath, 'skills', 'codebook'), { recursive: true })
  await mkdir(storageRoot)
  await mkdir(homeRoot)
  await writeFile(
    join(extensionPath, 'skills', 'codebook', 'SKILL.md'),
    '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n',
  )
  await cursorSkillDeployment.deployCursorSkill(
    extensionPath,
    storageRoot,
    homeRoot,
  )
  await writeFile(
    join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md'),
    'An edit made by the learner.\n',
  )
  const warnings: string[] = []
  let reportWarning!: () => void
  const warned = new Promise<void>((resolveWarned) => {
    reportWarning = resolveWarned
  })
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showWarningMessage(message: string) {
            warnings.push(message)
            reportWarning()
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => directory },
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
      './cursorSkillDeployment': {
        ...cursorSkillDeployment,
        // The real check, pointed at the temporary home instead of the user's.
        verifyManagedCursorSkill: (
          checkedExtensionPath: string,
          checkedStorageRoot: string,
        ) =>
          cursorSkillDeployment.verifyManagedCursorSkill(
            checkedExtensionPath,
            checkedStorageRoot,
            homeRoot,
          ),
      },
    },
  )
  try {
    // Act
    boundary.activate({
      extensionPath,
      globalStorageUri: { fsPath: storageRoot },
      subscriptions: [],
      workspaceState: {
        get: () => ({ workspace: directory }),
        update: async () => {},
      },
    })
    await warned

    // Assert
    assert.deepEqual(warnings, [
      'Codebook AI chat did not reconnect: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ])
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Cycle 0045 (ST-9): the tenth notification that quotes outside text.
test('a reconnect that fails with an error quoting a command link warns without a clickable link', async () => {
  // Arrange: Cursor chat was set up for this workspace, and the skill check names a redirected home folder.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-reconnect-link-')),
  )
  const warnings: string[] = []
  let reportWarning!: () => void
  const warned = new Promise<void>((resolveWarned) => {
    reportWarning = resolveWarned
  })
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showWarningMessage(message: string) {
            warnings.push(message)
            reportWarning()
            return Promise.resolve(undefined)
          },
        },
      },
      './environment': { requireWorkspace: () => directory },
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
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => {
          throw new Error(
            'Codebook will not follow a missing or redirected skill directory: /home/[Open](command:x)/.cursor',
          )
        },
      },
    },
  )
  try {
    // Act
    boundary.activate({
      extensionPath: directory,
      globalStorageUri: { fsPath: directory },
      subscriptions: [],
      workspaceState: {
        get: () => ({ workspace: directory }),
        update: async () => {},
      },
    })
    await warned

    // Assert
    assert.deepEqual(warnings, [
      'Codebook AI chat did not reconnect: Codebook will not follow a missing or redirected skill directory: /home/[Open] (command:x)/.cursor. Run Codebook: Set Up AI Chat.',
    ])
    assert.equal(warnings[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=the one sentence a Cursor learner reads when the agent server started without its chat connection; fails_when=the notice prints "Error:", names the setup step twice or ends with two full stops; why_new=Cycle 0045 (EX-F1); seam=the real skill check against a temporary home folder
test('a Cursor chat registration that finds the skill edited says once what happened and once to run Set Up AI Chat', async () => {
  // Arrange: Cursor chat was set up for this workspace; the skill is edited after the window's first check, before the connection registers.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-registration-sentence-')),
  )
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home')
  await mkdir(join(extensionPath, 'skills', 'codebook'), { recursive: true })
  await mkdir(storageRoot)
  await mkdir(homeRoot)
  await writeFile(
    join(extensionPath, 'skills', 'codebook', 'SKILL.md'),
    '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n',
  )
  await cursorSkillDeployment.deployCursorSkill(
    extensionPath,
    storageRoot,
    homeRoot,
  )
  const warnings: string[] = []
  let reportWarning!: () => void
  const warned = new Promise<void>((resolveWarned) => {
    reportWarning = resolveWarned
  })
  let skillChecks = 0
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: { registerCommand: () => ({ dispose(): void {} }) },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
        },
        window: {
          showWarningMessage(message: string) {
            warnings.push(message)
            reportWarning()
            return Promise.resolve(undefined)
          },
        },
        cursor: {
          mcp: { registerServer(): void {}, unregisterServer(): void {} },
        },
      },
      './service': {
        StudyService: class {
          instanceId = 'instance-1'
        },
      },
      './environment': {
        requireWorkspace: () => directory,
        createEnvironment: async () => ({
          workspace: directory,
          dispose(): void {},
        }),
      },
      './server': {
        startServer: async () => ({
          listening: true,
          resourcesReleased: true,
          descriptor: {
            url: 'http://127.0.0.1/instance-1/mcp',
            token: 'token-instance-1',
            instanceId: 'instance-1',
            workspace: directory,
            apiVersion: '1.5',
          },
          close: async (): Promise<void> => {},
        }),
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './cursorSkillDeployment': {
        ...cursorSkillDeployment,
        // The real check, pointed at the temporary home; the learner's edit lands between the first and the second check.
        verifyManagedCursorSkill: async (
          checkedExtensionPath: string,
          checkedStorageRoot: string,
        ) => {
          skillChecks += 1
          if (skillChecks === 2)
            await writeFile(
              join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md'),
              'An edit made by the learner.\n',
            )
          return cursorSkillDeployment.verifyManagedCursorSkill(
            checkedExtensionPath,
            checkedStorageRoot,
            homeRoot,
          )
        },
      },
    },
  )
  try {
    // Act
    boundary.activate({
      extensionPath,
      globalStorageUri: { fsPath: storageRoot },
      subscriptions: [],
      workspaceState: {
        get: () => ({ workspace: directory }),
        update: async () => {},
      },
    })
    await warned

    // Assert
    assert.deepEqual(warnings, [
      'Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ])
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})
