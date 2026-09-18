import { PRODUCT, BACKGROUND_PRODUCT } from './constants.mjs';

const runId = document.documentElement.dataset.runId!;
const scenario = document.documentElement.dataset.scenario!;
const count = document.querySelector('#count')!;
const clicks = document.querySelector('#clicks')!;
const status = document.querySelector('#status')!;
interface CartResult { operationId: string; cartId: string; productId: string; price: number; cartCount: number; admittedCount: number }

/** Sends each fixture request once from the click handler; its headers and body are debugger correlation evidence. @example requestCart('selected', 'run', PRODUCT) */
async function requestCart(cartId: string, operationId: string, product: typeof PRODUCT): Promise<CartResult> {
  const response = await fetch('api/cart', { method: 'POST', headers: { 'content-type': 'application/json', ...(operationId ? { 'x-codebook-operation': operationId } : {}) }, body: JSON.stringify({ cartId, productId: product.id, price: product.price }) });
  if (!response.ok) throw new Error(`Cart HTTP ${response.status}`);
  return response.json();
}

document.querySelector('#add')!.addEventListener('click', () => {
  void (async () => {
    status.textContent = 'Two requests pending; waiting for the server.';
    const selected = requestCart('selected', scenario === 'missing-id' ? '' : runId, PRODUCT);
    const background = requestCart('background', scenario === 'duplicate-id' ? runId : `${runId}-background`, BACKGROUND_PRODUCT);
    const [result, backgroundResult] = await Promise.all([selected, background]);
    count.textContent = String(result.cartCount); // CODEBOOK_BROWSER_STOP
    clicks.textContent = String(Number(clicks.textContent) + 1);
    status.textContent = `Selected cart updated; background cart ${backgroundResult.cartCount}.`;
  })().catch(error => { status.textContent = String(error); document.documentElement.dataset.error = String(error); });
});
document.documentElement.dataset.ready = 'true';
