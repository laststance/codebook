import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { StudyClient } from '../client';
import type { StudyItemId } from 'codebook-cycle-0004/dist/constants';
import { NATIVE_OBSERVATION_TIMEOUT_MS } from '../constants';
import { recordingContextSchema, recordingEntrySchema, type RecordingEntry } from '../recordingSchemas';
import type { NativeStudyAction } from '../nativeStudySchemas';

const playback = z.object({ revision: z.number(), studyId: z.string().optional(), readiness: z.string(), mode: z.string(), presentedMs: z.number().optional(), requestedMs: z.number().optional(), reason: z.string().optional(), cleared: z.boolean(), observationId: z.string().optional() });
const metadata = z.object({ status: z.string(), endMs: z.number(), frameCount: z.number(), framesUri: z.string(), contextUri: z.string(), playbackUri: z.string() });
const framePage = z.object({ entries: z.array(z.record(z.string(), z.unknown())), nextUri: z.string().optional() });

/** Exercises public recording discovery, exact bytes and shared native playback after execution; a fresh instance proves offline restore. @example await exerciseNativeRecording(agent, studyId, directory, bridge) */
export async function exerciseNativeRecording(agent: StudyClient, studyId: string, directory: string, bridge: (action: NativeStudyAction, itemId?: StudyItemId) => Promise<unknown>, restored = false) {
  await mkdir(directory, { recursive: true });
  const status = await agent.tool('codebook_status', {}, z.object({ instanceId: z.uuid(), apiVersion: z.literal('1.2'), runs: z.array(z.unknown()), recording: z.object({ libraryUri: z.string(), playbackUri: z.string(), playbackAvailable: z.literal(true) }) }));
  if (restored) assert.equal(status.runs.length, 0, 'Reload must not start any live run.');
  const catalog = await agent.json(status.recording.libraryUri, z.object({ entries: z.array(z.object({ studyId: z.string(), recordingUri: z.string() })) }));
  const selected = catalog.entries.find(entry => entry.studyId === studyId); assert.ok(selected);
  const recording = await agent.json(selected.recordingUri, metadata); assert.equal(recording.status, 'finalized');
  const context = await agent.json(recording.contextUri, recordingContextSchema), entries: RecordingEntry[] = [];
  const files = new Map<string, string>(); let pageUri: string | undefined = recording.framesUri;
  // Retrieve each verified journal page without inventing paths, then retain content-hashed PNGs once.
  while (pageUri) {
    const page: z.infer<typeof framePage> = await agent.json(pageUri, framePage);
    for (const raw of page.entries) {
      const { uri, ...fields } = raw, entry = recordingEntrySchema.parse(fields); entries.push(entry);
      if (entry.type === 'frame') files.set(entry.hash, z.string().parse(uri));
    }
    pageUri = page.nextUri;
  }
  if (!restored) for (const [hash, uri] of files) {
    const image = (await agent.read(uri)).contents[0]; assert.ok(image && 'blob' in image && typeof image.blob === 'string');
    const bytes = Buffer.from(image.blob, 'base64'); assert.equal(sha256(bytes), hash); await writeFile(join(directory, `${hash}.png`), bytes);
  }
  await writeFile(join(directory, 'recording.json'), JSON.stringify(recording, null, 2));
  await writeFile(join(directory, 'frames.json'), JSON.stringify(entries, null, 2)); await writeFile(join(directory, 'context.json'), JSON.stringify(context, null, 2));
  const read = () => agent.json(recording.playbackUri, playback);
  const ready = () => waitUntil(async () => { const state = await read(); if (state.readiness === 'failed') throw new Error(state.reason); return state.readiness === 'ready' && !state.cleared ? state : undefined; }, 'native recorded presentation', NATIVE_OBSERVATION_TIMEOUT_MS);
  const control = async (action: 'open' | 'play' | 'pause' | 'seek', positionMs?: number) => {
    const state = await read(); return agent.tool('codebook_playback', { instanceId: status.instanceId, studyId, action, expectedRevision: state.revision, ...(positionMs === undefined ? {} : { positionMs }) }, z.unknown());
  };
  const started = performance.now(); await control('open'); const opened = await ready(), firstReplayMs = performance.now() - started;
  assert.equal(opened.mode, 'paused');
  const first = context.study.observations[0]!, last = context.study.observations.at(-1)!;
  if (restored) {
    assert.equal(opened.presentedMs, first.elapsedMs); assert.equal(opened.observationId, first.id); await bridge('assert-recording', first.itemId);
    return { firstReplayMs, restoredPaused: true, zeroLiveRuns: true, studyId, positionMs: opened.presentedMs, frameCount: recording.frameCount };
  }
  const seeks: { itemId: string; elapsedMs: number; latencyMs: number }[] = [];
  for (const observation of context.study.observations) {
    const start = performance.now(); await control('seek', observation.elapsedMs); const state = await ready();
    assert.equal(state.presentedMs, observation.elapsedMs); assert.equal(state.observationId, observation.id);
    await bridge('assert-recording', observation.itemId); seeks.push({ itemId: observation.itemId, elapsedMs: observation.elapsedMs, latencyMs: performance.now() - start });
  }
  const motion = entries.filter(entry => entry.type === 'frame' && entry.kind === 'stream' && entry.elapsedMs > last.elapsedMs);
  assert.ok(new Set(motion.flatMap(entry => entry.type === 'frame' ? [entry.hash] : [])).size >= 3, 'Actual confirmation requires at least three distinct recorded page frames.');
  await control('play');
  await waitUntil(async () => { const state = await read(); if (state.readiness === 'failed') throw new Error(state.reason); return state.mode === 'paused' && state.presentedMs === recording.endMs && !state.cleared; }, 'recorded transition through known end', NATIVE_OBSERVATION_TIMEOUT_MS);
  await bridge('close-recording-pane'); assert.equal((await read()).mode, 'paused');
  await bridge('open-recording-pane'); await ready(); await bridge('assert-recording', last.itemId);
  // Save a distinctive observed position for the next editor instance; no runtime operation is used.
  await control('seek', first.elapsedMs); await ready(); await bridge('assert-recording', first.itemId);
  return { firstReplayMs, seeks, studyId, frameCount: recording.frameCount, uniqueFrames: files.size, motionFrameCount: motion.length, completedPlayback: true, closedAndReopened: true, savedPositionMs: first.elapsedMs };
}
