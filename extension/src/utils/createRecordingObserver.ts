import { IMAGE_BASE64_LIMIT_CHARS } from '../constants'
import type { ViewportRecordingObserver } from '../runtimeSupport/browserViewport'
import type { StudyRecord } from '../service'
import { capturePhaseSchema } from '../studySchemas'

/** Binds the optional viewport observer to one reserved study/runtime; no focus lookup or awaited I/O enters the frame callback. @example createRecordingObserver(record)?.elapsedMs() */
export function createRecordingObserver(
  record: StudyRecord,
): ViewportRecordingObserver | undefined {
  const writer = record.recording,
    runtime = record.runtime
  if (!writer || !runtime) return undefined
  return {
    elapsedMs: () => runtime.evidence.elapsedMs(),
    frame(input): void {
      try {
        if (input.data.length > IMAGE_BASE64_LIMIT_CHARS)
          throw new Error('Recording frame exceeds the encoded byte limit.')
        const bytes = Buffer.from(input.data, 'base64')
        if (bytes.toString('base64') !== input.data)
          throw new Error('Recording frame encoding is malformed.')
        const phase =
          input.kind === 'phase'
            ? capturePhaseSchema.parse(input.phase)
            : undefined
        writer.frame({
          bytes,
          elapsedMs: input.elapsedMs,
          kind: input.kind,
          phase,
          browserTimestamp: input.browserTimestamp,
        })
      } catch (error) {
        writer.stopFrames(input.elapsedMs, String(error))
      }
    },
    gap(input): void {
      // A withheld image is a declared missing interval: the recording is partial from here (4A).
      writer.stopFrames(input.elapsedMs, input.reason)
    },
    closed(input): void {
      record.recordingEndMs = input.elapsedMs
      if (!input.expected)
        writer.stopFrames(
          input.elapsedMs,
          'Application viewport closed before owned cleanup.',
        )
    },
  }
}
