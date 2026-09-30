import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'

import type * as vscode from 'vscode'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { Cdp } from '../runtimeSupport/cdp'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { bindOwnedNodeTestDebugSession } from '../utils/bindOwnedNodeTestDebugSession'
import {
  launchNodeTest,
  type NodeTestOutputEvent,
} from '../utils/launchNodeTest'
import { verifyNodeTestInspectorOwnership } from '../utils/verifyNodeTestInspectorOwnership'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

test('an owned Node test announces its own loopback debugger and releases the paused process', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-owned-node-test-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "const inspector = require('node:inspector'); const port = Number(process.argv.find(value => value.startsWith('--inspect-brk='))?.split('=')[1]); inspector.open(port, '127.0.0.1'); setInterval(() => {}, 1000);\n",
  )
  const events: string[] = []
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const owned = await launchNodeTest(launch, process.execPath, (type) =>
    events.push(type),
  )
  let inspector: Cdp | undefined
  let boundDebugger:
    Awaited<ReturnType<typeof bindOwnedNodeTestDebugSession>> | undefined
  try {
    // Act
    const endpoint = await owned.inspectorEndpoint(AbortSignal.timeout(10_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    const identity = await verifyNodeTestInspectorOwnership(
      inspector,
      workspace,
      owned.processGroup!,
      AbortSignal.timeout(10_000),
      () => undefined,
    )
    const debuggerUrl = new URL(endpoint)
    const session = {
      id: 'owned-session',
      configuration: {
        name: 'codebook node test observed-run',
        type: 'pwa-node',
        request: 'attach',
      },
      customRequest: async () => ({
        host: debuggerUrl.hostname,
        port: Number(debuggerUrl.port),
        path: debuggerUrl.pathname,
      }),
    } as unknown as vscode.DebugSession
    boundDebugger = await bindOwnedNodeTestDebugSession(
      session,
      'observed-run',
      workspace,
      owned.processGroup!,
      AbortSignal.timeout(10_000),
      (sessionId) => assert.equal(sessionId, 'owned-session'),
    )
    // Assert
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/[a-f\d-]{36}$/i)
    assert.ok(owned.pid && owned.pid > 0)
    assert.equal(identity.pid, owned.pid)
    assert.equal(boundDebugger.identity.pid, owned.pid)
    await assert.rejects(
      bindOwnedNodeTestDebugSession(
        session,
        'another-run',
        workspace,
        owned.processGroup!,
        AbortSignal.timeout(10_000),
        () => undefined,
      ),
      /does not belong/,
    )
    await assert.rejects(
      bindOwnedNodeTestDebugSession(
        session,
        'observed-run',
        workspace,
        owned.processGroup! + 1,
        AbortSignal.timeout(10_000),
        () => undefined,
      ),
      /different process group/,
    )
    await assert.rejects(
      bindOwnedNodeTestDebugSession(
        session,
        'observed-run',
        workspace,
        owned.processGroup!,
        AbortSignal.timeout(10_000),
        () => {
          throw new Error('Session terminated')
        },
      ),
      /Session terminated/,
    )
    await assert.rejects(
      verifyNodeTestInspectorOwnership(
        inspector,
        workspace,
        owned.processGroup! + 1,
        AbortSignal.timeout(10_000),
        () => undefined,
      ),
      /different process group/,
    )
    assert.deepEqual(events, ['node-test.started'])
  } finally {
    boundDebugger?.cdp.close()
    inspector?.close()
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
  assert.deepEqual(events, ['node-test.started', 'node-test.closed'])
})

test('a Node test that exits before inspection reports the failure and still cleans up', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-exiting-node-test-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(program, 'process.exit(7)\n')
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const owned = await launchNodeTest(launch, process.execPath, () => undefined)
  try {
    // Act / Assert
    await assert.rejects(
      owned.inspectorEndpoint(AbortSignal.timeout(10_000)),
      /exited before debugger attachment/,
    )
  } finally {
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a Node test reports its final exit and output after a long log', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-result-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "process.stdout.write('x'.repeat(40000)); process.stdout.write('\\n9 tests passed\\n'); process.exitCode = 0;\n",
  )
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const outputEvents: NodeTestOutputEvent[] = []
  const owned = await launchNodeTest(
    launch,
    process.execPath,
    () => undefined,
    (event) => {
      outputEvents.push(event)
    },
  )
  try {
    // Act
    const result = await owned.result(AbortSignal.timeout(10_000))
    // Assert
    assert.equal(result.exitCode, 0)
    assert.equal(result.signal, null)
    assert.ok(Buffer.byteLength(result.output) <= 32_768)
    assert.match(result.output, /9 tests passed\n$/)
    assert.ok(outputEvents.length > 1)
    assert.ok(
      outputEvents.every(
        (event) => event.channel === 'stdout' && event.text.length <= 4_096,
      ),
    )
    assert.deepEqual(
      outputEvents.map((event) => event.sequence),
      outputEvents.map((_, index) => index + 1),
    )
    assert.ok(
      outputEvents.every(
        (event, index) =>
          event.elapsedMs >= (outputEvents[index - 1]?.elapsedMs ?? 0),
      ),
    )
    assert.match(
      outputEvents.map((event) => event.text).join(''),
      /9 tests passed\n$/,
    )
  } finally {
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a test file still running 20 seconds after its final continuation reports its real exit instead of timing out', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-long-result-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "setTimeout(() => { process.stdout.write('1 test passed\\n'); process.exitCode = 0; }, 300);\n",
  )
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const owned = await launchNodeTest(launch, process.execPath, () => undefined)
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // Act: the remaining tests outlast the 20-second DAP response bound before the process exits.
    const pending = owned.result(new AbortController().signal)
    mock.timers.tick(20_001)
    const result = await pending

    // Assert
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /1 test passed\n$/)
  } finally {
    mock.timers.reset()
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a Node test reports stdout and stderr separately with valid Unicode text', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-channels-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "process.stdout.write('準備完了\\n'); process.stderr.write('failed assertion\\n'); process.exitCode = 1;\n",
  )
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const outputEvents: NodeTestOutputEvent[] = []
  const owned = await launchNodeTest(
    launch,
    process.execPath,
    () => undefined,
    (event) => {
      outputEvents.push(event)
    },
  )
  try {
    // Act
    const result = await owned.result(AbortSignal.timeout(10_000))
    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      outputEvents
        .filter((event) => event.channel === 'stdout')
        .map((event) => event.text)
        .join(''),
      '準備完了\n',
    )
    assert.equal(
      outputEvents
        .filter((event) => event.channel === 'stderr')
        .map((event) => event.text)
        .join(''),
      'failed assertion\n',
    )
  } finally {
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test('output that arrives while an earlier line is still being saved reaches the history before a debugger stop accepted after it', async () => {
  // Arrange: the test prints two lines 150 ms apart; the history confirms the first line's durable write only when the driver allows it, as a slow disk would.
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-output-order-'))
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "process.stdout.write('first line\\n'); setTimeout(() => process.stdout.write('second line\\n'), 150); setTimeout(() => { process.exitCode = 0; }, 400);\n",
  )
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const header = nodeTestHistoryHeader(sha256('node-output-order-workspace'))
  const store = new NodeTestHistoryStore(
      join(workspace, '.learning'),
      header.workspaceKey,
    ),
    writer = await store.start(header)
  let confirmFirstWrite!: () => void
  const firstWriteConfirmed = new Promise<void>((resolve) => {
    confirmFirstWrite = resolve
  })
  const owned = await launchNodeTest(
    launch,
    process.execPath,
    () => undefined,
    (event) => {
      const saved = writer.appendOutput(event)
      return event.sequence === 1
        ? saved.then(() => firstWriteConfirmed)
        : saved
    },
  )
  const sourceText = 'const nextTheme = "dark";\n'
  try {
    // Act: the debugger stop is accepted after the second line arrived but before the first line's write is confirmed.
    await waitUntil(
      () => owned.output().includes('second line'),
      'second test output line',
      10_000,
    )
    const stopSaved = writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: owned.elapsedMs(),
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
      variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'notifyManager',
            line: 1,
            column: 1,
            source: {
              name: header.configuration.source.path,
              text: sourceText,
              hash: sha256(sourceText),
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    })
    confirmFirstWrite()
    await stopSaved
    const result = await owned.result(AbortSignal.timeout(10_000))
    const history = await store.read(header.studyId)

    // Assert
    assert.equal(result.exitCode, 0)
    assert.deepEqual(
      history.entries.map((entry) =>
        entry.type === 'output' ? entry.text : entry.type,
      ),
      ['first line\n', 'second line\n', 'stop'],
    )
    assert.ok(
      history.entries.every(
        (entry, index) =>
          entry.elapsedMs >= (history.entries[index - 1]?.elapsedMs ?? 0),
      ),
      'the journal stays in time order',
    )
  } finally {
    confirmFirstWrite()
    await owned.close()
    await writer.finish('partial', 'Output order test.').catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a failed Node output observer refuses capture and releases its process', async () => {
  // Arrange
  const workspace = await mkdtemp(
    join(tmpdir(), 'codebook-node-output-failure-'),
  )
  const program = join(workspace, 'runner.cjs')
  await writeFile(
    program,
    "process.stdout.write('test output'); setInterval(() => {}, 1000);\n",
  )
  const launch = {
    workspace,
    program,
    sourceFile: program,
    testFile: program,
    stops: [],
    args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'],
  }
  const owned = await launchNodeTest(
    launch,
    process.execPath,
    () => undefined,
    () => {
      throw new Error('recording unavailable')
    },
  )
  try {
    // Act / Assert
    await assert.rejects(
      owned.inspectorEndpoint(AbortSignal.timeout(10_000)),
      /Node test output capture failed: Error: recording unavailable/,
    )
  } finally {
    await owned.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test(
  'a Node test logging faster than its history can be saved fails capture instead of buffering the whole log in memory',
  { timeout: 60_000 },
  async () => {
    // Arrange: 12 MiB of output while the first durable history write is still pending.
    const workspace = await mkdtemp(
      join(tmpdir(), 'codebook-node-output-flood-'),
    )
    const program = join(workspace, 'runner.cjs')
    await writeFile(
      program,
      "process.stdout.write('x'.repeat(12 * 1024 * 1024)); process.stdout.write('END'); process.exitCode = 0;\n",
    )
    const launch = {
      workspace,
      program,
      sourceFile: program,
      testFile: program,
      stops: [],
      args: [
        'run',
        'src/test.test.ts',
        '--inspect-brk',
        '--no-file-parallelism',
      ],
    }
    let deliveredBytes = 0,
      historyWrites = Promise.resolve(),
      owned: Awaited<ReturnType<typeof launchNodeTest>> | undefined
    // eslint-disable-next-line prefer-const -- launch callbacks may run before the launch resolves and read this binding.
    owned = await launchNodeTest(
      launch,
      process.execPath,
      () => undefined,
      (event) => {
        // Like the durable history, each write waits for the one before it. The first stays pending until the whole log has arrived, as a slow disk would;
        // a regression fails here instead of hanging.
        const isFirstWrite = event.sequence === 1
        historyWrites = historyWrites.then(async () => {
          if (isFirstWrite)
            await new Promise<void>((resolve, reject) => {
              const deadline = Date.now() + 30_000
              const poll = setInterval(() => {
                if (owned?.output().endsWith('END')) {
                  clearInterval(poll)
                  resolve()
                } else if (Date.now() > deadline) {
                  clearInterval(poll)
                  reject(
                    new Error(
                      'The flooding test output never finished arriving.',
                    ),
                  )
                }
              }, 10)
            })
          deliveredBytes += Buffer.byteLength(event.text)
        })
        return historyWrites
      },
    )
    try {
      // Act
      const result = owned.result(AbortSignal.timeout(20_000))

      // Assert
      await assert.rejects(
        result,
        /output outpaced its durable history beyond the history size limit/,
      )
      assert.ok(
        deliveredBytes <= 8_388_608,
        `at most the 8 MiB history limit was queued for saving, not ${deliveredBytes} bytes`,
      )
    } finally {
      await owned.close()
      await rm(workspace, { recursive: true, force: true })
    }
  },
)
