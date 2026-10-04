import { MS_PER_MINUTE, WIKI_UPDATE_SHOWN_PATH_LIMIT } from '../constants'

/**
 * Writes the request an editor agent gets for a Wiki update, including what Codebook will accept as the update's success.
 *
 * Why: the agent has no channel back to Codebook except the published manifest, so it must be told the conditions it is judged by, and only those that can hold in this folder: publish through the installed publisher, within the bound, with a manifest that matches the source at that moment. A folder without a Git repository cannot record a commit, and asking for one invites the agent to create a repository in the learner's project.
 * Trigger: the extension builds it when an update starts and sends it to VS Code's chat or to the Cursor Agent CLI.
 *
 * @param options.manifestPath - Absolute path of the published `codebook-wiki.json`.
 * @param options.timeoutMs - Bound of the run; named to the agent in whole minutes.
 * @param options.isReplyRead - Whether somebody reads the agent's reply (VS Code's chat: yes; the Cursor CLI: no, so the report of changed pages is not asked for).
 * @param options.hasGitRepository - Whether the opened folder is inside a Git repository; without one the revision and the added-file condition are not asked for.
 * @param options.uncoveredPaths - Source files added since the Wiki's revision that it neither indexes nor excludes right now; the first few are named, the rest counted.
 * @returns The one-paragraph request, starting with `/codebook Update LLM Wiki`.
 *
 * @example
 * ```ts
 * buildWikiUpdatePrompt({ manifestPath: '/repo/.codebook/wiki/codebook-wiki.json', timeoutMs: 900_000, isReplyRead: false, hasGitRepository: true, uncoveredPaths: ['src/new.ts'] })
 * // => '/codebook Update LLM Wiki for this opened repository. Read "/repo/.codebook/wiki/codebook-wiki.json" and … within 15 minutes … every file added since that revision is indexed or covered by excludedPaths. Right now these added files are neither: src/new.ts. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.'
 * ```
 */
export function buildWikiUpdatePrompt(options: {
  manifestPath: string
  timeoutMs: number
  isReplyRead: boolean
  hasGitRepository: boolean
  uncoveredPaths: string[]
}): string {
  const minutes = Math.round(options.timeoutMs / MS_PER_MINUTE)
  const uncoveredCount = options.uncoveredPaths.length
  const namedPaths = options.uncoveredPaths
    .slice(0, WIKI_UPDATE_SHOWN_PATH_LIMIT)
    .join(', ')
  const moreCount = uncoveredCount - WIKI_UPDATE_SHOWN_PATH_LIMIT
  return [
    `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(options.manifestPath)} and the installed Codebook skill.`,
    'Reinspect current source, preserve manual files and the last usable Wiki on failure.',
    `Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and the published manifest matches the source at that moment: ${
      options.hasGitRepository
        ? 'every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths.'
        : 'every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one.'
    }`,
    ...(uncoveredCount > 0
      ? [
          `Right now ${uncoveredCount === 1 ? 'this added file is' : 'these added files are'} neither indexed nor excluded: ${namedPaths}${moreCount > 0 ? ` and ${moreCount} more` : ''}.`,
        ]
      : []),
    'If you cannot publish, say why in your reply and stop.',
    ...(options.isReplyRead
      ? ['Then report changed pages and citations.']
      : []),
    'Do not start a debugger or application.',
  ].join(' ')
}
