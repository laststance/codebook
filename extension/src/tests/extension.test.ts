import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import { connectionSchema } from '../client'
import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import * as cursorSkillDeployment from '../cursorSkillDeployment'
import type * as ExtensionModule from '../extension'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import type { StudyService } from '../service'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from '../utils/refreshCursorMcpCatalog'
import { sanitizeCause } from '../utils/sanitizeCause'

import { createHarness } from './helpers'
import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { keepLocalAddress, parseFakeUri } from './utils/fakeEditorAddresses'
import {
  createFakeFileWatching,
  FakeRelativePattern,
} from './utils/fakeFileWatching'
import { loadModule } from './utils/loadModule'

// Value: protects=normal installed breakpoints keeping keyboard input while native frame/value inspection commits; fails_when=the native focus default contribution is omitted or enabled; seam=normal extension manifest, not native keyboard proof.
test('ordinary installations let native breakpoints preserve keyboard input by default', async () => {
  // Arrange
  const manifest = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )

  // Act
  const defaults = manifest.contributes.configurationDefaults

  // Assert
  assert.deepEqual(defaults, { 'debug.focusEditorOnBreak': false })
})

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
          // The confirmation asks which commands the editor has, to say where the request goes.
          getCommands: async () => [
            'workbench.action.chat.open',
            'workbench.action.chat.newChat',
          ],
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
    // This editor has no progress API, so no notification watches the update and the sentence names none.
    assert.deepEqual(notices, [
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader.',
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
      // The managed Cursor skill an update readies first; nothing is written to the learner's home.
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => ({ status: 'current' }),
        deployCursorSkill: async () => ({ status: 'current' }),
        removeManagedCursorSkill: async () => undefined,
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

// Value: protects=an owner whose physical release failed staying owned, so a dead endpoint is neither started on nor copied until an explicit cleanup succeeds; fails_when=the owner is dropped after the failed release or a start or copy is accepted on the dead endpoint; why_new=release failure left a half-owned endpoint; seam=the release fails by a stand-in; no_claim=a real process group
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

// Value: protects=the one Codebook Output channel the failure texts point to, shared by the service and the Study reader, each entry naming surface, study, version, host, cause; fails_when=the service or the reader reports to no channel, a second channel appears, Show details does not reveal it or the extension's storage folder is named; why_new=the sink is built in activate() and the tests assign their own (X5, AC17); seam=none; no_claim=the host's log levels (a fake window API, Study reader and server start stand in)
test('activation gives the service and the Study reader one sink that writes unexpected failures to the Codebook Output channel', async () => {
  // Arrange
  const harness = await createHarness(),
    globalStorage = await mkdtemp(join(tmpdir(), 'codebook-global-storage-')),
    services: StudyService[] = [],
    readers: {
      diagnostics?: {
        log: (entry: CodebookDiagnostic) => void
        show: () => void
      }
    }[] = [],
    commands = new Map<string, () => Promise<string | void>>(),
    subscriptions: { dispose(): void }[] = [],
    channels: {
      name: string
      log: boolean | undefined
      error: (text: string) => void
      show: (preserveFocus?: boolean) => void
      dispose(): void
    }[] = [],
    entries: string[] = [],
    shows: (boolean | undefined)[] = []
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
        window: {
          createOutputChannel(name: string, options: { log?: boolean }) {
            const channel = {
              name,
              log: options.log,
              error(text: string): void {
                entries.push(text)
              },
              show(preserveFocus?: boolean): void {
                shows.push(preserveFocus)
              },
              dispose(): void {},
            }
            channels.push(channel)
            return channel
          },
        },
        env: { appName: 'Visual Studio Code' },
        version: '1.143.0',
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
          diagnostics?: {
            log: (entry: CodebookDiagnostic) => void
            show: () => void
          }
          constructor() {
            readers.push(this)
          }
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => ({
          ...harness.service.environment,
          dispose(): void {},
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
    globalStorageUri: { fsPath: globalStorage },
    subscriptions,
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  try {
    await commands.get('codebook.startAgentServer')!()
    const service = services[0]!,
      reader = readers[0]!

    // Act
    service.diagnostics?.({
      surface: 'HISTORY_SEAL_FAILED',
      studyId: 'a_b',
      profile: 'node-test',
      cause: 'EIO: i/o error',
    })
    reader.diagnostics?.log({
      surface: 'open:test-replay',
      studyId: 'a_b',
      profile: 'node-test',
      cause: 'Sealed Node history journal is corrupt.',
    })
    reader.diagnostics?.show()

    // Assert
    assert.equal(channels.length, 1)
    assert.equal(channels[0]!.name, 'Codebook')
    assert.equal(channels[0]!.log, true)
    assert.ok(subscriptions.includes(channels[0]!))
    assert.equal(entries.length, 2)
    assert.match(
      entries[0]!,
      /^HISTORY_SEAL_FAILED · study a_b · profile node-test\nCodebook \d+\.\d+\.\d+ \(API 1\.8\) · Visual Studio Code 1\.143\.0\nCause: EIO: i\/o error$/,
    )
    assert.match(
      entries[1]!,
      /^open:test-replay · study a_b · profile node-test\n/,
    )
    assert.deepEqual(shows, [true])
    assert.equal(
      sanitizeCause(
        `EACCES: permission denied, open '${globalStorage}/state.json'`,
        service.causeRoots,
      ),
      "EACCES: permission denied, open '<storage>/state.json'",
    )

    // The channel is disposed with the extension: writing to it throws, and the sinks must not (F99).
    channels[0]!.error = (): void => {
      throw new Error('Channel has been closed')
    }
    channels[0]!.show = (): void => {
      throw new Error('Channel has been closed')
    }
    assert.doesNotThrow(() => {
      service.diagnostics?.({
        surface: 'HISTORY_SEAL_FAILED',
        cause: 'EIO: i/o error',
      })
      reader.diagnostics?.log({ surface: 'open:test-replay', cause: 'x' })
      reader.diagnostics?.show()
    })
  } finally {
    await boundary.deactivate()
    await harness.close()
    await rm(globalStorage, { recursive: true, force: true })
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
      // The managed Cursor skill an update readies first; nothing is written to the learner's home.
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => ({ status: 'current' }),
        deployCursorSkill: async () => ({ status: 'current' }),
        removeManagedCursorSkill: async () => undefined,
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
      // The managed Cursor skill an update readies first; nothing is written to the learner's home.
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => ({ status: 'current' }),
        deployCursorSkill: async () => ({ status: 'current' }),
        removeManagedCursorSkill: async () => undefined,
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
  // Arrange: the setting `codebook.wikiOutputDirectory` carries link syntax, and the folder it names holds this project's manifest without its entry page. (Changed in Cycle 0055: a folder without any Wiki no longer fails the open but offers Generate LLM Wiki, so the failure comes from the missing entry page.)
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-command-rejection-')),
  )
  await mkdir(join(projectRoot, '[Open](command:x)'))
  await writeFile(
    join(projectRoot, '[Open](command:x)', 'codebook-wiki.json'),
    JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot }),
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
      `No Wiki was found at ${projectRoot}/[Open] (command:x): its entry page (index.html) does not exist`,
    )
    assert.equal(rejection.message.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

// Cycle 0045 (ST-9): one case per notification that quotes outside text. Each fails when its message reaches the editor without the plain-text wrapper of the notice helper.
test('a Cursor chat registration that fails with an error quoting a command link warns without a clickable link', async () => {
  // Arrange: a saved Cursor setup reconnects at activation; the skill check passes once and then names a home folder whose Cursor folder is gone.
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
              'Codebook will not follow a missing or redirected skill directory: /home/[Open](command:x)/.cursor. Nothing stands at that path. Run Codebook: Set Up AI Chat again.',
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
      'Codebook agent server started, but Cursor MCP registration failed: Codebook will not follow a missing or redirected skill directory: /home/[Open] (command:x)/.cursor. Nothing stands at that path. Run Codebook: Set Up AI Chat again.',
    ])
    assert.equal(warnings[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a learner whose Cursor is too old to let an extension register an MCP server, at the start that restores a saved setup and at the setup after the update; fails_when=the sentence says "use the public manual connection setup", which the README does not have, or the notice adds "Run Codebook: Set Up AI Chat to repair the connection." after it, although that setup ends the same way until Cursor is updated; or the setup in the updated Cursor does not finish; why_new=Cycle 0046 row 303; seam=the editor's `cursor.mcp`, which gets its `registerServer` between the start and the setup, as an update of Cursor gives it
test('a Cursor that exposes no MCP registration is answered with what works, to update Cursor and run the setup again or to connect an external client as the README says, without a second setup step; in the updated Cursor the setup registers the server and finishes', async () => {
  // Arrange: a saved Cursor setup reconnects at activation in a Cursor whose `cursor.mcp` has no `registerServer`.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-no-registration-')),
  )
  const commands = new Map<string, () => Promise<unknown>>(),
    warnings: string[] = [],
    informations: string[] = [],
    registeredServers: string[] = []
  let reportWarning!: () => void
  const warned = new Promise<void>((resolveWarned) => {
    reportWarning = resolveWarned
  })
  const cursorMcp: {
    registerServer?: (definition: { name: string }) => void
    unregisterServer: () => void
  } = { unregisterServer(): void {} }
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand(name: string, action: () => Promise<unknown>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          getConfiguration: () => ({
            get: (_setting: string, fallback: string) => fallback,
          }),
        },
        window: {
          showWarningMessage(message: string) {
            warnings.push(message)
            reportWarning()
            return Promise.resolve(undefined)
          },
          showInformationMessage(message: string) {
            informations.push(message)
            return Promise.resolve(undefined)
          },
        },
        cursor: { mcp: cursorMcp },
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
        deployCursorSkill: async () => ({ status: 'current' }),
        verifyManagedCursorSkill: async () => ({ status: 'current' }),
      },
      './utils/refreshCursorMcpCatalog': {
        refreshCursorMcpCatalog: async () => 'generation-1',
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/usr/local/bin/node',
      },
    },
  )
  try {
    // Act: the start that restores the saved setup, and then the sentence to the letter: Cursor is updated and the setup is run again.
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
    cursorMcp.registerServer = (definition): void => {
      registeredServers.push(definition.name)
    }
    const setupInTheUpdatedCursor = await commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'finished',
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    )

    // Assert
    assert.deepEqual(
      { warnings, setupInTheUpdatedCursor, registeredServers, informations },
      {
        warnings: [
          'Codebook agent server started, but Cursor MCP registration failed: This Cursor version does not expose MCP registration to Codebook. Update Cursor, then run Codebook: Set Up AI Chat again. For an external MCP client, run Codebook: Start Agent Server and Codebook: Copy Agent Connection.',
        ],
        setupInTheUpdatedCursor: 'finished',
        registeredServers: ['codebook-instance-1'],
        informations: [
          'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.',
        ],
      },
    )
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a learner whose agent server is stopped (by another command of the window) while Set Up AI Chat connects Cursor; fails_when=the setup ends with "Codebook server did not start.", which is not what happened and names no step, where the same state a line earlier reads "Codebook server is not running. Run Codebook: Set Up AI Chat again."; or the setup run again does not finish; why_new=Cycle 0046, the pass over every sentence of the Cursor setup after rows 277 to 309; seam=the refresh of the Cursor MCP catalog of the loaded extension, during whose first call the server is stopped
test('a Set Up AI Chat in Cursor whose server is stopped while it connects says that the server is not running and names the setup as the command to run again, and that setup finishes', async () => {
  // Arrange: a Cursor window without a saved setup; the first refresh of the Cursor MCP catalog stops the agent server.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-setup-stopped-')),
  )
  const commands = new Map<string, () => Promise<unknown>>(),
    informations: string[] = []
  let isServerStoppedOnce = false
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand(name: string, action: () => Promise<unknown>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          getConfiguration: () => ({
            get: (_setting: string, fallback: string) => fallback,
          }),
        },
        window: {
          showInformationMessage(message: string) {
            informations.push(message)
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
        deployCursorSkill: async () => ({ status: 'current' }),
        verifyManagedCursorSkill: async () => ({ status: 'current' }),
      },
      './utils/refreshCursorMcpCatalog': {
        refreshCursorMcpCatalog: async () => {
          if (!isServerStoppedOnce) {
            isServerStoppedOnce = true
            await commands.get('codebook.stopAgentServer')!()
          }
          return 'generation-1'
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/usr/local/bin/node',
      },
    },
  )
  const setUp = (): Promise<string> =>
    commands.get('codebook.setupAiChat')!().then(
      () => 'finished',
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    )
  try {
    // Act: the setup during which the server is stopped, and then its sentence to the letter.
    boundary.activate({
      extensionPath: directory,
      globalStorageUri: { fsPath: directory },
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
    })
    const setup = await setUp()
    const setupRunAgain = await setUp()

    // Assert
    assert.deepEqual(
      { setup, setupRunAgain, informations },
      {
        setup:
          'Codebook server is not running. Run Codebook: Set Up AI Chat again.',
        setupRunAgain: 'finished',
        informations: [
          'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.',
        ],
      },
    )
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Value: protects=a learner whose agent server is stopped by another command of the window while it starts, before it is running and while it restores a saved Cursor connection; fails_when=the start ends with "Codebook server stopped while starting its chat connection." and names no step, where the start's other refusal of a stop names "Run Codebook: Start Agent Server to start it."; or that command does not start the server afterwards; why_new=Cycle 0046 row 311; seam=the server start and the skill check of the loaded extension, during which the stop command is run
test('a start of the agent server that a stop overtakes, while the server is prepared and while a saved Cursor connection is restored, says that the server stopped and names Codebook: Start Agent Server as the command that starts it, and that command starts it', async () => {
  // Arrange: a Cursor window with a saved setup for this workspace; a test decides at which step of a start the stop command runs.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-start-stopped-')),
  )
  const commands = new Map<string, () => Promise<unknown>>()
  let stopAt: 'the preparation' | 'the restored connection' | undefined
  let stopped: Promise<unknown> = Promise.resolve()
  let reportReconnected!: () => void
  const reconnected = new Promise<void>((resolveReconnected) => {
    reportReconnected = resolveReconnected
  })
  const stopHereIfAskedAt = (step: NonNullable<typeof stopAt>): void => {
    if (stopAt !== step) return
    stopAt = undefined
    stopped = commands.get('codebook.stopAgentServer')!()
  }
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        env: { appName: 'Cursor' },
        commands: {
          registerCommand(name: string, action: () => Promise<unknown>) {
            commands.set(name, action)
            return { dispose(): void {} }
          },
        },
        workspace: {
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          getConfiguration: () => ({
            get: (_setting: string, fallback: string) => fallback,
          }),
        },
        window: {
          showWarningMessage: () => Promise.resolve(undefined),
          showInformationMessage: () => Promise.resolve(undefined),
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
        startServer: async () => {
          // The stop is asked for while the server is prepared: it waits for this start, which then finds it.
          stopHereIfAskedAt('the preparation')
          return {
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
          }
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
      './repositoryReader': {
        RepositoryReader: class {
          async storage(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './cursorSkillDeployment': {
        verifyManagedCursorSkill: async () => {
          // The stop runs to its end while the start restores the saved Cursor connection.
          stopHereIfAskedAt('the restored connection')
          await stopped
          return { status: 'current' }
        },
      },
      './utils/refreshCursorMcpCatalog': {
        refreshCursorMcpCatalog: async () => {
          reportReconnected()
          return 'generation-1'
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/usr/local/bin/node',
      },
    },
  )
  const startOrRefusal = (): Promise<string> =>
    commands.get('codebook.startAgentServer')!().then(
      () => 'started',
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    )
  try {
    // Act: the saved setup reconnects at activation; then the server is stopped, and each start is overtaken by a stop at one of the two steps and followed by its sentence to the letter.
    boundary.activate({
      extensionPath: directory,
      globalStorageUri: { fsPath: directory },
      subscriptions: [],
      workspaceState: {
        get: () => ({ workspace: directory }),
        update: async () => {},
      },
    })
    await reconnected
    await commands.get('codebook.stopAgentServer')!()
    stopAt = 'the preparation'
    const startStoppedWhileItWasPrepared = await startOrRefusal()
    await stopped
    const startAfterIt = await startOrRefusal()
    await commands.get('codebook.stopAgentServer')!()
    stopAt = 'the restored connection'
    const startStoppedWhileItRestoredTheConnection = await startOrRefusal()
    await stopped
    const startAfterThat = await startOrRefusal()

    // Assert
    assert.deepEqual(
      {
        startStoppedWhileItWasPrepared,
        startAfterIt,
        startStoppedWhileItRestoredTheConnection,
        startAfterThat,
      },
      {
        startStoppedWhileItWasPrepared:
          'Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
        startAfterIt: 'started',
        startStoppedWhileItRestoredTheConnection:
          'Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
        startAfterThat: 'started',
      },
    )
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
      'Codebook found no LLM Wiki in [Open] (command:x).',
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
        captureOwnedCursorMcpCatalogGeneration: async () => ({
          ownedGeneration: 'generation-1',
        }),
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
      "EACCES: permission denied, unlink '/home/[Open] (command:x)/.cursor/mcp.json'. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.",
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

test('a failed Open LLM Wiki in Browser whose error quotes a command link shows no clickable link', async () => {
  // Arrange: the setting `codebook.wikiOutputDirectory` carries link syntax, and the folder it names holds this project's manifest without its entry page. (Changed in Cycle 0055: a folder without any Wiki no longer fails the open but offers Generate LLM Wiki, so the failure comes from the missing entry page.)
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-open-wiki-notice-')),
  )
  await mkdir(join(projectRoot, '[Open](command:x)'))
  await writeFile(
    join(projectRoot, '[Open](command:x)', 'codebook-wiki.json'),
    JSON.stringify({ schemaVersion: 1, repositoryRoot: projectRoot }),
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
      `Codebook could not open DeepWiki: Error: No Wiki was found at ${projectRoot}/[Open] (command:x): its entry page (index.html) does not exist. Generate it through /codebook in this project, then retry.`,
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
      'Codebook found no LLM Wiki in [Open cited line] (x).',
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('a failed Save Learning Replay whose error quotes a command link shows no clickable link', async () => {
  // Value: protects=the Save Learning Replay command's error notice shows the workspace's described cause as plain text, so a cause quoting a Markdown command link cannot become a clickable link; fails_when=the notice passes the cause to the editor unescaped, or the command reports nothing because describing the failure throws; why_changed=F264 words the notice through StudyWorkspace.describeFailure, so the stand-in describes a failure as the real workspace does (F277); seam=the StudyWorkspace stand-in; no_claim=which private roots the real workspace hides (studyWorkspaceTestReplay.test.ts)
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
          describeFailure(error: unknown): string {
            return sanitizeCause(error, { storage: [] })
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
      "Codebook could not save learning: EACCES: permission denied, open '/library/[Open] (command:x).json'",
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
          releaseUnsavedStudies(): never[] {
            return []
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
    assert.ok(changeWorkspaceFolders)
    // Act
    changeWorkspaceFolders()
    await reported

    // Assert
    assert.deepEqual(errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. The Repository Wiki reader could not be closed: EBUSY: resource busy or locked, rmdir '/storage/[Open] (command:x)'. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
    ])
    assert.equal(errors[0]!.includes(']('), false)
  } finally {
    await boundary.deactivate()
  }
})

/** What the extension did to one fake Study reader of {@link activateOverRecordedReaders}. */
interface RecordedStudyReader {
  /** 1 for the reader made at activation, 2 for the one made after it, and so on. */
  number: number
  /** The services the extension attached to this reader. */
  attachedServices: StudyService[]
  /** The services the extension retired on this reader. */
  retiredServices: StudyService[]
  /** The study archives the extension gave this reader when it made it. */
  handedOver: unknown[]
  /** The study archives this reader could not save: a test puts them here, and the reader hands them on when the extension asks. */
  unsaved: unknown[]
  /** How many Study commands the extension passed to this reader. */
  commands: number
  isDisposed: boolean
}

/**
 * Activates the extension over fake readers that record what the extension does with them, with the listener of changed workspace folders and the commands reachable, and with the real agent server over a temporary project.
 * No other test of this file reaches the extension's handling of a changed workspace folder with a server: the fakes here are what that needs.
 * @param behavior - `disposeStudyReader` runs inside every dispose of a Study reader, before the reader counts as disposed: a test holds it open, as while the reader's panes close, or throws from it. `beforeStudyReaderIsMade` runs first in every construction of a Study reader, with the number that reader would get: a test throws from it. `disposeRepositoryReader` runs inside every dispose of a Repository reader, with that reader's number, after the reader counts as disposed, as the real one marks itself first: a test throws from it. `retireStudyReader` runs inside every retirement of a server on a Study reader, after it was recorded: a test throws from it, as a reader whose last history save fails does.
 * @returns The commands by name, `changeWorkspaceFolders` (the editor's event), every Study reader the extension made, what happened in order (`events`), how many environments a server start has built, the error notices, the services the extension started with the runtimes and the configuration of the temporary project (for a test that runs a study on a server), `deactivate` (the extension's own shutdown, for a test of it), and `close`, which deactivates the extension and removes the temporary project.
 * @example
 * const editor = await activateOverRecordedReaders()
 * editor.changeWorkspaceFolders()
 * await waitUntil(() => editor.readers.length === 2, 'the reader made again', 1_000)
 */
async function activateOverRecordedReaders(
  behavior: {
    disposeStudyReader?: (reader: RecordedStudyReader) => Promise<void>
    beforeStudyReaderIsMade?: (number: number) => void
    disposeRepositoryReader?: (number: number) => Promise<void>
    retireStudyReader?: (reader: RecordedStudyReader) => Promise<void>
  } = {},
) {
  const harness = await createHarness(),
    commands = new Map<string, () => Promise<string | void>>(),
    services: StudyService[] = [],
    readers: RecordedStudyReader[] = [],
    events: string[] = [],
    errors: string[] = []
  let changeWorkspaceFolders: (() => void) | undefined,
    repositoryReaders = 0,
    environments = 0
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
          onDidChangeWorkspaceFolders: (listener: () => void) => {
            changeWorkspaceFolders = listener
            return { dispose(): void {} }
          },
        },
        window: {
          showErrorMessage(message: string) {
            errors.push(message)
            return Promise.resolve(undefined)
          },
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          private readonly number = ++repositoryReaders
          private isDisposed = false
          constructor() {
            events.push(`Repository reader ${this.number} made`)
          }
          async storage() {
            // As the real reader answers once it was disposed.
            if (this.isDisposed)
              throw new Error('Repository reader is disposed.')
            return undefined
          }
          async dispose(): Promise<void> {
            this.isDisposed = true
            await behavior.disposeRepositoryReader?.(this.number)
            events.push(`Repository reader ${this.number} disposed`)
          }
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class implements RecordedStudyReader {
          readonly number = readers.length + 1
          readonly attachedServices: StudyService[] = []
          readonly retiredServices: StudyService[] = []
          readonly handedOver: unknown[]
          unsaved: unknown[] = []
          commands = 0
          isDisposed = false
          presentation = undefined
          constructor(
            _context: unknown,
            _controls: unknown,
            handedOver: unknown[] = [],
          ) {
            behavior.beforeStudyReaderIsMade?.(this.number)
            this.handedOver = handedOver
            readers.push(this)
            events.push(`Study reader ${this.number} made`)
          }
          async action(): Promise<void> {
            this.commands += 1
          }
          releaseUnsavedStudies(): unknown[] {
            events.push(
              `Study reader ${this.number} handed its unsaved studies on`,
            )
            return this.unsaved.splice(0)
          }
          async attach(service: StudyService): Promise<void> {
            this.attachedServices.push(service)
          }
          async retire(service: StudyService): Promise<void> {
            this.retiredServices.push(service)
            await behavior.retireStudyReader?.(this)
          }
          async dispose(): Promise<void> {
            events.push(`Study reader ${this.number}: dispose started`)
            await behavior.disposeStudyReader?.(this)
            this.isDisposed = true
            events.push(`Study reader ${this.number} disposed`)
          }
        },
      },
      './environment': {
        requireWorkspace: () => harness.directory,
        createEnvironment: async () => {
          environments += 1
          return { ...harness.service.environment, dispose(): void {} }
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
  assert.ok(changeWorkspaceFolders)
  return {
    commands,
    changeWorkspaceFolders,
    readers,
    events,
    environments: (): number => environments,
    errors,
    services,
    runtimes: harness.runtimes,
    configuration: harness.configuration,
    /** Shuts the extension down as a closing window does; a test that calls it reads how the shutdown ended. */
    deactivate: (): Promise<void> => boundary.deactivate(),
    async close(): Promise<void> {
      // The temporary project is removed also when the shutdown fails.
      try {
        await boundary.deactivate()
      } finally {
        await harness.close()
      }
    },
  }
}

// Value: protects=a server the learner starts while the workspace's folders change serving the Study reader that lives: its runs are shown, checkpointed and presented by that reader; fails_when=the start runs while the old reader is being disposed, so its service is attached to the disposed reader and the reader made after it has no service until the next stop; why_new=Cycle 0046 row 279 (read in the code while working on row 267); seam=the listener of changed workspace folders and the Start Agent Server command over fake readers (activateOverRecordedReaders), with the first reader's dispose held open as while its panes close
test('a server started while a change of the workspace’s folders is handled waits for the readers to be replaced and is attached to the Study reader that lives, not to the one being disposed', async () => {
  // Arrange: the workspace's folders changed, and the dispose of the first Study reader is still closing its panes.
  let finishDispose!: () => void
  const disposeHeld = new Promise<void>((resolveHeld) => {
    finishDispose = resolveHeld
  })
  const editor = await activateOverRecordedReaders({
    disposeStudyReader: (reader) =>
      reader.number === 1 ? disposeHeld : Promise.resolve(),
  })
  try {
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.events.includes('Study reader 1: dispose started'),
      'the dispose of the first Study reader',
      1_000,
    )
    // Act: the learner runs Start Agent Server meanwhile; then the panes have closed.
    const starting = editor.commands.get('codebook.startAgentServer')!()
    // A start that does not wait for the readers has built its environment and attached its service well within this time.
    await Promise.race([
      starting.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolveGrace) => setTimeout(resolveGrace, 150)),
    ])
    const environmentsBuiltMeanwhile = editor.environments()
    finishDispose()
    const descriptorPath = await starting
    // The learner's next action works: Stop Agent Server retires the service on the reader it was attached to.
    await editor.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.deepEqual(
      editor.readers.map((reader) => ({
        number: reader.number,
        isDisposed: reader.isDisposed,
        attached: reader.attachedServices.length,
        retired: reader.retiredServices.length,
      })),
      [
        { number: 1, isDisposed: true, attached: 0, retired: 0 },
        { number: 2, isDisposed: false, attached: 1, retired: 1 },
      ],
    )
    // The start built nothing before the readers were replaced, and then answered as every start does.
    assert.equal(environmentsBuiltMeanwhile, 0)
    assert.equal(typeof descriptorPath, 'string')
    assert.deepEqual(editor.errors, [])
  } finally {
    finishDispose()
    await editor.close()
  }
})

// Value: protects=the learner after a change of the workspace's folders on which the Repository Wiki reader could not be closed: the failure is told with what Codebook did, both readers are made anew, the new Study reader has the archives the old one could not save, and the agent server starts; fails_when=the failure ends the handling before the reader's variable is cleared and before the Study reader is replaced, so every later start fails with "Repository reader is disposed." and the Study reader of the folders that were left stays in use, until the folders change again; why_new=Cycle 0046 row 312 (read in the code while working on row 298); seam=the listener of changed workspace folders and Start Agent Server over fake readers (activateOverRecordedReaders), whose first Repository reader's dispose throws
test('when the Repository Wiki reader cannot be closed during a change of the workspace’s folders, the learner is told, both readers are made anew, the new Study reader is given the archives the old one could not save, and the next start works', async () => {
  // Arrange: the Study reader holds one archive it could not save, and the Repository Wiki reader cannot be closed at the first attempt.
  let disposals = 0
  const editor = await activateOverRecordedReaders({
    disposeRepositoryReader: async (): Promise<void> => {
      disposals += 1
      if (disposals === 1)
        throw new Error(
          "EBUSY: resource busy or locked, rmdir '/storage/books'",
        )
    },
  })
  const unsavedStudy = { archive: { id: 'unsaved-study' } }
  try {
    editor.readers[0]!.unsaved = [unsavedStudy]
    // Act: the workspace's folders change; then the learner runs Start Agent Server.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.errors.length === 1,
      'the notice of the reader that could not be closed',
      1_000,
    )
    const eventsAfterTheChange = [...editor.events]
    const start = await editor.commands.get(
      'codebook.startAgentServer',
    )!().then(
      (descriptorPath) => typeof descriptorPath,
      (error: unknown) => String(error),
    )
    // Assert
    assert.deepEqual(editor.errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. The Repository Wiki reader could not be closed: EBUSY: resource busy or locked, rmdir '/storage/books'. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
    ])
    assert.deepEqual(eventsAfterTheChange, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Study reader 1 handed its unsaved studies on',
      'Study reader 1: dispose started',
      'Study reader 1 disposed',
      'Study reader 2 made',
      'Repository reader 2 made',
    ])
    assert.equal(start, 'string')
    // Cloned: the list a reader was given was made inside the loaded extension.
    assert.deepEqual(
      structuredClone(
        editor.readers.map((reader) => ({
          number: reader.number,
          handedOver: reader.handedOver,
          attached: reader.attachedServices.length,
        })),
      ),
      [
        { number: 1, handedOver: [], attached: 0 },
        { number: 2, handedOver: [unsavedStudy], attached: 1 },
      ],
    )
  } finally {
    await editor.close()
  }
})

// Value: protects=the learner after a change of the workspace's folders during which the agent server was stopped but its last history save failed: the failure is told as a server that is stopped, both readers are made anew, the study that was not saved goes to the new Study reader, and the agent server starts again; fails_when=the failed stop ends the handling, so the readers of the folders that were left stay in use and the notice names no state; why_new=Cycle 0046 row 312 (each step of the handling runs whatever the step before it did); seam=the listener of changed workspace folders with Start Agent Server over fake readers (activateOverRecordedReaders), whose first Study reader fails the retirement of its server
test('when the agent server is stopped for a change of the workspace’s folders and its last history save fails, the learner is told, both readers are made anew with the unsaved archives handed over, and the next start works', async () => {
  // Arrange: an agent server runs, and the Study reader cannot save its last history when the server is retired.
  let retirements = 0
  const editor = await activateOverRecordedReaders({
    retireStudyReader: async (): Promise<void> => {
      retirements += 1
      if (retirements === 1)
        throw new Error(
          'Runtime released; final reader history was not saved: Error: disk is read-only',
        )
    },
  })
  const unsavedStudy = { archive: { id: 'unsaved-study' } }
  try {
    await editor.commands.get('codebook.startAgentServer')!()
    editor.readers[0]!.unsaved = [unsavedStudy]
    // Act: the workspace's folders change; then the learner runs Start Agent Server.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.errors.length === 1,
      'the notice of the stop whose history save failed',
      1_000,
    )
    const readersAfterTheChange = editor.readers.length
    const start = await editor.commands.get(
      'codebook.startAgentServer',
    )!().then(
      (descriptorPath) => typeof descriptorPath,
      (error: unknown) => String(error),
    )
    // Assert
    assert.deepEqual(editor.errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. The agent server was stopped, but not all of its cleanup was done: Runtime released; final reader history was not saved: Error: disk is read-only. Codebook goes on with new readers.",
    ])
    assert.equal(readersAfterTheChange, 2)
    assert.equal(start, 'string')
    // Cloned: the list a reader was given was made inside the loaded extension.
    assert.deepEqual(
      structuredClone(
        editor.readers.map((reader) => ({
          number: reader.number,
          handedOver: reader.handedOver,
          attached: reader.attachedServices.length,
        })),
      ),
      [
        { number: 1, handedOver: [], attached: 1 },
        { number: 2, handedOver: [unsavedStudy], attached: 1 },
      ],
    )
  } finally {
    await editor.close()
  }
})

// Value: protects=the learner after a change of the workspace's folders during which the agent server could not be released: the notice sends to Stop Agent Server, both readers are made anew, a start refuses with the same step until that stop, and after it the server is retired on the reader that lives and starts again; fails_when=the failed stop ends the handling with a notice that names no step and with the old readers left in use; why_new=Cycle 0046 row 312 (each step of the handling runs whatever the step before it did; the notice is true for the failure it tells); seam=the listener of changed workspace folders with Start and Stop Agent Server over fake readers (activateOverRecordedReaders) and a run whose runtime cannot be stopped
test('when the agent server cannot be released for a change of the workspace’s folders, the learner is told to run Stop Agent Server again, both readers are made anew, and after that stop the server is retired on the new reader and starts again', async () => {
  // Arrange: an agent server runs a study whose runtime cannot be stopped.
  const editor = await activateOverRecordedReaders()
  let restoreRuntimeStop: (() => void) | undefined
  try {
    await editor.commands.get('codebook.startAgentServer')!()
    const service = editor.services[0]!
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: editor.configuration,
      key: 'owned-run',
    })
    await service.record(receipt).preparation
    const runtime = editor.runtimes[0]!,
      stopRuntime = runtime.stop.bind(runtime)
    restoreRuntimeStop = (): void => {
      runtime.stop = stopRuntime
    }
    runtime.stop = async () => {
      throw new Error('Owned process still alive')
    }
    // Act: the workspace's folders change; the learner runs Start Agent Server, then the runtime can be stopped and the learner runs Stop Agent Server and Start Agent Server.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.errors.length === 1,
      'the notice of the server that could not be released',
      1_000,
    )
    const readersAfterTheChange = editor.readers.length
    const startWhileOwned = await editor.commands.get(
      'codebook.startAgentServer',
    )!().then(
      () => 'started',
      (error: unknown) => String(error),
    )
    restoreRuntimeStop()
    await editor.commands.get('codebook.stopAgentServer')!()
    const startAfterTheStop = await editor.commands.get(
      'codebook.startAgentServer',
    )!().then(
      (descriptorPath) => typeof descriptorPath,
      (error: unknown) => String(error),
    )
    // Assert
    // The cause is the server's own text, which begins with "Error:" because the server joins what each part of its shutdown threw.
    assert.deepEqual(editor.errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. The agent server could not be stopped completely: Error: Owned shutdown remains incomplete. Run Codebook: Stop Agent Server again before you start it. Codebook goes on with new readers.",
    ])
    assert.equal(readersAfterTheChange, 2)
    assert.equal(
      startWhileOwned,
      'Error: Previous server shutdown is incomplete. Retry Codebook: Stop Agent Server before starting a new instance.',
    )
    assert.equal(startAfterTheStop, 'string')
    assert.deepEqual(
      editor.readers.map((reader) => ({
        number: reader.number,
        attached: reader.attachedServices.length,
        retired: reader.retiredServices.length,
      })),
      [
        { number: 1, attached: 1, retired: 0 },
        { number: 2, attached: 1, retired: 1 },
      ],
    )
  } finally {
    restoreRuntimeStop?.()
    await editor.close()
  }
})

// Value: protects=the learner's writes and playback position when the window closes while the agent server's stop fails: the Repository Wiki reader's dispose, which waits for accepted publications and learner writes, and the Study reader's dispose, which ends its run and saves the playback position, both run and are waited for, and the editor is still told the stop's failure; fails_when=the stop's failure ends the shutdown before either dispose, so a write that is under way is not waited for before the extension host ends; why_new=Cycle 0046 row 315 (read in the code while working on row 312, whose fault it shares); seam=the extension's deactivation over fake readers (activateOverRecordedReaders) whose disposes record what they save, with a server whose retirement fails
test('when the agent server’s stop fails as the window closes, the Repository Wiki reader’s dispose still waits for the learner’s write under way and the Study reader’s dispose still saves the playback position, and the shutdown ends with the stop’s failure', async () => {
  // Arrange: an agent server runs; its last history save fails when it is retired; a learner write is under way that the Repository Wiki reader's dispose waits for, and the Study reader's dispose saves the playback position.
  const saved: string[] = []
  let retirements = 0
  const editor = await activateOverRecordedReaders({
    retireStudyReader: async (): Promise<void> => {
      retirements += 1
      if (retirements === 1)
        throw new Error(
          'Runtime released; final reader history was not saved: Error: disk is read-only',
        )
    },
    disposeRepositoryReader: async (): Promise<void> => {
      // The write ends a moment after the dispose began to wait for it.
      await new Promise<void>((resolveWrite) => setTimeout(resolveWrite, 20))
      saved.push('the learner’s write under way')
    },
    disposeStudyReader: async (): Promise<void> => {
      saved.push('the playback position')
    },
  })
  try {
    await editor.commands.get('codebook.startAgentServer')!()
    // Act: the window closes.
    const shutdown = await editor.deactivate().then(
      () => 'shut down without a failure',
      (error: unknown) => String(error),
    )
    const savedWhenTheShutdownEnded = [...saved]
    // Assert
    assert.equal(
      shutdown,
      'Error: Runtime released; final reader history was not saved: Error: disk is read-only',
    )
    assert.deepEqual(savedWhenTheShutdownEnded, [
      'the learner’s write under way',
      'the playback position',
    ])
    assert.deepEqual(editor.events, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Repository reader 1 disposed',
      'Study reader 1: dispose started',
      'Study reader 1 disposed',
    ])
  } finally {
    await editor.close()
  }
})

// Value: protects=the editor's log of a shutdown in which several steps fail naming the failure that came first, the one the later failures may follow from, while every later step still runs; fails_when=the last failure replaces the first, as nested finally blocks do, or a failed dispose keeps the next reader from being disposed; why_new=Cycle 0046 row 315 (the first failure is thrown at the end); seam=the extension's deactivation over fake readers (activateOverRecordedReaders) whose server's retirement and Repository Wiki reader's dispose both fail
test('when the agent server’s stop and the Repository Wiki reader’s dispose both fail as the window closes, the Study reader is still disposed and the shutdown ends with the first failure, the stop’s', async () => {
  // Arrange: an agent server runs; its retirement fails, and so does the Repository Wiki reader's dispose.
  let retirements = 0,
    disposals = 0
  const editor = await activateOverRecordedReaders({
    retireStudyReader: async (): Promise<void> => {
      retirements += 1
      if (retirements === 1)
        throw new Error(
          'Runtime released; final reader history was not saved: Error: disk is read-only',
        )
    },
    disposeRepositoryReader: async (): Promise<void> => {
      disposals += 1
      if (disposals === 1)
        throw new Error(
          "EBUSY: resource busy or locked, rmdir '/storage/books'",
        )
    },
  })
  try {
    await editor.commands.get('codebook.startAgentServer')!()
    // Act: the window closes.
    const shutdown = await editor.deactivate().then(
      () => 'shut down without a failure',
      (error: unknown) => String(error),
    )
    const eventsWhenTheShutdownEnded = [...editor.events]
    // Assert
    assert.equal(
      shutdown,
      'Error: Runtime released; final reader history was not saved: Error: disk is read-only',
    )
    assert.deepEqual(eventsWhenTheShutdownEnded, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Study reader 1: dispose started',
      'Study reader 1 disposed',
    ])
  } finally {
    await editor.close()
  }
})

// Value: protects=the learner who runs Stop Agent Server while a start still waits for a change of the workspace's folders: no server comes up afterwards, the start says why, and the next start works; fails_when=the stop finds nothing running and the start that waited goes on once the readers are replaced, so a server runs after the learner stopped it; why_new=Cycle 0046 row 301 (named as a limit of row 279's fix); seam=the listener of changed workspace folders with Start and Stop Agent Server over fake readers (activateOverRecordedReaders), with the first reader's dispose held open as while its panes close
test('a start that waits for a change of the workspace’s folders does not go on when Stop Agent Server is run during the wait: no server comes up, the start says why, and the next start works', async () => {
  // Arrange: the workspace's folders changed, the first Study reader is still closing its panes, and the learner's Start Agent Server waits.
  let finishDispose!: () => void
  const disposeHeld = new Promise<void>((resolveHeld) => {
    finishDispose = resolveHeld
  })
  const editor = await activateOverRecordedReaders({
    disposeStudyReader: (reader) =>
      reader.number === 1 ? disposeHeld : Promise.resolve(),
  })
  try {
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.events.includes('Study reader 1: dispose started'),
      'the dispose of the first Study reader',
      1_000,
    )
    const waitingStart = editor.commands.get(
      'codebook.startAgentServer',
    )!().then(
      () => 'started',
      (error: unknown) => String(error),
    )
    // Act: the learner runs Stop Agent Server during the wait; the panes have closed; then the learner runs Start Agent Server again.
    await editor.commands.get('codebook.stopAgentServer')!()
    finishDispose()
    const outcomeOfWaitingStart = await waitingStart
    const serversAfterTheStop = {
      environmentsBuilt: editor.environments(),
      attached: editor.readers.map((reader) => reader.attachedServices.length),
    }
    const descriptorPath = await editor.commands.get(
      'codebook.startAgentServer',
    )!()
    // Assert
    assert.equal(
      outcomeOfWaitingStart,
      "Error: Codebook server was not started: a stop was asked for while the start waited for the workspace's folders to change. Run Codebook: Start Agent Server to start it.",
    )
    assert.deepEqual(serversAfterTheStop, {
      environmentsBuilt: 0,
      attached: [0, 0],
    })
    assert.equal(typeof descriptorPath, 'string')
    assert.deepEqual(
      editor.readers.map((reader) => reader.attachedServices.length),
      [0, 1],
    )
    assert.deepEqual(editor.errors, [])
  } finally {
    finishDispose()
    await editor.close()
  }
})

// Value: protects=two changes of the workspace's folders in a row each replacing the readers in full: every reader is disposed once before the next is made; fails_when=the second change is handled while the first still disposes, so both dispose the same Study reader and the later one clears a reader the earlier one had just made, without disposing it; why_new=Cycle 0046 row 279 (the changes are handled one after the other, which a waiting start relies on); seam=the listener of changed workspace folders over fake readers (activateOverRecordedReaders), with the first Study reader's dispose held open
test('a second change of the workspace’s folders that arrives while the first is handled is handled after it, so no reader is disposed twice or cleared without being disposed', async () => {
  // Arrange: the first change is disposing the first Study reader.
  let finishDispose!: () => void
  const disposeHeld = new Promise<void>((resolveHeld) => {
    finishDispose = resolveHeld
  })
  const editor = await activateOverRecordedReaders({
    disposeStudyReader: (reader) =>
      reader.number === 1 ? disposeHeld : Promise.resolve(),
  })
  try {
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.events.includes('Study reader 1: dispose started'),
      'the dispose of the first Study reader',
      1_000,
    )
    // Act: the folders change again, and then the first reader's panes have closed.
    editor.changeWorkspaceFolders()
    await new Promise<void>((resolveTask) => setImmediate(resolveTask))
    finishDispose()
    // Changes handled at once make no third Repository reader: the events below then say what happened instead.
    await waitUntil(
      () => editor.events.includes('Repository reader 3 made'),
      'the readers of the second change',
      1_000,
    ).catch(() => undefined)
    // Assert
    assert.deepEqual(editor.events, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Repository reader 1 disposed',
      'Study reader 1 handed its unsaved studies on',
      'Study reader 1: dispose started',
      'Study reader 1 disposed',
      'Study reader 2 made',
      'Repository reader 2 made',
      'Repository reader 2 disposed',
      'Study reader 2 handed its unsaved studies on',
      'Study reader 2: dispose started',
      'Study reader 2 disposed',
      'Study reader 3 made',
      'Repository reader 3 made',
    ])
    assert.deepEqual(editor.errors, [])
  } finally {
    finishDispose()
    await editor.close()
  }
})

// Value: protects=the study archives a Study reader could not save when the workspace's folders change: the extension takes them from the reader before it disposes it and makes the next Study reader with them at once, so the learner reads "History not saved: …" again without running a command, and the Study views have their provider again; fails_when=the handling disposes the reader with its archives, or makes no Study reader until a later command; why_new=Cycle 0046 row 278 (the reader that is disposed hands its pending archives on); seam=the listener of changed workspace folders over fake readers (activateOverRecordedReaders), with a marker in place of an archive
test('after a change of the workspace’s folders the Study reader is made again at once and is given the study archives the disposed reader could not save', async () => {
  // Arrange: the Study reader holds one archive it could not save.
  const editor = await activateOverRecordedReaders()
  const unsavedStudy = { archive: { id: 'unsaved-study' } }
  try {
    editor.readers[0]!.unsaved = [unsavedStudy]
    // Act: the workspace's folders change; no command is run.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.events.includes('Repository reader 2 made'),
      'the readers made again',
      1_000,
    ).catch(() => undefined)
    // Assert
    assert.deepEqual(editor.events, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Repository reader 1 disposed',
      'Study reader 1 handed its unsaved studies on',
      'Study reader 1: dispose started',
      'Study reader 1 disposed',
      'Study reader 2 made',
      'Repository reader 2 made',
    ])
    // Cloned: the list a reader was given was made inside the loaded extension.
    assert.deepEqual(
      structuredClone(editor.readers.map((reader) => reader.handedOver)),
      [[], [unsavedStudy]],
    )
    assert.deepEqual(editor.errors, [])
  } finally {
    await editor.close()
  }
})

// Value: protects=the learner after a change of the workspace's folders on which the Study reader's panes could not be closed: the failure is told, a new Study reader stands in its place at once, has the archives the old one could not save, answers the next Study command, and is the reader a server started afterwards is attached to; fails_when=the reader whose dispose threw stays in its place, disposed, so every Study command answers "The study workspace was closed; repeat the action explicitly if needed." and a later server is attached to it, until the folders change again; why_new=Cycle 0046 row 298 (found while working on row 278, whose test of this way waited for a second change); seam=the listener of changed workspace folders, a Study command and Start Agent Server over fake readers (activateOverRecordedReaders), whose first dispose of the first Study reader throws
test('when the dispose of the Study reader fails during a change of the workspace’s folders, the learner is told, and the Study reader made in its place is given the archives the old one could not save, answers the next Study command and is the one a server started afterwards is attached to', async () => {
  // Arrange: the Study reader holds one archive it could not save, and its panes cannot be closed at the first attempt.
  let disposals = 0
  const editor = await activateOverRecordedReaders({
    disposeStudyReader: async (): Promise<void> => {
      disposals += 1
      if (disposals === 1) throw new Error('The panes could not be closed.')
    },
  })
  const unsavedStudy = { archive: { id: 'unsaved-study' } }
  try {
    editor.readers[0]!.unsaved = [unsavedStudy]
    // Act: the workspace's folders change and the dispose fails; then the learner presses Retry storage / refresh and runs Start Agent Server.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.errors.length === 1,
      'the notice of the failed dispose',
      1_000,
    )
    const eventsAfterFailedDispose = [...editor.events]
    await editor.commands.get('codebook.study.retry')!()
    const descriptorPath = await editor.commands.get(
      'codebook.startAgentServer',
    )!()
    // Assert
    assert.deepEqual(editor.errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. The Study workspace could not be closed: The panes could not be closed. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
    ])
    assert.deepEqual(eventsAfterFailedDispose, [
      'Study reader 1 made',
      'Repository reader 1 made',
      'Repository reader 1 disposed',
      'Study reader 1 handed its unsaved studies on',
      'Study reader 1: dispose started',
      'Study reader 2 made',
      'Repository reader 2 made',
    ])
    // Cloned: the list a reader was given was made inside the loaded extension.
    assert.deepEqual(
      structuredClone(
        editor.readers.map((reader) => ({
          number: reader.number,
          handedOver: reader.handedOver,
          commands: reader.commands,
          attached: reader.attachedServices.length,
        })),
      ),
      [
        { number: 1, handedOver: [], commands: 0, attached: 0 },
        { number: 2, handedOver: [unsavedStudy], commands: 1, attached: 1 },
      ],
    )
    assert.equal(typeof descriptorPath, 'string')
  } finally {
    await editor.close()
  }
})

// Value: protects=the study archives a disposed Study reader could not save when the reader after it cannot be made at once: they stay with the extension, and the Study reader that the learner's next command makes is given them; fails_when=the archives are taken out of the extension's keeping before the new reader exists, so a constructor that throws loses them; why_new=Cycle 0046 row 278 (no way through the handling may lose an archive); seam=the listener of changed workspace folders and a Study command over fake readers (activateOverRecordedReaders), whose second Study reader cannot be made once
test('when the Study reader cannot be made after a change of the workspace’s folders, the archives the disposed reader could not save are kept and given to the Study reader the next command makes', async () => {
  // Arrange: the Study reader holds one archive it could not save, and the reader after it cannot be made at the first attempt.
  let attempts = 0
  const editor = await activateOverRecordedReaders({
    beforeStudyReaderIsMade: (number): void => {
      if (number !== 2) return
      attempts += 1
      if (attempts === 1)
        throw new Error('The Learning summary could not be registered.')
    },
  })
  const unsavedStudy = { archive: { id: 'unsaved-study' } }
  try {
    editor.readers[0]!.unsaved = [unsavedStudy]
    // Act: the workspace's folders change and the learner is told that the cleanup is incomplete; then the learner presses Retry storage / refresh.
    editor.changeWorkspaceFolders()
    await waitUntil(
      () => editor.errors.length === 1,
      'the notice of the reader that could not be made',
      1_000,
    )
    const readersAfterFailedChange = editor.readers.length
    await editor.commands.get('codebook.study.retry')!()
    // Assert
    assert.deepEqual(editor.errors, [
      "Codebook did not finish its cleanup after the workspace's folders changed. Codebook's readers could not be made again: The Learning summary could not be registered. The next Codebook command makes them.",
    ])
    assert.equal(readersAfterFailedChange, 1)
    // Cloned: the list a reader was given was made inside the loaded extension.
    assert.deepEqual(
      structuredClone(editor.readers.map((reader) => reader.handedOver)),
      [[], [unsavedStudy]],
    )
  } finally {
    await editor.close()
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
      `Codebook AI chat did not reconnect: Cursor skill is missing or was changed: ${join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')}. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.`,
    ])
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

// Cycle 0045 (ST-9): the tenth notification that quotes outside text.
test('a reconnect that fails with an error quoting a command link warns without a clickable link', async () => {
  // Arrange: Cursor chat was set up for this workspace, and the skill check names a home folder whose Cursor folder is a link; its refusal ends with the setup as its own step (row 284: the notice does not say that step a second time).
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
            "Codebook will not follow a missing or redirected skill directory: /home/[Open](command:x)/.cursor. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
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
      "Codebook AI chat did not reconnect: Codebook will not follow a missing or redirected skill directory: /home/[Open] (command:x)/.cursor. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.",
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
      `Codebook agent server started, but Cursor MCP registration failed: Cursor skill is missing or was changed: ${join(homeRoot, '.cursor', 'skills', 'codebook', 'SKILL.md')}. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.`,
    ])
  } finally {
    await boundary.deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})

/** The bundled skill of the removal command's tests, in the form the setup accepts. */
const REMOVAL_TEST_SKILL =
  '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n'

/**
 * Simulates the catalog's locked-storage refusal when {@link removalCommandOverATemporaryHome} first runs cleanup.
 * @returns Never resolves; the cleanup rejects with the storage-lock refusal.
 * @throws Always, with the sentence of a catalog held by another writer.
 * @example
 * await refuseAsLockedStorage() // => rejects with 'Learning storage is locked by another writer or an interrupted session ...'
 */
async function refuseAsLockedStorage(): Promise<void> {
  throw new Error(
    'Learning storage is locked by another writer or an interrupted session (lock file: /storage/cursor-mcp-catalog/writer.lock). No data changed; retry after resolving the lock.',
  )
}

/**
 * Prepares the real skill and catalog in a temporary home when command regression tests need a removal with an interrupted first cleanup.
 * @param beforeFirstCleanup - What happens once, right before the command's first cleanup of the MCP config reaches the real catalog, given the path of the catalog's receipt: nothing, a refusal thrown in the cleanup's place ({@link refuseAsLockedStorage}), or a change another Cursor window made in the meantime.
 * @param isCursorChatSetUp - Whether Cursor chat was set up in that home before the command is loaded; without it the home holds nothing, not even a `.cursor` folder.
 * @returns The command, the notifications it showed, the paths of the skill, of its receipt, of the config and of the catalog's receipt, and the cleanup of the temporary folders.
 * @example
 * const removal = await removalCommandOverATemporaryHome(refuseAsLockedStorage)
 * await removal.runRemoval() // => the skill is removed and the locked catalog is reported
 * await removal.dispose()
 */
async function removalCommandOverATemporaryHome(
  beforeFirstCleanup: (catalogReceiptPath: string) => Promise<void>,
  isCursorChatSetUp = true,
): Promise<{
  runRemoval: () => Promise<void>
  informations: string[]
  warnings: string[]
  skillPath: string
  skillReceiptPath: string
  configPath: string
  catalogReceiptPath: string
  dispose: () => Promise<void>
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-removal-twice-')),
  )
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home'),
    cursorDirectory = join(homeRoot, '.cursor')
  await mkdir(join(extensionPath, 'skills', 'codebook'), { recursive: true })
  await mkdir(storageRoot)
  await mkdir(homeRoot)
  await writeFile(
    join(extensionPath, 'skills', 'codebook', 'SKILL.md'),
    REMOVAL_TEST_SKILL,
  )
  if (isCursorChatSetUp) {
    await cursorSkillDeployment.deployCursorSkill(
      extensionPath,
      storageRoot,
      homeRoot,
    )
    await refreshCursorMcpCatalog(storageRoot, cursorDirectory)
  }
  const commands = new Map<string, () => Promise<void>>(),
    informations: string[] = [],
    warnings: string[] = []
  const catalogReceiptPath = join(
    storageRoot,
    'cursor-mcp-catalog',
    'receipt.json',
  )
  let isFirstCleanup = true
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
          showInformationMessage(message: string) {
            informations.push(message)
            return Promise.resolve(undefined)
          },
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
      // The real removals, over the temporary home instead of the learner's.
      './cursorSkillDeployment': {
        removeManagedCursorSkill: (storage: string) =>
          cursorSkillDeployment.removeManagedCursorSkill(storage, homeRoot),
      },
      './utils/refreshCursorMcpCatalog': {
        captureOwnedCursorMcpCatalogGeneration: (
          storage: string,
          _cursorDirectory: string | undefined,
          commandToRunAgain: string,
        ) =>
          captureOwnedCursorMcpCatalogGeneration(
            storage,
            cursorDirectory,
            commandToRunAgain,
          ),
        removeOwnedCursorMcpCatalog: async (
          storage: string,
          _cursorDirectory: string | undefined,
          generation: string,
          commandToRunAgain: string,
        ) => {
          if (isFirstCleanup) {
            isFirstCleanup = false
            await beforeFirstCleanup(catalogReceiptPath)
          }
          return removeOwnedCursorMcpCatalog(
            storage,
            cursorDirectory,
            generation,
            commandToRunAgain,
          )
        },
      },
    },
  )
  boundary.activate({
    extensionPath,
    globalStorageUri: { fsPath: storageRoot },
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => {} },
  })
  return {
    runRemoval: commands.get('codebook.removeManagedCursorSkill')!,
    informations,
    warnings,
    skillPath: join(cursorDirectory, 'skills', 'codebook', 'SKILL.md'),
    skillReceiptPath: join(storageRoot, 'cursor-skill', 'receipt.json'),
    configPath: join(cursorDirectory, 'mcp.json'),
    catalogReceiptPath,
    dispose: async (): Promise<void> => {
      await boundary.deactivate()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

// Value: protects=a learner whose Remove Managed Cursor Skill removed the skill and could not retire Codebook's empty Cursor MCP config (another window held the storage lock); fails_when=a second removal ends with "No installed Codebook-owned Cursor skill was found; no file was changed." and never reaches the config, which then stays until the learner sets Cursor chat up and removes it again; why_new=Cycle 0046 row 222; seam=the removal command with the real skill and catalog over a temporary home, and a first cleanup that is refused
test('a second Remove Managed Cursor Skill, after a first whose Cursor MCP config cleanup was refused, goes on to that cleanup: it retires the config Codebook created and says that the skill was already removed', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome(refuseAsLockedStorage)
  try {
    // Act
    await cursor.runRemoval()
    const configAfterTheFirstRemoval = await readFile(cursor.configPath, 'utf8')
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        warnings: cursor.warnings,
        configAfterTheFirstRemoval,
        informations: cursor.informations,
        configAfterTheSecondRemoval: await readFile(
          cursor.configPath,
          'utf8',
        ).catch((error: { code?: string }) => error.code),
      },
      {
        warnings: [
          'Learning storage is locked by another writer or an interrupted session (lock file: /storage/cursor-mcp-catalog/writer.lock). No data changed; retry after resolving the lock. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
        ],
        configAfterTheFirstRemoval: '{"mcpServers":{}}\n',
        informations: [
          'The managed Cursor skill was already removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
        ],
        configAfterTheSecondRemoval: 'ENOENT',
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=a Cursor MCP config the learner changed after a removal could not retire it; fails_when=the second removal removes a config that is not the empty one Codebook created, or ends without saying why the config was left; why_new=Cycle 0046 row 222: the cleanup the second removal goes on to keeps the catalog's rule; seam=the removal command with the real skill and catalog over a temporary home, and a first cleanup that is refused
test('a second Remove Managed Cursor Skill leaves a Cursor MCP config the learner changed after the first removal, and says that the skill was already removed and why the config stays', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome(refuseAsLockedStorage)
  const changedConfig = '{"mcpServers":{"mine":{"command":"tool"}}}\n'
  try {
    // Act: between the two removals the learner adds a server of their own.
    await cursor.runRemoval()
    await writeFile(cursor.configPath, changedConfig)
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        informations: cursor.informations,
        config: await readFile(cursor.configPath, 'utf8'),
      },
      {
        informations: [
          'The managed Cursor skill was already removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
        ],
        config: changedConfig,
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=a learner who asks Codebook to remove its Cursor setup while a record of the Cursor MCP catalog is damaged; fails_when=the command ends at its first step, the catalog's generation, with that record's refusal: the skill stays, and the sentence sends a learner who asked for a removal to Codebook: Set Up AI Chat; why_new=Cycle 0046 row 224; seam=the removal command with the real skill and catalog over a temporary home, whose catalog receipt is no JSON
test('a Remove Managed Cursor Skill whose Cursor MCP catalog record is damaged removes the skill all the same and warns with that record’s refusal, which names the removal as the command to run again; after the learner deletes the record as told, a second removal says that the skill was already removed and leaves the config', async () => {
  // Arrange: the catalog's receipt was cut off in the middle.
  const cursor = await removalCommandOverATemporaryHome(async () => {})
  await writeFile(cursor.catalogReceiptPath, '{"schemaVersion":1,')
  try {
    // Act: the warning is followed to the letter.
    await cursor.runRemoval()
    const skillAfterTheFirstRemoval = await access(cursor.skillPath).then(
      () => 'still there',
      (error: { code?: string }) => error.code,
    )
    const configAfterTheFirstRemoval = await readFile(cursor.configPath, 'utf8')
    await rm(cursor.catalogReceiptPath)
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        warnings: cursor.warnings,
        skillAfterTheFirstRemoval,
        configAfterTheFirstRemoval,
        informations: cursor.informations,
        configAfterTheSecondRemoval: await readFile(cursor.configPath, 'utf8'),
      },
      {
        warnings: [
          `Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${cursor.catalogReceiptPath}, then run Codebook: Remove Managed Cursor Skill again. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.`,
        ],
        skillAfterTheFirstRemoval: 'ENOENT',
        configAfterTheFirstRemoval: '{"mcpServers":{}}\n',
        informations: [
          'The managed Cursor skill was already removed. Codebook owns no Cursor MCP config; none was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
        ],
        configAfterTheSecondRemoval: '{"mcpServers":{}}\n',
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=the same learner when the record is damaged only after the removal's first step read it (another Cursor window, or a hand edit while the confirmation stood open); fails_when=the cleanup's refusal names Codebook: Set Up AI Chat, because the command handed its own title to the catalog's first step only; why_new=Cycle 0046 row 224: both catalog calls of the removal command get the command to name; seam=the removal command with the real skill and catalog over a temporary home, whose catalog receipt is cut off right before the cleanup
test('a Cursor MCP catalog record that is damaged between the two catalog steps of a Remove Managed Cursor Skill is refused by the cleanup with the removal as the command to run again', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome((catalogReceiptPath) =>
    writeFile(catalogReceiptPath, '{"schemaVersion":1,'),
  )
  try {
    // Act
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      { warnings: cursor.warnings, informations: cursor.informations },
      {
        warnings: [
          `Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${cursor.catalogReceiptPath}, then run Codebook: Remove Managed Cursor Skill again. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.`,
        ],
        informations: [],
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=the learner who runs Remove Managed Cursor Skill again after a removal that finished; fails_when=the notice says "Existing or changed Cursor MCP config preserved." although no config is there, because every removal that retires nothing is worded as a preserved config; why_new=Cycle 0046 row 246: the notice tells a config that was already retired from one that was preserved; seam=the removal command with the real skill and catalog over a temporary home
test('a Remove Managed Cursor Skill that is run again after one that finished says that the skill was already removed and that Codebook’s config was already retired, not that a config was preserved', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome(async () => {})
  try {
    // Act
    await cursor.runRemoval()
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        informations: cursor.informations,
        warnings: cursor.warnings,
        config: await access(cursor.configPath).then(
          () => 'still there',
          (error: { code?: string }) => error.code,
        ),
      },
      {
        informations: [
          'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
          "The managed Cursor skill was already removed. Codebook's empty Cursor MCP config was already retired; no config was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.",
        ],
        warnings: [],
        config: 'ENOENT',
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=a learner who asks Codebook to remove its Cursor setup while a link stands at the skill's path; fails_when=the refusal says "then run Codebook: Set Up AI Chat again", which installs again the skill the learner is removing, or the removal does not finish after the link is removed; why_new=Cycle 0046 row 244: every refusal of the skill that a removal meets names the removal; seam=the removal command with the real skill and catalog over a temporary home
test('a Remove Managed Cursor Skill that meets a link at the skill’s path says to remove the link and to run the removal again; after the learner removes the link, the removal finishes and retires the config Codebook created', async (context) => {
  // Arrange: the installed skill is moved away and a link to it stands at its path.
  const cursor = await removalCommandOverATemporaryHome(async () => {})
  const movedSkillPath = join(dirname(cursor.skillPath), 'moved-SKILL.md')
  await rename(cursor.skillPath, movedSkillPath)
  if (!(await createLinkIfAllowed(movedSkillPath, cursor.skillPath))) {
    await cursor.dispose()
    return context.skip(LINK_NOT_ALLOWED)
  }
  try {
    // Act: the refusal is followed to the letter.
    const refusal = await cursor.runRemoval().then(
      () => 'no refusal',
      (error: Error) => error.message,
    )
    await rm(cursor.skillPath)
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        refusal,
        informations: cursor.informations,
        warnings: cursor.warnings,
        movedSkill: await readFile(movedSkillPath, 'utf8'),
      },
      {
        refusal: `Codebook will not read through a link: ${cursor.skillPath}. To finish the removal, remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
        informations: [
          'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
        ],
        warnings: [],
        movedSkill: REMOVAL_TEST_SKILL,
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=a learner who asks Codebook to remove its Cursor setup while the skill's receipt is damaged; fails_when=the refusal sends the learner to Codebook: Set Up AI Chat, or the removal that is run again after the receipt and the folder were deleted ends with an error and leaves the config Codebook created; why_new=Cycle 0046 row 244: the invalid record's sentence names the removal, and a removal without a receipt goes on to the config; seam=the removal command with the real skill and catalog over a temporary home, whose skill receipt is cut off
test('a Remove Managed Cursor Skill whose skill receipt is invalid says to delete the receipt and the skill folder and to run the removal again; after the learner does so, the removal retires the config Codebook created and says that no Codebook-owned skill was found', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome(async () => {})
  await writeFile(cursor.skillReceiptPath, '{"schemaVersion":1,')
  try {
    // Act: the refusal is followed to the letter.
    const refusal = await cursor.runRemoval().then(
      () => 'no refusal',
      (error: Error) => error.message,
    )
    await rm(cursor.skillReceiptPath)
    await rm(dirname(cursor.skillPath), { recursive: true })
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        refusal,
        informations: cursor.informations,
        warnings: cursor.warnings,
        config: await access(cursor.configPath).then(
          () => 'still there',
          (error: { code?: string }) => error.code,
        ),
      },
      {
        refusal: `Cursor skill ownership receipt is invalid; no skill file was changed. To start over, delete ${cursor.skillReceiptPath} and the folder ${dirname(cursor.skillPath)} (first copy anything of yours out of that folder), then run Codebook: Remove Managed Cursor Skill again.`,
        informations: [
          'No Codebook-owned Cursor skill was found; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
        ],
        warnings: [],
        config: 'ENOENT',
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// Value: protects=a learner who runs Remove Managed Cursor Skill in a Cursor where Codebook's chat was never set up; fails_when=the command ends with an error ("No installed Codebook-owned Cursor skill was found; no file was changed.", or a refusal of the missing skills folder) instead of a notice that nothing was there to remove; why_new=Cycle 0046 row 244; seam=the removal command with the real skill and catalog over a temporary home that holds nothing
test('a Remove Managed Cursor Skill in a Cursor where Codebook was never set up ends with the notice that nothing was there to remove, and changes no file', async () => {
  // Arrange
  const cursor = await removalCommandOverATemporaryHome(async () => {}, false)
  try {
    // Act
    await cursor.runRemoval()

    // Assert
    assert.deepEqual(
      {
        informations: cursor.informations,
        warnings: cursor.warnings,
        home: await readdir(dirname(dirname(cursor.configPath))),
      },
      {
        informations: [
          'Nothing to remove: no Codebook-owned Cursor skill was found and Codebook owns no Cursor MCP config. No file was changed.',
        ],
        warnings: [],
        home: [],
      },
    )
  } finally {
    await cursor.dispose()
  }
})

// protects=TD-7 at activation: the window's workspace storage is handed to the orphan reaper once, with the shutdown grace, before any run starts; fails_when=activation never reaps, reaps another store, or uses another grace; no_claim=the reaper's matching and signals (nodeServerOrphans.test.ts)
test('activation hands the workspace storage to the node-server orphan reaper once', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-orphan-reap-')),
  )
  const reaped: Array<{ store: unknown; graceMs: number }> = []
  const workspaceState = {
    get: () => undefined,
    update: async (): Promise<void> => {},
  }
  const boundary = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode: {
        RelativePattern: FakeRelativePattern,
        commands: {
          registerCommand: () => ({ dispose(): void {} }),
        },
        workspace: {
          getConfiguration: () => ({ get: () => '.codebook/wiki' }),
          onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
          createFileSystemWatcher:
            createFakeFileWatching().createFileSystemWatcher,
        },
        env: { asExternalUri: keepLocalAddress },
        Uri: {
          parse: parseFakeUri,
          file: (fsPath: string) => ({ fsPath }),
        },
        window: {},
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
      './utils/reapNodeServerOrphans': {
        reapNodeServerOrphans: async (input: {
          store: unknown
          graceMs: number
        }) => {
          reaped.push({ store: input.store, graceMs: input.graceMs })
          return 0
        },
      },
    },
  )
  try {
    // Act
    boundary.activate({
      extensionPath: resolve(__dirname, '../..'),
      globalStorageUri: { fsPath: projectRoot },
      subscriptions: [],
      workspaceState,
    })
    // Assert
    assert.equal(reaped.length, 1)
    assert.equal(reaped[0]?.store, workspaceState)
    assert.equal(reaped[0]?.graceMs, 5_000)
  } finally {
    await boundary.deactivate()
    await rm(projectRoot, { recursive: true, force: true })
  }
})
