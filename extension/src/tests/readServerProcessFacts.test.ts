import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { test } from 'node:test'

import { readConnectionServerPid } from '../utils/readConnectionServerPid'
import { readListeningPortsOfProcess } from '../utils/readListeningPortsOfProcess'
import { readProcessCwd } from '../utils/readProcessCwd'
import type { BoundedQueryRunner } from '../utils/runBoundedQuery'

import { startFixtureServer } from './utils/startFixtureServer'

const LSOF = { kind: 'lsof' as const, path: '/usr/sbin/lsof' }
const SS = { kind: 'ss' as const, path: '/usr/bin/ss' }

/**
 * Builds a runner answering one fixed output in place of the listener tool.
 * @param stdout - What the tool prints.
 * @returns The runner.
 * @example answering('p77\n')
 */
function answering(stdout: string): BoundedQueryRunner {
  return async () => ({ stdout })
}

// protects=the corrected port declaration comes from the process's own listening sockets; fails_when=another process's ports or duplicates are returned; no_claim=the inspector port filtering (the run's)
test('the ports a real server process listens on are read for the corrected declaration', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const ports = await readListeningPortsOfProcess(server.pid)
  // Assert
  assert.deepEqual(ports, [server.port])
})

// protects=ss output of other processes is not attributed to the server; fails_when=the pid filter is dropped; no_claim=real ss output formatting
test('ports of other processes in ss output are not counted for the server', async () => {
  // Arrange
  const stdout =
    'LISTEN 0 511 127.0.0.1:4100 0.0.0.0:* users:(("node",pid=77,fd=18))\n' +
    'LISTEN 0 511 *:5432 *:* users:(("postgres",pid=900,fd=4))\n'
  // Act
  const ports = await readListeningPortsOfProcess(77, {
    findTool: async () => SS,
    run: answering(stdout),
  })
  // Assert
  assert.deepEqual(ports, [4100])
})

// protects=an unreadable tool never invents ports; fails_when=a failure throws or returns ports; no_claim=none
test('an unavailable listener tool reads as no ports', async () => {
  // Arrange / Act
  const ports = await readListeningPortsOfProcess(77, {
    findTool: async () => undefined,
  })
  // Assert
  assert.deepEqual(ports, [])
})

// protects=the peer check names the process holding the server end of the real connection; fails_when=the client end or another process is returned; no_claim=Linux ss
test('the pid holding the server end of a real established connection is the fixture server', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  const client = connect({ host: '127.0.0.1', port: server.port })
  t.after(() => client.destroy())
  await new Promise((resolve) => client.once('connect', resolve))
  // Act
  const serverPid = await readConnectionServerPid({
    clientPort: client.localPort ?? 0,
    serverPort: server.port,
  })
  // Assert
  assert.equal(serverPid, server.pid)
})

// protects=the lsof parser picks the server end not the client end; fails_when=the client line wins; no_claim=real lsof timing
test('lsof output with both ends of a connection yields the server end only', async () => {
  // Arrange
  const stdout =
    `p${process.pid}\nn127.0.0.1:55000->127.0.0.1:4100\n` +
    'p77\nn127.0.0.1:4100->127.0.0.1:55000\n'
  // Act
  const serverPid = await readConnectionServerPid(
    { clientPort: 55000, serverPort: 4100 },
    { findTool: async () => LSOF, run: answering(stdout) },
  )
  // Assert
  assert.equal(serverPid, 77)
})

// protects=ss output yields the server end; fails_when=the ss parser misses the users column; no_claim=real ss
test('ss output for an established connection yields the process on the server port', async () => {
  // Arrange
  const stdout =
    '0 0 127.0.0.1:4100 127.0.0.1:55000 users:(("node",pid=77,fd=19))\n'
  // Act
  const serverPid = await readConnectionServerPid(
    { clientPort: 55000, serverPort: 4100 },
    { findTool: async () => SS, run: answering(stdout) },
  )
  // Assert
  assert.equal(serverPid, 77)
})

// protects=an unreadable connection is undefined never a guess; fails_when=a failed tool returns a pid; no_claim=none
test('an unreadable connection owner is undefined', async () => {
  // Arrange / Act
  const serverPid = await readConnectionServerPid(
    { clientPort: 55000, serverPort: 4100 },
    {
      findTool: async () => LSOF,
      run: async () => {
        throw new Error('timed out')
      },
    },
  )
  // Assert
  assert.equal(serverPid, undefined)
})

// protects=the orphan sweep's folder match uses the process's real folder; fails_when=the folder of another process or an unresolved link is returned; no_claim=Windows
test('the working folder of a real server process is its realpath', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const folder = await readProcessCwd(server.pid)
  // Assert
  assert.equal(folder, server.workspace)
})
