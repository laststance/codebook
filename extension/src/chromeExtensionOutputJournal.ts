import type { ExtensionStopContext } from './chromeExtensionContracts'
import {
  EXTENSION_OUTPUT_EVENT_LIMIT,
  PROCESS_OUTPUT_EVENT_LIMIT_CHARS,
} from './constants'
import { redactSecretText } from './utils/redactSecretText'
import { hidePrivateRoots, type CauseRoots } from './utils/sanitizeCause'

/**
 * Journals the console output of an extension run's page and service worker as `chrome-extension.output` events, bounded by count and size (C3, ER10).
 * Created by the extension debugger; fed by the DAP `output` events its tracker sees. The text is masked, private roots are hidden, then it is cut, so a secret split by the cut cannot survive; after {@link EXTENSION_OUTPUT_EVENT_LIMIT} events one `chrome-extension.output-dropped` event carries the count of the rest.
 *
 * @example
 * const journal = new ExtensionOutputJournal(record, roots)
 * journal.add('service-worker', 'View mode: Popup\n')
 * journal.finish() // journals the dropped count when output was dropped
 */
export class ExtensionOutputJournal {
  private journaled = 0
  private dropped = 0

  constructor(
    private readonly record: (type: string, detail?: unknown) => unknown,
    private readonly roots: CauseRoots,
  ) {}

  /**
   * Journals one output event of a context, or counts it as dropped past the cap.
   * @param context - The context whose thread printed.
   * @param text - The raw output text.
   */
  add(context: ExtensionStopContext, text: string): void {
    // Past the cap only the count grows.
    if (this.journaled >= EXTENSION_OUTPUT_EVENT_LIMIT) {
      this.dropped += 1
      return
    }
    this.journaled += 1
    const hidden = hidePrivateRoots(redactSecretText(text), this.roots)
    this.record('chrome-extension.output', {
      context,
      text: hidden.slice(0, PROCESS_OUTPUT_EVENT_LIMIT_CHARS),
    })
  }

  /** Journals the dropped count once, when output was dropped; later calls journal nothing more. */
  finish(): void {
    if (this.dropped === 0) return
    this.record('chrome-extension.output-dropped', { count: this.dropped })
    this.dropped = 0
  }
}
