import { z } from 'zod'

import { classifySecretControl } from './classifySecretControl'

/** What a page reports of a resolved text control so its text can be classified: its `type` property (`password`, `text`, `textarea`, …), `name`, `id` and raw `autocomplete`; a field the page did not report is absent. */
const controlIdentitySchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  autocomplete: z.string().optional(),
})

/** What a page reports of a resolved text control; see {@link controlReadinessSchema}. */
export type ControlIdentity = z.infer<typeof controlIdentitySchema>

/** A page's answer when it focused or checked a text control, with the control's identity when the focus phase reports it; read by {@link prepareRepositoryInputs} and the Chrome extension click executor. */
export const controlReadinessSchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
  control: controlIdentitySchema.optional(),
})

/**
 * Tells whether text typed into a control the page reported is a secret, by the one rule of {@link classifySecretControl}.
 *
 * Why it exists: a prepared text (v1/v2 `initialInputs`, an extension click's `inputs`) is masked in every stored or served form when its control reads as secret; the page's report may omit fields, which read as empty. Called by {@link prepareRepositoryInputs} and the Chrome extension click executor.
 * @param control - The control's type, name, id and autocomplete as the page reports them.
 * @returns `true` when {@link classifySecretControl} names a reason.
 * @example
 * isSecretControl({ type: 'text', name: 'otp', autocomplete: 'one-time-code' }) // => true
 * isSecretControl({ type: 'text', name: 'email' }) // => false
 */
export function isSecretControl(control: ControlIdentity): boolean {
  return (
    classifySecretControl({
      type: control.type?.toLowerCase() ?? '',
      name: control.name ?? '',
      id: control.id ?? '',
      autocomplete: control.autocomplete ?? '',
    }) !== undefined
  )
}
