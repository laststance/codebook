/** One element of a stand-in page: the selector it answers, its text, and whether it has geometry. */
export type FakePageElement = {
  selector: string
  textContent: string
  /** `false` makes the element hidden (zero geometry); default visible. */
  visible?: boolean
}

/**
 * Builds the globals a stand-in page gives the run's DOM-condition expression ({@link configuredDomExpression}): `document.querySelectorAll` answers the elements listed under a selector, and each element has geometry and a computed style.
 * Why it exists: tests that evaluate the run's own condition expression against a page before and after an operation need the same minimal DOM. Called by {@link configuredRuntimeHarness} and the quick-start guard test.
 * @param elements - What the page shows, each under the selector that matches it.
 * @returns The context object for `runInNewContext`.
 * @example runInNewContext(expression, fakePageContext([{ selector: 'h1', textContent: 'Invoices' }]))
 */
export function fakePageContext(
  elements: readonly FakePageElement[],
): Record<string, unknown> {
  return {
    document: {
      querySelectorAll: (selector: string) =>
        elements
          .filter((element) => element.selector === selector)
          .map((element) => ({
            textContent: element.textContent,
            isConnected: true,
            getBoundingClientRect: () =>
              element.visible === false
                ? { width: 0, height: 0 }
                : { width: 10, height: 10 },
          })),
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  }
}
