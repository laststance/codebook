import {
  buildServerReplayModel,
  type ServerReplayModel,
} from '../../utils/buildServerReplayModel'
import {
  indexServerOutput,
  projectServerApplication,
} from '../../utils/projectServerApplication'

import { openServerRepository } from './nodeServerHistoryFixture'
import { writeServerHistory } from './sealedServerHistory'

/** The verdicts of a saved, complete and fully explained history. */
export const VERDICTS = {
  saved: true,
  captureComplete: true,
  learningCoverage: 'complete',
} as const

/**
 * Writes a fixture history through the shared writer and returns its replay model with the sequences it holds.
 * @param context - The test whose end removes the learning directory.
 * @param options - What {@link writeServerHistory} writes.
 * @returns The model and the sequences of the entries written.
 * @example const { model, sequences } = await modelOf(context, { output: ['created\n'] })
 */
export async function modelOf(
  context: Parameters<typeof openServerRepository>[0],
  options: Parameters<typeof writeServerHistory>[1] = {},
) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, options)
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    VERDICTS,
  )
  return { model, sequences }
}

/**
 * The Application view of a model at one sequence.
 * @param model - The replay model.
 * @param sequence - The selected event's journal sequence.
 * @param reason - The no-response reason of a history that never answered.
 * @returns The projected view.
 * @example viewAt(model, sequences.response!).response?.state // => 'Response 201 · application/json'
 */
export function viewAt(
  model: ServerReplayModel,
  sequence: number,
  reason?: string,
) {
  const selected = model.events[model.indexBySequence.get(sequence)!]
  return projectServerApplication(model, indexServerOutput(model), selected, {
    generation: 1,
    ...(reason ? { noResponseReason: reason } : {}),
  })
}
