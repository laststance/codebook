import { StudyError } from '../errors'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

/**
 * Builds the refusal of a server stop whose file is a `'use client'` component, which the server layer holds only as a reference stub.
 *
 * Why it exists: such a stop can never pause on the server, so the run fails before any declared input with a sentence that tells the learner to declare it as a browser stop. Called by {@link readDevelopmentBundle} when {@link findNextClientReferenceStub} finds the stub, and by the run test harness that stands in for the seal.
 * @param selected - The stop's source (path and line).
 * @param extraDetails - Fields added to `details` by a caller whose refusal runs after Codebook's readiness request (the App Router library seal passes `router: "app"` and `sideEffects: "unknown"`); omitted by callers that refuse before any request, so their output is unchanged.
 * @returns A `NEXT_STOP_NOT_SEALED` error with `details.reason: 'client-component'` and `details.stop` (`path:line`), plus `extraDetails`; its message holds the primary, detail and recovery sentences.
 * @example
 * throw clientComponentRefusal({ path: 'app/ui/search.tsx', line: 7 })
 * // details: { reason: 'client-component', stop: 'app/ui/search.tsx:7' }
 */
export function clientComponentRefusal(
  selected: Pick<RepositoryConfiguration['source'], 'path' | 'line'>,
  extraDetails: Readonly<Record<string, string>> = {},
): StudyError {
  const stop = `${selected.path}:${selected.line}`
  const message = `This location runs only in the browser: declare it as a browser stop. ${stop} is a client component file ('use client'); the server holds only a reference to it. Declare it with participant "browser", or choose a server file this page renders.`
  return new StudyError(
    'NEXT_STOP_NOT_SEALED',
    message,
    message,
    undefined,
    undefined,
    { reason: 'client-component', stop, ...extraDetails },
  )
}
