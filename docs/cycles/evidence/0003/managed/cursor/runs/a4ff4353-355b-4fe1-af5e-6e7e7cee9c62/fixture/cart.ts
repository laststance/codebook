const product = Object.freeze({ id: 'tote-01', price: 24 });
const state = { items: [] as (typeof product)[], clicks: 0 };

/** Handles the fixture button's click so the runner can observe one pre-mutation stop. @example addToCart() // cart count: 0 → 1 */
function addToCart(): void {
  state.clicks += 1;
  const selectedProduct = product;
  const previousCount = state.items.length;
  state.items.push(selectedProduct); // CODEBOOK_BREAKPOINT: stop before this mutation.
  document.querySelector('#count')!.textContent = String(state.items.length);
  document.querySelector('#clicks')!.textContent = String(state.clicks);
  document.querySelector('#status')!.textContent = `Added ${selectedProduct.id}; previous count ${previousCount}.`;
}

document.querySelector('#add')!.addEventListener('click', addToCart);
document.documentElement.dataset.ready = 'true';
export {};

// Deliberate local edit after sealing.
