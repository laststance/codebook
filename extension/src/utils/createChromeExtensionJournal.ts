import { chromeExtensionEventDetail } from './chromeExtensionEventDetail'
import {
  createBoundedEventJournal,
  type JournaledEvent,
} from './createBoundedEventJournal'

/** The prefix of every event type an extension run's journal keeps. */
const CHROME_EXTENSION_EVENT_PREFIX = 'chrome-extension.'

/** What {@link createChromeExtensionJournal} needs besides the list it fills. */
type ChromeExtensionJournalOptions = {
  /** Replaces the private roots of a text before it is masked and cut. */
  sanitize: (text: string) => string
  /** Told every whitelisted event, also one the bounded journal no longer keeps. */
  onEvent?: (type: string, detail: Record<string, unknown>) => void
}

/**
 * Makes the `record` callback a chrome-extension run reports its events to: only `chrome-extension.*` types are kept, each whitelisted ({@link chromeExtensionEventDetail}) and appended to the run's journal within the bounds of every run journal, after which one `chrome-extension.events-truncated` marker is the last entry.
 * Called by {@link StudyService} when it creates a chrome-extension run.
 * @param events - The run's journal list, filled in order.
 * @param options - The text sanitizer and the listener of whitelisted events.
 * @returns The callback; it returns nothing and never throws for a malformed event.
 * @example
 * const record = createChromeExtensionJournal(run.extensionEvents, { sanitize })
 * record('chrome-extension.click', { clickIndex: 1, selector: '#go' })
 */
export function createChromeExtensionJournal(
  events: JournaledEvent[],
  options: ChromeExtensionJournalOptions,
): (type: string, detail?: unknown) => void {
  const record = createBoundedEventJournal(events, {
    whitelist: (type, detail) =>
      chromeExtensionEventDetail(type, detail, options.sanitize),
    outputType: 'chrome-extension.output',
    truncatedType: 'chrome-extension.events-truncated',
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  })
  return (type, detail): void => {
    // Another profile's event type has no place in an extension run's journal; an unknown chrome-extension type is kept as `{ omitted: true }`.
    if (!type.startsWith(CHROME_EXTENSION_EVENT_PREFIX)) return
    record(type, detail)
  }
}
