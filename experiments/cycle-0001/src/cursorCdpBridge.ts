import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { ACTIVE_TIMEOUT_MS, CDP_BRIDGE_PAYLOAD_LIMIT_BYTES, CDP_BRIDGE_PENDING_LIMIT } from './constants';

interface TargetInfo { targetId: string; type: string; url: string; [key: string]: unknown }
interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: { targetId?: string; sessionId?: string; targetInfo?: TargetInfo; [key: string]: unknown };
  result?: { sessionId?: string; targetInfo?: TargetInfo; targetInfos?: TargetInfo[]; [key: string]: unknown };
  error?: { code: number; message: string };
}
type Log = (type: string, detail?: unknown) => unknown;
const BROWSER_METHODS = new Set(['Target.attachToBrowserTarget', 'Target.setDiscoverTargets', 'Target.getTargets', 'Target.getTargetInfo', 'Target.attachToTarget', 'Target.detachFromTarget', 'Browser.getVersion']);

/** Restricts an experimental js-debug connection to one native target and normalizes only its webview metadata. @example const bridge = new CursorCdpBridge(upstream, targetId, log); await bridge.listen() */
export class CursorCdpBridge {
  private readonly server = createServer((request, response) => {
    if (request.url !== '/json/version') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${this.port}/${this.secretPath}` }));
  });
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: CDP_BRIDGE_PAYLOAD_LIMIT_BYTES, perMessageDeflate: false });
  private readonly upstreams = new Set<WebSocket>();
  private readonly secretPath = randomUUID();
  port = 0;

  constructor(private readonly upstreamUrl: string, private readonly targetId: string, private readonly log: Log) {
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url !== `/${this.secretPath}`) { socket.destroy(); return; }
      this.sockets.handleUpgrade(request, socket, head, client => this.connect(client));
    });
  }

  /** Binds an ephemeral loopback endpoint used only by the owned DAP attach configuration. @example const port = await bridge.listen() */
  async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Cursor CDP bridge did not bind');
    this.port = address.port;
    this.log('bridge.listening', { targetId: this.targetId, originalType: 'webview', debuggerType: 'page' });
    return this.port;
  }

  /** Closes both transport directions so pending attach cannot outlive owned-run cleanup. @example await bridge.close() */
  async close(): Promise<void> {
    for (const socket of this.upstreams) socket.terminate();
    for (const socket of this.sockets.clients) socket.terminate();
    this.sockets.close();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    this.log('bridge.closed');
  }

  /** Relays real runtime messages while filtering browser-level discovery and attachment for one debugger. @example this.connect(ownedSocket) */
  private connect(client: WebSocket): void {
    const upstream = new WebSocket(this.upstreamUrl, { maxPayload: CDP_BRIDGE_PAYLOAD_LIMIT_BYTES, handshakeTimeout: ACTIVE_TIMEOUT_MS });
    this.upstreams.add(upstream);
    const pending: CdpMessage[] = [];
    const requestMethods = new Map<string, string>();
    const browserSessions = new Set<string>();
    const pageSessions = new Set<string>();
    const key = (message: CdpMessage) => `${message.sessionId ?? 'root'}:${message.id}`;
    const sendClient = (message: CdpMessage) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message)); };
    const close = () => { this.upstreams.delete(upstream); upstream.terminate(); client.terminate(); };
    const relay = (message: CdpMessage) => {
      const inPage = message.sessionId && pageSessions.has(message.sessionId);
      const inBrowser = !message.sessionId || browserSessions.has(message.sessionId);
      const foreignTarget = message.params?.targetId && message.params.targetId !== this.targetId;
      const foreignSession = message.params?.sessionId && !pageSessions.has(message.params.sessionId) && !browserSessions.has(message.params.sessionId);
      const browserMutation = message.method?.startsWith('Browser.') && message.method !== 'Browser.getVersion';
      const targetMutation = message.method?.startsWith('Target.') && !BROWSER_METHODS.has(message.method) && !(inPage && message.method === 'Target.setAutoAttach');
      // Browser-wide mutation and unrelated runtime sessions never reach the real editor browser.
      if (foreignTarget || foreignSession || browserMutation || targetMutation || (!inPage && (!inBrowser || !BROWSER_METHODS.has(message.method ?? '')))) {
        this.log('bridge.rejected', { method: message.method, sessionId: message.sessionId, targetId: message.params?.targetId });
        sendClient({ id: message.id, sessionId: message.sessionId, error: { code: -32601, message: 'Outside owned fixture target' } });
        return;
      }
      if (message.id !== undefined && message.method) requestMethods.set(key(message), message.method);
      upstream.send(JSON.stringify(message));
    };
    client.on('message', bytes => {
      try {
        const message: CdpMessage = JSON.parse(bytes.toString());
        if (upstream.readyState === WebSocket.OPEN) relay(message);
        else if (pending.length < CDP_BRIDGE_PENDING_LIMIT) pending.push(message);
        else close();
      } catch { close(); }
    });
    upstream.on('open', () => { for (const message of pending.splice(0)) relay(message); });
    upstream.on('message', bytes => {
      try {
        const message: CdpMessage = JSON.parse(bytes.toString());
        const method = requestMethods.get(key(message));
        if (message.id !== undefined) requestMethods.delete(key(message));
        if (method === 'Target.attachToBrowserTarget' && message.result?.sessionId) browserSessions.add(message.result.sessionId);
        if (method === 'Target.attachToTarget' && message.result?.sessionId) pageSessions.add(message.result.sessionId);
        const normalize = (target: TargetInfo) => ({ ...target, type: target.type === 'webview' ? 'page' : target.type });
        if (message.result?.targetInfos) message.result.targetInfos = message.result.targetInfos.filter(target => target.targetId === this.targetId).map(normalize);
        if (message.result?.targetInfo) {
          if (message.result.targetInfo.targetId !== this.targetId) { sendClient({ id: message.id, sessionId: message.sessionId, error: { code: -32601, message: 'Outside owned fixture target' } }); return; }
          message.result.targetInfo = normalize(message.result.targetInfo);
        }
        if (message.params?.targetInfo) {
          if (message.params.targetInfo.targetId !== this.targetId) return;
          message.params.targetInfo = normalize(message.params.targetInfo);
          if (message.method === 'Target.attachedToTarget' && message.params.sessionId) pageSessions.add(message.params.sessionId);
        }
        if (message.params?.targetId && message.params.targetId !== this.targetId) return;
        sendClient(message);
      } catch { close(); }
    });
    client.on('close', close);
    client.on('error', close);
    upstream.on('close', close);
    upstream.on('error', close);
  }
}
