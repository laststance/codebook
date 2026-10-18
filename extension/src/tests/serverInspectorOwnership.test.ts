import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'

import { Cdp } from '../runtimeSupport/cdp'
import { verifyServerInspectorOwnership } from '../utils/verifyServerInspectorOwnership'

import { standInForPs } from './utils/standInForPs'

test('a real worker inspector identifies its thread separately from the owned process', async (context) => {
  // Arrange: a Node worker shares the process PID, repository and launch marker.
  const processGroup = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  const modulePath = resolve(
    __dirname,
    '../utils/verifyServerInspectorOwnership.js',
  )
  const worker = new Worker(
    `const { parentPort } = require('node:worker_threads');
const { Session } = require('node:inspector');
const { verifyServerInspectorOwnership } = require(${JSON.stringify(modulePath)});
const session = new Session();
session.connect();
const inspector = { request: (method, parameters) => new Promise((resolve, reject) => session.post(method, parameters, (error, response) => error ? reject(error) : resolve(response))) };
verifyServerInspectorOwnership(inspector, process.cwd(), ${processGroup}, new AbortController().signal, () => {}).then(
  identity => { parentPort.postMessage(identity); session.disconnect(); },
  error => { parentPort.postMessage({ error: String(error) }); session.disconnect(); }
);`,
    { eval: true, env: { ...process.env, NEXT_PRIVATE_WORKER: '1' } },
  )
  context.after(() => worker.terminate())

  // Act
  const identity = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
    },
  )

  // Assert: matching process ownership must not imply the main JavaScript target.
  assert.equal(identity.error, undefined)
  assert.equal(identity.pid, process.pid)
  assert.equal(identity.isMainThread, false)
  assert.ok(typeof identity.threadId === 'number')
  assert.equal(identity.threadId > 0, true)
})

/** Supplies explicit inspector responses while the OS group check remains real; ownership tests call this without launching an application. @example inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' }) */
function inspectorResponse(
  value: unknown,
  exception = false,
  threadValue: unknown = { isMainThread: true, threadId: 0 },
) {
  class Socket extends EventTarget {
    send(message: string): void {
      const request = JSON.parse(message)
      assert.equal(request.method, 'Runtime.evaluate')
      const readingThread = request.params.expression.includes(
        'node:worker_threads',
      )
      if (!readingThread)
        assert.equal(
          request.params.expression,
          '({pid:process.pid,cwd:process.cwd(),worker:process.env.NEXT_PRIVATE_WORKER})',
        )
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            id: request.id,
            result: {
              result: {
                type: 'object',
                value: readingThread ? threadValue : value,
              },
              ...(exception
                ? { exceptionDetails: { text: 'Unavailable' } }
                : {}),
            },
          }),
        }),
      )
    }
    close(): void {
      this.dispatchEvent(new Event('close'))
    }
  }
  return new Cdp(new Socket(), () => undefined)
}

test('selected server identity must match both the repository and the actual OS process group', async () => {
  // Arrange
  const inspector = inspectorResponse({
    pid: process.pid,
    cwd: process.cwd(),
    worker: '1',
  })
  const processGroup = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  // Act
  const identity = await verifyServerInspectorOwnership(
    inspector,
    process.cwd(),
    processGroup,
    new AbortController().signal,
    () => undefined,
  )
  // Assert
  assert.equal(identity.pid, process.pid)
  assert.equal(identity.processGroup, processGroup)
  assert.equal(identity.workspace, await realpath(process.cwd()))
  assert.equal(identity.isMainThread, true)
  assert.equal(identity.threadId, 0)
  inspector.close()
})

test('missing or contradictory thread identity cannot become an owned server candidate', async () => {
  // Arrange
  const processGroup = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  for (const thread of [
    {},
    { isMainThread: 'true', threadId: 0 },
    { isMainThread: true, threadId: 1 },
    { isMainThread: false, threadId: 0 },
    { isMainThread: false, threadId: -1 },
  ]) {
    const inspector = inspectorResponse(
      { pid: process.pid, cwd: process.cwd(), worker: '1' },
      false,
      thread,
    )
    // Act / Assert
    await assert.rejects(
      verifyServerInspectorOwnership(
        inspector,
        process.cwd(),
        processGroup,
        new AbortController().signal,
        () => undefined,
      ),
    )
    inspector.close()
  }
})

test('foreign worker groups cannot gain server debugger control through a matching repository', async () => {
  // Arrange
  const inspector = inspectorResponse({
    pid: process.pid,
    cwd: process.cwd(),
    worker: '1',
  })
  const processGroup = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  // Act / Assert
  await assert.rejects(
    verifyServerInspectorOwnership(
      inspector,
      process.cwd(),
      processGroup + 1,
      new AbortController().signal,
      () => undefined,
    ),
    /different process group/,
  )
  inspector.close()
})

test('another repository cannot gain server debugger control through a matching worker marker', async () => {
  // Arrange
  const inspector = inspectorResponse({
    pid: process.pid,
    cwd: '/',
    worker: '1',
  })
  // Act / Assert
  await assert.rejects(
    verifyServerInspectorOwnership(
      inspector,
      process.cwd(),
      process.pid,
      new AbortController().signal,
      () => undefined,
    ),
    /different repository/,
  )
  inspector.close()
})

test('malformed and failed inspector identities never establish server ownership', async () => {
  // Arrange
  for (const value of [
    undefined,
    { pid: '1; kill', cwd: '/', worker: '1' },
    { pid: 1, cwd: '/', worker: '0' },
    { pid: -1, cwd: '/', worker: '1' },
  ]) {
    const inspector = inspectorResponse(value)
    // Act / Assert
    await assert.rejects(
      verifyServerInspectorOwnership(
        inspector,
        process.cwd(),
        process.pid,
        new AbortController().signal,
        () => undefined,
      ),
    )
    inspector.close()
  }
  const inspector = inspectorResponse(
    { pid: process.pid, cwd: process.cwd(), worker: '1' },
    true,
  )
  await assert.rejects(
    verifyServerInspectorOwnership(
      inspector,
      process.cwd(),
      process.pid,
      new AbortController().signal,
      () => undefined,
    ),
    /evaluation failed/,
  )
  inspector.close()
})

test('cancelled or retired launches cannot retain ownership after an inspector response', async () => {
  // Arrange
  const inspector = inspectorResponse({
    pid: process.pid,
    cwd: process.cwd(),
    worker: '1',
  })
  const controller = new AbortController()
  controller.abort()
  // Act / Assert
  await assert.rejects(
    verifyServerInspectorOwnership(
      inspector,
      process.cwd(),
      process.pid,
      controller.signal,
      () => undefined,
    ),
    { name: 'AbortError' },
  )
  let checks = 0
  await assert.rejects(
    verifyServerInspectorOwnership(
      inspector,
      process.cwd(),
      process.pid,
      new AbortController().signal,
      () => {
        if (++checks > 1) throw new Error('Launch retired')
      },
    ),
    /Launch retired/,
  )
  assert.equal(checks, 2)
  inspector.close()
})

// Value: protects=the process group check that decides whether a server inspector belongs to the owned launch: it asks the system's ps at /bin/ps or /usr/bin/ps, never a ps the search path names; fails_when=the check starts the bare `ps`, so with an empty or relative PATH entry and the opened project as the editor's current folder a cloned repository's own ps answers the group and a foreign inspector gains debugger control; why_new=RT2; seam=`ps` itself, a stand-in of the test that is the whole search path and answers a foreign group; no_claim=a system whose /bin/ps and /usr/bin/ps are both missing
test(
  'a ps in the search path cannot vouch for a foreign process group of a server inspector',
  { skip: process.platform === 'win32' && 'the stand-in for ps needs /bin/sh' },
  async (context) => {
    // Arrange: the real group is read before the stand-in takes the search path; the stand-in answers the group one above it.
    const processGroup = Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
        encoding: 'utf8',
      }).trim(),
    )
    const foreignGroup = processGroup + 1
    await standInForPs(context, `process.stdout.write('${foreignGroup}\\n')`)
    const inspector = inspectorResponse({
      pid: process.pid,
      cwd: process.cwd(),
      worker: '1',
    })
    // Act / Assert
    await assert.rejects(
      verifyServerInspectorOwnership(
        inspector,
        process.cwd(),
        foreignGroup,
        new AbortController().signal,
        () => undefined,
      ),
      /different process group/,
    )
    inspector.close()
  },
)
