import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'

test('repository native QA reports an editor exit that arrives during launch metadata persistence', async () => {
  // Arrange: run the actual script with controlled process and filesystem boundaries.
  const filename = resolve(
    __dirname,
    '../../scripts/native-repository-session.mjs',
  )
  const source = (await readFile(filename, 'utf8'))
    .replace(/^import\b[\s\S]*?from '[^']+';?\n/gm, '')
    .replaceAll('import.meta.url', 'moduleUrl')
  const child = Object.assign(new EventEmitter(), { pid: 42 })
  const processBoundary = {
    env: { CODEBOOK_WORKSPACE: '/external/repository' },
    argv: ['/node', filename],
    execPath: '/node',
    exitCode: undefined,
  }
  const messages: string[] = []
  let completed = false
  const execution: Promise<void> = runInNewContext(
    `(async () => { ${source} })()`,
    {
      moduleUrl: pathToFileURL(filename).href,
      dirname,
      join,
      resolve,
      fileURLToPath,
      process: processBoundary,
      console: {
        log(message: string) {
          messages.push(message)
        },
      },
      randomUUID: () => 'one-run',
      selectHost: () => 'vscode',
      readHostInstallation: async () => ({
        host: { id: 'vscode' },
        binaryPath: '/editor',
        cliVersion: 'test',
      }),
      createNativeProfile: async () => '/private-profile',
      mkdir: async () => {},
      readFile: async () => '{}',
      openSync: () => 3,
      closeSync: () => {},
      spawn: () => child,
      writeFile: async (path: string) => {
        if (path.endsWith('/live-launch.json')) child.emit('exit', 23)
      },
    },
    { filename },
  )
  const observed = execution.then(() => {
    completed = true
  })
  try {
    // Act
    await setImmediate()
    // Assert: no duplicate exit notification is needed to release the launcher.
    assert.equal(completed, true)
    assert.equal(processBoundary.exitCode, 23)
    assert.equal(JSON.parse(messages.at(-1)!).exitCode, 23)
  } finally {
    child.emit('exit', 23)
    await observed
  }
})

for (const target of [
  {
    title: 'repository',
    relativePath: '../../scripts/native-repository-session.mjs',
    failure: 'build-read',
  },
  {
    title: 'repository',
    relativePath: '../../scripts/native-repository-session.mjs',
    failure: 'manifest-write',
  },
]) {
  test(`${target.title} native QA drains its owned editor when ${target.failure} fails`, async () => {
    // Arrange: run the actual launcher and keep its child alive until termination is observed.
    const filename = resolve(__dirname, target.relativePath)
    const source = (await readFile(filename, 'utf8'))
      .replace(/^import\b[\s\S]*?from '[^']+';?\n/gm, '')
      .replaceAll('import.meta.url', 'moduleUrl')
    const signals: string[] = []
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      kill(signal: string) {
        signals.push(signal)
        queueMicrotask(() => child.emit('exit', null))
        return true
      },
    })
    let acquired = false
    let descriptorClosed = false
    const messages: string[] = []
    const execution: Promise<void> = runInNewContext(
      `(async () => { ${source} })()`,
      {
        moduleUrl: pathToFileURL(filename).href,
        dirname,
        join,
        resolve,
        fileURLToPath,
        setTimeout,
        clearTimeout,
        process: {
          env: { CODEBOOK_WORKSPACE: '/external/repository' },
          argv: ['/node', filename],
          execPath: '/node',
        },
        console: {
          log(message: string) {
            messages.push(message)
          },
        },
        randomUUID: () => 'one-run',
        selectHost: () => 'vscode',
        readHostInstallation: async () => ({
          host: { id: 'vscode' },
          binaryPath: '/editor',
          cliVersion: 'test',
        }),
        createNativeProfile: async () => '/private-profile',
        mkdtemp: async () => '/private-profile',
        mkdir: async () => {},
        readFile: async (path: string) => {
          if (
            target.failure === 'build-read' &&
            path.endsWith('/dist/build.json')
          )
            throw new Error('injected build metadata failure')
          return '{}'
        },
        writeFile: async (path: string) => {
          if (
            acquired &&
            target.failure === 'manifest-write' &&
            path.endsWith('launch.json')
          )
            throw new Error('injected launch metadata failure')
        },
        execFileSync: () => 'source.ts',
        sha256: () => 'source-hash',
        openSync: () => 3,
        closeSync: () => {
          descriptorClosed = true
        },
        spawn: () => {
          acquired = true
          return child
        },
      },
      { filename },
    )

    // Act
    await assert.rejects(execution, /injected (build|launch) metadata failure/)

    // Assert: the failing launcher keeps no live child or log descriptor and publishes no success receipt.
    assert.equal(acquired, true)
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(descriptorClosed, true)
    assert.deepEqual(messages, [])
  })
}
