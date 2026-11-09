import type { DevelopmentServerStart } from '../developmentServerAdapter'
import { reactScriptsPortRefusal } from '../reactScriptsRefusals'

import { assessReactScriptsWorkspace } from './assessReactScriptsWorkspace'
import { declaredReactScriptsPort } from './reactScriptsChildEnvironment'
import type { ResolvedPackage } from './resolveNextPackage'

/**
 * Refuses a react-scripts library run whose declared port is taken, before the learner's confirmation and the library build.
 *
 * Why it exists: the launcher checks the same port only after the build, so a busy port was found after a long build and the refusal could not honestly say nothing was written. Called by the run's library planning, right after the root-app refusal.
 * @param reactScriptsPackage - The app the run resolved.
 * @param node - The Node executable of the run, read for react-scripts 4's Node options.
 * @param signal - Ends the Node version read when the run is cancelled.
 * @param assertPortFree - The run's port check ({@link DevelopmentServerStart.assertPortFree}).
 * @throws `REACT_SCRIPTS_PORT_UNAVAILABLE` with `sideEffects: "none"` when the port is busy; the workspace refusals of {@link assessReactScriptsWorkspace}.
 * @example await assertReactScriptsLibraryPortFree(reactScriptsPackage, request.node, request.signal, request.assertPortFree)
 */
export async function assertReactScriptsLibraryPortFree(
  reactScriptsPackage: ResolvedPackage,
  node: string,
  signal: AbortSignal,
  assertPortFree: DevelopmentServerStart['assertPortFree'],
): Promise<void> {
  const workspace = await assessReactScriptsWorkspace(
    reactScriptsPackage,
    node,
    signal,
  )
  await assertPortFree(
    declaredReactScriptsPort(workspace.assignments),
    (refusal) => reactScriptsPortRefusal(refusal.port, 'pre-start-check'),
  )
}
