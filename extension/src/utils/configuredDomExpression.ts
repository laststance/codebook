import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

/** Serializes declared DOM conditions as data for owned runtime evaluation; callers receive no executable expression slot. @example configuredDomExpression(configuration.action.before, configuration.action.selector) */
export function configuredDomExpression(
  conditions: RepositoryConfiguration['action']['before'],
  selector?: string,
): string {
  return `(${inspectDom.toString()})(${JSON.stringify(conditions)},${JSON.stringify(selector) ?? 'undefined'})`
}

/**
 * Evaluates the declared DOM conditions and an optional hittable click center inside the owned page, for every read of before and after conditions by {@link ConfiguredBrowserRun}; it is serialized with `toString()`, so everything it calls is declared inside it.
 * Text is compared on textContent trimmed with whitespace runs collapsed, attributes exactly. A `text` condition holds when one of the elements its selector matches reads the expected text; a `visible` or `attribute` condition and the click target need exactly one element.
 * @param conditions - The declared conditions of one phase.
 * @param selector - The click target's selector, before input only.
 * @returns Counts and reasons only, never page text or attribute values:
 * - Every condition holds: `ready: true`, the click center when a selector was given, and `textReadings` when a text condition's selector matched several elements (how many matched and how many read the text)
 * - Otherwise: `ready: false` and the first failure; a text condition whose several matched elements all read other text fails as `text-mismatch` with `matchedElements`
 * @example
 * inspectDom([{ kind: 'visible', selector: 'button' }], 'button').ready // => true
 * inspectDom([{ kind: 'text', selector: 'p', equals: 'Invalid credentials' }]) // => { ready: true, textReadings: [{ conditionIndex: 0, matchedElements: 3, readingElements: 1 }] } for three paragraphs, one of which reads it
 */
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
  // Text is compared on textContent, on both sides: whitespace runs collapse to one space and both ends are trimmed. Child texts join without a space, and CSS white-space, zero-width spaces and soft hyphens are not applied.
  const collapseWhitespace = (value: string | null) =>
    (value ?? '').replace(/\s+/g, ' ').trim()
  // The declared text stands as whole words in the element's text: no letter or digit touches it on either side ("Log in" in "Log in to Acme", never in "Log into Acme").
  const holdsAsWords = (elementText: string, expectedText: string) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
      'u',
    ).test(elementText)
  const textFailure = (element: Element, declaredText: string) => {
    const elementText = collapseWhitespace(element.textContent),
      expectedText = collapseWhitespace(declaredText)
    if (elementText === expectedText) return undefined
    // Name only the relation to the declared literal: the element holds it, as whole words, beside other text.
    return expectedText && holdsAsWords(elementText, expectedText)
      ? { reason: 'text-mismatch', textDifference: 'surrounding-text' }
      : { reason: 'text-mismatch' }
  }
  // Text conditions that held on one of several matched elements, as counts only.
  const textReadings: {
    conditionIndex: number
    matchedElements: number
    readingElements: number
  }[] = []
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
    // A text condition whose selector matches several elements holds when one of them reads the expected text.
    if (condition.kind === 'text' && elements.length > 1) {
      const expectedText = collapseWhitespace(condition.equals)
      const readingElements = Array.from(elements).filter(
        (candidate) =>
          collapseWhitespace(candidate.textContent) === expectedText,
      ).length
      if (readingElements === 0)
        return {
          ready: false,
          failure: {
            conditionIndex,
            reason: 'text-mismatch',
            matchedElements: elements.length,
          },
        }
      textReadings.push({
        conditionIndex,
        matchedElements: elements.length,
        readingElements,
      })
      continue
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
  // The readings are named only when a text condition held on one of several elements.
  const held = textReadings.length ? { textReadings } : {}
  if (selector === undefined) return { ready: true, ...held }
  const elements = select(selector),
    element = elements?.[0]
  if (!elements)
    return { ready: false, failure: { reason: 'invalid-selector' } }
  // The selector matched nothing: say how many controls the page has, as counts only, so the agent learns whether the page is the expected one.
  if (elements.length === 0)
    return {
      ready: false,
      failure: {
        reason: 'click-target-missing',
        candidates: {
          button: document.querySelectorAll(
            'button,[role="button"],input[type="submit"],input[type="button"]',
          ).length,
          link: document.querySelectorAll('a[href]').length,
          field: document.querySelectorAll('input,select,textarea').length,
        },
      },
    }
  if (elements.length !== 1 || !element)
    return { ready: false, failure: { reason: 'click-target-not-unique' } }
  if (!visible(element))
    return { ready: false, failure: { reason: 'click-target-not-visible' } }
  if (
    element.matches(':disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
    return { ready: false, failure: { reason: 'click-target-disabled' } }
  const before = element.getBoundingClientRect(),
    centreX = before.x + before.width / 2,
    centreY = before.y + before.height / 2
  // A target whose centre lies outside the viewport is scrolled to the middle first, as a learner scrolls before clicking: the hit test reads viewport points only, so a button below the fold read as obscured.
  if (
    centreX < 0 ||
    centreY < 0 ||
    centreX >= innerWidth ||
    centreY >= innerHeight
  )
    element.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    })
  const rect = element.getBoundingClientRect(),
    x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2,
    hit = document.elementFromPoint(x, y)
  return hit && (hit === element || element.contains(hit))
    ? { ready: true, x, y, ...held }
    : { ready: false, failure: { reason: 'click-target-obscured' } }
}
