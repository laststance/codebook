import { NODE_SERVER_PROFILE } from '../constants'

/**
 * Refuses Save learning replay for a node-server run, which keeps no history: there is nothing to finish or to verify.
 * Called first by {@link StudyWorkspace.saveLearningReplay}, so the status item's Save and a delayed click end with one clear sentence.
 * @param record - The current run, if any.
 * @throws When the run is a node-server run.
 * @example refuseSavingServerRun({ profile: 'node-server' }) // throws 'Server runs are not saved yet: there is no learning replay to save.'
 */
export function refuseSavingServerRun(
  record: { profile: string } | undefined,
): void {
  if (record?.profile === NODE_SERVER_PROFILE)
    throw new Error(
      'Server runs are not saved yet: there is no learning replay to save.',
    )
}
