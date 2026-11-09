import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import {
  processGroupFromStat,
  readProcessGroup,
  ReverseProxyGate,
  type ReverseProxyDependencies,
} from '../reverseProxyGate'

const ORIGIN = 'https://app.example.test'
const SERVER_PORT = 4310
const CLI_PID = 5000
const SERVER_PID = 5001

/** A started development server whose liveness a test flips. */
function startedApp(state = { running: true }) {
  return {
    state,
    app: {
      pid: CLI_PID,
      isRunning: () => state.running,
      listening: async () => 'http://127.0.0.1:4310',
    },
  }
}

/** Dependencies that pass by default: loopback answer, readable certificates, a proof from the server child in the spawned group, a browser at the checked address. */
function passingDependencies(
  overrides: Partial<ReverseProxyDependencies> = {},
): Partial<ReverseProxyDependencies> {
  return {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    readSystemCertificates: async () => ({
      ok: true,
      certificates: ['certificate-text'],
    }),
    prove: async () => ({ ok: true, serverPid: SERVER_PID }),
    probe: async () => ({
      ok: true,
      address: '127.0.0.1',
      port: 443,
      cleanupConfirmed: true,
    }),
    processGroupOf: async () => CLI_PID,
    isProcessAlive: () => true,
    ...overrides,
  }
}

function newGate(
  overrides: Partial<ReverseProxyDependencies> = {},
  origin = ORIGIN,
) {
  return new ReverseProxyGate({
    chromeBinary: '/opt/chrome/chrome',
    declaration: { origin, upstreamPort: SERVER_PORT },
    nodeExecutable: '/opt/node/bin/node',
    dependencies: passingDependencies(overrides),
  })
}

/** Resolves, prepares and proves a gate against a started app. */
async function provedGate(
  overrides: Partial<ReverseProxyDependencies> = {},
  state = { running: true },
) {
  const gate = newGate(overrides)
  const { app } = startedApp(state)
  const signal = new AbortController().signal
  assert.equal(await gate.resolve(signal), undefined)
  await gate.preparePreload()
  const failure = await gate.prove(app, signal)
  return { gate, failure }
}

// Value: protects=AC 3 the run resource shows resolving, proving and proved in order; fails_when=a state is skipped or the view lacks the address and proofMs after the proof; no_claim=the wording of the resource message
test('the view moves from resolving through proving to proved with the address and the proof time', async () => {
  // Arrange
  let releaseProof: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    releaseProof = resolve
  })
  const gate = newGate({
    prove: async () => {
      await held
      return { ok: true, serverPid: SERVER_PID }
    },
  })
  const { app } = startedApp()
  const signal = new AbortController().signal
  const before = gate.view()
  await gate.resolve(signal)
  await gate.preparePreload()
  // Act
  const proving = gate.prove(app, signal)
  await new Promise((resolve) => setImmediate(resolve))
  const during = gate.view()
  releaseProof()
  assert.equal(await proving, undefined)
  const after = gate.view()
  // Assert
  assert.deepEqual(before, {
    origin: ORIGIN,
    upstreamPort: SERVER_PORT,
    state: 'resolving',
  })
  assert.equal(during.state, 'proving')
  assert.equal(after.state, 'proved')
  assert.equal(after.address, '127.0.0.1')
  assert.equal(typeof after.proofMs, 'number')
  await gate.dispose()
})

// Value: protects=D20 a host that resolves outside loopback is refused before anything starts; fails_when=the gate lets a private address pass or drops the address from the facts; no_claim=the resolver's own rules (lane C)
test('a host that resolves to a non-loopback address is refused with that address and the view says refused', async () => {
  // Arrange
  const gate = newGate({
    lookup: async () => [{ address: '10.0.0.5', family: 4 }],
  })
  // Act
  const failure = await gate.resolve(new AbortController().signal)
  // Assert
  assert.equal(failure?.reason, 'not-loopback')
  assert.equal(failure?.facts.address, '10.0.0.5')
  assert.equal(failure?.facts.origin, ORIGIN)
  assert.equal(failure?.facts.upstreamPort, SERVER_PORT)
  assert.equal(gate.view().state, 'refused')
})

// Value: protects=D20 the proxy and the dev server cannot share a socket; fails_when=an origin on the upstream port at 127.0.0.1 passes, or 127.0.0.2 with the same port is refused; no_claim=resolution
test('an origin on the upstream port at 127.0.0.1 is refused as same-socket and at 127.0.0.2 is allowed', async () => {
  // Arrange
  const signal = new AbortController().signal
  const sameSocket = newGate({}, `https://app.example.test:${SERVER_PORT}`)
  const otherLoopback = newGate(
    { lookup: async () => [{ address: '127.0.0.2', family: 4 }] },
    `https://app.example.test:${SERVER_PORT}`,
  )
  // Act
  const refused = await sameSocket.resolve(signal)
  const allowed = await otherLoopback.resolve(signal)
  // Assert
  assert.equal(refused?.reason, 'same-socket')
  assert.equal(refused?.facts.address, '127.0.0.1')
  assert.equal(allowed, undefined)
})

// Value: protects=D27 the proof admits only the declared origin; fails_when=another origin, a path or a lookalike host is admitted before or after the proof; no_claim=the saved-session caller
test('a passing proof admits the declared origin and no other', async () => {
  // Arrange
  const gate = newGate()
  const beforeProof = gate.admits(ORIGIN)
  // Act
  const { gate: proved, failure } = await provedGate()
  // Assert
  assert.equal(beforeProof, false)
  assert.equal(failure, undefined)
  assert.equal(proved.admits(ORIGIN), true)
  assert.equal(proved.admits('https://other.example.test'), false)
  assert.equal(proved.admits('http://app.example.test'), false)
  assert.equal(proved.admits(`${ORIGIN}/login`), false)
  await proved.dispose()
})

// Value: protects=D27 an exited spawned CLI never reuses the proof; fails_when=admits stays true after the CLI exited; no_claim=other restarts
test('the proof stops admitting the origin once the spawned CLI exited', async () => {
  // Arrange
  const state = { running: true }
  const { gate } = await provedGate({}, state)
  const whileRunning = gate.admits(ORIGIN)
  // Act
  state.running = false
  // Assert
  assert.equal(whileRunning, true)
  assert.equal(gate.admits(ORIGIN), false)
  await gate.dispose()
})

// Value: protects=D27 a server child that exits while its parent lives is not admitted; fails_when=only the parent is watched; no_claim=a replaced server on the same pid
test('the proof stops admitting the origin once the answering server child exited while the parent lives', async () => {
  // Arrange
  const alive = { value: true }
  const { gate } = await provedGate({ isProcessAlive: () => alive.value })
  const whileAlive = gate.admits(ORIGIN)
  // Act
  alive.value = false
  // Assert
  assert.equal(whileAlive, true)
  assert.equal(gate.admits(ORIGIN), false)
  await gate.dispose()
})

// Value: protects=D22 an answer from a process outside the spawned group is refused; fails_when=a foreign pid passes as the started server; no_claim=ps itself
test('an answer from a process outside the spawned group is refused as proof-wrong-server and never admitted', async () => {
  // Arrange
  const overrides = { processGroupOf: async () => 9999 }
  // Act
  const { gate, failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'proof-wrong-server')
  assert.equal(failure?.facts.status, 200)
  assert.equal(gate.admits(ORIGIN), false)
  assert.equal(gate.view().state, 'refused')
})

// Value: protects=D22 a platform without ps binds the answer by liveness alone; fails_when=an undefined group refuses a run on Windows; no_claim=Windows being a host of this cycle
test('a platform without ps accepts the answer while the spawned CLI runs', async () => {
  // Arrange
  const overrides = { processGroupOf: async () => undefined }
  // Act
  const { gate, failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure, undefined)
  assert.equal(gate.admits(ORIGIN), true)
  await gate.dispose()
})

// Value: protects=D22 the Node proof's failure facts reach the refusal; fails_when=status, tlsCode, requestWritten or the checked address is dropped; no_claim=how the transport classifies
test('a failed Node proof returns its reason with the status, the TLS code and the checked address', async () => {
  // Arrange
  const overrides = {
    prove: async () =>
      ({
        ok: false,
        reason: 'proof-wrong-server',
        requestWritten: true,
        status: 404,
      }) as const,
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.deepEqual(failure, {
    reason: 'proof-wrong-server',
    facts: {
      origin: ORIGIN,
      upstreamPort: SERVER_PORT,
      resourcesReleased: true,
      address: '127.0.0.1',
      requestWritten: true,
      status: 404,
    },
  })
})

// Value: protects=D22 an unreadable system trust store is proof-unclassified; fails_when=the gate proves with an empty trust list; no_claim=how the child reads the store
test('an unreadable system certificate store refuses as proof-unclassified without sending a proof', async () => {
  // Arrange
  let proofRequests = 0
  const overrides = {
    readSystemCertificates: async () => ({ ok: false }) as const,
    prove: async () => {
      proofRequests += 1
      return { ok: true, serverPid: SERVER_PID } as const
    },
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'proof-unclassified')
  assert.equal(proofRequests, 0)
})

// Value: protects=C3-5 the refusal for an unreadable trust store says that no proof request was started; fails_when=the failure facts lack proofNotStarted, so the learner is told one GET was sent; no_claim=the wording of the refusal (reverseProxyRefusals.test)
test('an unreadable system certificate store marks the failure as before the proof request', async () => {
  // Arrange
  const overrides = {
    readSystemCertificates: async () => ({ ok: false }) as const,
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.facts.proofNotStarted, true)
})

// Value: protects=C3-5 a proof-unclassified after the Node proof passed stays unknown; fails_when=a failed process-group read after the proof request is reported as nothing sent; no_claim=why ps failed
test('an unreadable process group after the proof request does not mark the failure as before the proof', async () => {
  // Arrange
  const overrides = {
    processGroupOf: async (): Promise<number> => {
      throw new Error('ps failed')
    },
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'proof-unclassified')
  assert.equal(failure?.facts.proofNotStarted, undefined)
})

// Value: protects=O1-2 the probe's own cleanup decides resourcesReleased; fails_when=a probe that could not end its Chrome or remove its folder still yields resourcesReleased true; no_claim=what the run adds from its own stop
test('a browser check whose cleanup is unconfirmed refuses with resourcesReleased false', async () => {
  // Arrange
  const overrides: Partial<ReverseProxyDependencies> = {
    probe: async () => ({
      ok: false,
      reason: 'browser-address-mismatch',
      browserAddress: '10.1.2.3',
      cleanupConfirmed: false,
    }),
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'browser-address-mismatch')
  assert.equal(failure?.facts.resourcesReleased, false)
  assert.equal('cleanupConfirmed' in (failure?.facts ?? {}), false)
})

// Value: protects=O1-2 a confirmed probe cleanup reads as released; fails_when=a confirmed cleanup is reported as false; no_claim=the real Chrome
test('a browser check whose cleanup is confirmed refuses with resourcesReleased true', async () => {
  // Arrange
  const overrides: Partial<ReverseProxyDependencies> = {
    probe: async () => ({
      ok: false,
      reason: 'proof-timeout',
      cleanupConfirmed: true,
    }),
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'proof-timeout')
  assert.equal(failure?.facts.resourcesReleased, true)
})

// Value: protects=D23 the probe runs after the Node proof with the pin rule, the checked address and a fresh proof path; fails_when=the probe lacks the pin, uses the origin's wrong port, or a probe failure still admits the origin; no_claim=real Chrome (lane H)
test('a browser address mismatch refuses with both addresses and the probe received the pin and the proof path', async () => {
  // Arrange
  const inputs: Parameters<ReverseProxyDependencies['probe']>[0][] = []
  const overrides: Partial<ReverseProxyDependencies> = {
    probe: async (input) => {
      inputs.push(input)
      return {
        ok: false,
        reason: 'browser-address-mismatch',
        browserAddress: '10.1.2.3',
        cleanupConfirmed: true,
      }
    },
  }
  // Act
  const { gate, failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'browser-address-mismatch')
  assert.equal(failure?.facts.address, '127.0.0.1')
  assert.equal(failure?.facts.browserAddress, '10.1.2.3')
  assert.equal(inputs.length, 1)
  const [probeInput] = inputs
  assert.ok(probeInput)
  assert.equal(probeInput.chromeBinary, '/opt/chrome/chrome')
  assert.equal(
    probeInput.hostResolverRules,
    '--host-resolver-rules=MAP app.example.test 127.0.0.1',
  )
  assert.match(
    probeInput.url,
    /^https:\/\/app\.example\.test\/__codebook_proof__\/[0-9a-f]{32}$/,
  )
  assert.equal(probeInput.expectedAddress, '127.0.0.1')
  assert.equal(probeInput.expectedPort, 443)
  assert.equal(gate.admits(ORIGIN), false)
})

// Value: protects=D23 the pin rule for IPv4; fails_when=the rule names another host or address; no_claim=Chrome honoring it
test('the pin rule maps the declared host to the validated IPv4 address', async () => {
  // Arrange
  const gate = newGate()
  await gate.resolve(new AbortController().signal)
  // Act
  const rule = gate.hostResolverRules()
  // Assert
  assert.equal(rule, '--host-resolver-rules=MAP app.example.test 127.0.0.1')
})

// Value: protects=D23 the pin rule for IPv6; fails_when=the address is not bracketed; no_claim=Chrome honoring it
test('the pin rule brackets a validated IPv6 address', async () => {
  // Arrange
  const gate = newGate({ lookup: async () => [{ address: '::1', family: 6 }] })
  await gate.resolve(new AbortController().signal)
  // Act
  const rule = gate.hostResolverRules()
  // Assert
  assert.equal(rule, '--host-resolver-rules=MAP app.example.test [::1]')
})

// Value: protects=D21 the identity preload sits in a private folder that dispose removes; fails_when=the folder or file is group-readable, the secret is short, or the folder survives dispose; no_claim=what the preload does when Node loads it (lane B)
test('the preload file lives in a private folder with a 64 character secret and dispose removes it', async () => {
  // Arrange
  const gate = newGate()
  await gate.resolve(new AbortController().signal)
  // Act
  const facts = await gate.preparePreload()
  const again = await gate.preparePreload()
  const fileMode = (await stat(facts.identity.preloadPath)).mode & 0o777
  const folderMode =
    (await stat(dirname(facts.identity.preloadPath))).mode & 0o777
  const content = await readFile(facts.identity.preloadPath, 'utf8')
  await gate.dispose()
  await gate.dispose()
  // Assert
  assert.equal(facts.upstreamPort, SERVER_PORT)
  assert.match(facts.identity.secret, /^[0-9a-f]{64}$/)
  assert.equal(again, facts)
  assert.equal(fileMode, 0o600)
  assert.equal(folderMode, 0o700)
  assert.equal(content.includes(facts.identity.secret), false)
  await assert.rejects(stat(facts.identity.preloadPath), { code: 'ENOENT' })
})

// Value: protects=C1-9 a failed removal keeps the preload folder known, so a later dispose removes it; fails_when=dispose forgets the folder before rm succeeded and the folder is never removed; no_claim=other filesystems' error codes
test('a dispose whose removal failed rejects and a later dispose removes the folder', async (context) => {
  // Arrange
  if (process.platform === 'win32') return context.skip('uses POSIX modes')
  if (process.getuid?.() === 0) return context.skip('root ignores modes')
  const gate = newGate()
  await gate.resolve(new AbortController().signal)
  const { identity } = await gate.preparePreload()
  const folder = dirname(identity.preloadPath)
  const locked = join(folder, 'locked')
  await mkdir(locked)
  await writeFile(join(locked, 'held'), 'x')
  await chmod(locked, 0o500)

  // Act
  const failed = await gate.dispose().then(
    () => undefined,
    (error: unknown) => error,
  )
  const folderAfterFailure = await stat(folder).then(
    () => true,
    () => false,
  )
  await chmod(locked, 0o700)
  await gate.dispose()

  // Assert
  assert.ok(failed instanceof Error)
  assert.equal(folderAfterFailure, true)
  await assert.rejects(stat(folder), { code: 'ENOENT' })
})

// Value: protects=D25 cancellation during the proof ends the gate with the signal's reason and no admission; fails_when=the abort becomes a refusal or the origin is admitted; no_claim=the transport destroying its socket (lane C)
test('cancelling during the proof rejects with the signal reason and admits nothing', async () => {
  // Arrange
  const controller = new AbortController()
  const gate = newGate({
    prove: (_input, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason))
      }),
  })
  const { app } = startedApp()
  await gate.resolve(controller.signal)
  await gate.preparePreload()
  // Act
  const proving = gate.prove(app, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new Error('run cancelled'))
  // Assert
  await assert.rejects(proving, { message: 'run cancelled' })
  assert.equal(gate.admits(ORIGIN), false)
  await gate.dispose()
})

// Value: protects=D27 dispose invalidates a standing proof; fails_when=admits stays true after dispose; no_claim=later runs
test('dispose ends the admission of a proved origin', async () => {
  // Arrange
  const { gate } = await provedGate()
  const before = gate.admits(ORIGIN)
  // Act
  await gate.dispose()
  // Assert
  assert.equal(before, true)
  assert.equal(gate.admits(ORIGIN), false)
})

// Value: protects=a certificate failure keeps its TLS code in the refusal facts; fails_when=tlsCode is dropped between the transport and the refusal; no_claim=how the transport classifies
test('an untrusted certificate refuses with the TLS code in the facts', async () => {
  // Arrange
  const overrides = {
    prove: async () =>
      ({
        ok: false,
        reason: 'certificate-untrusted',
        requestWritten: false,
        tlsCode: 'SELF_SIGNED_CERT_IN_CHAIN',
      }) as const,
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'certificate-untrusted')
  assert.equal(failure?.facts.tlsCode, 'SELF_SIGNED_CERT_IN_CHAIN')
})

// Value: protects=X2 an answering process that exits while the browser check runs never yields a proof; fails_when=prove() sets proved without checking the server again; no_claim=which process replaced it
test('a server process that exits while the browser check runs is refused as proof-unclassified and admits nothing', async () => {
  // Arrange
  const alive = { value: true }
  const overrides = {
    isProcessAlive: () => alive.value,
    probe: async () => {
      alive.value = false
      return {
        ok: true,
        address: '127.0.0.1',
        port: 443,
        cleanupConfirmed: true,
      } as const
    },
  }
  // Act
  const { gate, failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.reason, 'proof-unclassified')
  assert.equal(failure?.facts.resourcesReleased, true)
  assert.equal(gate.admits(ORIGIN), false)
  assert.equal(gate.view().state, 'refused')
})

// Value: protects=X2 the spawned CLI ending during the browser check is refused too; fails_when=only the answering process is rechecked; no_claim=the stop of the server
test('a spawned CLI that exits while the browser check runs is refused as proof-unclassified with the probe cleanup', async () => {
  // Arrange
  const state = { running: true }
  const overrides = {
    probe: async () => {
      state.running = false
      return {
        ok: true,
        address: '127.0.0.1',
        port: 443,
        cleanupConfirmed: false,
      } as const
    },
  }
  // Act
  const { gate, failure } = await provedGate(overrides, state)
  // Assert
  assert.equal(failure?.reason, 'proof-unclassified')
  assert.equal(failure?.facts.resourcesReleased, false)
  assert.equal(gate.admits(ORIGIN), false)
})

// Value: protects=X3 a correct pass whose cleanup was not confirmed continues and dispose retries it; fails_when=the pass is refused or the retry is never called; no_claim=the real Chrome cleanup
test('a pass with unconfirmed cleanup is proved and dispose retries the release', async () => {
  // Arrange
  let retries = 0
  const overrides = {
    probe: async (input: Parameters<ReverseProxyDependencies['probe']>[0]) => {
      input.onUnreleased?.(async () => {
        retries += 1
        return true
      })
      return {
        ok: true,
        address: '127.0.0.1',
        port: 443,
        cleanupConfirmed: false,
      } as const
    },
  }
  // Act
  const { gate, failure } = await provedGate(overrides)
  const before = retries
  await gate.dispose()
  // Assert
  assert.equal(failure, undefined)
  assert.equal(gate.view().state, 'proved')
  assert.equal(before, 0)
  assert.equal(retries, 1)
})

// Value: protects=X3 a release that still fails rejects dispose and is tried again later; fails_when=a failed retry is swallowed; no_claim=the real Chrome cleanup
test('a dispose whose release retry fails rejects and a later dispose tries it again', async () => {
  // Arrange
  let attempts = 0
  const overrides = {
    probe: async (input: Parameters<ReverseProxyDependencies['probe']>[0]) => {
      input.onUnreleased?.(async () => {
        attempts += 1
        return attempts > 1
      })
      return {
        ok: true,
        address: '127.0.0.1',
        port: 443,
        cleanupConfirmed: false,
      } as const
    },
  }
  const { gate } = await provedGate(overrides)
  // Act
  await assert.rejects(gate.dispose(), /still not closed/)
  await gate.dispose()
  // Assert
  assert.equal(attempts, 2)
})

// Value: protects=X5 the probe failure's requestWritten reaches the refusal facts; fails_when=the flag is dropped so a written request reads as nothing sent; no_claim=the wording
test('a browser check failure forwards requestWritten to the refusal facts', async () => {
  // Arrange
  const overrides: Partial<ReverseProxyDependencies> = {
    probe: async () => ({
      ok: false,
      reason: 'proof-unreachable',
      requestWritten: true,
      cleanupConfirmed: true,
    }),
  }
  // Act
  const { failure } = await provedGate(overrides)
  // Assert
  assert.equal(failure?.facts.requestWritten, true)
})

// Value: protects=N4 the process group is read from /proc where Linux has no ps; fails_when=a missing ps makes every Linux run proof-unclassified; no_claim=the real /proc
test('without ps on Linux the process group comes from the stat line', async () => {
  // Arrange
  const seams = {
    platform: 'linux' as const,
    psProgram: async (): Promise<string> => {
      throw new Error('no ps')
    },
    readStat: async () =>
      '5001 (next-server (v16)) S 5000 5000 5000 0 -1 4194560',
  }
  // Act
  const group = await readProcessGroup(5001, seams)
  // Assert
  assert.equal(group, 5000)
  assert.equal(processGroupFromStat('7 (a b) R 1 42 42 0'), 42)
  await assert.rejects(
    readProcessGroup(5001, { ...seams, platform: 'darwin' }),
    { message: 'no ps' },
  )
})
