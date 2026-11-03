import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  const excerpt: {
    fragments: { line: number; column: number; text: string }[]
  } = JSON.parse(
    readFileSync(join(FIXTURES, `pages-runtime-${version}.json`), 'utf8'),
  )
  const lines: string[] = []
  for (const fragment of excerpt.fragments) {
    const before = lines[fragment.line] ?? ''
    // A fragment starts after the earlier ones of its line, at its real column.
    lines[fragment.line] = before.padEnd(fragment.column) + fragment.text
  }
  return Array.from(lines, (line) => line ?? '').join('\n')
}
