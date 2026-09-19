import type { ViewportRecordingObserver } from 'codebook-cycle-0001/dist/browserViewport';
import { IMAGE_BASE64_LIMIT_CHARS } from '../constants';
import { capturePhaseSchema } from '../studySchemas';
import type { StudyRecord } from '../service';

/** Binds the optional viewport observer to one reserved study/runtime; no focus lookup or awaited I/O enters the frame callback. @example createRecordingObserver(record)?.elapsedMs() */
export function createRecordingObserver(record: StudyRecord): ViewportRecordingObserver | undefined {
  const writer = record.recording, runtime = record.runtime;
  if (!writer || !runtime) return undefined;
  return {
    elapsedMs: () => runtime.evidence.elapsedMs(),
    frame(input) {
      try {
        if (input.data.length > IMAGE_BASE64_LIMIT_CHARS) throw new Error('Recording frame exceeds the encoded byte limit.');
        const bytes = Buffer.from(input.data, 'base64');
        if (bytes.toString('base64') !== input.data) throw new Error('Recording frame encoding is malformed.');
        const phase = input.kind === 'phase' ? capturePhaseSchema.parse(input.phase) : undefined;
        writer.frame({ bytes, elapsedMs: input.elapsedMs, kind: input.kind, phase, browserTimestamp: input.browserTimestamp });
      } catch (error) { writer.stopFrames(input.elapsedMs, String(error)); }
    },
    closed(input) {
      record.recordingEndMs = input.elapsedMs;
      if (!input.expected) writer.stopFrames(input.elapsedMs, 'Application viewport closed before owned cleanup.');
    },
  };
}
