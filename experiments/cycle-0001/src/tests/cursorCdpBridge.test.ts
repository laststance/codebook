import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { CursorCdpBridge } from '../cursorCdpBridge';

test('Cursor compatibility exposes only the owned target and preserves real runtime payloads', async context => {
  // Arrange
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const bridge = new CursorCdpBridge(`ws://127.0.0.1:${address.port}`, 'owned-page', () => undefined);
  const port = await bridge.listen();
  context.after(async () => { await bridge.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const descriptor = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const upstreamConnection = once(upstream, 'connection');
  const client = new WebSocket(descriptor.webSocketDebuggerUrl);
  const [peer] = await upstreamConnection;
  const observed = once(client, 'message');
  // Act
  peer.send(JSON.stringify({ id: 1, result: { targetInfos: [{ targetId: 'owned-page', type: 'webview', url: 'http://fixture' }, { targetId: 'unrelated', type: 'page', url: 'vscode-file://editor' }] } }));
  const [discovery] = await observed;
  const runtime = { method: 'Debugger.paused', params: { reason: 'other', callFrames: [{ callFrameId: 'real-frame', location: { scriptId: 'real-script', lineNumber: 8 }, scopeChain: [] }] } };
  const receivedRuntime = once(client, 'message');
  peer.send(JSON.stringify(runtime));
  const [pause] = await receivedRuntime;
  // Assert
  assert.deepEqual(JSON.parse(discovery.toString()), { id: 1, result: { targetInfos: [{ targetId: 'owned-page', type: 'page', url: 'http://fixture' }] } });
  assert.deepEqual(JSON.parse(pause.toString()), runtime);
});

test('Cursor compatibility rejects another target and browser shutdown before upstream dispatch', async context => {
  // Arrange
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const bridge = new CursorCdpBridge(`ws://127.0.0.1:${address.port}`, 'owned-page', () => undefined);
  const port = await bridge.listen();
  context.after(async () => { await bridge.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const descriptor = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const upstreamConnection = once(upstream, 'connection');
  const client = new WebSocket(descriptor.webSocketDebuggerUrl);
  const [peer] = await upstreamConnection;
  let forwarded = 0;
  peer.on('message', () => { forwarded += 1; });
  // Act
  const foreignReply = once(client, 'message');
  client.send(JSON.stringify({ id: 1, method: 'Target.attachToTarget', params: { targetId: 'unrelated' } }));
  const [foreign] = await foreignReply;
  const shutdownReply = once(client, 'message');
  client.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
  const [shutdown] = await shutdownReply;
  // Assert
  assert.equal(JSON.parse(foreign.toString()).error.message, 'Outside owned fixture target');
  assert.equal(JSON.parse(shutdown.toString()).error.message, 'Outside owned fixture target');
  assert.equal(forwarded, 0);
});

test('a valid page session cannot send browser-wide commands through the compatibility bridge', async context => {
  // Arrange
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const bridge = new CursorCdpBridge(`ws://127.0.0.1:${address.port}`, 'owned-page', () => undefined);
  const port = await bridge.listen();
  context.after(async () => { await bridge.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const descriptor = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const upstreamConnection = once(upstream, 'connection');
  const client = new WebSocket(descriptor.webSocketDebuggerUrl);
  const [peer] = await upstreamConnection;
  const attached = once(client, 'message');
  peer.send(JSON.stringify({ method: 'Target.attachedToTarget', params: { sessionId: 'owned-session', targetInfo: { targetId: 'owned-page', type: 'webview', url: 'http://fixture' } } }));
  await attached;
  let forwarded = 0;
  peer.on('message', () => { forwarded += 1; });
  // Act
  const rejected = once(client, 'message');
  client.send(JSON.stringify({ id: 3, sessionId: 'owned-session', method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));
  const [reply] = await rejected;
  // Assert
  assert.equal(JSON.parse(reply.toString()).error.message, 'Outside owned fixture target');
  assert.equal(forwarded, 0);
});
