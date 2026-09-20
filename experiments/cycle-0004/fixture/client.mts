import { PRODUCT, BACKGROUND_PRODUCT, CONFIRMATION_ANIMATION_DURATION_MS, CONFIRMATION_ENTRY_OFFSET_PX } from './constants.mjs';

const runId = document.documentElement.dataset.runId!;
const scenario = document.documentElement.dataset.scenario!;
const checkoutProfile = document.documentElement.dataset.profile === 'checkout-demo';
const count = document.querySelector('#count')!;
const clicks = document.querySelector('#clicks')!;
const status = document.querySelector('#status')!;
interface CartResult { operationId: string; cartId: string; productId: string; price: number; cartCount: number; admittedCount: number }
interface OrderResult extends CartResult { cartOperationId: string; orderId: string; total: number; orderCount: number }
let selectedCart: CartResult | undefined;
let backgroundCart: CartResult | undefined;
const checkoutButton = document.querySelector<HTMLButtonElement>('#checkout')!;
checkoutButton.hidden = !checkoutProfile;

/** Sends each fixture request once from the click handler; its headers and body are debugger correlation evidence. @example requestCart('selected', 'run', PRODUCT) */
async function requestCart(cartId: string, operationId: string, product: typeof PRODUCT): Promise<CartResult> {
  const response = await fetch('api/cart', { method: 'POST', headers: { 'content-type': 'application/json', ...(operationId ? { 'x-codebook-operation': operationId } : {}) }, body: JSON.stringify({ cartId, productId: product.id, price: product.price }) });
  if (!response.ok) throw new Error(`Cart HTTP ${response.status}`);
  return response.json();
}

document.querySelector('#add')!.addEventListener('click', () => {
  void (async () => {
    status.textContent = 'Two requests pending; waiting for the server.';
    const selected = requestCart('selected', !checkoutProfile && scenario === 'missing-id' ? '' : runId, PRODUCT);
    const background = requestCart('background', !checkoutProfile && scenario === 'duplicate-id' ? runId : `${runId}-background`, BACKGROUND_PRODUCT);
    const [result, backgroundResult] = await Promise.all([selected, background]);
    count.textContent = String(result.cartCount); // CODEBOOK_BROWSER_STOP
    clicks.textContent = String(Number(clicks.textContent) + 1);
    selectedCart = result; backgroundCart = backgroundResult;
    checkoutButton.disabled = false;
    status.textContent = `Selected cart updated; background cart ${backgroundResult.cartCount}.`;
  })().catch(error => { status.textContent = String(error); document.documentElement.dataset.error = String(error); });
});

/** Carries the observed cart operation into one checkout request; the checkout click supplies its actual cart result. @example await requestCheckout(selectedCart) */
async function requestCheckout(cart: CartResult): Promise<OrderResult> {
  const selected = cart.cartId === 'selected';
  const operationId = selected && scenario === 'missing-id' ? '' : selected || scenario === 'duplicate-id' ? `${runId}-checkout` : `${runId}-checkout-background`;
  const response = await fetch('api/checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...(operationId ? { 'x-codebook-operation': operationId } : {}) },
    body: JSON.stringify({ cartId: cart.cartId, productId: cart.productId, price: cart.price, cartOperationId: cart.operationId }) });
  if (!response.ok) throw new Error(`Checkout HTTP ${response.status}`);
  return response.json();
}

checkoutButton.addEventListener('click', () => {
  if (!checkoutProfile || !selectedCart || !backgroundCart || checkoutButton.disabled) return;
  const selected = selectedCart, background = backgroundCart;
  checkoutButton.disabled = true;
  void (async () => {
    status.textContent = 'Creating the selected and background orders.';
    const [result, backgroundResult] = await Promise.all([requestCheckout(selected), requestCheckout(background)]);
    document.querySelector('#order-id')!.textContent = result.orderId; // CODEBOOK_CONFIRMATION_STOP
    document.querySelector('#order-total')!.textContent = String(result.total);
    const confirmation = document.querySelector<HTMLElement>('#confirmation')!;
    confirmation.hidden = false;
    document.documentElement.dataset.orderStatus = 'confirming';
    // Completion waits for actual page motion so recording cannot seal before its final visible state.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await confirmation.animate([{ transform: `translateY(${CONFIRMATION_ENTRY_OFFSET_PX}px)`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: CONFIRMATION_ANIMATION_DURATION_MS, easing: 'ease-out' }).finished;
    }
    document.querySelector('#checkouts')!.textContent = String(Number(document.querySelector('#checkouts')!.textContent) + 1);
    document.documentElement.dataset.orderStatus = 'confirmed';
    status.textContent = `Purchase confirmed; background order ${backgroundResult.orderId}.`;
  })().catch(error => { status.textContent = String(error); document.documentElement.dataset.error = String(error); });
});
document.documentElement.dataset.ready = 'true';
