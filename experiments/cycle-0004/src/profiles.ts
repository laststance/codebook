import { ACTIVE_TIMEOUT_MS, CART_LINK_IDS, CHECKOUT_RUN_TIMEOUT_MS, RUN_TIMEOUT_MS, type ActionId, type CapturePhase, type ParticipantName, type ProfileId, type StudyItemId } from './constants';

export interface StudyItem {
  readonly id: StudyItemId;
  readonly participant: ParticipantName;
  readonly action: ActionId;
  readonly title: string;
  readonly file: 'server.mts' | 'client.mts';
  readonly marker: string;
  readonly capturePhase: CapturePhase;
  readonly artifactPrefix: string;
  readonly overview: string;
}
export interface StudyAction {
  readonly id: ActionId;
  readonly title: string;
  readonly selector: '#add' | '#checkout';
  readonly route: 'api/cart' | 'api/checkout';
  readonly afterCapture: CapturePhase;
}
export interface StudyProfile {
  readonly id: ProfileId;
  readonly title: string;
  readonly description: string;
  readonly actions: readonly StudyAction[];
  readonly items: readonly StudyItem[];
  readonly requiredLinks: readonly string[];
  readonly capturePhases: readonly CapturePhase[];
  readonly limits: { readonly runTimeoutMs: number; readonly setupTimeoutMs: number; readonly activeTimeoutMs: number; readonly activeBudget: 'whole-run' | 'per-action' };
}

const cartMutation = { participant: 'server', action: 'add-to-cart', title: 'Cart mutation', file: 'server.mts', marker: 'CODEBOOK_SERVER_STOP',
  overview: 'The server admits the selected cart request and adds the product to its cart state. The stop is immediately before that mutation. Source structure alone does not establish an observed execution.' } as const;
const cartUpdate = { participant: 'browser', action: 'add-to-cart', title: 'Cart update', file: 'client.mts', marker: 'CODEBOOK_BROWSER_STOP',
  overview: 'The browser awaits the selected cart response and updates the displayed count. The stop is immediately before the DOM update. Request correspondence requires a complete verified observation set.' } as const;

// Fixed profile data shares identities across execution, discovery and reading without exposing a workflow DSL.
export const STUDY_PROFILES: Readonly<Record<ProfileId, StudyProfile>> = {
  'paired-cart-demo': {
    id: 'paired-cart-demo', title: 'Paired cart demo', description: 'One local cart click with actual server and browser pauses.',
    actions: [{ id: 'add-to-cart', title: 'Add to cart', selector: '#add', route: 'api/cart', afterCapture: 'after' }],
    items: [
      { ...cartMutation, id: 'paired-cart-demo/server', title: 'Server cart mutation', capturePhase: 'paused-server', artifactPrefix: 'server' },
      { ...cartUpdate, id: 'paired-cart-demo/browser', title: 'Browser display update', capturePhase: 'paused-browser', artifactPrefix: 'browser' },
    ],
    requiredLinks: CART_LINK_IDS, capturePhases: ['before', 'paused-server', 'paused-browser', 'after'],
    limits: { runTimeoutMs: RUN_TIMEOUT_MS, setupTimeoutMs: ACTIVE_TIMEOUT_MS, activeTimeoutMs: ACTIVE_TIMEOUT_MS, activeBudget: 'whole-run' },
  },
  'checkout-demo': {
    id: 'checkout-demo', title: 'Checkout demo', description: 'Add one local product, then create an order and observe purchase confirmation in the same application. No real payment.',
    actions: [
      { id: 'add-to-cart', title: 'Add to cart', selector: '#add', route: 'api/cart', afterCapture: 'after-cart' },
      { id: 'checkout', title: 'Checkout', selector: '#checkout', route: 'api/checkout', afterCapture: 'after-confirmation' },
    ],
    items: [
      { ...cartMutation, id: 'checkout-demo/cart-mutation', capturePhase: 'paused-cart-mutation', artifactPrefix: 'cart-mutation' },
      { ...cartUpdate, id: 'checkout-demo/cart-update', capturePhase: 'paused-cart-update', artifactPrefix: 'cart-update' },
      { id: 'checkout-demo/order-creation', participant: 'server', action: 'checkout', title: 'Order creation', file: 'server.mts', marker: 'CODEBOOK_ORDER_STOP', capturePhase: 'paused-order-creation', artifactPrefix: 'order-creation',
        overview: 'The server checks the checkout request against the retained cart and derives the order total from its items. The stop is immediately before storing the order; its order count is still zero.' },
      { id: 'checkout-demo/purchase-confirmation', participant: 'browser', action: 'checkout', title: 'Purchase confirmation', file: 'client.mts', marker: 'CODEBOOK_CONFIRMATION_STOP', capturePhase: 'paused-purchase-confirmation', artifactPrefix: 'purchase-confirmation',
        overview: 'The browser has received the selected order response. The stop is immediately before displaying its confirmation. Captured order values and the later screen observation establish the result.' },
    ],
    requiredLinks: [...CART_LINK_IDS, 'cart-result-checkout-input', ...CART_LINK_IDS.map(id => `checkout-${id}`)],
    capturePhases: ['before', 'paused-cart-mutation', 'paused-cart-update', 'after-cart', 'paused-order-creation', 'paused-purchase-confirmation', 'after-confirmation'],
    limits: { runTimeoutMs: CHECKOUT_RUN_TIMEOUT_MS, setupTimeoutMs: ACTIVE_TIMEOUT_MS, activeTimeoutMs: ACTIVE_TIMEOUT_MS, activeBudget: 'per-action' },
  },
};
