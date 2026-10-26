import {
  WIKI_GENERATE_CHAT_REQUEST,
  WIKI_UPDATE_CHAT_REQUEST,
} from '../constants'

import type { WikiRunKind } from './wikiUpdateRun'

/** The words the sentences of a Wiki run use for its kind, so a generation's sentences never call it an update (Cycle 0055, D5). */
export type WikiRunKindWords = {
  /** The run as a noun: `update` or `generation`. */
  noun: string
  /** The run as the verb of "Cursor Agent timed out … the Wiki": `updating` or `generating`. */
  verb: string
  /** The button the learner presses to run it again: `Update` or `Generate`. */
  button: string
  /** The chat request a learner can paste in Cursor chat to see the agent's own message. */
  chatRequest: string
}

/**
 * {@link WikiRunKindWords} of each run kind: the one table that {@link describeWikiSkillStepEnd}, {@link describeJoinedWikiStart} and {@link runCursorWikiUpdate} word their kind from.
 * @example
 * WIKI_RUN_KIND_WORDS.generate.button // => 'Generate'
 */
export const WIKI_RUN_KIND_WORDS: Record<WikiRunKind, WikiRunKindWords> = {
  update: {
    noun: 'update',
    verb: 'updating',
    button: 'Update',
    chatRequest: WIKI_UPDATE_CHAT_REQUEST,
  },
  generate: {
    noun: 'generation',
    verb: 'generating',
    button: 'Generate',
    chatRequest: WIKI_GENERATE_CHAT_REQUEST,
  },
}
