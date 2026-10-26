import { MS_PER_MINUTE } from '../constants'

import type { WikiUpdateHost } from './wikiUpdateRun'

/** The confirmation every generation shows before anything starts (Cycle 0055, D2): its title and its detail. */
export type WikiGenerateConfirmation = { title: string; detail: string }

/**
 * Words the confirmation of a first LLM Wiki generation: the project, the resolved folder it is written to, where the request goes, what the learner does while it runs and how long Codebook waits.
 *
 * Why: PRODUCT_GOAL requires the resolved destination to show before a generation, and a generation uses the learner's plan for many minutes. Cycle 0055's E1 measured about 38 approvals and one Continue in VS Code's chat, so the VS Code detail says the chat asks to approve its commands instead of "You can keep working" (E1-F2); the Cursor agent CLI runs without prompts, with the model it is set to use.
 * Trigger: {@link startWikiGenerate} asks for it through the extension before the marker is claimed.
 *
 * @param options.host - The editor host that runs the generation.
 * @param options.projectName - The opened folder's name.
 * @param options.outputDirectory - The resolved Wiki folder.
 * @param options.chatHandOver - For VS Code: where the request goes ({@link describeWikiChatHandOver} with `generate`); ignored for Cursor.
 * @param options.timeoutMs - The generation's bound, named in whole minutes.
 * @returns The title and the detail.
 * @example
 * describeWikiGenerateConfirmation({ host: 'cursor', projectName: 'nextjs-dashboard', outputDirectory: '/repo/.codebook/wiki', chatHandOver: '', timeoutMs: 3_300_000 }).title
 * // => 'Generate the LLM Wiki of nextjs-dashboard?'
 */
export function describeWikiGenerateConfirmation(options: {
  host: WikiUpdateHost
  projectName: string
  outputDirectory: string
  chatHandOver: string
  timeoutMs: number
}): WikiGenerateConfirmation {
  const minutes = Math.round(options.timeoutMs / MS_PER_MINUTE)
  // Each host says where the request goes and what the learner does while it runs.
  const runner =
    options.host === 'cursor'
      ? `It runs through Cursor’s agent CLI (cursor-agent) without further prompts and uses your Cursor plan; the agent can edit files and run commands in this project. The model is the one cursor-agent is set to use; Codebook does not choose it. Codebook waits up to ${minutes} minutes; you can keep working.`
      : `${options.chatHandOver} The chat asks you to approve its commands and may ask you to Continue, so keep the Chat view open; it uses your chat plan. Codebook watches for up to ${minutes} minutes.`
  return {
    title: `Generate the LLM Wiki of ${options.projectName}?`,
    detail: `It is written to ${options.outputDirectory}.\n\n${runner}`,
  }
}
