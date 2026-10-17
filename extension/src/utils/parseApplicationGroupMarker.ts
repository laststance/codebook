import {
  applicationGroupMarkerSchema,
  type ApplicationGroupMarker,
} from '../applicationGroupMarkerSchemas'

/**
 * Reads the Application group record a window kept in its workspace state, so {@link StudyWorkspace} can judge a cold Study open's empty first group; anything it does not recognize proves nothing.
 * @param stored - The raw value of {@link APPLICATION_GROUP_MARKER_KEY}, as the workspace state returns it.
 * @returns
 * - The record, when it has this version's shape
 * - `undefined` for no record, another version or a malformed value
 * @example
 * parseApplicationGroupMarker({ version: 1, writer: 'b2c7…', column: 1, groupCount: 3, layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] } }) // => the same record
 * parseApplicationGroupMarker(undefined) // => undefined
 */
export function parseApplicationGroupMarker(
  stored: unknown,
): ApplicationGroupMarker | undefined {
  const parsed = applicationGroupMarkerSchema.safeParse(stored)
  return parsed.success ? parsed.data : undefined
}
