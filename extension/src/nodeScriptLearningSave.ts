import {
  ChromeExtensionLearningSave,
  type ChromeExtensionLearningSaveHost,
  type StructuredSaveKind,
} from './chromeExtensionLearningSave'
import { NODE_SCRIPT_PROFILE } from './constants'

/** The Save of a node-script run: its history state, its words and its counts of the stops and the end. */
const SCRIPT_SAVE_KIND: StructuredSaveKind = {
  profile: NODE_SCRIPT_PROFILE,
  noticeStudy: 'script-run',
  words: {
    noun: 'script',
    label: 'Script',
    recorded: 'output, executed source, debugger stops and end',
    outcomeName: 'end',
  },
  stateOf: (record) => record.nodeScript,
  stopCounts(record) {
    const view = record.nodeScript?.run?.view()
    return {
      reached: new Set(view?.stopsReached ?? []).size,
      declared: view?.stops.length ?? 0,
    }
  },
  outcomeRecorded: (record) => record.nodeScript?.run?.view().end !== undefined,
}

/**
 * Owns the Save of a script run's learning replay from the status item: the question before the run is stopped, the one seal Save joins, the single notice after it, and the status item's words.
 * It is the structured-history Save ({@link ChromeExtensionLearningSave}) with the script's state, words and counts.
 * Created by {@link StudyWorkspace}; the item and the Save command call it for a node-script run.
 * @example
 * const save = new NodeScriptLearningSave(host)
 * statusItem.text = save.item(record, 'Paused at stop 1 of 2')?.text
 * await save.save(record)
 */
export class NodeScriptLearningSave extends ChromeExtensionLearningSave {
  constructor(host: ChromeExtensionLearningSaveHost) {
    super(host, SCRIPT_SAVE_KIND)
  }
}
