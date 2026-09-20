import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { LearningLibrary } from '../learningLibrary';
import { RepositoryBookStore } from '../repositoryBook';
import { RecordingStore } from '../recordingStore';
import { StudyService } from '../service';
import { captureStudy } from '../utils/captureStudy';
import { createRecordingObserver } from '../utils/createRecordingObserver';
import { projectRecording } from '../utils/projectRecording';
import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness';

for (const failure of ['renderer acknowledgement', 'required inspection']) test(`a failed ${failure} retains verified source and available facts offline without granting Continue`, async context => {
  // Arrange: real coordinator/storage with controlled protocol failure, not native paint evidence.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined;
  context.after(async () => { await service?.shutdown(); books?.dispose(); });
  const harness = await configuredRuntimeHarness(context), directory = join(harness.directory, '.learning');
  const library = new LearningLibrary(directory, '0'.repeat(64)), store = new RecordingStore(directory, library.workspaceKey);
  books = new RepositoryBookStore(harness.sources, library);
  await books.publish({ bookId: 'interface', expectedRevision: 0, key: 'article', document: { title: 'Interface', summary: 'Two citations.', nodes: [{ id: 'theme', title: 'Theme', sections: [{ title: 'Theme', text: 'Source-derived explanation.' }], anchors: harness.definition.descriptor.anchors, observations: [] }], edges: [] } });
  service = new StudyService({ workspace: harness.directory, host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' }, build: { revision: 'controlled-runtime', dirty: false, sourceHash: '0'.repeat(64) }, prerequisites: async () => ({ ready: true, missing: [] }), createRuntime: async () => harness.run }, join(harness.directory, '.service'));
  service.repository = books; service.recordings = store;
  const receipt = service.start({ instanceId: service.instanceId, profile: 'repository-browser', key: 'partial', configuration: harness.definition.configuration });
  const record = service.record(receipt); harness.observeRecording(() => createRecordingObserver(record)); await record.preparation;
  if (failure === 'renderer acknowledgement') harness.rejectCapture('paused-browser'); else harness.requireUnavailableValue();
  // Act
  service.action({ ...receipt, key: 'one', action: 'repository-click' }); await waitUntil(() => harness.run.view().status === 'failed', 'explicit incomplete observation');
  await service.stop(receipt);
  const archive = await captureStudy(service, record, library.workspaceKey); assert.ok(archive);
  const revision = service.beginHistory(record, archive.materialSignature); assert.ok(revision);
  await library.saveStudy(archive); service.reportHistory(record, archive.materialSignature, revision, 'saved'); await service.saveRecordingContext(record, archive, revision);
  const restarted = new RecordingStore(directory, library.workspaceKey), saved = await restarted.readContext(archive.id), index = await restarted.read(archive.id);
  const projection = projectRecording(index, saved.context, index.endMs ?? index.lastVerifiedMs);
  // Assert
  assert.equal(service.state(record).participants.browser.resumable, false); assert.equal(service.state(record).participants.browser.continueArguments, undefined);
  assert.equal(service.state(record).recordedStudyOutcome, 'not-demonstrated'); assert.equal(archive.observations.length, 1);
  assert.ok(projection.observation?.actionId === 'repository-click');
  assert.equal(projection.observation.source.text, 'const nextTheme = "dark";\n'); assert.equal(projection.observation.values['value:enabled'], false);
  assert.equal(projection.observation.values['value:selection'], null); assert.equal(projection.rendererConfirmed, false);
  assert.equal(harness.commands.filter(command => command === 'continue').length, 0);
  const snapshot = harness.run.view().snapshots[0]!; await assert.rejects(harness.run.continue('browser', snapshot.pause), /conflict/);
  if (failure === 'required inspection') { assert.equal(snapshot.values['value:nextTheme'], undefined); assert.equal(snapshot.unavailableValues[0]?.path, 'value:nextTheme'); }
  else { assert.equal(snapshot.values['value:nextTheme'], 'dark'); assert.equal(archive.captures.find(capture => capture.phase === 'paused-browser')?.status, 'failed'); }
});

test('a configured action records all phase pixels and exact pause correspondence through the real coordinator and service after restart', async context => {
  // Arrange: controlled native protocols and a synthetic PNG; real coordinator, observer, archive and recording storage.
  let service: StudyService | undefined, books: RepositoryBookStore | undefined;
  context.after(async () => { await service?.shutdown(); books?.dispose(); });
  const harness = await configuredRuntimeHarness(context), directory = join(harness.directory, '.learning');
  const library = new LearningLibrary(directory, '0'.repeat(64)), store = new RecordingStore(directory, library.workspaceKey);
  books = new RepositoryBookStore(harness.sources, library);
  await books.publish({ bookId: 'interface', expectedRevision: 0, key: 'article', document: { title: 'Interface', summary: 'Two citations.', nodes: [{ id: 'theme', title: 'Theme', sections: [{ title: 'Theme', text: 'Source-derived explanation.' }], anchors: harness.definition.descriptor.anchors, observations: [] }], edges: [] } });
  service = new StudyService({ workspace: harness.directory, host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' },
    build: { revision: 'controlled-runtime', dirty: false, sourceHash: '0'.repeat(64) }, prerequisites: async () => ({ ready: true, missing: [] }), createRuntime: async () => harness.run }, join(harness.directory, '.service'));
  service.repository = books; service.recordings = store;
  const receipt = service.start({ instanceId: service.instanceId, profile: 'repository-browser', key: 'record-once', configuration: harness.definition.configuration });
  const record = service.record(receipt); harness.observeRecording(() => createRecordingObserver(record));
  await record.preparation; assert.equal(record.error, undefined);
  // Act
  service.action({ ...receipt, key: 'click-once', action: 'repository-click' });
  const snapshot = await waitUntil(() => harness.run.view().snapshots[0], 'configured recorded pause');
  await service.continue({ ...receipt, participant: 'browser', ...snapshot.pause });
  await waitUntil(() => harness.run.view().status === 'completed', 'configured recorded completion');
  await service.stop(receipt);
  const archive = await captureStudy(service, record, library.workspaceKey); assert.ok(archive);
  const revision = service.beginHistory(record, archive.materialSignature); assert.ok(revision);
  await library.saveStudy(archive); service.reportHistory(record, archive.materialSignature, revision, 'saved'); await service.saveRecordingContext(record, archive, revision);
  const restarted = new RecordingStore(directory, library.workspaceKey), index = await restarted.read(archive.id), saved = await restarted.readContext(archive.id);
  const pausePhase = saved.context.phases.find(phase => phase.phase === 'paused-browser')!;
  const projection = projectRecording(index, saved.context, snapshot.elapsedMs);
  // Assert: no manufactured capture events or direct writer.frame calls can conceal a missing production connection.
  assert.equal(service.state(record).recordedStudyOutcome, 'demonstrated'); assert.equal(index.status, 'finalized');
  assert.deepEqual(index.entries.filter(entry => entry.type === 'frame').map(entry => entry.phase), ['before', 'paused-browser', 'after']);
  const pixels = harness.run.evidence.events.filter(event => event.type === 'capture.response-received');
  const imageHash = '13f49d37064e5e9a125e79406f0e4d06a719813a3a3cca585595433c73e9b259';
  assert.deepEqual(JSON.parse(JSON.stringify(pixels.map(event => event.detail))), [{ phase: 'before', hash: imageHash }, { phase: 'paused-browser', pause: { sessionId: 'browser-session', threadId: 1, generation: 1 }, hash: imageHash }, { phase: 'after', hash: imageHash }]);
  assert.equal(pausePhase.pauseVerifiedMs, snapshot.elapsedMs); assert.ok(pausePhase.rendererConfirmedMs !== undefined && pausePhase.rendererConfirmedMs <= snapshot.elapsedMs);
  assert.equal(projection.pauseConfirmed, true); assert.equal(projection.rendererConfirmed, true);
  assert.ok(projection.observation?.actionId === 'repository-click');
  assert.equal(projection.observation.source.text, 'const nextTheme = "dark";\n'); assert.equal(projection.observation.values['value:nextTheme'], 'dark');
});
