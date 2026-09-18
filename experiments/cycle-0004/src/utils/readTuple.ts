export interface CartTuple { operationId: string; cartId: string; productId: string; price: number }

/** Validates untrusted fixture JSON at network boundaries before {@link NetworkEvidence} correlates a request. @example readTuple({ cartId: 'selected', productId: 'tote-01', price: 24 }, 'run') */
export function readTuple(value: unknown, operationId: string): CartTuple {
  if (!value || typeof value !== 'object' || !('cartId' in value) || typeof value.cartId !== 'string' || !('productId' in value) || typeof value.productId !== 'string' || !('price' in value) || typeof value.price !== 'number' || !Number.isFinite(value.price)) throw new Error('Malformed cart tuple');
  return { operationId, cartId: value.cartId, productId: value.productId, price: value.price };
}
