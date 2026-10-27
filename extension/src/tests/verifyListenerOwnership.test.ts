import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  PortListener,
  PortListenerReading,
} from '../utils/readPortListeners'
import {
  verifyListenerOwnership,
  type ListenerOwnershipInput,
} from '../utils/verifyListenerOwnership'

import { freeLoopbackPort } from './utils/freeLoopbackPort'
import { occupyPort } from './utils/occupyPort'
import { startFixtureServer } from './utils/startFixtureServer'

/**
 * Builds the input for an ownership judgement over a fixed listener reading, with launched process 100 in group 100.
 * @param listeners - What the listener tool shows, or an unknown reading.
 * @param overrides - Further input.
 * @returns The input.
 * @example inputFor([{ family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 100 }])
 */
function inputFor(
  listeners: PortListener[] | { reason: string },
  overrides: Partial<ListenerOwnershipInput> = {},
): ListenerOwnershipInput {
  const reading: PortListenerReading = Array.isArray(listeners)
    ? { kind: 'read', tool: 'lsof', listeners }
    : { kind: 'unknown', reason: listeners.reason }
  return {
    port: 4100,
    selectedHost: '127.0.0.1',
    ownerPid: 100,
    processGroup: 100,
    readListeners: async () => reading,
    readProcessGroup: async (pid) => (pid === 101 ? 100 : 900),
    readProcessCommand: async () => '/usr/local/bin/postgres',
    ...overrides,
  }
}

// protects=the launched process listening on the declared address is accepted; fails_when=an owned server is refused; no_claim=wildcards
test('the launched process listening on 127.0.0.1 owns the endpoint', async () => {
  // Arrange
  const input = inputFor([
    { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 100 },
  ])
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.deepEqual(result, { owned: true })
})

// protects=a server bound to 0.0.0.0 or :: is accepted (README limit); fails_when=a wildcard owner is refused; no_claim=firewalling
test('the launched process bound to 0.0.0.0, * or :: owns the endpoint', async () => {
  // Arrange
  const wildcards: PortListener[][] = [
    [{ family: 'IPv4', address: '0.0.0.0', port: 4100, pid: 100 }],
    [{ family: 'IPv6', address: '*', port: 4100, pid: 100 }],
    [{ family: 'IPv6', address: '::', port: 4100, pid: 100 }],
  ]
  // Act
  const results = await Promise.all(
    wildcards.map((listeners) => verifyListenerOwnership(inputFor(listeners))),
  )
  // Assert
  assert.deepEqual(results, [{ owned: true }, { owned: true }, { owned: true }])
})

// protects=a fork or cluster child that listens is named and the debugger limit is stated; fails_when=a child in the group passes as owned; no_claim=cluster workers beyond one level
test('a listener in a child of the launched group is refused naming the child and the debugger limit', async () => {
  // Arrange
  const input = inputFor([
    { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 101 },
  ])
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.deepEqual(result, {
    owned: false,
    code: 'LISTENER_NOT_OWNED',
    message:
      'Port 4100 is held by a child process (pid 101) of the started server, not by the started process itself. The debugger does not control that child, so a request would not stop in your code. Use a server whose started process listens itself.',
  })
})

// protects=a foreign server on the port is named with its command and never to be killed; fails_when=a foreign pid passes or the message tells to kill; no_claim=the learner's reaction
test('a listener in a foreign process is refused naming its pid and command and asking to stop it or declare the port', async () => {
  // Arrange
  const input = inputFor([
    { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 100 },
    { family: 'IPv6', address: '*', port: 4100, pid: 555 },
  ])
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.deepEqual(result, {
    owned: false,
    code: 'LISTENER_NOT_OWNED',
    message:
      'Port 4100 is held by another process (pid 555, postgres). Ask the learner to stop it or to declare the port the server listens on; do not kill it.',
  })
})

// protects=a listener that cannot accept the selected endpoint is not blamed; fails_when=an IPv4-only foreign listener blocks a ::1 server; no_claim=other ports
test('a foreign IPv4-only listener does not take the ::1 endpoint from the owner', async () => {
  // Arrange
  const input = inputFor(
    [
      { family: 'IPv6', address: '::1', port: 4100, pid: 100 },
      { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: 555 },
    ],
    { selectedHost: '::1' },
  )
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.deepEqual(result, { owned: true })
})

// protects=a port that accepts while no listener is shown is never passed as owned; fails_when=an empty reading counts as owned; no_claim=why the tool shows nothing
test('a port that accepted while the tool shows no listener is refused as not owned', async () => {
  // Arrange
  const input = inputFor([], { acceptedWithoutListener: true })
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.equal(result.owned, false)
  assert.equal(result.owned === false && result.code, 'LISTENER_NOT_OWNED')
})

// protects=an unreadable owner is PORT_OWNER_UNKNOWN never "no listener"; fails_when=an unknown reading passes or reads LISTENER_NOT_OWNED; no_claim=the install hint's wording
test('a listener tool that cannot answer yields PORT_OWNER_UNKNOWN asking to install lsof or ss', async () => {
  // Arrange
  const input = inputFor({ reason: 'lsof did not answer within 3 s.' })
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.deepEqual(result, {
    owned: false,
    code: 'PORT_OWNER_UNKNOWN',
    message:
      'Codebook cannot read which process listens on port 4100: lsof did not answer within 3 s. Install lsof (macOS or Linux) or ss (Linux) at its system path.',
  })
})

// protects=a listener whose process the tool hides is not trusted; fails_when=a hidden pid passes as owned; no_claim=which user holds it
test('a listener whose process is hidden is refused as not owned', async () => {
  // Arrange
  const input = inputFor([
    { family: 'IPv4', address: '127.0.0.1', port: 4100, pid: undefined },
  ])
  // Act
  const result = await verifyListenerOwnership(input)
  // Assert
  assert.equal(result.owned, false)
  assert.equal(result.owned === false && result.code, 'LISTENER_NOT_OWNED')
})

// protects=the real lsof/ps readings agree with a real launched server; fails_when=the real tools mis-read the owner; no_claim=Linux ss (CI runs it there)
test('a real fixture server listening itself is owned by its launched process', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const result = await verifyListenerOwnership({
    port: server.port,
    selectedHost: '127.0.0.1',
    ownerPid: server.pid,
    processGroup: server.processGroup,
  })
  // Assert
  assert.deepEqual(result, { owned: true })
})

// protects=a real fork child listener is refused naming the child; fails_when=the parent is judged the owner of its child's socket; no_claim=cluster
test('a real fork-mode server whose child listens is refused naming the child pid', async (t) => {
  // Arrange
  const server = await startFixtureServer(t, { mode: 'fork' })
  // Act
  const result = await verifyListenerOwnership({
    port: server.port,
    selectedHost: '127.0.0.1',
    ownerPid: server.pid,
    processGroup: server.processGroup,
  })
  // Assert
  assert.equal(result.owned, false)
  assert.equal(result.owned === false && result.code, 'LISTENER_NOT_OWNED')
  assert.match(
    result.owned === false ? result.message : '',
    /held by a child process \(pid \d+\) of the started server/,
  )
})

// protects=a real foreign listener is named and refused; fails_when=a foreign listener passes; no_claim=another user's processes
test('a real foreign listener on the port is refused naming its pid', async (t) => {
  // Arrange
  const foreignPort = await freeLoopbackPort()
  await occupyPort(t, foreignPort)
  // Act
  const result = await verifyListenerOwnership({
    port: foreignPort,
    selectedHost: '127.0.0.1',
    ownerPid: process.pid + 1,
    processGroup: process.pid + 1,
  })
  // Assert
  assert.equal(result.owned, false)
  assert.match(
    result.owned === false ? result.message : '',
    new RegExp(`held by another process \\(pid ${process.pid}`),
  )
})
