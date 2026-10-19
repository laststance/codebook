/**
 * The refusal of a Wiki whose folder, or a folder on its path in the project, is a link, a file or a folder that leads out of the project ({@link assertNoLinkOnWikiPath}); Codebook read nothing through it then.
 * Its sentence ends with its own step (`…, then open the Wiki again.`), so the open command shows it as it is and adds no step of its own: the step of a missing Wiki would contradict it. The name stays `Error`, so `String(error)` reads as before.
 * @example
 * try {
 *   await assertNoLinkOnWikiPath('/repo/.codebook/wiki', '/repo')
 * } catch (error) {
 *   error instanceof WikiPathRefusedError // => true while `.codebook` is a link
 * }
 */
export class WikiPathRefusedError extends Error {}
