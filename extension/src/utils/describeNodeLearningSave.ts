import { cutCauseForDisplay } from './cutCauseForDisplay'
import { describeNodeLearningPart } from './describeNodeLearningPart'
import type { NodeTestVerdict } from './describeNodeTestResult'
import type { NodeLearningExplanationPart } from './listMissingNodeExplanations'
import type {
  NodeLearningCapturePart,
  NodeLearningPart,
} from './listMissingNodeLearning'
import {
  nodeTestResultKind,
  type NodeTestResultFacts,
} from './nodeTestResultKind'

/** What a test replay's Save shows, keyed by the status item's state, its question and its notifications (the String catalog of plan version 7). */
export type NodeLearningSaveMessage =
  | { kind: 'preparing' }
  | { kind: 'live'; reached: number; declared: number }
  | { kind: 'finished' }
  | { kind: 'saving' }
  | { kind: 'saved'; verdict: NodeTestVerdict; stops: number }
  | {
      kind: 'partial'
      verdict: NodeTestVerdict
      missing: readonly NodeLearningPart[]
    }
  | { kind: 'stop-rejected'; cause: string }
  | { kind: 'read-failed'; cause: string }
  | { kind: 'seal-failed'; cause: string }
  | { kind: 'question'; reached: number; declared: number }
  | {
      kind: 'partial-notice'
      result: NodeTestResultFacts | undefined
      explanations: readonly NodeLearningExplanationPart[]
      capture: readonly NodeLearningCapturePart[]
    }
  | { kind: 'nothing-yet' }
  | { kind: 'open-refused' }
  | {
      kind: 'open-failed'
      title: string
      cause: string
      /** Which replay failed to open; a server replay is worded with server words. Defaults to a test replay. */
      profile?: 'node-test' | 'node-server'
    }

/** The words of one message: the status item's text with its tooltip, or a question's or notification's text with its actions. */
export type NodeLearningSaveText = {
  text: string
  tooltip?: string
  actions?: readonly string[]
}

/** The labels of the actions a Save question or notification offers; the one set the catalog, {@link NodeLearningSave} and the Study workspace read, so no consumer retypes a label. The question's Cancel is the modal dialog's own and is not an action here. */
export const NODE_LEARNING_SAVE_ACTION = {
  saveNow: 'Save now',
  saveAndStop: 'Save and stop',
  openReplay: 'Open replay',
  closeBrowserReplay: 'Close browser replay',
  showDetails: 'Show details',
} as const

/** Where every failed stage of a Save points for its details. */
const DETAILS = 'Details: Output › Codebook.'

/**
 * Words the parts of one kind for a sentence.
 * @param parts - The parts, in the order {@link listMissingNodeLearning} gave them.
 * @returns The parts' words joined by commas.
 * @example wordParts([{ kind: 'stop', stop: 1 }, { kind: 'result' }]) // => 'an explanation step for stop 1, an explanation step for the result'
 */
function wordParts(parts: readonly NodeLearningPart[]): string {
  return parts.map(describeNodeLearningPart).join(', ')
}

/**
 * Composes the partial-save notification from the sentences that apply, in the String catalog's order: the verdict of a test that did not pass, the explanations to ask the chat for, and the capture no explanation can add.
 * @param message - The notice's result and missing parts.
 * @returns The notification's text.
 * @example
 * partialNotice({ kind: 'partial-notice', result: { exitCode: 1, signal: null }, explanations: [], capture: [] })
 * // => 'Learning partially saved. The test did not pass (exit code 1); the replay holds the failing run.'
 */
function partialNotice(
  message: Extract<NodeLearningSaveMessage, { kind: 'partial-notice' }>,
): string {
  const kind = nodeTestResultKind(message.result)
  const sentences = ['Learning partially saved.']
  if (kind === 'failed')
    sentences.push(
      `The test did not pass (exit code ${String(message.result?.exitCode)}); the replay holds the failing run.`,
    )
  if (kind === 'signal')
    sentences.push(
      `The test ended by signal ${String(message.result?.signal)}; the replay holds the run up to it.`,
    )
  // Only an explanation gap is offered to the chat: no explanation adds a recording.
  if (message.explanations.length)
    sentences.push(
      `Ask the chat for ${wordParts(message.explanations)}, then save again.`,
    )
  if (message.capture.length)
    sentences.push(
      `Not recorded: ${wordParts(message.capture)}. An explanation cannot add them; only a new test run records them.`,
    )
  return sentences.join(' ')
}

/**
 * Words what a test replay's Save shows the learner, so every text, tooltip, question and notification of the status item's states comes from one catalog; called by {@link NodeLearningSave} for the status item and its notifications.
 * A cause is shown as {@link sanitizeCause} gave it at assignment, cut for display ({@link cutCauseForDisplay}).
 * @param message - The state, question or notification to word.
 * @returns Its text, with the status item's tooltip or the actions a question or notification offers.
 * @example
 * describeNodeLearningSave({ kind: 'live', reached: 1, declared: 2 })
 * // => { text: '$(record) Recording explanation · stop 1 of 2 · Save learning replay', tooltip: 'Save learning replay ends this test run and saves …' }
 * describeNodeLearningSave({ kind: 'partial', verdict: 'Test failed · exit code 1', missing: [] }).tooltip
 * // => 'Saved available learning · Test failed · exit code 1. Open replay to inspect retained evidence.'
 */
export function describeNodeLearningSave(
  message: NodeLearningSaveMessage,
): NodeLearningSaveText {
  switch (message.kind) {
    case 'preparing':
      return {
        text: '$(sync~spin) Preparing the test run…',
        tooltip:
          'Codebook is preparing the test run; Save learning replay appears once the first stop is recorded.',
      }
    case 'live':
      return {
        text: `$(record) Recording explanation · stop ${message.reached} of ${message.declared} · Save learning replay`,
        tooltip:
          "Save learning replay ends this test run and saves its recorded output, source, debugger stops and the chat's learning material.",
      }
    case 'finished':
      return {
        text: '$(save) Recording finished · Save learning replay',
        tooltip:
          "Save learning replay saves the sealed test history with the chat's learning material.",
      }
    case 'saving':
      return {
        text: '$(sync~spin) Saving learning…',
        tooltip:
          'Codebook is sealing the test history and reading its learning material.',
      }
    case 'saved':
      return {
        text: '$(check) Learning saved · Open replay',
        tooltip: `Saved: ${message.verdict} · capture complete · ${message.stops} of ${message.stops} stops explained. Opens the test replay.`,
      }
    case 'partial':
      return {
        text: '$(warning) Learning partially saved · Open replay',
        tooltip: `Saved available learning · ${message.verdict}${message.missing.length ? ` · Missing: ${wordParts(message.missing)}` : ''}. Open replay to inspect retained evidence.`,
      }
    case 'stop-rejected':
      return {
        text: '$(error) Learning save failed · Retry',
        tooltip: `Learning save failed: stopping the test run did not finish (${cutCauseForDisplay(message.cause)}). What was recorded is kept; click to stop it again. ${DETAILS}`,
      }
    case 'read-failed':
      return {
        text: '$(error) Learning save failed · Retry',
        tooltip: `Learning save failed: the test history was sealed but could not be read back (${cutCauseForDisplay(message.cause)}). Click to read it again; the test does not run again. ${DETAILS}`,
      }
    case 'seal-failed':
      return {
        text: '$(error) Learning save failed · Open retained history',
        tooltip: `Learning save failed: the test history could not be sealed (${cutCauseForDisplay(message.cause)}). The run is stopped; its recorded part opens read-only. ${DETAILS}`,
      }
    case 'question':
      return {
        text: `Saving ends the test run before its result (${message.reached} of ${message.declared} stops reached). Save now?`,
        actions: [NODE_LEARNING_SAVE_ACTION.saveNow],
      }
    case 'partial-notice':
      return {
        text: partialNotice(message),
        actions: [NODE_LEARNING_SAVE_ACTION.openReplay],
      }
    case 'nothing-yet':
      return {
        text: 'Nothing to save yet: the test run has not reached its first stop.',
      }
    case 'open-refused':
      return {
        text: 'Codebook shows one replay at a time. Close the browser replay to open this test replay.',
        actions: [NODE_LEARNING_SAVE_ACTION.closeBrowserReplay],
      }
    case 'open-failed':
      return {
        // A cause that ends its own sentence is not given a second full stop.
        text: `Codebook could not open the ${message.profile === 'node-server' ? 'server' : 'test'} replay "${message.title}": ${cutCauseForDisplay(message.cause).replace(/\.$/, '')}. The saved history is unchanged; open it again from Saved studies.`,
        actions: [NODE_LEARNING_SAVE_ACTION.showDetails],
      }
  }
}
