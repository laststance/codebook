import { readTuple, type CartTuple } from './readTuple';

export interface CheckoutTuple extends CartTuple { cartOperationId: string }

/** Retains the cart parent from untrusted checkout JSON so {@link NetworkEvidence} can verify cross-action correspondence. @example readCheckoutTuple(body, 'run-checkout').cartOperationId */
export function readCheckoutTuple(value: unknown, operationId: string): CheckoutTuple {
  const tuple = readTuple(value, operationId);
  if (!value || typeof value !== 'object' || !('cartOperationId' in value) || typeof value.cartOperationId !== 'string' || !value.cartOperationId) throw new Error('Missing checkout cart operation identity');
  return { ...tuple, cartOperationId: value.cartOperationId };
}
