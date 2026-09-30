import { z } from 'zod'

import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import type { Cdp } from '../runtimeSupport/cdp'

const resultSchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
})

/** Prepares declared text controls on the owned page before its learning breakpoint is armed; uncertain inserts are never retried. @example await prepareRepositoryInputs(cdp, inputs, origin, assertCurrent) */
export async function prepareRepositoryInputs(
  cdp: Pick<Cdp, 'request'>,
  inputs: NonNullable<RepositoryConfiguration['initialInputs']>,
  origin: string,
  assertCurrent: () => void,
): Promise<void> {
  for (const [index, input] of inputs.entries()) {
    assertCurrent()
    const selected = await cdp.request('Runtime.evaluate', {
      expression: `(${selectInput.toString()})(${JSON.stringify(input.selector)},${JSON.stringify(origin)})`,
      returnByValue: false,
    })
    const objectId = selected.result.objectId
    try {
      assertCurrent()
      if (
        selected.exceptionDetails ||
        selected.result.subtype !== 'node' ||
        !objectId
      )
        throw new Error(`Input ${index + 1} has no unique owned target.`)
      const inspect = async (phase: 'focus' | 'verify'): Promise<void> => {
        assertCurrent()
        const result = await cdp.request('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: inspectInput.toString(),
          arguments: [{ value: { ...input, origin, phase } }],
          returnByValue: true,
        })
        assertCurrent()
        const parsed = resultSchema.safeParse(result.result.value)
        if (result.exceptionDetails || !parsed.success || !parsed.data.ready)
          throw new Error(
            `Input ${index + 1} ${phase} failed: ${parsed.success ? (parsed.data.reason ?? 'unavailable') : 'invalid response'}`,
          )
      }
      await inspect('focus')
      assertCurrent()
      await cdp.request('Input.insertText', { text: input.text })
      assertCurrent()
      await inspect('verify')
    } finally {
      // Release only the acquired remote reference; a closed target cannot safely retry input.
      if (objectId)
        await cdp.request('Runtime.releaseObject', { objectId }).catch(() => {})
    }
  }
}

/** Resolves one node without modifying the target page or copying its current input value. @example selectInput('#email', origin) */
function selectInput(selector: string, origin: string) {
  if (location.origin !== origin) return undefined
  const matches = document.querySelectorAll(selector)
  return matches.length === 1 ? matches[0] : undefined
}

/** Inspects the exact retained node in the owned page; a replaced control never inherits input authority. @example inspectInput.call(element, {selector:'#email',text:'invalid@example.invalid',origin,phase:'focus'}) */
function inspectInput(
  this: Element,
  input: {
    selector: string
    text: string
    origin: string
    phase: 'focus' | 'verify'
  },
) {
  if (location.origin !== input.origin)
    return { ready: false, reason: 'wrong-origin' }
  const matches = document.querySelectorAll(input.selector),
    element = matches[0]
  if (
    matches.length !== 1 ||
    element !== this ||
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    )
  )
    return { ready: false, reason: 'unique-text-control-required' }
  if (
    element instanceof HTMLInputElement &&
    !['text', 'search', 'email', 'password', 'tel', 'url'].includes(
      element.type,
    )
  )
    return { ready: false, reason: 'unsupported-input-type' }
  const rect = element.getBoundingClientRect(),
    style = getComputedStyle(element)
  if (
    !element.isConnected ||
    element.disabled ||
    element.readOnly ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    style.display === 'none' ||
    style.visibility !== 'visible' ||
    style.opacity === '0'
  )
    return { ready: false, reason: 'input-not-editable' }
  const hit = document.elementFromPoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  )
  if (hit !== element && !element.contains(hit))
    return { ready: false, reason: 'input-obscured' }
  if (input.phase === 'verify')
    return {
      ready: element.value === input.text && document.activeElement === element,
      reason: 'input-result-changed',
    }
  element.focus()
  element.select()
  return {
    ready: document.activeElement === element,
    reason: 'input-focus-changed',
  }
}
