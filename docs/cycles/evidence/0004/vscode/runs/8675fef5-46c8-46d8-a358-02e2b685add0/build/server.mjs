import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY_LIMIT_BYTES, EXPECTED_ADMISSIONS } from './constants.mjs';
const directory = dirname(dirname(fileURLToPath(import.meta.url)));
const configuration = JSON.parse(await readFile(join(directory, 'fixture-config.json'), 'utf8'));
const arrivals = [];
const carts = new Map();
let releaseBarrier = () => undefined;
const barrier = new Promise(resolve => { releaseBarrier = resolve; });
/** Mutates one admitted cart after both requests arrive; the HTTP fixture calls this at the server study stop. @example addProduct({ operationId: 'run', cartId: 'selected', productId: 'tote-01', price: 24 }) */
function addProduct(tuple) {
    const state = carts.get(tuple.cartId) ?? { items: [] };
    const admittedCount = arrivals.length;
    state.items.push({ id: tuple.productId, price: tuple.price }); // CODEBOOK_SERVER_STOP
    carts.set(tuple.cartId, state);
    return { ...tuple, cartCount: state.items.length, admittedCount };
}
const server = createServer((request, response) => {
    void (async () => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        const prefix = `/runs/${configuration.runId}/`;
        response.setHeader('cache-control', 'no-store');
        if (!pathname.startsWith(prefix)) {
            response.writeHead(404).end();
            return;
        }
        const route = pathname.slice(prefix.length);
        if (request.method === 'GET' && ['index.html', 'client.mjs', 'client.mjs.map', 'constants.mjs', 'constants.mjs.map'].includes(route)) {
            const bytes = await readFile(join(directory, route === 'index.html' ? route : `build/${route}`));
            response.setHeader('content-type', route === 'index.html' ? 'text/html' : 'text/javascript');
            response.end(bytes);
            return;
        }
        if (request.method !== 'POST' || !['api/cart', 'api/redirected'].includes(route)) {
            response.writeHead(404).end();
            return;
        }
        if (configuration.scenario === 'redirect' && route === 'api/cart') {
            response.writeHead(307, { location: `${prefix}api/redirected` }).end();
            return;
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > BODY_LIMIT_BYTES) {
                response.writeHead(413).end();
                return;
            }
            chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (!body || typeof body !== 'object' || !('cartId' in body) || typeof body.cartId !== 'string' || !('productId' in body) || typeof body.productId !== 'string' || !('price' in body) || typeof body.price !== 'number') {
            response.writeHead(400).end();
            return;
        }
        const tuple = { operationId: String(request.headers['x-codebook-operation'] ?? ''), cartId: body.cartId, productId: body.productId, price: body.price };
        arrivals.push(tuple);
        if (arrivals.length === EXPECTED_ADMISSIONS)
            releaseBarrier();
        await barrier;
        const result = addProduct(tuple);
        if (tuple.cartId === 'selected') {
            if (configuration.scenario === 'backend-exit')
                process.exit(1);
            if (configuration.scenario === 'absent-response')
                return;
            if (configuration.scenario === 'wrong-response-id')
                result.operationId = 'wrong-operation';
            if (configuration.scenario === 'wrong-response-value')
                result.cartCount = 2;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result));
    })().catch(error => { response.writeHead(500).end(String(error)); });
});
server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('No owned fixture listener');
    void writeFile(join(directory, 'backend-endpoint.json'), JSON.stringify({ runId: configuration.runId, pid: process.pid, origin: `http://127.0.0.1:${address.port}`, executable: process.execPath, version: process.version }));
});
//# sourceMappingURL=server.mjs.map
// Injected stale server deployment.
