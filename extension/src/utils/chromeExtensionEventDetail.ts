import {
  NODE_SERVER_EVENT_PATH_LIMIT_CHARS,
  NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS,
  PROCESS_OUTPUT_EVENT_LIMIT_CHARS,
} from '../constants'

import {
  boundedText,
  integerField,
  sanitizedEventFields,
} from './eventFieldReaders'

type EventFields = Record<string, unknown>

/** The contexts a stop or an output line names. */
function contextField(value: unknown): 'page' | 'service-worker' {
  return value === 'service-worker' ? 'service-worker' : 'page'
}

/** What each `chrome-extension.*` event publishes, field by field (SR32); a field an event carries beyond these never leaves the run. One row per type: a new event type is a new row, and every type without one reads `{ omitted: true }`. */
const CHROME_EXTENSION_EVENT_FIELDS: Record<
  string,
  (input: EventFields) => EventFields
> = {
  'chrome-extension.click': (input) => ({
    clickIndex: integerField(input.clickIndex),
    selector: boundedText(input.selector, NODE_SERVER_EVENT_PATH_LIMIT_CHARS),
  }),
  'chrome-extension.output': (input) => ({
    context: contextField(input.context),
    text: boundedText(input.text, PROCESS_OUTPUT_EVENT_LIMIT_CHARS) ?? '',
  }),
  'chrome-extension.output-dropped': (input) => ({
    count: integerField(input.count),
  }),
  'chrome-extension.prepare-pause': (input) => ({
    path: boundedText(input.path, NODE_SERVER_EVENT_PATH_LIMIT_CHARS),
    line: integerField(input.line),
    context: contextField(input.context),
  }),
  'chrome-extension.repeat-hit': (input) => ({
    stopIndex: integerField(input.stopIndex),
    path: boundedText(input.path, NODE_SERVER_EVENT_PATH_LIMIT_CHARS),
    line: integerField(input.line),
  }),
  'chrome-extension.surface-lost': (input) => ({
    surface: input.surface === 'page' ? 'page' : 'popup',
  }),
  'chrome-extension.context-mismatch': (input) => ({
    stopIndex: integerField(input.stopIndex),
    context: contextField(input.context),
  }),
  'chrome-extension.intervention': (input) => ({
    kind: boundedText(input.kind, NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS),
    time: boundedText(input.time, NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS),
  }),
  'chrome-extension.phase': (input) => ({
    name: boundedText(input.name, NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS),
    elapsedMs: integerField(input.elapsedMs),
  }),
  'chrome-extension.dialog': (input) => ({
    ...(integerField(input.clickIndex) === null
      ? {}
      : { clickIndex: integerField(input.clickIndex) }),
    type: boundedText(input.type, NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS),
    answer: boundedText(input.answer, NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS),
    message: boundedText(input.message, PROCESS_OUTPUT_EVENT_LIMIT_CHARS),
  }),
  'chrome-extension.debugger-error': (input) => ({
    message: boundedText(input.message, PROCESS_OUTPUT_EVENT_LIMIT_CHARS),
  }),
  'chrome-extension.view-unavailable': (input) => ({
    message: boundedText(input.message, PROCESS_OUTPUT_EVENT_LIMIT_CHARS),
  }),
}

/** Every `chrome-extension.*` event type the journal publishes, in table order; the help's event list is generated from it (ER24). */
export const CHROME_EXTENSION_EVENT_TYPES: readonly string[] = Object.keys(
  CHROME_EXTENSION_EVENT_FIELDS,
)

/**
 * Names the fields one event type publishes, read from its whitelist row, so the help lists them as the journal writes them (ER24).
 * Called by the chrome-extension help for each of {@link CHROME_EXTENSION_EVENT_TYPES}; a field a row adds only when its input has it (the dialog's `clickIndex`) is not named.
 * @param type - A `chrome-extension.*` event type.
 * @returns The row's field names in order; empty for a type without a row.
 * @example
 * chromeExtensionEventFieldNames('chrome-extension.click') // => ['clickIndex', 'selector']
 * chromeExtensionEventFieldNames('chrome-extension.surprise') // => []
 */
export function chromeExtensionEventFieldNames(type: string): string[] {
  const row = CHROME_EXTENSION_EVENT_FIELDS[type]
  return row ? Object.keys(row({})) : []
}

/**
 * Publishes only what the learning evidence of a chrome-extension run needs from one of its events, so no host path, private root or secret reaches the run's events resource (SR32).
 * Called by {@link createChromeExtensionJournal} for each event a run records.
 * @param type - The event type, `chrome-extension.<name>`.
 * @param detail - What the run recorded with it.
 * @param sanitize - Replaces the private roots of a text; applied to every text field before it is masked and cut. Identity when left out.
 * @returns The event's whitelisted fields (text masked, root-hidden and bounded); `{ omitted: true }` for a type without a row.
 * @example
 * chromeExtensionEventDetail('chrome-extension.click', { clickIndex: 1, selector: '#go', cwd: '/Users/ada' })
 * // => { clickIndex: 1, selector: '#go' }
 * chromeExtensionEventDetail('chrome-extension.surprise', { secret: 'x' }) // => { omitted: true }
 */
export function chromeExtensionEventDetail(
  type: string,
  detail: unknown,
  sanitize: (text: string) => string = (text) => text,
): EventFields {
  const fields = Object.hasOwn(CHROME_EXTENSION_EVENT_FIELDS, type)
    ? CHROME_EXTENSION_EVENT_FIELDS[type]
    : undefined
  if (!fields) return { omitted: true }
  // Private roots go before any cut, so a path at a cut can never survive as a fragment.
  return fields(sanitizedEventFields(detail, sanitize))
}
