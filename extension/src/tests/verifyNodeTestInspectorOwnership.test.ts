import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import { Cdp } from '../runtimeSupport/cdp'
import { verifyNodeTestInspectorOwnership } from '../utils/verifyNodeTestInspectorOwnership'

import { standInForPs } from './utils/standInForPs'

/**
 * Builds an Inspector that answers the identity evaluation with this test process's id and current folder, while the group check stays the real one; the ownership tests call it without launching a Node test.
 * @returns A connected {@link Cdp} over a socket of the test's own.
 * @example const inspector = inspectorOfThisProcess() // Runtime.evaluate answers { pid: process.pid, cwd: process.cwd() }
 */
function inspectorOfThisProcess(): Cdp {
  class Socket extends EventTarget {
    send(message: string): void {
      const request = JSON.parse(message)
      assert.equal(request.method, 'Runtime.evaluate')
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            id: request.id,
            result: {
              result: {
                type: 'object',
                value: { pid: process.pid, cwd: process.cwd() },
              },
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

// Value: protects=the process group check that binds a Vitest worker Inspector to the owned test launch: it asks the system's ps at /bin/ps or /usr/bin/ps, never a ps the search path names; fails_when=the check starts the bare `ps`, so with an empty or relative PATH entry and the opened project as the editor's current folder a cloned repository's own ps answers the group and a foreign Inspector gains debugger control; why_new=RT2; seam=`ps` itself, a stand-in of the test that is the whole search path and answers a foreign group, and an Inspector of the test's own; no_claim=a system whose /bin/ps and /usr/bin/ps are both missing
test(
  'a ps in the search path cannot vouch for a foreign process group of a Node test Inspector',
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
    const inspector = inspectorOfThisProcess()
    // Act / Assert
    await assert.rejects(
      verifyNodeTestInspectorOwnership(
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

// Value: protects=the Node test Inspector of the owned launch still passes the group check once ps is started by its absolute path; fails_when=the check names a path where no ps lies or reads the system's answer wrongly, so every owned Node test is refused debugger control; why_new=RT2; seam=an Inspector of the test's own; no_claim=macOS, where /bin/ps is not observed on this machine
test('a Node test Inspector of the owned process group passes the check of the system’s ps', async () => {
  // Arrange
  const processGroup = Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    }).trim(),
  )
  const inspector = inspectorOfThisProcess()
  // Act
  const identity = await verifyNodeTestInspectorOwnership(
    inspector,
    process.cwd(),
    processGroup,
    new AbortController().signal,
    () => undefined,
  )
  // Assert
  assert.equal(identity.pid, process.pid)
  assert.equal(identity.processGroup, processGroup)
  inspector.close()
})
