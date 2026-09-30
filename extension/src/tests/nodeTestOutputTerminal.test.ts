import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import { NodeTestOutputTerminal } from '../nodeTestOutputTerminal'

function terminalHarness(openOnShow = true) {
  const writes: string[] = []
  let pty: vscode.Pseudoterminal | undefined,
    disposed = 0,
    shown = 0
  const editor = {
    EventEmitter: class {
      private readonly listeners = new Set<(value: string) => void>()
      event = (listener: (value: string) => void) => {
        this.listeners.add(listener)
        return { dispose: () => this.listeners.delete(listener) }
      }
      fire(value: string): void {
        for (const listener of this.listeners) listener(value)
      }
      dispose(): void {
        this.listeners.clear()
      }
    },
    window: {
      createTerminal(options: { name: string; pty: vscode.Pseudoterminal }) {
        pty = options.pty
        pty.onDidWrite((value) => writes.push(value))
        return {
          name: options.name,
          show(): void {
            shown++
            if (openOnShow) pty?.open(undefined)
          },
          dispose(): void {
            disposed++
            pty?.close()
          },
        }
      },
    },
  } as unknown as ConstructorParameters<typeof NodeTestOutputTerminal>[1]
  return {
    editor,
    writes,
    close: () => pty?.close(),
    disposed: () => disposed,
    shown: () => shown,
  }
}

test('a Node test shows only the owned ordered output in a native terminal', async () => {
  // Arrange
  const harness = terminalHarness()
  const output = new NodeTestOutputTerminal(
    '12345678-0000-0000-0000-000000000000',
    harness.editor,
  )
  try {
    // Act
    await output.ready(AbortSignal.timeout(1_000))
    output.write({
      sequence: 1,
      elapsedMs: 12,
      channel: 'stdout',
      text: 'RUN\n',
    })
    output.write({
      sequence: 2,
      elapsedMs: 18,
      channel: 'stderr',
      text: 'failed assertion\n',
    })
    output.reveal()
    // Assert
    assert.equal(output.terminal.name, 'Codebook · Test output 12345678')
    assert.deepEqual(harness.writes, ['RUN\r\n', 'failed assertion\r\n'])
    assert.equal(harness.shown(), 2)
    assert.throws(
      () =>
        output.write({
          sequence: 2,
          elapsedMs: 19,
          channel: 'stdout',
          text: 'duplicate',
        }),
      /missing, repeated or out of order/,
    )
    assert.throws(
      () =>
        output.write({
          sequence: 3,
          elapsedMs: 17,
          channel: 'stdout',
          text: 'older',
        }),
      /missing, repeated or out of order/,
    )
  } finally {
    output.dispose()
  }
  assert.equal(harness.disposed(), 1)
})

test('closing the owned output terminal refuses later capture without reviving it', async () => {
  // Arrange
  const harness = terminalHarness()
  let closeSignals = 0
  const output = new NodeTestOutputTerminal(
    'closed-run',
    harness.editor,
    () => {
      closeSignals++
    },
  )
  await output.ready(AbortSignal.timeout(1_000))
  // Act
  harness.close()
  // Assert
  assert.throws(
    () =>
      output.write({
        sequence: 1,
        elapsedMs: 1,
        channel: 'stdout',
        text: 'late',
      }),
    /was closed/,
  )
  assert.throws(() => output.reveal(), /was closed/)
  output.dispose()
  output.dispose()
  assert.equal(closeSignals, 1)
  assert.equal(harness.disposed(), 1)
})

test('owned terminal cleanup never reports a learner close', async () => {
  // Arrange
  const harness = terminalHarness()
  let closeSignals = 0
  const output = new NodeTestOutputTerminal(
    'finished-run',
    harness.editor,
    () => {
      closeSignals++
    },
  )
  await output.ready(AbortSignal.timeout(1_000))
  // Act
  output.dispose()
  // Assert
  assert.equal(closeSignals, 0)
  assert.equal(harness.disposed(), 1)
})

test('a Node test never launches when its output terminal cannot open', async () => {
  // Arrange
  const harness = terminalHarness(false)
  const output = new NodeTestOutputTerminal('unopened-run', harness.editor)
  const ready = output.ready(AbortSignal.timeout(1_000))
  // Act
  output.dispose()
  // Assert
  await assert.rejects(ready, /closed before capture was ready/)
  assert.equal(harness.disposed(), 1)
})
