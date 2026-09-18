import { BACKGROUND_CART_TUPLE, COMPLETED_CART_COUNT, COMPLETED_ORDER_COUNT, EXPECTED_REQUEST_COUNT, SELECTED_CART_TUPLE, type ActionId } from '../constants';
import type { CartResponse, OrderResponse } from '../networkEvidence';
import type { CartTuple } from './readTuple';
import type { CheckoutTuple } from './readCheckoutTuple';

export interface ActionExpectations {
  selectedRequest: CartTuple | CheckoutTuple;
  backgroundRequest: CartTuple | CheckoutTuple;
  selectedResponse: CartResponse | OrderResponse;
  backgroundResponse: CartResponse | OrderResponse;
}

/** Freezes concrete selected/background tuples before {@link PairedRun} sends input; network and pause checks consume the same contract. @example actionExpectations('run', 'checkout').selectedResponse */
export function actionExpectations(runId: string, action: ActionId): ActionExpectations {
  const selected = { operationId: runId, ...SELECTED_CART_TUPLE };
  const background = { operationId: `${runId}-background`, ...BACKGROUND_CART_TUPLE };
  const counts = { cartCount: COMPLETED_CART_COUNT, admittedCount: EXPECTED_REQUEST_COUNT };
  if (action === 'add-to-cart') return { selectedRequest: selected, backgroundRequest: background, selectedResponse: { ...selected, ...counts }, backgroundResponse: { ...background, ...counts } };
  const selectedCheckout = { ...selected, operationId: `${runId}-checkout`, cartOperationId: runId };
  const backgroundCheckout = { ...background, operationId: `${runId}-checkout-background`, cartOperationId: `${runId}-background` };
  return { selectedRequest: selectedCheckout, backgroundRequest: backgroundCheckout,
    selectedResponse: { ...selectedCheckout, ...counts, orderId: `order-${runId}`, total: selected.price, orderCount: COMPLETED_ORDER_COUNT },
    backgroundResponse: { ...backgroundCheckout, ...counts, orderId: `order-${runId}-background`, total: background.price, orderCount: COMPLETED_ORDER_COUNT } };
}
