import { readFile, realpath, stat } from 'node:fs/promises'
import { z } from 'zod'
import { VITEST_REPORT_LIMIT_BYTES } from '../constants'

const reportSchema = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({
          ancestorTitles: z.array(z.string()),
          title: z.string(),
          status: z.string(),
        }),
      ),
    }),
  ),
})
/** Statuses of a test whose body Vitest actually executed. */
const EXECUTED_STATUSES = new Set(['passed', 'failed'])

/**
 * Confirms from Vitest's JSON report that the finished run executed exactly the cited test, once, in exactly the cited file.
 *
 * A declared source stop and an exit code cannot prove this: Vitest imports the test module before applying its name filter, so a stop can be
 * reached by module code while the cited test is skipped, and one anchored name pattern can select two tests in Vitest 5.
 * Called by {@link OwnedNodeTestRun.complete} after the owned process exits.
 *
 * @param reportFile - The `--outputFile.json` path given to this run.
 * @param testFile - The cited test file's canonical absolute path.
 * @param testTitles - The cited enclosing `describe` titles followed by the test title.
 * @param limitBytes - Largest report read.
 * @returns The cited test's status, `passed` or `failed`.
 * @throws When the report is missing, too large or unreadable, names another file, or shows zero, several or a different executed test.
 * @example
 * ```ts
 * await verifyVitestTestResult('/tmp/codebook-vitest-report-x/vitest-report.json', '/repo/app/lib/data.test.ts', ['invoice data queries', 'returns undefined']) // => 'passed'
 * ```
 */
export async function verifyVitestTestResult(
  reportFile: string,
  testFile: string,
  testTitles: readonly string[],
  limitBytes = VITEST_REPORT_LIMIT_BYTES,
): Promise<'passed' | 'failed'> {
  const size = await stat(reportFile).then(
    (entry) => entry.size,
    () => undefined,
  )
  if (size === undefined)
    throw new Error(
      'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
    )
  if (size > limitBytes)
    throw new Error(`Vitest's test report is larger than ${limitBytes} bytes.`)
  const report = reportSchema.safeParse(
    await readFile(reportFile, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => undefined),
  )
  if (!report.success)
    throw new Error('Vitest wrote an unreadable test report.')
  // Preflight admits an in-repository alias only when its real file is the cited one; the report must use the same identity rule.
  for (const result of report.data.testResults) {
    if (result.name === testFile) continue
    // Refuse the first foreign or missing alias before scheduling more filesystem reads.
    const reportedFile = await realpath(result.name).catch(() => undefined)
    if (reportedFile !== testFile)
      throw new Error(
        `Vitest reported another test file, ${result.name}, beside the cited one.`,
      )
  }
  const executed = report.data.testResults
    .flatMap((result) => result.assertionResults)
    .filter((test) => EXECUTED_STATUSES.has(test.status))
  // A title array keeps a top-level test named "a > b" distinct from describe("a") > test("b").
  const describe = (test: (typeof executed)[number]) =>
    JSON.stringify([...test.ancestorTitles, test.title])
  if (executed.length === 0)
    throw new Error(
      'Vitest ran no test: the cited test did not run. Check that testTitles names it exactly.',
    )
  const [ran] = executed
  if (!ran || executed.length > 1)
    throw new Error(
      `Vitest ran ${executed.length} tests (${executed.map(describe).join(', ')}); Codebook requires exactly the cited test.`,
    )
  const ranTitles = [...ran.ancestorTitles, ran.title]
  if (
    ranTitles.length !== testTitles.length ||
    ranTitles.some((title, index) => title !== testTitles[index])
  )
    throw new Error(
      `Vitest ran a different test instead of the cited test: ${describe(ran)}.`,
    )
  // The executed-status set admits only these two values.
  return ran.status === 'failed' ? 'failed' : 'passed'
}
