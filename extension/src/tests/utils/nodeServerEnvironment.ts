import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TestContext } from 'node:test'

import type * as EnvironmentModule from '../../environment'

import { loadModule } from './loadModule'

/**
 * Creates the real environment over a temporary trusted workspace with a fake editor, whose node-server machine check answers the given gaps, so a test reads what `prerequisites()` and the confirmation hook do without a real `lsof` or `ps`.
 * @param context - The test, which removes the folder and disposes the environment when it ends.
 * @param options - The machine gaps the stubbed check reports, and the answers of the editor's modal question.
 * @returns The environment, and the modal questions the editor was asked.
 * @example const { environment } = await createEnvironmentWith(context, { gaps: [] })
 */
export async function createEnvironmentWith(
  context: TestContext,
  options: { gaps: string[]; modalChoice?: string | undefined },
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-server-env-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(
    join(directory, 'product.json'),
    JSON.stringify({ version: '1.140.0', commit: 'fixture' }),
  )
  await mkdir(join(directory, 'dist'))
  await writeFile(
    join(directory, 'dist/build.json'),
    JSON.stringify({
      revision: 'fixture',
      dirty: false,
      sourceHash: 'fixture',
    }),
  )
  const chromeExecutable = join(directory, 'chrome')
  await writeFile(chromeExecutable, '#!/bin/sh\n', { mode: 0o755 })
  const disposable = { dispose(): void {} }
  const questions: unknown[][] = []
  const boundary = await loadModule<typeof EnvironmentModule>(
    resolve(__dirname, '../../environment.js'),
    {
      './configuredBrowserRun': {},
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => '/external/node',
      },
      './utils/nodeServerMachineGaps': {
        nodeServerMachineGaps: async () => options.gaps,
      },
      './utils/searchRepositoryVitest': {
        searchRepositoryVitest: async () => ({ vitestSearch: 'none' }),
      },
      'node:util': {
        promisify: () => async () => ({ stdout: 'Google Chrome 140.0' }),
      },
      vscode: {
        workspace: {
          isTrusted: true,
          workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
          textDocuments: [],
          getConfiguration: () => ({
            get: (key: string, fallback: string) =>
              key === 'chromeExecutable' ? chromeExecutable : fallback,
          }),
        },
        window: {
          showWarningMessage: async (...question: unknown[]) => {
            questions.push(question)
            return options.modalChoice
          },
        },
        env: {
          appRoot: directory,
          appName: 'Visual Studio Code',
          remoteName: 'wsl',
        },
        version: '1.140.0',
        extensions: { getExtension: () => ({}) },
        debug: {
          registerDebugAdapterTrackerFactory: () => disposable,
          onDidTerminateDebugSession: () => disposable,
          onDidChangeActiveDebugSession: () => disposable,
        },
      },
    },
  )
  const environment = await boundary.createEnvironment({
    extensionPath: directory,
  })
  context.after(() => environment.dispose())
  return { environment, questions }
}
