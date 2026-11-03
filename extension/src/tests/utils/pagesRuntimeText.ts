import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  runtimeTextOfFragments,
  type RuntimeTextFragment,
} from './runtimeTextOfFragments'

const FIXTURES = join(
  __dirname,
  '../../../src/tests/fixtures/next-pages-paused',
)

/**
 * Builds the text of Next's Pages renderer from the vendored fragments of one Next version: each fragment sits at its real line and column, the rest is blank, so a frame's recorded location finds the text it found in the real file.
 * @param version - The Next version of the vendored excerpt (`16.1.4` or `16.4.4`).
 * @returns The runtime text: lines up to the last fragment, blank where nothing is vendored.
 * @example
 * pagesRuntimeTextOf('16.1.4').split('\n')[20].slice(438, 457) // => 'getServerSideProps('
 */
export function pagesRuntimeTextOf(version: '16.1.4' | '16.4.4'): string {
  const excerpt: { fragments: RuntimeTextFragment[] } = JSON.parse(
    readFileSync(join(FIXTURES, `pages-runtime-${version}.json`), 'utf8'),
  )
  return runtimeTextOfFragments(excerpt.fragments)
}
