export const ACTIVE_TIMEOUT_MS = 20_000
/**
 * How long {@link BrowserViewport} waits for its lease's owner to answer whether the pane is to come to the front without the keyboard ({@link ViewportLease.comesWithoutKeyboard}), before it reveals the pane as if the keyboard had been given to nobody. The owner's answer is two reads of the editor and one focus command, which the editor answers within tens of milliseconds; a reveal that waits also holds every placement queued behind it, whose own waits last five seconds, so the bound lies well below that and well above the answer's usual time.
 * @example await settledWithin(answered, KEYBOARD_OWNER_ANSWER_TIMEOUT_MS)
 */
export const KEYBOARD_OWNER_ANSWER_TIMEOUT_MS = 2_000
export const RUN_TIMEOUT_MS = 120_000
export const CAPTURE_TIMEOUT_MS = 3_000
export const VIEWPORT_ACK_TIMEOUT_REASON =
  'Viewport frame acknowledgement timed out'
export const POLL_INTERVAL_MS = 50
export const HOLD_DURATION_MS = 40_000
export const CONTROL_RESPONSE_LIMIT_MS = 2_000
export const INJECTED_DELAY_MS = 4_500
export const INTERFERENCE_DELAY_MS = 500
export const WATCHDOG_INTERVAL_MS = 100
export const HTTP_BODY_LIMIT_BYTES = 4_096
export const FOCUS_ATTEMPT_LIMIT = 4
export const CDP_BRIDGE_PAYLOAD_LIMIT_BYTES = 16 * 1024 * 1024
export const CDP_BRIDGE_PENDING_LIMIT = 64
export const VIEWPORT_WIDTH_PX = 720
export const VIEWPORT_HEIGHT_PX = 640
export const STREAM_TELEMETRY_INTERVAL_MS = 1_000
export const NANOSECONDS_PER_MILLISECOND = 1_000_000
export const SCENARIOS = [
  'normal',
  'hold',
  'duplicate',
  'continue-race',
  'manual-race',
  'cdp-resume',
  'decoy',
  'stale-script',
  'source-drift',
  'unbound',
  'capture-timeout',
  'disconnect',
  'terminate',
  'disconnect-after',
  'cancel-prepare',
  'cancel-browser',
  'cancel-attach',
  'missing-capability',
  'missing-endpoint',
  'ambiguous-target',
  'missing-browser',
  'viewport-close',
  'viewport-reload',
  'viewport-timeout',
] as const
export type Scenario = (typeof SCENARIOS)[number]
/**
 * The areas of a debug adapter's `invalidated` event after which the editor handles the stops of that session again, opening the paused file with the keyboard: `all`, `threads` and `stacks` (VS Code 1.140 and Cursor 3.23); read by {@link isDebugStopsInvalidation}. An event for `variables` only refreshes the views.
 * @example STOP_HANDLING_INVALIDATION_AREAS.has('variables') // => false
 */
export const STOP_HANDLING_INVALIDATION_AREAS: ReadonlySet<string> = new Set([
  'all',
  'threads',
  'stacks',
])
export const RESUME_COMMANDS = new Set([
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'restartFrame',
  'goto',
])
