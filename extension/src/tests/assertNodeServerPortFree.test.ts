import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { ConnectLoopback } from '../utils/assertDevelopmentPortFree'
import { assertNodeServerPortFree } from '../utils/assertNodeServerPortFree'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
} from '../utils/ownedDevelopmentPorts'

/** A loopback connect that never connects: it times out, so the bind probe decides. */
const silentConnect: ConnectLoopback = () => {
  const socket = new EventEmitter() as unknown as Socket
  Object.assign(socket, {
    setTimeout: () => {
      setImmediate(() => socket.emit('timeout'))
      return socket
    },
    destroy: () => socket,
  })
  return socket
}

/** A bind probe that fails with the given error code. */
const bindFailingWith = (code: string) => async () =>
  Object.assign(new Error(`listen ${code}`), { code })

/** A bind probe that finds the port free. */
const freeBind = async () => undefined

/** Runs the check and returns the refusal it throws. */
async function refusalOf(
  input: Parameters<typeof assertNodeServerPortFree>[0],
): Promise<StudyError> {
  const error = await assertNodeServerPortFree(input).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, `expected a refusal, got ${error}`)
  return error
}

// protects=a port another process holds is refused with PORT_UNAVAILABLE naming that process's pid and command, and the learner is told never to end it from the chat; fails_when=the occupant is not named or the chat is told to end it; no_claim=how the occupant is found (findPortOccupant tests)
test('a port another process listens on names that process and its command', async () => {
  // Arrange
  const asked: number[] = []
  // Act
  const refusal = await refusalOf({
    port: 4801,
    findPortOccupant: async (port) => {
      asked.push(port)
      return { pid: 99, command: 'node' }
    },
    seams: { connect: silentConnect, bind: bindFailingWith('EADDRINUSE') },
  })
  // Assert
  assert.equal(refusal.code, 'PORT_UNAVAILABLE')
  assert.equal(
    refusal.message,
    "Process 99 (node) listens on port 4801, and the declaration names it as the server's own port. Ask the learner to stop that process, or to declare the port the server's own code listens on, then start again; never end that process yourself.",
  )
  assert.deepEqual(asked, [4801])
})

// protects=an occupant whose command cannot be read is still named by its pid; fails_when=a missing command breaks the sentence; no_claim=none
test('a port held by a process whose command is unreadable names its pid alone', async () => {
  // Arrange
  const input = {
    port: 4802,
    findPortOccupant: async () => ({ pid: 77 }),
    seams: { connect: silentConnect, bind: bindFailingWith('EADDRINUSE') },
  }
  // Act
  const refusal = await refusalOf(input)
  // Assert
  assert.equal(
    refusal.message,
    "Process 77 listens on port 4802, and the declaration names it as the server's own port. Ask the learner to stop that process, or to declare the port the server's own code listens on, then start again; never end that process yourself.",
  )
})

// protects=a taken port whose occupant cannot be seen is still refused, without inventing a process; fails_when=an unknown occupant reads as a named one or the refusal is lost; no_claim=none
test('a taken port whose occupant cannot be seen says something listens there', async () => {
  // Arrange
  const input = {
    port: 4803,
    findPortOccupant: async () => undefined,
    seams: { connect: silentConnect, bind: bindFailingWith('EADDRINUSE') },
  }
  // Act
  const refusal = await refusalOf(input)
  // Assert
  assert.equal(refusal.code, 'PORT_UNAVAILABLE')
  assert.match(refusal.message, /^Something listens on port 4803, /)
})

// protects=a port the system does not let Codebook listen on asks for a port from 1024 up and looks for no occupant; fails_when=it reads as taken or names a process; no_claim=which ports a real host refuses
test('a port the system does not permit asks for a port from 1024 up', async () => {
  // Arrange
  const asked: number[] = []
  // Act
  const refusal = await refusalOf({
    port: 4804,
    findPortOccupant: async (port) => {
      asked.push(port)
      return undefined
    },
    seams: { connect: silentConnect, bind: bindFailingWith('EACCES') },
  })
  // Assert
  assert.equal(refusal.code, 'PORT_UNAVAILABLE')
  assert.equal(
    refusal.message,
    "Port 4804 is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it). Ask the learner to declare the port the server's own code listens on, from 1024 up, then start again.",
  )
  assert.deepEqual(asked, [])
})

// protects=a port Codebook could not check is refused with the error code only, and nothing is started; fails_when=an unreadable port reads as free or as taken by someone; no_claim=which codes a real host raises
test('a port Codebook could not check names the error code and starts nothing', async () => {
  // Arrange
  const input = {
    port: 4805,
    findPortOccupant: async () => undefined,
    seams: { connect: silentConnect, bind: bindFailingWith('EADDRNOTAVAIL') },
  }
  // Act
  const refusal = await refusalOf(input)
  // Assert
  assert.equal(refusal.code, 'PORT_UNAVAILABLE')
  assert.equal(
    refusal.message,
    'Codebook could not check whether port 4805 is free (EADDRNOTAVAIL), so it did not start the server. Ask the learner to resolve the network problem on this machine, then start again.',
  )
})

// protects=a port an earlier Codebook run still holds is refused naming that run, which the chat stops with codebook_stop; fails_when=Codebook's own running run reads as a foreign process; no_claim=none
test('a port an earlier Codebook run still holds asks to stop that run first', async (context) => {
  // Arrange
  const claim = claimOwnedDevelopmentPort(4806)
  context.after(() => releaseOwnedDevelopmentPort(claim))
  // Act
  const refusal = await refusalOf({
    port: 4806,
    findPortOccupant: async () => undefined,
    seams: { connect: silentConnect, bind: freeBind },
  })
  // Assert
  assert.equal(refusal.code, 'PORT_UNAVAILABLE')
  assert.equal(
    refusal.message,
    'Port 4806 is still held by an earlier Codebook run that is still running. Stop that run (codebook_stop) and wait for it to finish, then start again.',
  )
})

// protects=a port an earlier Codebook run is still stopping on, and that stays taken past the wait, says that run has not finished stopping; fails_when=the stopping run reads as running or as a foreign process; no_claim=the real release wait (5,000 ms)
test('a port an earlier Codebook run has not finished stopping on says so', async (context) => {
  // Arrange
  const claim = claimOwnedDevelopmentPort(4807)
  beginReleaseOfOwnedDevelopmentPort(claim)
  context.after(() => releaseOwnedDevelopmentPort(claim))
  // Act
  const refusal = await refusalOf({
    port: 4807,
    findPortOccupant: async () => undefined,
    seams: {
      connect: silentConnect,
      bind: bindFailingWith('EADDRINUSE'),
      releaseWaitMs: 20,
    },
  })
  // Assert
  assert.equal(
    refusal.message,
    'Port 4807 is still held by an earlier Codebook run that has not finished stopping. Stop that run (codebook_stop) and wait for it to finish, then start again.',
  )
})
