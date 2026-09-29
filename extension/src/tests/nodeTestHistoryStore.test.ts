import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NODE_TEST_HISTORY_DIRECTORY } from '../constants';
import { NodeTestHistoryStore } from '../nodeTestHistoryStore';
import { sha256 } from '../runtimeSupport/utils/sha256';

const createWorkspaceKey = () => sha256('node-history-test-workspace');
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture';



test('Node history remains a readable interrupted prefix after extension restart and rejects foreign workspace access', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-')), header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey), writer = await store.start(header);
  try {
    // Act: reopen the same private workspace store without a seal, as after abrupt extension exit.
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'RUN src/theme.test.ts' });
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey);
    const recovered = await restarted.read(header.studyId);

    // Assert
    assert.equal(recovered.status, 'interrupted');
    assert.deepEqual(recovered.entries.map(entry => entry.type), ['output']);
    assert.match(recovered.reason!, /no verified final seal/i);
    await assert.rejects(new NodeTestHistoryStore(directory, 'f'.repeat(64)).read(header.studyId), /another workspace/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Node history refuses edited bytes after a sealed partial run', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-seal-')), header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey), writer = await store.start(header);
  try {
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stderr', text: 'test interrupted' });
    await writer.finish('partial', 'The learner stopped this run.');
    const journal = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId, 'events.jsonl');
    await appendFile(journal, '{"type":"forged"}\n');

    // Act / Assert
    await assert.rejects(store.read(header.studyId), /sealed Node history journal is corrupt/i);
    const [listed] = await store.list();
    assert.equal(listed?.verification, 'unavailable', 'catalog keeps corrupted evidence visible without trusting it');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Node reader restores a verified event cursor without changing the sealed journal', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-position-')), header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey), writer = await store.start(header);
  try {
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'RUN src/theme.test.ts' });
    await writer.finish('partial', 'The test process was stopped.');
    const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId);
    const journalPath = join(historyDirectory, 'events.jsonl'), journalBefore = await readFile(journalPath);

    // Act: save an exact journal event and open it through a fresh store instance.
    await store.saveReaderPosition(header.studyId, 1);
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey);
    const restoredSequence = await restarted.readReaderPosition(header.studyId);

    // Assert
    assert.equal(restoredSequence, 1);
    assert.deepEqual(await readFile(journalPath), journalBefore, 'reading progress does not rewrite sealed execution evidence');
    await assert.rejects(restarted.saveReaderPosition(header.studyId, 2), /unavailable in verified history/i);

    // Act: a stale cursor cannot be presented as a valid replay position.
    const positionPath = join(historyDirectory, 'reader-position.json');
    await writeFile(positionPath, JSON.stringify({ version: 1, studyId: header.studyId, sequence: 2, updatedAt: new Date().toISOString() }));

    // Assert
    await assert.rejects(restarted.readReaderPosition(header.studyId), /no longer present in the verified history/i);
    assert.deepEqual(await readFile(journalPath), journalBefore, 'a stale cursor leaves the sealed journal byte-identical');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stepping through an opened Node history saves each reader position without re-verifying the whole journal', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-position-steps-')), header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey), writer = await store.start(header);
  try {
    for (const sequence of [1, 2, 3]) await writer.appendOutput({ sequence, elapsedMs: sequence, channel: 'stdout', text: `output ${sequence}` });
    await writer.finish('partial', 'The test process was stopped.');
    const opened = await store.read(header.studyId);
    const journalReads = mock.method(store, 'read');

    // Act: playback advances through each event of the history the reader already verified.
    for (const sequence of [1, 2, 3]) await store.saveReaderPosition(header.studyId, sequence, opened);

    // Assert
    assert.equal(journalReads.mock.callCount(), 0);
    assert.equal(await new NodeTestHistoryStore(directory, header.workspaceKey).readReaderPosition(header.studyId), 3);
    await assert.rejects(store.saveReaderPosition(header.studyId, 4, opened), /unavailable in verified history/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Node history understanding is an explicit private decision that survives store restart', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-understanding-'));
  const header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey);
  const writer = await store.start(header);
  try {
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'Tests 1 passed' });
    const sourceText = 'const nextTheme = "dark";\n';
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: header.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } });
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 6);
    await writer.finish('complete');
    const journalPath = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId, 'events.jsonl');
    const originalJournal = await readFile(journalPath);

    // Act: a completed test has no understanding decision until the learner records one.
    assert.equal(await store.readLearningDecision(header.studyId), undefined);
    const decision = await store.saveLearningDecision(header.studyId, true);
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey);
    const restored = await restarted.readLearningDecision(header.studyId);

    // Assert
    assert.equal(decision.studyId, header.studyId);
    assert.equal(decision.understood, true);
    assert.equal(restored?.understood, true);
    assert.ok(restored?.at);
    assert.deepEqual(await readFile(journalPath), originalJournal, 'learner progress does not rewrite sealed test output');

    // Act: an explicit review choice can replace understood state for the same history.
    await restarted.saveLearningDecision(header.studyId, false);

    // Assert
    assert.equal((await store.readLearningDecision(header.studyId))?.understood, false);
    await writeFile(join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId, 'learning-decision.json'), JSON.stringify({
      version: 1, studyId: '00000000-0000-4000-8000-000000000000_00000000-0000-4000-8000-000000000000', understood: true, at: new Date().toISOString(),
    }));
    await assert.rejects(restarted.readLearningDecision(header.studyId), /belongs to another history/i);
    assert.deepEqual(await readFile(journalPath), originalJournal, 'a foreign learner decision does not modify execution evidence');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Node learning explanation restores by revision and accepts only exact sealed stop and result events', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-learning-material-'));
  const header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey);
  const writer = await store.start(header);
  try {
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'RUN src/theme.test.ts' });
    const sourceText = 'const nextTheme = "dark";\n';
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: header.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } });
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 6);
    await writer.finish('complete');
    const historyDirectory = join(directory, NODE_TEST_HISTORY_DIRECTORY, header.studyId);
    const journalPath = join(historyDirectory, 'events.jsonl');
    const sealedJournal = await readFile(journalPath);
    const content = { question: 'Why did the selected theme become dark?', title: 'Theme update', summary: 'The captured stop shows the dark value; the test process later exited successfully.',
      participants: [{ id: 'test', label: 'Vitest test' }, { id: 'state', label: 'Theme state' }],
      steps: [
        { id: 'selection', from: 'test', to: 'state', label: 'Select theme', explanation: 'The native debugger captured the dark theme value at this source stop.', evidence: 'observed' as const,
          reference: { type: 'stop' as const, sequence: 2, sourceHash: header.configuration.source.hash } },
        { id: 'result', from: 'test', to: 'test', label: 'Finish test', explanation: 'The sealed journal records a passing process result.', evidence: 'observed' as const,
          reference: { type: 'result' as const, sequence: 3 } },
      ] };

    // Act: save the editor agent's summary, then reopen it from a fresh store instance.
    const saved = await store.saveLearningMaterial(header.studyId, 0, content);
    const restarted = new NodeTestHistoryStore(directory, header.workspaceKey);
    const restored = await restarted.readLearningMaterial(header.studyId);

    // Assert
    assert.equal(saved.revision, 1);
    assert.deepEqual(restored?.content, content);
    assert.equal(await restarted.readLearningDecision(header.studyId), undefined, 'agent explanation never marks learner understanding');
    assert.deepEqual(await readFile(journalPath), sealedJournal, 'learning content never mutates sealed execution events');
    await assert.rejects(restarted.saveLearningMaterial(header.studyId, 0, content), /revision changed/i);
    const [stopStep, resultStep] = content.steps;
    assert.ok(stopStep); assert.ok(resultStep);
    await assert.rejects(restarted.saveLearningMaterial(header.studyId, 1, { ...content, steps: [{ ...stopStep,
      reference: { type: 'stop', sequence: 3, sourceHash: header.configuration.source.hash } }, resultStep] }), /does not match its sealed history reference/i);
    assert.deepEqual(await restarted.readLearningMaterial(header.studyId), saved, 'invalid revisions and references preserve the last valid explanation');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a new Node test is refused when saved studies and histories reach the configured limit, keeping existing history readable', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-capacity-'));
  const workspaceKey = createWorkspaceKey();
  const savedBrowserStudies = async () => 1;
  const store = new NodeTestHistoryStore(directory, workspaceKey, () => 2, savedBrowserStudies);
  const first = nodeTestHistoryHeader(workspaceKey), second = nodeTestHistoryHeader(workspaceKey);
  try {
    const writer = await store.start(first);
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'RUN src/theme.test.ts' });
    await writer.finish('partial', 'The learner stopped this run.');

    // Act
    const starting = store.start(second);

    // Assert
    await assert.rejects(starting, /Saved study storage is full/);
    assert.deepEqual((await store.list()).map(entry => entry.studyId), [first.studyId]);
    assert.equal((await store.read(first.studyId)).status, 'partial');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a failing Node test result can be sealed only as partial history', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-history-failing-result-'));
  const header = nodeTestHistoryHeader(createWorkspaceKey());
  const store = new NodeTestHistoryStore(directory, header.workspaceKey), writer = await store.start(header);
  try {
    await writer.appendOutput({ sequence: 1, elapsedMs: 4, channel: 'stdout', text: 'RUN src/theme.test.ts' });
    const sourceText = 'const nextTheme = "dark";\n';
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: header.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: header.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } });
    await writer.appendResult({ exitCode: 1, signal: null, output: 'Tests 1 failed' }, 6);

    // Act
    const completing = writer.finish('complete');

    // Assert
    await assert.rejects(completing, /cannot be marked complete/);
    await writer.finish('partial', 'The test failed after its recorded stop.');
    const history = await store.read(header.studyId);
    assert.equal(history.status, 'partial');
    assert.equal(history.reason, 'The test failed after its recorded stop.');
    assert.deepEqual(history.entries.map(entry => entry.type), ['output', 'stop', 'result']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
