import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { Cdp } from '../runtimeSupport/cdp';
import { verifyServerInspectorOwnership } from '../utils/verifyServerInspectorOwnership';

/** Supplies explicit inspector responses while the OS group check remains real; ownership tests call this without launching an application. @example inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' }) */
function inspectorResponse(value: unknown, exception = false) {
  class Socket extends EventTarget {
    send(message: string) {
      const request = JSON.parse(message);
      assert.equal(request.method, 'Runtime.evaluate');
      assert.equal(request.params.expression, '({pid:process.pid,cwd:process.cwd(),worker:process.env.NEXT_PRIVATE_WORKER})');
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result: {
        result: { type: 'object', value }, ...(exception ? { exceptionDetails: { text: 'Unavailable' } } : {}),
      } }) }));
    }
    close() { this.dispatchEvent(new Event('close')); }
  }
  return new Cdp(new Socket(), () => undefined);
}

test('selected server identity must match both the repository and the actual OS process group', async () => {
  // Arrange
  const inspector = inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' });
  const processGroup = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  // Act
  const identity = await verifyServerInspectorOwnership(inspector, process.cwd(), processGroup, new AbortController().signal, () => undefined);
  // Assert
  assert.equal(identity.pid, process.pid);
  assert.equal(identity.processGroup, processGroup);
  assert.equal(identity.workspace, await realpath(process.cwd()));
  inspector.close();
});

test('foreign worker groups cannot gain server debugger control through a matching repository', async () => {
  // Arrange
  const inspector = inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' });
  const processGroup = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  // Act / Assert
  await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), processGroup + 1, new AbortController().signal, () => undefined), /different process group/);
  inspector.close();
});

test('another repository cannot gain server debugger control through a matching worker marker', async () => {
  // Arrange
  const inspector = inspectorResponse({ pid: process.pid, cwd: '/', worker: '1' });
  // Act / Assert
  await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), process.pid, new AbortController().signal, () => undefined), /different repository/);
  inspector.close();
});

test('malformed and failed inspector identities never establish server ownership', async () => {
  // Arrange
  for (const value of [undefined, { pid: '1; kill', cwd: '/', worker: '1' }, { pid: 1, cwd: '/', worker: '0' }, { pid: -1, cwd: '/', worker: '1' }]) {
    const inspector = inspectorResponse(value);
    // Act / Assert
    await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), process.pid, new AbortController().signal, () => undefined));
    inspector.close();
  }
  const inspector = inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' }, true);
  await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), process.pid, new AbortController().signal, () => undefined), /evaluation failed/);
  inspector.close();
});

test('cancelled or retired launches cannot retain ownership after an inspector response', async () => {
  // Arrange
  const inspector = inspectorResponse({ pid: process.pid, cwd: process.cwd(), worker: '1' });
  const controller = new AbortController();
  controller.abort();
  // Act / Assert
  await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), process.pid, controller.signal, () => undefined), { name: 'AbortError' });
  let checks = 0;
  await assert.rejects(verifyServerInspectorOwnership(inspector, process.cwd(), process.pid, new AbortController().signal, () => {
    if (++checks > 1) throw new Error('Launch retired');
  }), /Launch retired/);
  assert.equal(checks, 2);
  inspector.close();
});
