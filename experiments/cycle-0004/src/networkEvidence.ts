import type { Protocol } from 'devtools-protocol';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { MAX_BODY_BYTES, MAX_REQUESTS, EXPECTED_REQUEST_COUNT } from './constants';
import { readTuple, type CartTuple } from './utils/readTuple';

export interface CartResponse extends CartTuple { cartCount: number; admittedCount: number }
export interface RequestObservation {
  requestId: string;
  sequence: number;
  tuple: CartTuple;
  initiatorUrls: string[];
  response?: { status: number; url: string };
  finishedSequence?: number;
  body?: CartResponse;
  bodyHash?: string;
}

/** Retains the complete fixed request set so {@link PairedRun} cannot infer uniqueness from early partial evidence. @example network.request(event, sequence) */
export class NetworkEvidence {
  readonly requests = new Map<string, RequestObservation>();
  readonly errors: string[] = [];
  closed = false;
  constructor(readonly operationId: string, readonly url: string, readonly clientUrl: string) {}

  /** Records one HTTP hop, rejecting redirects, malformed payloads and later extras before final run sealing. @example network.request(requestWillBeSent, 12) */
  request(event: Protocol.Network.RequestWillBeSentEvent, sequence: number): void {
    if (!this.requests.has(event.requestId) && !event.request.url.startsWith(this.url)) return;
    try {
      if (this.closed) throw new Error('Request appeared after the expected observation set closed');
      if (event.redirectResponse || this.requests.has(event.requestId)) throw new Error('Redirect or reused HTTP request ID is unsupported');
      if (event.request.url !== this.url || event.request.method !== 'POST') throw new Error('Unexpected cart request URL or method');
      if (this.requests.size >= MAX_REQUESTS) throw new Error('Request observation limit exceeded');
      const raw = event.request.postData;
      if (!raw || Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('Missing or oversized request body');
      const operationHeader = Object.entries(event.request.headers).find(([name]) => name.toLowerCase() === 'x-codebook-operation')?.[1];
      const tuple = readTuple(JSON.parse(raw), typeof operationHeader === 'string' ? operationHeader : '');
      const initiatorUrls: string[] = [];
      let stack = event.initiator.stack;
      while (stack) { for (const frame of stack.callFrames) initiatorUrls.push(frame.url); stack = stack.parent; }
      if (event.initiator.type !== 'script' || !initiatorUrls.includes(this.clientUrl)) throw new Error('Request has no sealed client initiator context');
      this.requests.set(event.requestId, { requestId: event.requestId, sequence, tuple, initiatorUrls });
      if (!tuple.operationId) throw new Error('Missing operation identity');
      if ([...this.requests.values()].filter(request => request.tuple.operationId === tuple.operationId).length > 1) throw new Error('Ambiguous duplicate operation identity');
      if (this.requests.size > EXPECTED_REQUEST_COUNT) throw new Error('Unexpected additional cart request');
    } catch (error) { this.errors.push(String(error)); }
  }

  /** Retains origin/status only after real response headers; cache or worker delivery invalidates the fixture contract. @example network.response(responseReceived) */
  response(event: Protocol.Network.ResponseReceivedEvent): void {
    const observation = this.requests.get(event.requestId);
    if (!observation) return;
    const response = event.response;
    observation.response = { status: response.status, url: response.url };
    if (response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache || response.status !== 200 || response.url !== this.url) this.errors.push('Unsupported cached, worker, redirected or unsuccessful response');
  }

  /** Marks actual transport completion before {@link PairedRun} asks CDP for its body. @example network.finished('request-1', 30) // true */
  finished(requestId: string, sequence: number): boolean {
    const observation = this.requests.get(requestId);
    if (!observation) return false;
    observation.finishedSequence = sequence;
    return true;
  }

  /** Parses bounded completed body bytes without promoting missing fields or partial traffic to evidence. @example network.body('request-1', { body: '{...}', base64Encoded: false }) */
  body(requestId: string, result: Protocol.Network.GetResponseBodyResponse): void {
    const observation = this.requests.get(requestId);
    if (!observation) { this.errors.push('Response body has no retained request'); return; }
    try {
      if (!observation.finishedSequence) throw new Error('Response body arrived before loadingFinished');
      if (Buffer.byteLength(result.body) > MAX_BODY_BYTES) throw new Error('Response body exceeds evidence limit');
      const bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
      if (result.base64Encoded && bytes.toString('base64').replace(/=+$/, '') !== result.body.replace(/=+$/, '')) throw new Error('Invalid base64 response body');
      if (bytes.length > MAX_BODY_BYTES) throw new Error('Decoded response body exceeds evidence limit');
      const decoded: unknown = JSON.parse(bytes.toString('utf8'));
      if (!decoded || typeof decoded !== 'object' || !('operationId' in decoded) || typeof decoded.operationId !== 'string' || !('cartCount' in decoded) || typeof decoded.cartCount !== 'number' || !('admittedCount' in decoded) || typeof decoded.admittedCount !== 'number') throw new Error('Malformed response body');
      observation.body = { ...readTuple(decoded, decoded.operationId), cartCount: decoded.cartCount, admittedCount: decoded.admittedCount };
      observation.bodyHash = sha256(bytes);
    } catch (error) { this.errors.push(String(error)); }
  }

  /** Exposes only one fully closed expected set; a late background observation cannot be silently omitted. @example network.settled() // undefined until both bodies exist */
  settled(): { selected: RequestObservation; background: RequestObservation } | undefined {
    if (this.errors.length || this.requests.size !== EXPECTED_REQUEST_COUNT) return undefined;
    const requests = [...this.requests.values()];
    const selected = requests.find(request => request.tuple.operationId === this.operationId);
    const background = requests.find(request => request.tuple.operationId === `${this.operationId}-background`);
    if (!selected || !background || !selected.body || !background.body || !selected.response || !background.response || !selected.finishedSequence || !background.finishedSequence) return undefined;
    const expectedSelected = { operationId: this.operationId, cartId: 'selected', productId: 'tote-01', price: 24 };
    const expectedBackground = { operationId: `${this.operationId}-background`, cartId: 'background', productId: 'background-02', price: 99 };
    if (JSON.stringify(selected.tuple) !== JSON.stringify(expectedSelected) || JSON.stringify(background.tuple) !== JSON.stringify(expectedBackground)) { this.errors.push('Request tuple differs from the frozen expectation'); return undefined; }
    if (JSON.stringify(selected.body) !== JSON.stringify({ ...expectedSelected, cartCount: 1, admittedCount: 2 }) || JSON.stringify(background.body) !== JSON.stringify({ ...expectedBackground, cartCount: 1, admittedCount: 2 })) { this.errors.push('Response identity or values differ from the frozen expectation'); return undefined; }
    return { selected, background };
  }

  /** Seals a complete set while keeping subsequent protocol violations observable until teardown. @example network.closeSet() */
  closeSet(): void {
    if (!this.settled()) throw new Error('Expected request observation set is incomplete');
    this.closed = true;
  }
}
