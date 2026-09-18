import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cdp } from '../cdp';

/** Models reordered wire responses for the transport tests, without claiming a real browser result. @example socket.reply(2, { data: 'png' }) */
class TestSocket extends EventTarget {
  readonly messages: { id: number; method: string }[] = [];
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void { this.messages.push(JSON.parse(String(value))); }
  close(): void { this.dispatchEvent(new Event('close')); }
  reply(id: number, result: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) })); }
}

test('a screenshot is sent and resolved while the input request has no response', async () => {
  // Arrange
  const socket = new TestSocket();
  const cdp = new Cdp(socket, () => undefined);
  const input = cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 });
  // Act
  const capture = cdp.request('Page.captureScreenshot', { format: 'png' });
  socket.reply(2, { data: 'captured' });
  // Assert
  assert.deepEqual(socket.messages, [{ id: 1, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 1, y: 1 } }, { id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }]);
  assert.deepEqual(await capture, { data: 'captured' });
  socket.reply(1, {});
  await input;
  cdp.close();
});

test('a timed-out screenshot response cannot resolve a newer screenshot', async () => {
  // Arrange
  const socket = new TestSocket();
  const events: string[] = [];
  const cdp = new Cdp(socket, type => events.push(type));
  // Act
  await assert.rejects(cdp.request('Page.captureScreenshot', {}, 5), /timed out/);
  const next = cdp.request('Page.captureScreenshot', {});
  socket.reply(1, { data: 'stale' });
  socket.reply(2, { data: 'current' });
  // Assert
  assert.deepEqual(await next, { data: 'current' });
  assert.equal(events.filter(type => type === 'cdp.late-response-ignored').length, 1);
  cdp.close();
});

test('disconnect rejects every outstanding request without sending another input', async () => {
  // Arrange
  const socket = new TestSocket();
  const cdp = new Cdp(socket, () => undefined);
  const input = cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 });
  const capture = cdp.request('Page.captureScreenshot', {});
  // Act
  socket.close();
  // Assert
  await assert.rejects(input, /disconnected/);
  await assert.rejects(capture, /disconnected/);
  assert.equal(socket.messages.length, 2);
});
