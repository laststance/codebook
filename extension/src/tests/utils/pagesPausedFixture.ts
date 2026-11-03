import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  parsePagesPausedEvent,
  type PagesPausedEvent,
} from '../../utils/parsePagesPausedEvent'

/** A recorded `Debugger.paused` event of a Next Pages server, with the script addresses its synchronous frames resolve through. */
export interface PagesPausedFixture {
  description: string
  nextVersion: string
  /** The script addresses by script id, as the run's `Debugger.scriptParsed` events would give them. */
  scriptUrls: Record<string, string>
  /** The event as the proxy forwarded it (sanitized), for the verdict's own input. */
  rawEvent: unknown
  /** The same event in the parsed shape, a fresh copy a test may edit. */
  event: PagesPausedEvent
}

const FIXTURES = join(
  __dirname,
  '../../../src/tests/fixtures/next-pages-paused',
)

/**
 * Loads one sanitized `Debugger.paused` payload recorded in E0b (Issue 188) through js-debug's CDP proxy.
 * @param name - The fixture's file name without `.json`, e.g. `get-server-side-props-after-await`.
 * @returns The payload twice (raw and parsed, each a fresh copy), its script addresses and its description.
 * @throws When the fixture does not parse as a paused event.
 * @example
 * pagesPausedFixtureOf('get-server-side-props-before-await').event.callFrames.length // => 12
 */
export function pagesPausedFixtureOf(name: string): PagesPausedFixture {
  const stored = JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), 'utf8'),
  )
  const event = parsePagesPausedEvent(stored.event)
  if (!event) throw new Error(`Fixture ${name} is not a paused event`)
  return {
    description: stored.description,
    nextVersion: stored.nextVersion,
    scriptUrls: stored.scriptUrls,
    rawEvent: JSON.parse(JSON.stringify(stored.event)),
    event,
  }
}
