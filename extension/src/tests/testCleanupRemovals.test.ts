import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { test } from 'node:test'

/** The test sources, read from the compiled test's place (`dist/tests` beside `src/tests`). */
const TESTS_SOURCE = join(__dirname, '..', '..', 'src', 'tests')
/** The two helpers that own a retrying recursive removal: the cleanup of test folders and of a test Chrome's profile. */
const RETRYING_REMOVAL_HELPERS = new Set([
  'utils/removeTestFolder.ts',
  'utils/removeTestBrowserProfile.ts',
  'testCleanupRemovals.test.ts',
])
/** A call of `rm(` or of a module's `.rm(`; `rmSync(` and names ending in rm (`confirm(`) are no match. */
const REMOVAL_CALL = /(?:^|[^\w$])rm\(|\.rm\(/
/** The longest argument list read for one call, in lines. */
const CALL_LINES_LIMIT = 15

/**
 * Lists the recursive `rm` calls of the test sources that neither go through a retrying helper nor carry a `// not cleanup:` comment on the line above; called by the test below, which guards the cleanup rule of Cycle 0094 task 10 (Discussion 214).
 * @returns Each offending call as `<file>:<line>` relative to `src/tests`.
 * @example unannotatedRecursiveRemovals() // => [] when every call is annotated
 */
function unannotatedRecursiveRemovals(): string[] {
  const offending: string[] = []
  const files = readdirSync(TESTS_SOURCE, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
  for (const file of files) {
    const name = relative(TESTS_SOURCE, file).split(sep).join('/')
    if (RETRYING_REMOVAL_HELPERS.has(name)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const code = line.trim()
      // A comment or JSDoc line only mentions a call.
      if (
        code.startsWith('//') ||
        code.startsWith('*') ||
        code.startsWith('/*')
      )
        return
      if (!REMOVAL_CALL.test(code)) return
      // The argument list may run over several lines: read until the parentheses close.
      let call = ''
      let depth = 0
      for (
        let next = index;
        next < Math.min(lines.length, index + CALL_LINES_LIMIT);
        next += 1
      ) {
        call += `${lines[next]}\n`
        depth += (lines[next]!.match(/\(/g) ?? []).length
        depth -= (lines[next]!.match(/\)/g) ?? []).length
        if (depth <= 0) break
      }
      if (!/recursive:\s*true/.test(call)) return
      if (lines[index - 1]?.includes('// not cleanup:')) return
      offending.push(`${name}:${index + 1}`)
    })
  }
  return offending.sort()
}

// Value: protects=the cleanup rule of the test suite: a recursive removal goes through removeTestFolder (which retries while a writer is still finishing, Discussion 214) or says on the line above why it is part of a test's Arrange or Act, so the next ENOTEMPTY race under load cannot come back through a new bare rm; fails_when=a test or helper removes a folder recursively with a bare rm and no `// not cleanup:` comment; why_new=Cycle 0094 part 1 review round (OCR lens D: twelve unannotated removals); seam=none; no_claim=synchronous rmSync removals (process-exit and synchronous contexts) and removals through another name (a variable holding rm)
test('every recursive removal of the tests goes through the retrying helper or says why it is no cleanup', () => {
  // Arrange
  const testsSource = TESTS_SOURCE

  // Act
  const offending = unannotatedRecursiveRemovals()

  // Assert
  assert.equal(readdirSync(testsSource).length > 0, true)
  assert.deepEqual(offending, [])
})
