/**
 * The text of an HTML fragment with every tag replaced by a space, read in one forward pass, so its cost grows with the fragment's length whatever markup it holds.
 *
 * Why: a backtracking pattern such as `/<[^>]*>/g` rescans to the end of the text for every `<` that has no later `>`, so a fragment of many such characters takes seconds (Cycle 0119 review round: 200,000 of them took 15 s), and the Wiki reader reads generated articles on every question.
 * Called by `firstParagraphOf` in {@link wikiPageGuideOf} for a page's first paragraph. A `<` without a later `>` ends the text there, as the rest would be an unfinished tag.
 * @param html - An HTML fragment, such as one paragraph's inner markup.
 * @returns The fragment's text, with a space where each tag stood; character references are left as written.
 * @example textWithoutTags('Fetches <code>data</code> once.') // => 'Fetches  data  once.'
 * @example textWithoutTags('Starts <b unfinished') // => 'Starts  '
 */
export function textWithoutTags(html: string): string {
  let text = ''
  let index = 0
  while (index < html.length) {
    const tagStart = html.indexOf('<', index)
    // No tag is left: the rest is text.
    if (tagStart < 0) return text + html.slice(index)
    text += `${html.slice(index, tagStart)} `
    const tagEnd = html.indexOf('>', tagStart + 1)
    // A tag that never closes hides the rest of the fragment.
    if (tagEnd < 0) return text
    index = tagEnd + 1
  }
  return text
}
