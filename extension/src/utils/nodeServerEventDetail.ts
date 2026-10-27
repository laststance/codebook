import {
  NODE_SERVER_EVENT_BODY_LIMIT_BYTES,
  NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS,
  NODE_SERVER_REQUEST_PATH_LIMIT_CHARS,
  PROCESS_OUTPUT_EVENT_LIMIT_CHARS,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'
import { redactSecretText } from './redactSecretText'

type EventFields = Record<string, unknown>

/** Longest content type, reason, address, version or signal name an event keeps. */
const SHORT_TEXT_LIMIT_CHARS = 256
/** Longest repository path an event keeps. */
const PATH_LIMIT_CHARS = 512
/** The HTTP methods a declared request may use. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Reads a text field of a run's event: masked first, then cut, so a secret split by the cut can never survive.
 * @param value - The raw field.
 * @param limit - The most characters kept.
 * @returns The masked, cut text; `null` for a field that is no text.
 * @example boundedText('Bearer abcdefgh12345 more', 12) // => 'Bearer [mask'
 */
function boundedText(value: unknown, limit: number): string | null {
  return typeof value === 'string'
    ? redactSecretText(value).slice(0, limit)
    : null
}

/**
 * Reads a whole-number field of a run's event.
 * @param value - The raw field.
 * @returns The integer; `null` for anything else.
 * @example integerField(200) // => 200
 */
function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * Reads a response body for its event: masked, then cut between characters so the event stays small whatever the escaping makes of it.
 * @param value - The raw field.
 * @returns The body text fitting {@link NODE_SERVER_EVENT_BODY_LIMIT_BYTES} in UTF-8; `null` for a field that is no text.
 * @example bodyField('{"ok":true}') // => '{"ok":true}'
 */
function bodyField(value: unknown): string | null {
  return typeof value === 'string'
    ? cutTextToFit(
        redactSecretText(value),
        (candidate) =>
          Buffer.byteLength(candidate) <= NODE_SERVER_EVENT_BODY_LIMIT_BYTES,
      )
    : null
}

/** What each `node-server.*` event publishes, field by field; a field a run's event carries beyond these never leaves the run (paths, argument lists, environment names). One row per type: a new event type is a new row, and every type without one reads `{ omitted: true }`. */
const NODE_SERVER_EVENT_FIELDS: Record<
  string,
  (input: EventFields) => EventFields
> = {
  'node-server.output': (input) => ({
    sequence: integerField(input.sequence),
    elapsedMs: integerField(input.elapsedMs),
    channel: input.channel === 'stderr' ? 'stderr' : 'stdout',
    text: boundedText(input.text, PROCESS_OUTPUT_EVENT_LIMIT_CHARS) ?? '',
  }),
  'node-server.request': (input) => ({
    method: METHODS.includes(String(input.method)) ? input.method : null,
    path: boundedText(input.path, NODE_SERVER_REQUEST_PATH_LIMIT_CHARS),
    bodyBytes: integerField(input.bodyBytes),
    address: boundedText(input.address, SHORT_TEXT_LIMIT_CHARS),
  }),
  'node-server.response': (input) => ({
    status: integerField(input.status),
    contentType: boundedText(input.contentType, SHORT_TEXT_LIMIT_CHARS),
    body: bodyField(input.body),
    bodyBytes: integerField(input.bodyBytes),
    readCut: input.readCut === true,
    elapsedMs: integerField(input.elapsedMs),
  }),
  'node-server.learner-paused': (input) => ({
    path: boundedText(input.path, PATH_LIMIT_CHARS),
    line: integerField(input.line),
    reason: boundedText(input.reason, SHORT_TEXT_LIMIT_CHARS) ?? 'paused',
  }),
  'node-server.learner-resumed': (input) => ({
    path: boundedText(input.path, PATH_LIMIT_CHARS),
    line: integerField(input.line),
  }),
  'node-server.failure': (input) => ({
    code: boundedText(input.code, SHORT_TEXT_LIMIT_CHARS),
    cause: boundedText(input.cause, NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS),
  }),
  // The launch journal's paths and variable names stay in the run; the chat reads what ran and with which Node.
  'node-server.started': (input) => ({
    pid: integerField(input.pid),
    loader: input.loader === 'node' ? 'node' : 'tsx',
    nodeVersion: boundedText(input.nodeVersion, SHORT_TEXT_LIMIT_CHARS),
  }),
  'node-server.closed': (input) => ({
    pid: integerField(input.pid),
    exitCode: integerField(input.exitCode),
    signal: boundedText(input.signal, SHORT_TEXT_LIMIT_CHARS),
  }),
}

/**
 * Publishes only what the learning evidence of a node-server run needs from one of its events, so no host path, argument list or environment name reaches the run's events resource.
 * Called by {@link createNodeServerJournal} for each event a run records.
 * @param type - The event type, `node-server.<name>`.
 * @param detail - What the run recorded with it.
 * @returns The event's whitelisted fields (text masked and bounded); `{ omitted: true }` for a type without a row in {@link NODE_SERVER_EVENT_FIELDS}.
 * @example
 * nodeServerEventDetail('node-server.request', { method: 'GET', path: '/api/healthz', bodyBytes: 0, address: '127.0.0.1:4100', cwd: '/Users/ada/repo' })
 * // => { method: 'GET', path: '/api/healthz', bodyBytes: 0, address: '127.0.0.1:4100' }
 * nodeServerEventDetail('node-server.surprise', { secret: 'x' }) // => { omitted: true }
 */
export function nodeServerEventDetail(
  type: string,
  detail: unknown,
): EventFields {
  const fields = Object.hasOwn(NODE_SERVER_EVENT_FIELDS, type)
    ? NODE_SERVER_EVENT_FIELDS[type]
    : undefined
  if (!fields) return { omitted: true }
  return fields(
    detail && typeof detail === 'object'
      ? Object.fromEntries(Object.entries(detail))
      : {},
  )
}
