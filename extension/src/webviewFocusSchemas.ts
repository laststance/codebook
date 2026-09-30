import { z } from 'zod'

import type { WebviewFocusReceipt } from './runtimeSupport/utils/installWebviewFocus'

export const webviewFocusReceiptSchema = z.strictObject({
  type: z.literal('codebook-focus-receipt'),
  phase: z.enum(['prepared', 'focused']),
  requestId: z.uuid(),
  epoch: z.uuid(),
  focused: z.boolean(),
}) satisfies z.ZodType<WebviewFocusReceipt>
