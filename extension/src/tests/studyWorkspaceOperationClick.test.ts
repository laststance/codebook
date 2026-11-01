import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { configuredWorkspaceHarness } from './studyWorkspaceHarness'
import type { ControlledConfiguredRuntime } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'
import { defer } from './utils/defer'

/**
 * Starts a version 3 run of one ask-learner password operation in the configured Study workspace harness, shown in the Study pane and ready for its Click.
 * The editor's masked box is a stand-in that stays open (as the real one does with `ignoreFocusOut`) until the learner types into it or the run's own signal withdraws it.
 * @returns The harness, the run, its controlled runtime, `boxOpened`, which settles once the box is shown, `boxTitles`, the title of every box shown, and `typeIntoBox`, which answers it.
 */
async function passwordRunInStudyPane() {
  const harness = await configuredWorkspaceHarness()
  const runtimes: ControlledOperationsRuntime[] = []
  harness.service.environment.createRuntime = async (root, definition) => {
    if (!definition || typeof definition === 'string')
      throw new Error('The operation click harness expects a declared article.')
    const runtime = new ControlledOperationsRuntime(root, definition)
    runtimes.push(runtime)
    // Returned as the configured runtime it extends, as the configured service harness does: its list of typed secrets is no runtime's secret set.
    const configuredRuntime: ControlledConfiguredRuntime = runtime
    return configuredRuntime
  }
  const boxOpened = defer<void>(),
    typed = defer<string>(),
    boxTitles: string[] = []
  harness.service.environment.askLearnerSecret = (question, signal) => {
    boxTitles.push(question.title)
    boxOpened.resolve()
    // The box stays open without focus until the learner types; the run's Stop or the wait's end closes it unanswered.
    return new Promise<string | undefined>((resolve) => {
      signal.addEventListener('abort', () => resolve(undefined))
      void typed.promise.then(resolve)
    })
  }
  const configuration = harness.study.configuration
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: 'repository-browser',
    key: randomUUID(),
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      entryPath: '/',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations: [
        {
          kind: 'text',
          title: 'Password',
          selector: '#password',
          secret: 'ask-learner',
        },
      ],
      inspections: configuration.inspections,
    },
  })
  const record = harness.service.records.get(receipt.runId)!
  await record.preparation
  assert.equal(record.error, undefined)
  await harness.reader.open()
  await harness.reader.action('return-current')
  return {
    harness,
    record,
    runtime: runtimes[0]!,
    boxOpened,
    boxTitles,
    typeIntoBox: typed.resolve,
  }
}

// protects=OCR 46: the learner can stop a run from the Study pane while the masked password box its Click opened is still waiting for an answer, and the pane offers Stop but no second Click meanwhile; fails_when=the Click holds the pane's control section for the whole wait, so Stop is refused with 'A study control request is already pending.' and the pane reads busy until the box is answered or 5 minutes pass; no_claim=the native input box (a stand-in that waits on the run's signal) and the webview's button rendering
test('Stop in the Study pane ends a run while the password box its Click opened is still waiting for the learner', async () => {
  // Arrange
  const { harness, record, runtime, boxOpened } = await passwordRunInStudyPane()
  try {
    const click = harness.reader.action('click')
    // The Click's answer is read after the Stop; its refusal is caught at once so it is never unhandled meanwhile.
    const clickOutcome = click.then(
      () => 'sent',
      (error: unknown) => error,
    )
    await boxOpened.promise
    const paneWhileAsking = harness.reader.inspect().view!
    // Act
    await harness.reader.action('stop')
    // Assert
    assert.equal(paneWhileAsking.busy, false)
    assert.equal(paneWhileAsking.canClick, false)
    assert.equal(record.stopped, true)
    const outcome = await clickOutcome
    assert.ok(outcome instanceof Error)
    assert.match(
      outcome.message,
      /^The learner did not provide the secret for operation 1 \(Password\), so nothing was sent\./,
    )
    assert.equal(runtime.dispatches, 0)
  } finally {
    await harness.close()
  }
})

// protects=OCR 46: a second Click from the command palette while the first Click's password box is open is refused at once with what to do, asks nothing twice, and leaves the pane's Click off; fails_when=the second Click reaches the run, so it is refused only as the run's BUSY and its end turns the pane's Click back on while the box is still open; no_claim=the native input box (a stand-in) and the command palette (the reader's action is called as its command does)
test('a second Click while the password box of the first is open is refused and keeps the pane Click off', async () => {
  // Arrange
  const { harness, boxOpened, boxTitles, typeIntoBox } =
    await passwordRunInStudyPane()
  try {
    // The first Click's answer is read at the end; its refusal is caught at once so it is never unhandled meanwhile.
    const firstClickOutcome = harness.reader.action('click').then(
      () => 'sent',
      (error: unknown) => error,
    )
    await boxOpened.promise
    // Act
    const secondClick = harness.reader.action('click')
    // Assert
    await assert.rejects(secondClick, {
      message: 'Answer the question the last Click opened in the editor first.',
    })
    assert.deepEqual(boxTitles, ['Password'])
    assert.equal(harness.reader.inspect().view!.canClick, false)
    typeIntoBox('typed-by-learner')
    assert.equal(await firstClickOutcome, 'sent')
  } finally {
    await harness.close()
  }
})

// protects=OCR 46 regression of X1: the Study pane's Click still sends the password operation once the learner typed into the box, and the pane is free for the next control afterwards; fails_when=the Click no longer waits for the answer, sends nothing or another value, or leaves the pane busy or reporting an error after the answer; no_claim=the native input box (a stand-in) and the page input (the controlled runtime records the value)
test('Click in the Study pane sends the password operation with what the learner typed, then frees the pane', async () => {
  // Arrange
  const { harness, runtime, boxOpened, typeIntoBox } =
    await passwordRunInStudyPane()
  try {
    const click = harness.reader.action('click')
    await boxOpened.promise
    // Act
    typeIntoBox('typed-by-learner')
    await click
    // Assert
    assert.equal(runtime.dispatches, 1)
    assert.deepEqual(runtime.learnerSecrets, ['typed-by-learner'])
    const pane = harness.reader.inspect().view!
    assert.equal(pane.busy, false)
    // The pane's lines are an array of the reader's module context: copied, they compare as plain values.
    assert.deepEqual([...pane.errors], [])
  } finally {
    await harness.close()
  }
})
