import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

/** Serializes declared DOM conditions as data for owned runtime evaluation; callers receive no executable expression slot. @example configuredDomExpression(configuration.action.before, configuration.action.selector) */
export function configuredDomExpression(
  conditions: RepositoryConfiguration['action']['before'],
  selector?: string,
): string {
  return `(${inspectDom.toString()})(${JSON.stringify(conditions)},${JSON.stringify(selector) ?? 'undefined'})`
}

/** Evaluates unique-node conditions (text with whitespace collapsed, attributes exactly) and an optional hittable click center inside the owned page; it is serialized with `toString()`, so everything it calls is declared inside it. @example inspectDom([{kind:'visible',selector:'button'}], 'button').ready */
function inspectDom(
  conditions: RepositoryConfiguration['action']['before'],
  selector?: string,
) {
  const select = (value: string) => {
    try {
      return document.querySelectorAll(value)
    } catch {
      return undefined
    }
  }
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element)
    return (
      element.isConnected &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      style.opacity !== '0'
    )
  }
  // Text is compared as a reader sees it: whitespace runs collapse to one space and both ends are trimmed, on both sides.
  const collapseWhitespace = (value: string | null) =>
    (value ?? '').replace(/\s+/g, ' ').trim()
  const textFailure = (element: Element, declaredText: string) => {
    const elementText = collapseWhitespace(element.textContent),
      expectedText = collapseWhitespace(declaredText)
    if (elementText === expectedText) return undefined
    // Name only the relation to the declared literal: the element holds it beside other text.
    return expectedText && elementText.includes(expectedText)
      ? { reason: 'text-mismatch', textDifference: 'surrounding-text' }
      : { reason: 'text-mismatch' }
  }
  for (const [conditionIndex, condition] of conditions.entries()) {
    const elements = select(condition.selector),
      element = elements?.[0]
    // Return only the failed predicate, never page text or attribute values.
    if (!elements)
      return {
        ready: false,
        failure: { conditionIndex, reason: 'invalid-selector' },
      }
    if (elements.length === 0)
      return {
        ready: false,
        failure: { conditionIndex, reason: 'selector-missing' },
      }
    if (elements.length !== 1 || !element)
      return {
        ready: false,
        failure: { conditionIndex, reason: 'selector-not-unique' },
      }
    if (condition.kind === 'visible' && !visible(element))
      return {
        ready: false,
        failure: { conditionIndex, reason: 'not-visible' },
      }
    const textMismatch =
      condition.kind === 'text'
        ? textFailure(element, condition.equals)
        : undefined
    if (textMismatch)
      return { ready: false, failure: { conditionIndex, ...textMismatch } }
    if (
      condition.kind === 'attribute' &&
      element.getAttribute(condition.attribute) !== condition.equals
    )
      return {
        ready: false,
        failure: { conditionIndex, reason: 'attribute-mismatch' },
      }
  }
  if (selector === undefined) return { ready: true }
  const elements = select(selector),
    element = elements?.[0]
  if (!elements)
    return { ready: false, failure: { reason: 'invalid-selector' } }
  if (elements.length === 0)
    return { ready: false, failure: { reason: 'click-target-missing' } }
  if (elements.length !== 1 || !element)
    return { ready: false, failure: { reason: 'click-target-not-unique' } }
  if (!visible(element))
    return { ready: false, failure: { reason: 'click-target-not-visible' } }
  if (
    element.matches(':disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
    return { ready: false, failure: { reason: 'click-target-disabled' } }
  const rect = element.getBoundingClientRect(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2,
    hit = document.elementFromPoint(x, y)
  return hit && (hit === element || element.contains(hit))
    ? { ready: true, x, y }
    : { ready: false, failure: { reason: 'click-target-obscured' } }
}
