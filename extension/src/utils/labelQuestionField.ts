/** What {@link labelQuestionField} reads and writes of the question field: the label elements that name it and its attributes. A textarea and an input both have them. */
export type QuestionField = {
  labels: { length: number } | null
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

/**
 * Gives the question field of a served Wiki page the words of the shell's label when nothing names the field.
 *
 * Why: on a page published before the publisher kept the ids of a page's content apart from the reader's, the shell's label may name a heading of the article instead of the field, which then has no name for a screen reader. A field that has a name of its own keeps it: a label element that names it, an `aria-label` or an `aria-labelledby`.
 * Trigger: the reader embeds this function into `codebook-qa.js` with `toString()` and the script of the question form calls it once per page load, so it must stay free of imports and outer variables.
 *
 * @param field - The question field of the page's form.
 * @returns Nothing; the field gets `aria-label="Ask about this repository"` or is left as it is.
 * @example
 * labelQuestionField(document.querySelector('form#qa-form textarea'))
 */
export function labelQuestionField(field: QuestionField): void {
  const labelCount = field.labels === null ? 0 : field.labels.length
  // An attribute that is empty names nothing.
  const hasNamingAttribute = ['aria-label', 'aria-labelledby'].some(
    (name) => (field.getAttribute(name) ?? '').trim() !== '',
  )
  if (labelCount === 0 && !hasNamingAttribute)
    field.setAttribute('aria-label', 'Ask about this repository')
}
