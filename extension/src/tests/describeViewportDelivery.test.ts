import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeViewportDelivery } from '../utils/describeViewportDelivery'

test('Recording error details count dropped receipts and never show recorded image data or hashes', () => {
  // Arrange
  const log = {
    omitted: 3,
    receipts: [
      {
        type: 'viewport.sent',
        detail: {
          epoch: '11111111-1111-1111-1111-111111111111',
          id: 7,
          hash: 'recorded-image-hash',
          phase: 'Recorded · 1.00 s',
          data: 'iVBORw0KGgo=',
        },
      },
      {
        type: 'viewport.frame-stage',
        detail: {
          id: 7,
          stage: 'received',
          visibility: 'visible',
          hasArea: true,
        },
      },
      {
        type: 'viewport.frame-stage',
        detail: {
          id: 7,
          stage: 'decoded',
          visibility: 'hidden',
          hasArea: true,
        },
      },
      { type: 'viewport.lease-released' },
      { type: 'viewport.frame-stage', detail: 'malformed renderer message' },
      {
        type: 'viewport.acknowledged',
        detail: {
          epoch: '11111111-1111-1111-1111-111111111111',
          id: 7,
          hash: 'recorded-image-hash',
          phase: 'Recorded · 1.00 s',
        },
      },
    ],
  }
  // Act
  const summary = describeViewportDelivery(log)
  // Assert
  assert.equal(
    summary,
    '3 earlier receipts omitted; sent #7; received (visible, area); decoded (hidden, area); painted #7',
  )
})

test('Recording error details say so when a renderer attempt produced no receipts', () => {
  // Arrange
  const log = { omitted: 0, receipts: [] }
  // Act
  const summary = describeViewportDelivery(log)
  // Assert
  assert.equal(summary, 'no renderer receipts')
})

test('Recording error details distinguish a stale paint receipt and a failed readiness request', () => {
  // Arrange
  const log = {
    omitted: 0,
    receipts: [
      {
        type: 'viewport.ready-request-failed',
        detail: { error: 'Error: Webview is disposed' },
      },
      {
        type: 'viewport.ready',
        detail: { epoch: '22222222-2222-2222-2222-222222222222' },
      },
      {
        type: 'viewport.stale-ack-ignored',
        detail: { epoch: '11111111-1111-1111-1111-111111111111', id: 4 },
      },
      { type: 'viewport.disposed', detail: { expected: false } },
    ],
  }
  // Act
  const summary = describeViewportDelivery(log)
  // Assert
  assert.equal(
    summary,
    'ready request failed: Error: Webview is disposed; ready 22222222; stale receipt #4; disposed',
  )
})
