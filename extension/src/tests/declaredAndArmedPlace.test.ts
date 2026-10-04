import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { declaredAndArmedPlace } from '../utils/declaredAndArmedPlace'

import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

// Value: protects=the journal naming a stop's requested place only when Codebook asked the debugger for another place than the declared one; fails_when=a request at the declared position is journaled as armed, or a request on another line or column is not; why_new=Cycle 0045 ER-8 (the journal held the declared place under "requested" and the requested place nowhere); seam=none
test('a stop requested where it was declared has no armed place, and one requested on another line or column has it', () => {
  // Arrange
  const declared = { line: 35, column: 9 }

  // Act
  const requestedAsDeclared = declaredAndArmedPlace(declared, {
      line: 35,
      column: 9,
    }),
    requestedOnNextLine = declaredAndArmedPlace(declared, {
      line: 36,
      column: 7,
    }),
    requestedAtAnotherColumn = declaredAndArmedPlace(declared, {
      line: 35,
      column: 3,
    })

  // Assert
  assert.equal(
    JSON.stringify(requestedAsDeclared),
    '{"declared":{"line":35,"column":9}}',
  )
  assert.equal(
    JSON.stringify(requestedOnNextLine),
    '{"declared":{"line":35,"column":9},"armed":{"line":36,"column":7}}',
  )
  assert.equal(
    JSON.stringify(requestedAtAnotherColumn),
    '{"declared":{"line":35,"column":9},"armed":{"line":35,"column":3}}',
  )
})

// Value: protects=the journal of a server stop naming the place the agent declared beside the place Codebook requested; fails_when=breakpoint.pause-binding holds only "expected" (the declared place), so kept evidence cannot tell where the breakpoint was requested; why_new=Cycle 0045 ER-8; seam=the native participants harness's adapter, which binds the pending registration on line 2
test('the pause binding a server stop declared on an unmapped line journals names its declared place and the place it was requested at', async (context) => {
  // Arrange: line 1 of the server module has no mapping, line 2 has one, and the citation covers both.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: ';AACA' },
    fixture: { server: { citationEndLine: 2 } },
  })
  await harness.run.prepare()
  harness.pauseAt('server', 1, 0)
  harness.bindAt('server', 2, 1)
  harness.movePausedFrame(2)

  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'server stop captured at the first mapped position after its declared line')
  const pauseBinding = harness.run
    .view()
    .events.find((event) => event.type === 'breakpoint.pause-binding')
  await harness.run.stop()

  // Assert
  const detail = JSON.parse(JSON.stringify(pauseBinding?.detail))
  assert.equal(JSON.stringify(detail.declared), '{"line":1,"column":1}')
  assert.equal(JSON.stringify(detail.armed), '{"line":2,"column":1}')
  assert.equal(detail.expected.line, 1)
  assert.equal(detail.expected.column, 1)
})

// Value: protects=the journal of a server stop requested where it was declared carrying no armed place; fails_when=breakpoint.pause-binding repeats the declared place as armed, so a reader takes every stop for a moved request; why_new=Cycle 0045 ER-8; seam=the native participants harness's adapter
test('the pause binding a server stop requested on its declared line journals names its declared place and no armed place', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()

  // Act
  harness.run.action('once', 'repository-click')
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'server stop captured on its declared line')
  const pauseBinding = harness.run
    .view()
    .events.find((event) => event.type === 'breakpoint.pause-binding')
  await harness.run.stop()

  // Assert
  const detail = JSON.parse(JSON.stringify(pauseBinding?.detail))
  assert.equal(JSON.stringify(detail.declared), '{"line":1,"column":1}')
  assert.equal('armed' in detail, false)
})
