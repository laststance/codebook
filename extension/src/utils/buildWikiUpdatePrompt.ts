import { MS_PER_MINUTE } from '../constants'

/**
 * Writes the request an editor agent gets for a Wiki update, including what Codebook will accept as the update's success.
 *
 * Why: the agent has no channel back to Codebook except the published manifest, so it must be told the condition it is judged by: publish through the installed publisher, within the bound, with a manifest that matches the source at that moment.
 * Trigger: the extension builds it when an update starts and sends it to VS Code's chat or to the Cursor Agent CLI.
 *
 * @param options.manifestPath - Absolute path of the published `codebook-wiki.json`.
 * @param options.timeoutMs - Bound of the run; named to the agent in whole minutes.
 * @param options.isReplyRead - Whether somebody reads the agent's reply (VS Code's chat: yes; the Cursor CLI: no, so the report of changed pages is not asked for).
 * @returns The one-paragraph request, starting with `/codebook Update LLM Wiki`.
 *
 * @example
 * ```ts
 * buildWikiUpdatePrompt({ manifestPath: '/repo/.codebook/wiki/codebook-wiki.json', timeoutMs: 900_000, isReplyRead: false })
 * // => '/codebook Update LLM Wiki for this opened repository. Read "/repo/.codebook/wiki/codebook-wiki.json" and … within 15 minutes … If you cannot publish, say why in your reply and stop. Do not start a debugger or application.'
 * ```
 */
export function buildWikiUpdatePrompt(options: {
  manifestPath: string
  timeoutMs: number
  isReplyRead: boolean
}): string {
  const minutes = Math.round(options.timeoutMs / MS_PER_MINUTE)
  return [
    `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(options.manifestPath)} and the installed Codebook skill.`,
    'Reinspect current source, preserve manual files and the last usable Wiki on failure.',
    `Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, and generated.revision is the full commit hash of HEAD.`,
    'If you cannot publish, say why in your reply and stop.',
    ...(options.isReplyRead
      ? ['Then report changed pages and citations.']
      : []),
    'Do not start a debugger or application.',
  ].join(' ')
}
