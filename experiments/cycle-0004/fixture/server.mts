import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY_LIMIT_BYTES, EXPECTED_ADMISSIONS, EXPECTED_CART_ITEMS } from './constants.mjs';

const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const configuration: { runId: string; scenario: string; profile?: string } = JSON.parse(await readFile(join(directory, 'fixture-config.json'), 'utf8'));
interface Tuple { operationId: string; cartId: string; productId: string; price: number }
interface CheckoutTuple extends Tuple { cartOperationId: string }
const arrivals: Tuple[] = [];
const checkoutArrivals: CheckoutTuple[] = [];
const carts = new Map<string, { items: { id: string; price: number }[]; lastOperationId: string; orders: { id: string; total: number }[] }>();
let releaseBarrier: () => void = () => undefined;
const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
let releaseCheckoutBarrier: () => void = () => undefined;
const checkoutBarrier = new Promise<void>(resolve => { releaseCheckoutBarrier = resolve; });

/** Mutates one admitted cart after both requests arrive; the HTTP fixture calls this at the server study stop. @example addProduct({ operationId: 'run', cartId: 'selected', productId: 'tote-01', price: 24 }) */
function addProduct(tuple: Tuple) {
  const state = carts.get(tuple.cartId) ?? { items: [], lastOperationId: '', orders: [] };
  const admittedCount = arrivals.length;
  state.items.push({ id: tuple.productId, price: tuple.price }); // CODEBOOK_SERVER_STOP
  state.lastOperationId = tuple.operationId;
  carts.set(tuple.cartId, state);
  return { ...tuple, cartCount: state.items.length, admittedCount };
}

/** Creates one order from retained cart state after both checkout requests arrive; the checkout route supplies its tuple. @example createOrder({operationId:'run-checkout',cartOperationId:'run',cartId:'selected',productId:'tote-01',price:24}) */
function createOrder(tuple: CheckoutTuple) {
  const state = carts.get(tuple.cartId);
  if (!state || state.lastOperationId !== tuple.cartOperationId || state.items.length !== EXPECTED_CART_ITEMS || state.orders.length) throw new Error('Checkout does not match one unpurchased cart');
  const product = state.items[0]!;
  if (product.id !== tuple.productId || product.price !== tuple.price) throw new Error('Checkout product differs from retained cart');
  const admittedCount = checkoutArrivals.length;
  const orderId = `order-${state.lastOperationId}`;
  const total = state.items.reduce((sum, item) => sum + item.price, 0);
  state.orders.push({ id: orderId, total }); // CODEBOOK_ORDER_STOP
  return { ...tuple, cartCount: state.items.length, admittedCount, orderId, total, orderCount: state.orders.length };
}

const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const prefix = `/runs/${configuration.runId}/`;
    response.setHeader('cache-control', 'no-store');
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const route = pathname.slice(prefix.length);
    if (request.method === 'GET' && ['index.html', 'client.mjs', 'client.mjs.map', 'constants.mjs', 'constants.mjs.map'].includes(route)) {
      const bytes = await readFile(join(directory, route === 'index.html' ? route : `build/${route}`));
      response.setHeader('content-type', route === 'index.html' ? 'text/html' : 'text/javascript');
      response.end(bytes); return;
    }
    const checkout = route === 'api/checkout';
    if (request.method !== 'POST' || !['api/cart', 'api/redirected', 'api/checkout'].includes(route) || checkout && configuration.profile !== 'checkout-demo') { response.writeHead(404).end(); return; }
    const injectFault = configuration.profile === 'checkout-demo' ? checkout : route === 'api/cart';
    if (injectFault && configuration.scenario === 'redirect') { response.writeHead(307, { location: `${prefix}api/redirected` }).end(); return; }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT_BYTES) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || !('cartId' in body) || typeof body.cartId !== 'string' || !('productId' in body) || typeof body.productId !== 'string' || !('price' in body) || typeof body.price !== 'number') { response.writeHead(400).end(); return; }
    const tuple: Tuple = { operationId: String(request.headers['x-codebook-operation'] ?? ''), cartId: body.cartId, productId: body.productId, price: body.price };
    // Separate admission barriers keep second-action counters independent while retaining the same carts.
    let result: ReturnType<typeof addProduct> | ReturnType<typeof createOrder>;
    if (checkout) {
      if (!('cartOperationId' in body) || typeof body.cartOperationId !== 'string') { response.writeHead(400).end(); return; }
      const checkoutTuple = { ...tuple, cartOperationId: body.cartOperationId };
      checkoutArrivals.push(checkoutTuple);
      if (checkoutArrivals.length === EXPECTED_ADMISSIONS) releaseCheckoutBarrier();
      await checkoutBarrier;
      result = createOrder(checkoutTuple);
    } else {
      arrivals.push(tuple);
      if (arrivals.length === EXPECTED_ADMISSIONS) releaseBarrier();
      await barrier;
      result = addProduct(tuple);
    }
    if (injectFault && tuple.cartId === 'selected') {
      if (configuration.scenario === 'backend-exit') process.exit(1);
      if (configuration.scenario === 'absent-response') return;
      if (configuration.scenario === 'wrong-response-id') result.operationId = 'wrong-operation';
      if (configuration.scenario === 'wrong-response-value') result.cartCount = 2;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result));
  })().catch(error => { response.writeHead(500).end(String(error)); });
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No owned fixture listener');
  void writeFile(join(directory, 'backend-endpoint.json'), JSON.stringify({ runId: configuration.runId, pid: process.pid, origin: `http://127.0.0.1:${address.port}`, executable: process.execPath, version: process.version }));
});
