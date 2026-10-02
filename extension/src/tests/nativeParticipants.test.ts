import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

const pauseReady = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  name: 'server' | 'browser',
) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants[name]?.snapshot
  }, `${name} committed stop`)

test('a result already visible before input cannot establish completion', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.satisfyAfterBeforeInput()
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'preexisting result rejected',
  )
  await harness.run.stop()
  // Assert
  assert.match(
    harness.run.view().failures.join(' '),
    /already true before application input/,
  )
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

test('an internal browser CDP pause that auto resumes cannot invalidate a server-only result', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  // Act
  const continuation = harness.run.continue('server', server.pause)
  await waitUntil(
    () =>
      harness.run
        .view()
        .events.some((event) => event.type === 'dap.resume-request'),
    'server continuation requested',
  )
  harness.emitBrowserAdapterPause()
  harness.emitResume('browser')
  harness.releaseContinueResponse()
  await continuation
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'server-only result after internal browser pause',
  )
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run.view().operation?.afterVerified, true)
})

test('a held browser CDP pause during a server-only result cannot claim completion', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  // Act
  const continuation = harness.run.continue('server', server.pause)
  await waitUntil(
    () =>
      harness.run
        .view()
        .events.some((event) => event.type === 'dap.resume-request'),
    'server continuation requested',
  )
  harness.emitBrowserAdapterPause()
  harness.releaseContinueResponse()
  await continuation.catch(() => undefined)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'held browser pause rejected',
  )
  // Assert
  assert.equal(harness.run.view().operation?.afterVerified, false)
  assert.match(harness.run.view().failures.join(' '), /browser stop/)
})

test('a browser DAP stop during a server-only result remains a competing pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  // Act
  const continuation = harness.run.continue('server', server.pause)
  await waitUntil(
    () =>
      harness.run
        .view()
        .events.some((event) => event.type === 'dap.resume-request'),
    'server continuation requested',
  )
  harness.emitBrowserAdapterPause()
  harness.run.onEvent(harness.sessions.browser, {
    type: 'event',
    seq: 903,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  harness.releaseContinueResponse()
  await continuation.catch(() => undefined)
  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.equal(harness.run.view().operation?.afterVerified, false)
  assert.match(
    harness.run.view().failures.join(' '),
    /Unowned browser DAP stop/,
  )
})

test('one input retains server/browser/server sources and independent native generations while video stays on the browser', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual(harness.identities, ['server'])
  assert.equal(harness.launches[0]?.restart, false)
  assert.equal(harness.launches[0]?.continueOnAttach, false)
  assert.equal(
    harness.run
      .view()
      .events.some((event) => event.type === 'breakpoint.registered'),
    true,
  )
  // Act
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  await assert.rejects(
    harness.run.continue('browser', first.pause),
    /stale, foreign/,
  )
  await harness.run.continue('server', first.pause)
  const second = await pauseReady(harness, 'browser')
  await harness.run.continue('browser', second.pause)
  const third = await pauseReady(harness, 'server')
  await harness.run.continue('server', third.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed cross-runtime action',
  )
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.equal(
    JSON.stringify(
      view.snapshots.map((snapshot) => [
        snapshot.participant,
        snapshot.pause.generation,
      ]),
    ),
    JSON.stringify([
      ['server', 1],
      ['browser', 1],
      ['server', 2],
    ]),
  )
  assert.equal(first.values['value:mode'], 'display')
  assert.equal(second.values['value:nextTheme'], 'dark')
  assert.notEqual(first.source.hash, second.source.hash)
  assert.equal(
    harness.run.source(first.itemId, first.id)?.source,
    first.source.text,
  )
  assert.equal(
    harness.run.source(second.itemId, second.id)?.source,
    second.source.text,
  )
  assert.equal(harness.run.source(first.itemId, 'foreign-snapshot'), undefined)
  assert.equal(
    harness.commands.filter(
      (command) => command.method === 'Input.dispatchMouseEvent',
    ).length,
    2,
  )
  assert.equal(
    harness.commands.some(
      (command) =>
        command.participant === 'server' && command.method.startsWith('Page.'),
    ),
    false,
  )
  assert.equal(
    JSON.parse(
      await readFile(
        join(view.artifactDirectory, 'snapshot-server-1.json'),
        'utf8',
      ),
    ).id,
    first.id,
  )
  assert.equal(
    JSON.parse(
      await readFile(
        join(view.artifactDirectory, 'snapshot-browser-1.json'),
        'utf8',
      ),
    ).id,
    second.id,
  )
  assert.equal(view.finalOutcome, 'demonstrated')
  assert.equal(view.resourcesReleased, true)
  assert.equal(harness.breakpoints.length, 0)
  assert.ok(harness.released.includes('server-session'))
  assert.ok(harness.released.includes('browser-root'))
})

test('an idle browser continuation while a server stop is current preserves the next owned pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const firstServer = await pauseReady(harness, 'server')
  await harness.run.continue('server', firstServer.pause)
  const browser = await pauseReady(harness, 'browser')
  await harness.run.continue('browser', browser.pause)
  const lastServer = await pauseReady(harness, 'server')
  // Act
  harness.run.onEvent(harness.sessions.browser, {
    type: 'event',
    seq: 901,
    event: 'continued',
    body: { threadId: 1 },
  })
  // Assert
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(harness.run.view().failures.length, 0)
  await harness.run.continue('server', lastServer.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after idle browser continuation',
  )
})

// Both native participants must preserve the same historical generation across a presentation-only stack refresh.
for (const participant of ['server', 'browser'] as const)
  test(`${participant} stack refresh preserves its captured pause and allows the declared path to complete`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(context)
    await harness.run.prepare()
    harness.run.action('once', 'repository-click')
    const server = await pauseReady(harness, 'server')
    if (participant === 'browser')
      await harness.run.continue('server', server.pause)
    const captured =
      participant === 'server' ? server : await pauseReady(harness, 'browser')
    const snapshotCount = harness.run.view().snapshots.length

    // Act: js-debug refreshes its presentation without a client request or CDP runtime resume.
    harness.run.onEvent(harness.sessions[participant], {
      type: 'event',
      seq: 910,
      event: 'continued',
      body: { threadId: 1 },
    })
    harness.run.onEvent(harness.sessions[participant], {
      type: 'event',
      seq: 911,
      event: 'stopped',
      body: { reason: 'breakpoint', threadId: 1 },
    })
    await waitUntil(() => {
      const view = harness.run.view()
      if (view.failures.length) throw new Error(view.failures.join('; '))
      return view.events.some((event) => event.type === 'dap.pause-refreshed')
    }, 'same native pause refreshed')

    // Assert
    assert.equal(harness.run.view().status, `paused-${participant}`)
    assert.equal(
      harness.run.view().participants[participant]?.snapshot?.id,
      captured.id,
    )
    assert.equal(
      harness.run.view().participants[participant]?.pause?.generation,
      1,
    )
    assert.equal(harness.run.view().snapshots.length, snapshotCount)
    await harness.run.continue(participant, captured.pause)
    // Finish the already declared path; refreshing must not skip or duplicate its remaining stops.
    if (participant === 'server') {
      const browser = await pauseReady(harness, 'browser')
      await harness.run.continue('browser', browser.pause)
    }
    const finalServer = await pauseReady(harness, 'server')
    await harness.run.continue('server', finalServer.pause)
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'completed after native refresh',
    )
    assert.equal(harness.run.view().failures.length, 0)
    assert.equal(harness.run.view().snapshots.length, 3)
    assert.equal(
      harness.commands.filter(
        (command) => command.method === 'Input.dispatchMouseEvent',
      ).length,
      2,
    )
  })

test('Codebook refuses continuation during an unconfirmed native stack refresh without revoking the actual pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')

  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 912,
    event: 'continued',
    body: { threadId: 1 },
  })
  await assert.rejects(harness.run.continue('server', server.pause), /conflict/)

  // Assert
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(harness.run.view().participants.server?.pause?.generation, 1)
  assert.equal(
    harness.commands.some((command) => command.method === 'continue'),
    false,
  )
})

test('a changed native source location after stack refresh cannot reuse the captured pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')
  harness.movePausedFrame(2)

  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 913,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 914,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'changed refreshed source rejected',
  )

  // Assert
  assert.match(
    harness.run.view().failures.join(' '),
    /refresh.*source|source.*refresh/i,
  )
  assert.equal(harness.run.view().participants.server?.pause, undefined)
  assert.equal(harness.run.view().snapshots.length, 1)
})

// Independent runtime and client receipts continue to distinguish a true resume from stack presentation.
for (const resume of ['native client', 'CDP runtime'] as const)
  test(`${resume} resume during stack refresh invalidates the original captured pause`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(context)
    await harness.run.prepare()
    harness.run.action('once', 'repository-click')
    const server = await pauseReady(harness, 'server')
    harness.run.onEvent(harness.sessions.server, {
      type: 'event',
      seq: 915,
      event: 'continued',
      body: { threadId: 1 },
    })

    // Act
    if (resume === 'native client')
      harness.run.onRequest(harness.sessions.server, {
        type: 'request',
        seq: 916,
        command: 'continue',
        arguments: { threadId: 1 },
      })
    else harness.emitResume('server')

    // Assert
    assert.equal(harness.run.view().status, 'failed')
    assert.equal(harness.run.view().participants.server?.pause, undefined)
    await assert.rejects(
      harness.run.continue('server', server.pause),
      /conflict/,
    )
  })

test('a different native thread cannot re-adopt the captured generation during stack refresh', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 917,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 918,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 2 },
  })

  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.equal(harness.run.view().participants.server?.pause, undefined)
  assert.equal(harness.run.view().snapshots.length, 1)
})

test('closing during delayed stack refresh verification cannot revive the captured pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')
  const originalRequest = harness.sessions.server.customRequest
  let releaseStack = (): void => {},
    stackRequested = false
  const delayedStack = new Promise<void>((resolve) => {
    releaseStack = resolve
  })
  harness.sessions.server.customRequest = async (command, arguments_) => {
    if (command === 'stackTrace') {
      stackRequested = true
      await delayedStack
    }
    return originalRequest(command, arguments_)
  }
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 920,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 921,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await waitUntil(() => stackRequested, 'delayed refresh source check')

  // Act: closing revokes ownership before the delayed native response arrives.
  const closing = harness.run.stop()
  releaseStack()
  await closing

  // Assert
  assert.equal(harness.run.view().status, 'cancelled')
  assert.equal(harness.run.view().participants.server?.pause, undefined)
  assert.equal(harness.run.view().resourcesReleased, true)
  assert.equal(
    harness.run
      .view()
      .events.some((event) => event.type === 'dap.pause-refreshed'),
    false,
  )
  assert.equal(harness.run.view().snapshots.length, 1)
})

test('an extra native stop without a refresh cannot claim an already captured pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')

  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 919,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })

  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.equal(harness.run.view().snapshots.length, 1)
})

test('a competing browser resume request while the server is paused invalidates the run', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  // Act
  harness.run.onRequest(harness.sessions.browser, {
    type: 'request',
    seq: 902,
    command: 'continue',
    arguments: { threadId: server.pause.threadId },
  })
  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.match(
    harness.run.view().failures.join(' '),
    /Manual or competing resume/,
  )
})

test('one owned Next worker with nested debugger sessions still reaches its first server stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser', 'server'],
    { duplicateServerSession: true },
  )
  // Act
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  // Assert
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(first.pause.sessionId, 'server-child')
  assert.deepEqual(harness.identities, ['server', 'server'])
  assert.equal(harness.parentServerProxy.closed, true)
  assert.equal(harness.proxies.server.closed, false)
})

test('two distinct owned server workers reject before application input', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser', 'server'],
    { duplicateServerSession: true, distinctServerWorker: true },
  )
  // Act
  await assert.rejects(harness.run.prepare(), /Ambiguous owned server/)
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().resourcesReleased, true)
})

for (const failure of ['registration', 'replacement'] as const)
  test(`a failed server ${failure} rejects the operation before any browser input`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(context)
    if (failure === 'registration') harness.failRegistration()
    // Act
    if (failure === 'registration')
      await assert.rejects(harness.run.prepare(), /registration/)
    else {
      await harness.run.prepare()
      harness.revokeServerRegistration()
      harness.run.action('once', 'repository-click')
      await waitUntil(
        () => harness.run.view().status === 'failed',
        'failed replacement',
      )
    }
    await harness.run.stop()
    // Assert
    assert.equal(
      harness.commands.some((command) => command.method.startsWith('Input.')),
      false,
    )
    assert.equal(harness.run.view().snapshots.length, 0)
    assert.equal(harness.run.view().resourcesReleased, true)
  })

for (const failure of ['source', 'binding', 'binding-source'] as const)
  test(`a server stop with changed ${failure} never publishes captured facts`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(context)
    await harness.run.prepare()
    if (failure === 'source') harness.changeExecutedSource()
    else if (failure === 'binding') harness.leavePauseUnbound()
    else harness.bindForeignSource()
    // Act
    harness.run.action('once', 'repository-click')
    await waitUntil(
      () => harness.run.view().status === 'failed',
      'invalid server pause',
    )
    await harness.run.stop()
    // Assert
    assert.equal(harness.run.view().snapshots.length, 0)
    assert.equal(harness.run.view().resourcesReleased, true)
    const receipt = harness.run
      .view()
      .events.find((event) => event.type === 'breakpoint.pause-binding')
    assert.ok(receipt)
    const detail = JSON.parse(JSON.stringify(receipt.detail))
    assert.equal(detail.returned, 'parsed')
    assert.equal(detail.observed.verified, failure !== 'binding')
    assert.equal(
      detail.observed.source.path,
      failure === 'binding-source'
        ? '/foreign/source.ts'
        : detail.expected.path,
    )
    assert.equal(detail.expected.line, 1)
    assert.equal(detail.expected.column, 1)
    assert.match(
      harness.run.view().failures.join(' '),
      failure === 'source' ? /Executed JavaScript differs/ : /did not bind/,
    )
  })

test('a fast browser stop waits for the prior server continuation response before gaining authority', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  // Act
  const continued = harness.run.continue('server', first.pause)
  await waitUntil(
    () =>
      harness.commands.some(
        (command) =>
          command.participant === 'server' && command.method === 'continue',
      ),
    'native continue',
  )
  // Assert
  assert.equal(harness.run.view().participants.browser.snapshot, undefined)
  assert.equal(harness.run.view().snapshots.length, 1)
  harness.releaseContinueResponse()
  await continued
  const browser = await pauseReady(harness, 'browser')
  assert.equal(browser.pause.generation, 1)
})

test('manually resuming a queued browser stop cannot reuse the previous server continuation', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  const continued = harness.run.continue('server', first.pause)
  const rejected = assert.rejects(continued)
  await waitUntil(
    () =>
      harness.commands.some(
        (command) =>
          command.participant === 'server' && command.method === 'continue',
      ),
    'native continue',
  )
  // Act
  harness.emitResume('browser')
  harness.releaseContinueResponse()
  await rejected
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.match(
    harness.run.view().failures.join(' '),
    /Queued browser stop resumed/,
  )
})

test('server worker exit invalidates the whole operation and releases both owned transports', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  // Act
  harness.run.terminated(harness.sessions.server)
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.match(
    harness.run.view().failures.join(' '),
    /Selected debugger terminated/,
  )
  assert.equal(harness.proxies.server.closed, true)
  assert.equal(harness.proxies.browser.closed, true)
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
})

test('an unrelated debugger stop cannot claim the configured server pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  // Act
  harness.run.onEvent(
    { ...harness.sessions.server, id: 'unrelated' },
    {
      type: 'event',
      seq: 999,
      event: 'stopped',
      body: { threadId: 1, reason: 'breakpoint' },
    },
  )
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(harness.run.view().snapshots.length, 0)
  harness.run.action('once', 'repository-click')
  assert.equal(
    (await pauseReady(harness, 'server')).pause.sessionId,
    'server-session',
  )
})

test('server registration revoked during the final DOM check prevents the mouse input', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context)
  await harness.run.prepare()
  harness.revokeDuringDomCheck()
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'registration revoked during input preparation',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

const MAPPING_HINTS =
  'These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them.'

const armingEvents = (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
) =>
  harness.run
    .view()
    .events.filter(
      (event) =>
        event.type === 'breakpoint.bound' ||
        event.type === 'breakpoint.registered',
    )
    .map((event) => event.type)

test('a browser stop declared after a server stop does not pause when its line runs before its turn, and both stops commit in declared order', async (context) => {
  // Arrange: the click re-renders the browser component before the server action pauses.
  const harness = await nativeParticipantsHarness(context, [
    'server',
    'browser',
  ])
  harness.runBrowserLineOnInput()
  await harness.run.prepare()
  // Act
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  const browser = await pauseReady(harness, 'browser')
  await harness.run.continue('browser', browser.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after an early browser line',
  )
  await harness.run.stop()
  // Assert
  const view = harness.run.view()
  assert.equal(
    JSON.stringify(view.snapshots.map((snapshot) => snapshot.participant)),
    '["server","browser"]',
  )
  assert.equal(view.failures.length, 0)
  assert.equal(view.operation?.afterVerified, true)
  assert.equal(view.finalOutcome, 'demonstrated')
})

test('preparation installs only the first declared stop, so a later stop cannot pause before its turn', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, [
    'server',
    'browser',
  ])
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.breakpoints.length, 1)
  assert.match(
    harness.breakpoints[0]?.location.uri.fsPath ?? '',
    /\/src\/mode\.ts$/,
  )
  assert.equal(
    JSON.stringify(armingEvents(harness)),
    '["breakpoint.registered"]',
  )
})

test('a browser stop declared before a server stop is armed before input and the server stop only inside the browser continuation', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, [
    'browser',
    'server',
  ])
  await harness.run.prepare()
  const armedBeforeInput = JSON.stringify(armingEvents(harness))
  const installedBeforeInput = harness.breakpoints.map(
    (breakpoint) => breakpoint.location.uri.fsPath,
  )
  // Act
  harness.run.action('once', 'repository-click')
  const browser = await pauseReady(harness, 'browser')
  const armedAtBrowserStop = JSON.stringify(armingEvents(harness))
  await harness.run.continue('browser', browser.pause)
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed browser-then-server action',
  )
  await harness.run.stop()
  // Assert
  assert.equal(armedBeforeInput, '["breakpoint.bound"]')
  assert.equal(installedBeforeInput.length, 1)
  assert.match(installedBeforeInput[0] ?? '', /\/src\/theme\.ts$/)
  assert.equal(armedAtBrowserStop, '["breakpoint.bound"]')
  assert.equal(
    JSON.stringify(armingEvents(harness)),
    '["breakpoint.bound","breakpoint.registered"]',
  )
  const view = harness.run.view()
  assert.equal(
    JSON.stringify(view.snapshots.map((snapshot) => snapshot.participant)),
    '["browser","server"]',
  )
  assert.equal(view.finalOutcome, 'demonstrated')
})

test('a later stop on a line the sealed map never reaches is refused at preparation, before any application input', async (context) => {
  // Arrange: the browser module's only mapping points at line 2, and the stop is declared on line 1.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    { mappings: { browser: 'AACA' } },
  )
  // Act
  await assert.rejects(harness.run.prepare(), (error: unknown) => {
    assert.equal(
      String(error),
      `Error: Declared stop src/theme.ts:1 has no mapped position on that line in the sealed module. Frozen source map positions in the selected citation: none. ${MAPPING_HINTS}`,
    )
    return true
  })
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.commands.some((command) => command.method.startsWith('Input.')),
    false,
  )
  assert.equal(harness.breakpoints.length, 0)
  assert.equal(harness.run.view().snapshots.length, 0)
})

test('a server stop the debugger binds at another column of its declared line commits at the bound column', async (context) => {
  // Arrange: the stop asks for 1:7 and the adapter binds the paused breakpoint at 1:1.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    declaredColumn: { server: 7 },
    mappings: { server: 'AAAA,MAAM' },
  })
  await harness.run.prepare()
  // Act
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed at the bound column',
  )
  await harness.run.stop()
  // Assert
  assert.equal(server.source.line, 1)
  assert.equal(server.source.column, 1)
  assert.equal(server.values['value:mode'], 'display')
  const receipt = harness.run
    .view()
    .events.find((event) => event.type === 'breakpoint.pause-binding')
  const detail = JSON.parse(JSON.stringify(receipt?.detail))
  assert.equal(detail.expected.column, 7)
  assert.equal(detail.observed.column, 1)
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

test('a server stop the debugger binds on another line fails naming the declared stop, where it landed and the mapped positions', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.bindAt('server', 2, 1)
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'binding on another line rejected',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:1 bound at 2:1, not on its declared line. Frozen source map positions in the selected citation: 1:1. ${MAPPING_HINTS}`,
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

test('a paused server binding under another adapter id than its registration never publishes captured facts', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.rebindPauseId()
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'foreign binding id rejected',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: Pending server breakpoint did not bind to the captured source',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

test('a stack refresh that reports the bound position keeps the captured pause of a stop whose column moved', async (context) => {
  // Arrange: declared 1:7, bound and paused at 1:1.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    declaredColumn: { server: 7 },
    mappings: { server: 'AAAA,MAAM' },
  })
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 930,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 931,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.events.find((event) => event.type === 'dap.pause-refreshed')
  }, 'refresh at the bound position accepted')
  // Assert
  const refreshed = harness.run
    .view()
    .events.find((event) => event.type === 'dap.pause-refreshed')
  const detail = JSON.parse(JSON.stringify(refreshed?.detail))
  assert.equal(detail.line, 1)
  assert.equal(detail.column, 1)
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(harness.run.view().participants.server?.snapshot?.id, server.id)
})

test('a stack refresh that reports the requested column instead of the bound one cannot reuse the captured pause', async (context) => {
  // Arrange: declared 1:7, bound and paused at 1:1; the refreshed frame then names 1:7.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    declaredColumn: { server: 7 },
    mappings: { server: 'AAAA,MAAM' },
  })
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')
  harness.movePausedFrame(1, 7)
  // Act
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 932,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 933,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'refresh at another column rejected',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0] ?? '',
    /Native stack refresh changed the captured source location/,
  )
  assert.equal(harness.run.view().snapshots.length, 1)
})

test('a paused frame at another column than the paused binding on the same line never publishes captured facts', async (context) => {
  // Arrange: declared 1:7 and bound at 1:1, while the top frame reports 1:7.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    declaredColumn: { server: 7 },
    mappings: { server: 'AAAA,MAAM' },
  })
  await harness.run.prepare()
  harness.movePausedFrame(1, 7)
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'frame beside the binding rejected',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: DAP frame differs from exact configured source',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

test('a server stop armed in an already loaded module and acknowledged at another column of its line commits at the bound column', async (context) => {
  // Arrange: both stops ask for 1:7; the second is registered after the module loaded, so the adapter verifies it at once at 1:1.
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'server'],
    {
      declaredColumn: { server: 7 },
      mappings: { server: 'AAAA,MAAM' },
    },
  )
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  harness.acknowledgeRegistrationsAt(1, 1)
  // Act
  await harness.run.continue('server', first.pause)
  const second = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.snapshots[1]
  }, 'second server stop committed')
  await harness.run.continue('server', second.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after a loaded-module registration',
  )
  await harness.run.stop()
  // Assert
  const registrations = harness.run
    .view()
    .events.filter((event) => event.type === 'breakpoint.registered')
    .map((event) => JSON.parse(JSON.stringify(event.detail)).status)
  assert.equal(JSON.stringify(registrations), '["pending","bound"]')
  assert.equal(second.source.line, 1)
  assert.equal(second.source.column, 1)
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

test('a browser stop that binds on another line while the server is paused ends the run at once without resuming the server', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, [
    'server',
    'browser',
  ])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  harness.bindAt('browser', 2, 1)
  const startedMs = performance.now()
  // Act
  await assert.rejects(
    harness.run.continue('server', server.pause),
    (error: unknown) => {
      assert.equal(
        String(error),
        `Error: Declared stop src/theme.ts:1 bound at 2:1, not on its declared line. Frozen source map positions in the selected citation: 1:1. ${MAPPING_HINTS}`,
      )
      return true
    },
  )
  const failedWithinMs = performance.now() - startedMs
  await harness.run.stop()
  // Assert
  assert.ok(failedWithinMs < 1_000, `failed after ${failedWithinMs} ms`)
  assert.equal(
    harness.run.view().failures[0],
    `Next declared stop was not armed and no resume was sent: Error: Declared stop src/theme.ts:1 bound at 2:1, not on its declared line. Frozen source map positions in the selected citation: 1:1. ${MAPPING_HINTS}`,
  )
  assert.equal(
    harness.commands.some((command) => command.method === 'continue'),
    false,
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

test('a later server stop whose registration is acknowledged on another line ends the run naming that stop, without resuming', async (context) => {
  // Arrange: the second stop is registered after the module loaded and the adapter verifies it on line 2.
  const harness = await nativeParticipantsHarness(context, ['server', 'server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  harness.acknowledgeRegistrationsAt(2, 1)
  // Act
  let cause = ''
  await assert.rejects(
    harness.run.continue('server', first.pause),
    (error: unknown) => {
      cause = String(error)
      return true
    },
  )
  await harness.run.stop()
  // Assert
  assert.match(
    cause,
    /^Error: Declared stop src\/mode\.ts:1 was not registered: Selected adapter did not acknowledge the exact breakpoint registration: \{.*"expectedLine":1,.*"selectedLine":2,"selectedColumn":1,.*\}\. Frozen source map positions in the selected citation: 1:1\. These are mapped source positions, not verified debugger bindings or proof that the requested action reaches them\.$/,
  )
  assert.match(
    harness.run.view().failures[0] ?? '',
    /^Next declared stop was not armed and no resume was sent: Error: Declared stop src\/mode\.ts:1 was not registered: Selected adapter did not acknowledge the exact breakpoint registration: /,
  )
  assert.equal(
    harness.commands.some((command) => command.method === 'continue'),
    false,
  )
  assert.equal(harness.run.view().snapshots.length, 1)
})

/** Sends the two events js-debug emits when it refreshes a paused stack without resuming the runtime. @example refreshServerStack(harness, 940) */
const refreshServerStack = (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  sequence: number,
): void => {
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: sequence,
    event: 'continued',
    body: { threadId: 1 },
  })
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: sequence + 1,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
}

test('a stack refresh that arrives before a server stop’s bound position is known keeps the pause and the stop commits at the bound position', async (context) => {
  // Arrange: the server stop has paused and the adapter has not yet answered where its breakpoint bound.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  const lookup = harness.holdBindingLookup()
  harness.run.action('once', 'repository-click')
  await lookup.started
  // Act: js-debug refreshes its presentation of the same pause, then the binding arrives.
  refreshServerStack(harness, 940)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.events.some((event) => event.type === 'dap.pause-refreshed')
  }, 'refresh before the binding accepted')
  lookup.release()
  const server = await pauseReady(harness, 'server')
  // Assert
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(harness.run.view().participants.server?.pause?.generation, 1)
  assert.equal(server.source.line, 1)
  assert.equal(server.source.column, 1)
  assert.equal(harness.run.view().snapshots.length, 1)
})

test('a stack refresh before the binding at another column of the declared line does not move the stop from the position the debugger then binds', async (context) => {
  // Arrange: declared 1:7; the refreshed frame names 1:7 while the binding is pending, and the debugger then binds and pauses at 1:1.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    declaredColumn: { server: 7 },
    mappings: { server: 'AAAA,MAAM' },
  })
  await harness.run.prepare()
  const lookup = harness.holdBindingLookup()
  harness.run.action('once', 'repository-click')
  await lookup.started
  harness.movePausedFrame(1, 7)
  // Act
  refreshServerStack(harness, 942)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.events.some((event) => event.type === 'dap.pause-refreshed')
  }, 'refresh on the declared line accepted')
  harness.movePausedFrame(1, 1)
  lookup.release()
  const server = await pauseReady(harness, 'server')
  // Assert: the saved observation names the bound position, not the column the refresh reported.
  assert.equal(server.source.line, 1)
  assert.equal(server.source.column, 1)
  assert.equal(harness.run.view().participants.server?.pause?.generation, 1)
})

for (const moved of ['another line', 'another file'] as const)
  test(`a stack refresh before the binding that reports ${moved} cannot reuse the pause`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(context, ['server'])
    await harness.run.prepare()
    const lookup = harness.holdBindingLookup()
    harness.run.action('once', 'repository-click')
    await lookup.started
    if (moved === 'another line') harness.movePausedFrame(2)
    else harness.movePausedFrameToFile('/elsewhere/server.ts')
    // Act
    refreshServerStack(harness, 944)
    await waitUntil(
      () => harness.run.view().status === 'failed',
      'refresh away from the declared line rejected',
    )
    lookup.release()
    // Assert
    assert.equal(
      harness.run.view().failures[0],
      'Error: Native stack refresh changed the captured source location',
    )
    assert.equal(harness.run.view().snapshots.length, 0)
  })

type NativeParticipantsHarness = Awaited<
  ReturnType<typeof nativeParticipantsHarness>
>

/** Declares the server module with a second source line: generated line 1 is source line 2, where the debug adapter's own breakpoint lands. */
const TWO_LINE_SERVER_MODULE = { mappings: { server: 'AAAA;AACA' } }

/** Reports the pause js-debug makes for its module entry breakpoint: in the server stop's module, on source line 2, in that module's first function, with no debugger stop. @example emitEntryBreakpointPause(harness) */
const emitEntryBreakpointPause = (harness: NativeParticipantsHarness): void =>
  harness.emitUnannouncedPause('server', {
    scriptId: 'server',
    lineNumber: 1,
    columnNumber: 0,
    functionName: 'getUser',
    hitBreakpoints: ['4:14:0:server'],
  })

/** Sends the `continued` the adapter announces on the server session for a resume it made by itself. @example emitAdapterContinued(harness, 950) */
const emitAdapterContinued = (
  harness: NativeParticipantsHarness,
  sequence: number,
): void =>
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: sequence,
    event: 'continued',
    body: { threadId: 1 },
  })

/** Reads what the run journaled about every pause it retired. @example retiredPauses(harness).length // 1 */
const retiredPauses = (harness: NativeParticipantsHarness): unknown[] =>
  harness.run
    .view()
    .events.filter((event) => event.type === 'cdp.adapter-pause-retired')
    .map((event) => event.detail)

/** Waits until the server's `continue` request has been sent and its two resume receipts delivered, while its response is still held. @example await serverContinueRequested(harness) */
const serverContinueRequested = (
  harness: NativeParticipantsHarness,
): Promise<boolean> =>
  waitUntil(
    () =>
      harness.commands.some(
        (command) =>
          command.participant === 'server' && command.method === 'continue',
      ),
    'native continue',
  )

for (const order of [
  'its continued is read before its pause',
  'its pause is read before its continued',
] as const)
  // Value: protects=a live run going on to its next stop when the debug adapter pauses once more for its own module entry breakpoint and resumes it (Cycle 0041 run 1 in both hosts, P1-1); fails_when=that pause is taken for the next declared stop or its resume for a foreign one, in either order of the two channels, or the journal loses where the pause was; why_new=every pause during an action was a candidate stop, whatever its place; seam=none
  test(`a pause the debugger makes for itself in the next stop’s module and resumes does not end the run when ${order}`, async (context) => {
    // Arrange: both stops are in one module; the first has been continued and the second has not paused yet.
    const harness = await nativeParticipantsHarness(
      context,
      ['server', 'server'],
      TWO_LINE_SERVER_MODULE,
    )
    await harness.run.prepare()
    const nextStop = harness.holdNextPause()
    harness.run.action('once', 'repository-click')
    const first = await pauseReady(harness, 'server')
    await harness.run.continue('server', first.pause)
    // Act: the adapter pauses at its entry breakpoint and resumes it with no stopped event; only then the declared line is reached.
    if (order === 'its continued is read before its pause')
      emitAdapterContinued(harness, 950)
    emitEntryBreakpointPause(harness)
    if (order === 'its pause is read before its continued')
      emitAdapterContinued(harness, 950)
    harness.emitResume('server')
    nextStop.paused()
    nextStop.stopped()
    const second = await pauseReady(harness, 'server')
    await harness.run.continue('server', second.pause)
    await waitUntil(
      () => harness.run.view().status === 'completed',
      'completed after the adapter’s own pause',
    )
    await harness.run.stop()
    // Assert
    const view = harness.run.view()
    assert.equal(view.failures.join('; '), '')
    assert.equal(second.pause.generation, 2)
    assert.equal(view.snapshots.length, 2)
    assert.equal(view.finalOutcome, 'demonstrated')
    const retired = retiredPauses(harness)
    assert.equal(retired.length, 1)
    const detail = JSON.parse(JSON.stringify(retired[0]))
    assert.equal(Number.isInteger(detail.pausedForMs), true)
    assert.equal(detail.pausedForMs >= 0, true)
    assert.deepEqual(
      { ...detail, pausedForMs: 'an integer, checked above' },
      {
        participant: 'server',
        url: 'webpack-internal:///(action-browser)/./src/mode.ts',
        line: 2,
        column: 1,
        functionName: 'getUser',
        hitBreakpoints: ['4:14:0:server'],
        place: 'src/mode.ts:2',
        pausedForMs: 'an integer, checked above',
      },
    )
    assert.equal(
      view.events.filter((event) => event.type === 'dap.idle-continued-ignored')
        .length,
      1,
    )
  })

// Value: protects=the next declared stop being reached when the adapter's own pause is read while the continue response is still outstanding; fails_when=that pause is queued as the next stop, so its resume ends the run ("Queued server stop resumed before prior continuation receipts completed"); why_new=a pause during a continuation whose next stop is in the same participant was queued whatever its place; seam=none
test('a pause the debugger makes for itself before the continue response arrives is not queued as the next declared stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'server'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  harness.holdContinueResponse()
  const continuation = harness.run.continue('server', first.pause)
  await serverContinueRequested(harness)
  // Act: both resume receipts are in and the response is not, when the adapter's own pause comes and goes.
  emitEntryBreakpointPause(harness)
  harness.emitResume('server')
  emitAdapterContinued(harness, 951)
  harness.releaseContinueResponse()
  // A continuation the run cancelled is reported below through the run's own failure text.
  await continuation.catch(() => undefined)
  nextStop.paused()
  nextStop.stopped()
  const second = await pauseReady(harness, 'server')
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(second.pause.generation, 2)
  assert.equal(harness.run.view().snapshots.length, 2)
  assert.equal(retiredPauses(harness).length, 1)
})

// Value: protects=a run whose next stop is in the browser going on when the server's adapter pauses for itself and resumes (Cycle 0041 Cursor run 2, C-P2b-1); fails_when=a server pause while a browser stop is next ends the run as an additional stop; why_new=a pause of the participant whose turn it is not failed at once; seam=none
test('a pause the debugger makes for itself on the server while a browser stop is next does not end the run', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  const nextStop = harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  // Act
  emitAdapterContinued(harness, 952)
  emitEntryBreakpointPause(harness)
  harness.emitResume('server')
  nextStop.paused()
  nextStop.stopped()
  const browser = await pauseReady(harness, 'browser')
  await harness.run.continue('browser', browser.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after the browser stop',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(browser.participant, 'browser')
  assert.equal(browser.values['value:nextTheme'], 'dark')
  assert.equal(retiredPauses(harness).length, 1)
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

// Value: protects=a run completing when the adapter resumes a pause of its own after the last continuation (Cycle 0041 Cursor run 3, C-P2-1); fails_when=a continued after the last continuation ends the run ("Unowned continuation invalidated live pause"), or the pause that follows does; why_new=the last continuation stays set, so every later continued of its session failed; seam=none
test('a continued and a pause the debugger makes for itself after the last continuation do not end the run, and it completes', async (context) => {
  // Arrange: the application has not acknowledged its input yet, so the after conditions are still open.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  harness.holdInput()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  // Act
  emitAdapterContinued(harness, 953)
  emitEntryBreakpointPause(harness)
  harness.emitResume('server')
  harness.releaseInput()
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.status === 'completed'
  }, 'completed after the adapter’s own pause')
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().operation?.afterVerified, true)
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
  assert.equal(retiredPauses(harness).length, 1)
})

// Value: protects=a run never being certified as completed while its server is still paused; fails_when=the after phase completes with a pause nobody announced still open, or never completes after that pause is resumed; why_new=an unannounced pause no longer fails the run, so completion has to wait for its resume (Cycle 0042 ER5); seam=none
test('a run does not complete while the server is still paused at a pause the debugger made for itself, and completes once that pause is resumed', async (context) => {
  // Arrange: every other completion condition is met while the pause is open.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  harness.holdInput()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  emitEntryBreakpointPause(harness)
  harness.releaseInput()
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.operation?.inputAcknowledged
  }, 'input acknowledged')
  // Act: three polling intervals pass, then the adapter resumes its pause.
  const threePollingIntervalsMs = 150
  await setTimeout(threePollingIntervalsMs)
  const whilePaused = {
    status: harness.run.view().status,
    afterVerified: harness.run.view().operation?.afterVerified,
    failures: harness.run.view().failures.join('; '),
  }
  harness.emitResume('server')
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after the resume',
  )
  await harness.run.stop()
  // Assert
  assert.deepEqual(whilePaused, {
    status: 'resuming',
    afterVerified: false,
    failures: '',
  })
  assert.equal(harness.run.view().operation?.afterVerified, true)
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
})

// Value: protects=a real server stop that no declaration names still ending the run: only a pause the adapter keeps to itself is tolerated; fails_when=a pause the debugger announces with a stopped event while a browser stop is next is held or retired instead of failing; why_new=the failure moved from the pause to its announcement (Cycle 0042 ER1); seam=none
test('a server stop the debugger announces while a browser stop is next ends the run as an additional stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'browser'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  emitEntryBreakpointPause(harness)
  // Act: this pause is not the adapter's own, a stopped event names it.
  harness.run.onEvent(harness.sessions.server, {
    type: 'event',
    seq: 954,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Unexpected or additional server stop invalidated the declared operation',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(retiredPauses(harness).length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a resume the learner or another client requests never being taken for the adapter's own; fails_when=a resume request nobody reserved, sent while the server is paused at an unannounced pause, is accepted and the pause retired without a failure; why_new=an unannounced pause is now held instead of failing, which must not open a path for a manual resume; seam=none
test('a resume request nobody reserved while the server is paused at a pause nobody announced ends the run as a competing resume', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(
    context,
    ['server', 'server'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  harness.holdNextPause()
  harness.run.action('once', 'repository-click')
  const first = await pauseReady(harness, 'server')
  await harness.run.continue('server', first.pause)
  emitEntryBreakpointPause(harness)
  // Act: Continue is pressed in the debugger, and the runtime resumes.
  harness.run.onRequest(harness.sessions.server, {
    type: 'request',
    seq: 955,
    command: 'continue',
    arguments: { threadId: 1 },
  })
  harness.emitResume('server')
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Manual or competing resume invalidated live pause',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=the failure text that tells an agent where a server stop really bound when the debugger pauses on another line of the cited file; fails_when=that pause is held as nobody's and the run ends on a timeout that names nothing; why_new=a pause away from the declared line is no longer taken for the stop, so the announced one has to be found again (Cycle 0042 ER4); seam=the 3 s bound of the wait for the stop's own pause, ended after one look
test('a server stop the debugger announces and pauses on another line of its module fails naming the declared stop and where it landed', async (context) => {
  // Arrange: the breakpoint binds on line 2, and the runtime pauses there.
  const harness = await nativeParticipantsHarness(
    context,
    ['server'],
    TWO_LINE_SERVER_MODULE,
  )
  await harness.run.prepare()
  harness.pauseAt('server', 1, 0)
  harness.bindAt('server', 2, 1)
  harness.movePausedFrame(2)
  harness.expireSourceBoundWait()
  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'pause on another line rejected',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    `Error: Declared stop src/mode.ts:1 bound at 2:1, not on its declared line. Frozen source map positions in the selected citation: 1:1. ${MAPPING_HINTS}`,
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a real browser stop while a server stop is held still ending the run; fails_when=a browser pause the debugger announces during a held server stop is held or retired instead of failing; why_new=the failure moved from the pause to its announcement (Cycle 0042 ER13); seam=none
test('a browser stop the debugger announces while a server stop is held ends the run as an additional stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, [
    'server',
    'browser',
  ])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await pauseReady(harness, 'server')
  harness.announceScript(
    'browser',
    'menu',
    'webpack-internal:///(app-pages-browser)/./src/menu.ts',
  )
  // Act: a breakpoint of the learner's own pauses the page, and the debugger announces it.
  harness.emitUnannouncedPause('browser', {
    scriptId: 'menu',
    lineNumber: 4,
    columnNumber: 2,
    functionName: 'openMenu',
    hitBreakpoints: ['1:4:2:menu'],
  })
  harness.run.onEvent(harness.sessions.browser, {
    type: 'event',
    seq: 956,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1 },
  })
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Unexpected or additional browser stop invalidated the declared operation',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a server stop's captured facts staying valid when the browser's adapter pauses for itself and resumes during the capture; fails_when=a browser pause while the server stop is being captured ends the run, or the journal loses where it was; why_new=a pause of the participant whose turn it is not failed at once (Cycle 0042 ER13); seam=the adapter's binding lookup, held by the test
test('a pause the debugger makes for itself in the browser while a server stop is being captured leaves that capture valid, and the run completes', async (context) => {
  // Arrange: the server stop has paused and its bound position is not known yet.
  const harness = await nativeParticipantsHarness(context, [
    'server',
    'browser',
  ])
  await harness.run.prepare()
  const lookup = harness.holdBindingLookup()
  harness.run.action('once', 'repository-click')
  await lookup.started
  harness.announceScript(
    'browser',
    'actions',
    'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts',
  )
  // Act: the browser's adapter hits its own entry breakpoint and resumes it.
  harness.emitUnannouncedPause('browser', {
    scriptId: 'actions',
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['br:2:0:0:actions'],
  })
  harness.emitResume('browser')
  lookup.release()
  const server = await pauseReady(harness, 'server')
  await harness.run.continue('server', server.pause)
  const browser = await pauseReady(harness, 'browser')
  await harness.run.continue('browser', browser.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'completed after both stops',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.equal(server.values['value:mode'], 'display')
  assert.equal(harness.run.view().finalOutcome, 'demonstrated')
  const retired = retiredPauses(harness)
  assert.equal(retired.length, 1)
  const detail = JSON.parse(JSON.stringify(retired[0]))
  assert.equal(Number.isInteger(detail.pausedForMs), true)
  assert.deepEqual(
    { ...detail, pausedForMs: 'an integer, checked above' },
    {
      participant: 'browser',
      url: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts',
      line: 1,
      column: 1,
      functionName: '',
      hitBreakpoints: ['br:2:0:0:actions'],
      place: 'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 1:1',
      pausedForMs: 'an integer, checked above',
    },
  )
})

for (const moment of [
  'after the continuation',
  'before the continue response',
] as const)
  // Value: protects=the next declared stop being captured when its stopped event is read before the adapter's own pause in the same module, the channel order that makes the place of a pause decide and not its announcement; fails_when=the adapter's pause is taken for the announced stop, so its resume ends the run; why_new=the two channels have no common order and a stopped was read up to 29 ms before its pause (Cycle 0042 ER14); seam=none
  test(`a declared stop whose stopped event is read before the debugger’s own pause in its module is still captured, ${moment}`, async (context) => {
    // Arrange
    const harness = await nativeParticipantsHarness(
      context,
      ['server', 'server'],
      TWO_LINE_SERVER_MODULE,
    )
    await harness.run.prepare()
    const nextStop = harness.holdNextPause()
    harness.run.action('once', 'repository-click')
    const first = await pauseReady(harness, 'server')
    if (moment === 'before the continue response')
      harness.holdContinueResponse()
    const continuation = harness.run.continue('server', first.pause)
    if (moment === 'after the continuation') await continuation
    else await serverContinueRequested(harness)
    // Act: the stop's announcement is read first, then the adapter's own pause and its resume, then the stop's pause.
    nextStop.stopped()
    emitEntryBreakpointPause(harness)
    harness.emitResume('server')
    nextStop.paused()
    harness.releaseContinueResponse()
    // A continuation the run cancelled is reported below through the run's own failure text.
    await continuation.catch(() => undefined)
    const second = await pauseReady(harness, 'server')
    // Assert
    assert.equal(harness.run.view().failures.join('; '), '')
    assert.equal(second.pause.generation, 2)
    assert.equal(second.source.line, 1)
    assert.equal(harness.run.view().snapshots.length, 2)
    assert.equal(retiredPauses(harness).length, 1)
  })
