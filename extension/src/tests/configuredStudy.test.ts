import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { type ConfiguredStudy } from '../configuredStudySchemas';
import { repositoryConfigSchema } from '../repositoryConfigSchemas';
import { studyArchiveSchema } from '../studySchemas';
import { citationContext } from '../utils/citationContext';
import { decodeConfiguredStudy } from '../utils/decodeConfiguredStudy';

const workspaceKey = '0'.repeat(64);

/** Supplies immutable configured history for decoder tests without pretending to run an app or debugger. @example configuredStudy().observations[0]?.values['value:nextTheme'] // 'dark' */
function configuredStudy(): ConfiguredStudy {
  const instanceId = '11111111-1111-4111-8111-111111111111', runId = '22222222-2222-4222-8222-222222222222';
  const source = 'const nextTheme = "dark";\n', secondary = 'export const mode = "display";\n';
  const anchors = [{ path: 'src/theme.ts', hash: sha256(source), startLine: 1, endLine: 1 }, { path: 'src/mode.ts', hash: sha256(secondary), startLine: 1, endLine: 1 }];
  const configuration = repositoryConfigSchema.parse({ version: 1, adapter: 'next-dev-webpack', book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    source: { path: 'src/theme.ts', hash: sha256(source), line: 1, column: 1 },
    action: { title: 'Change theme', selector: 'button', before: [{ kind: 'visible', selector: 'button' }], after: [{ kind: 'text', selector: 'label', equals: 'Dark' }] },
    inspections: [{ path: 'nextTheme', mode: 'value', required: true }, { path: 'setTheme', mode: 'type', required: true },
      { path: 'enabled', mode: 'value', required: false }, { path: 'selection', mode: 'value', required: false }, { path: 'renderLocal', mode: 'value', required: false }] });
  const pause = { sessionId: 'browser-session', threadId: 1, generation: 1 };
  return {
    version: 3, workspaceKey, id: `${instanceId}_${runId}`, instanceId, runId, profile: 'repository-browser',
    createdAt: '2026-09-20T00:00:00.000Z', savedAt: '2026-09-20T00:00:10.000Z', state: 'stopped', terminal: true, finalOutcome: 'demonstrated', materialSignature: sha256('material'),
    configuration, configurationHash: sha256(JSON.stringify(configuration)),
    descriptor: { itemId: 'repository/interface/theme', anchors, citationContext: citationContext(anchors),
      sources: [{ path: 'src/theme.ts', hash: sha256(source), text: source, lineCount: 2 }, { path: 'src/mode.ts', hash: sha256(secondary), text: secondary, lineCount: 2 }] },
    operation: { id: '33333333-3333-4333-8333-333333333333', key: 'change-theme', inputDispatched: true, inputAcknowledged: true, continuedPause: pause, afterVerified: true },
    observations: [{ id: 'browser-session:1', itemId: 'repository/interface/theme', actionId: 'repository-click', capturePhase: 'paused-browser',
      snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/browser-session%3A1`, participant: 'browser', capturedAt: '2026-09-20T00:00:02.000Z', elapsedMs: 2_000, pause,
      source: { text: source, hash: sha256(source), line: 1, column: 1, javascriptHash: sha256('emitted javascript'), mapHash: sha256('emitted source map'), scriptId: '17', scriptUrl: 'webpack-internal:///(app-pages-browser)/src/theme.ts', generated: { line: 8, column: 2 } },
      values: { 'value:nextTheme': 'dark', 'type:setTheme': 'function', 'value:enabled': false, 'value:selection': null }, unavailableValues: [{ path: 'value:renderLocal', reason: 'Optimized out at this frame.' }],
      interpretations: [{ id: '44444444-4444-4444-8444-444444444444', text: 'This stop captures the selected dark theme before it is applied.', createdAt: '2026-09-20T00:00:03.000Z', facts: [{ path: 'value:nextTheme', value: 'dark' }] }] }],
    captures: [{ phase: 'before', status: 'captured', base64: Buffer.from('light').toString('base64'), hash: sha256('light') },
      { phase: 'paused-browser', status: 'captured', base64: Buffer.from('paused').toString('base64'), hash: sha256('paused') },
      { phase: 'after', status: 'captured', base64: Buffer.from('dark').toString('base64'), hash: sha256('dark') }], links: [],
  };
}

test('configured offline history retains exact source, complete citations and actual false or null values without runtime authority', () => {
  // Arrange
  const archive = configuredStudy(), before = JSON.stringify(archive);
  // Act
  const decoded = decodeConfiguredStudy(JSON.parse(before), workspaceKey);
  // Assert
  assert.equal(decoded.profile, 'repository-browser'); assert.equal(decoded.descriptor?.itemId, 'repository/interface/theme');
  assert.equal(decoded.descriptor?.citationContext.anchors.length, 2);
  assert.equal(decoded.observations[0]?.source.text, 'const nextTheme = "dark";\n');
  assert.deepEqual(decoded.observations[0]?.values, { 'value:nextTheme': 'dark', 'type:setTheme': 'function', 'value:enabled': false, 'value:selection': null });
  assert.deepEqual(decoded.observations[0]?.unavailableValues, [{ path: 'value:renderLocal', reason: 'Optimized out at this frame.' }]);
  assert.equal('continueArguments' in decoded, false); assert.equal(JSON.stringify(archive), before);
});

test('preparation failure can retain configured intent without fabricating an article binding or observed pause', () => {
  // Arrange
  const archive = configuredStudy();
  archive.descriptor = undefined; archive.operation = undefined; archive.observations = []; archive.captures = [];
  archive.finalOutcome = 'not-demonstrated'; archive.reason = 'Selected book is unavailable.';
  // Act
  const decoded = decodeConfiguredStudy(archive, workspaceKey);
  // Assert
  assert.equal(decoded.configuration.book.nodeId, 'theme'); assert.equal(decoded.descriptor, undefined);
  assert.deepEqual(decoded.observations, []); assert.equal(decoded.finalOutcome, 'not-demonstrated');
});

test('configured data cannot be passed off as version 2 or attach fake server observations and causal links', () => {
  // Arrange
  const archive = configuredStudy();
  // Act / Assert
  assert.equal(studyArchiveSchema.safeParse({ ...archive, version: 2 }).success, false);
  assert.throws(() => decodeConfiguredStudy({ ...archive, version: 2 }, workspaceKey));
  assert.throws(() => decodeConfiguredStudy({ ...archive, links: [{ id: 'server-request', status: 'observed' }] }, workspaceKey));
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...archive.observations[0], participant: 'server' }] }, workspaceKey));
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [...archive.observations, ...archive.observations] }, workspaceKey));
});

test('changed intent, foreign workspace and rebound learning identity reject retained configured history', () => {
  // Arrange
  const archive = configuredStudy();
  // Act / Assert
  assert.throws(() => decodeConfiguredStudy(archive, 'f'.repeat(64)), /different workspace/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, id: `${archive.runId}_${archive.instanceId}` }, workspaceKey), /different workspace or run/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, configuration: { ...archive.configuration, action: { ...archive.configuration.action, title: 'Changed title' } } }, workspaceKey), /intent changed/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: { ...archive.descriptor, itemId: 'repository/interface/other' } }, workspaceKey), /learning item changed/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: undefined }, workspaceKey), /no bound descriptor/);
});

test('changed secondary citations and source bytes cannot retain the original understanding context', () => {
  // Arrange
  const archive = configuredStudy(), descriptor = archive.descriptor!;
  // Act / Assert
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: { ...descriptor, anchors: [descriptor.anchors[0]] } }, workspaceKey), /complete citation context changed/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: { ...descriptor, sources: descriptor.sources.map(source => source.path === 'src/mode.ts' ? { ...source, text: 'changed' } : source) } }, workspaceKey), /source bytes changed/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: { ...descriptor, sources: [descriptor.sources[0], descriptor.sources[0]] } }, workspaceKey), /duplicate source paths/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, descriptor: { ...descriptor, sources: [descriptor.sources[0]] } }, workspaceKey), /no exact retained source/);
});

test('captured pause identity and selected source coordinates cannot be rebound after saving', () => {
  // Arrange
  const archive = configuredStudy(), observation = archive.observations[0]!;
  // Act / Assert
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, pause: { ...observation.pause, generation: 2 } }] }, workspaceKey), /observation identity changed/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, source: { ...observation.source, column: 2 } }] }, workspaceKey), /source differs/);
  const invalid = configuredStudy(); invalid.configuration.source.column = 100; invalid.configurationHash = sha256(JSON.stringify(invalid.configuration));
  assert.throws(() => decodeConfiguredStudy(invalid, workspaceKey), /position differs/);
  const otherAnchor = configuredStudy(); otherAnchor.configuration.book.anchorIndex = 1; otherAnchor.configurationHash = sha256(JSON.stringify(otherAnchor.configuration));
  assert.throws(() => decodeConfiguredStudy(otherAnchor, workspaceKey), /position differs/);
});

test('undeclared, missing, unavailable or invented interpretation facts are rejected instead of becoming observed values', () => {
  // Arrange
  const archive = configuredStudy(), observation = archive.observations[0]!;
  // Act / Assert
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, values: { ...observation.values, 'value:other': 'invented' } }] }, workspaceKey), /declared inspections/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, unavailableValues: [] }] }, workspaceKey), /declared inspections/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, unavailableValues: [...observation.unavailableValues, ...observation.unavailableValues] }] }, workspaceKey), /declared inspections/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, observations: [{ ...observation, values: { ...observation.values, 'type:setTheme': 'pretend' } }] }, workspaceKey), /captured type string/);
  const missingRequired = configuredStudy(); delete missingRequired.observations[0]!.values['value:nextTheme']; missingRequired.observations[0]!.unavailableValues.push({ path: 'value:nextTheme', reason: 'Absent' });
  assert.throws(() => decodeConfiguredStudy(missingRequired, workspaceKey), /required fact/);
  const invented = configuredStudy(); invented.observations[0]!.interpretations[0]!.facts = [{ path: 'value:renderLocal', value: 'inferred from source' }];
  assert.throws(() => decodeConfiguredStudy(invented, workspaceKey), /interpretation facts differ/);
  const duplicated = configuredStudy(); duplicated.observations[0]!.interpretations[0]!.facts.push({ path: 'value:nextTheme', value: 'dark' });
  assert.throws(() => decodeConfiguredStudy(duplicated, workspaceKey), /interpretation facts differ/);
});

test('configured success requires confirmed input, the exact continued pause and all three retained images', () => {
  // Arrange
  const archive = configuredStudy(), operation = archive.operation!;
  // Act / Assert
  assert.throws(() => decodeConfiguredStudy({ ...archive, operation: undefined }, workspaceKey), /no dispatched operation/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, operation: { ...operation, inputAcknowledged: false } }, workspaceKey), /after verification lacks/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, operation: { ...operation, continuedPause: { ...operation.continuedPause, sessionId: 'foreign' } } }, workspaceKey), /continuation differs/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, operation: { ...operation, afterVerified: false } }, workspaceKey), /missing required evidence/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, terminal: false }, workspaceKey), /missing required evidence/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, captures: archive.captures.slice(0, 2) }, workspaceKey), /missing required evidence/);
});

test('partial captures remain readable while altered image bytes or duplicate phases cannot certify history', () => {
  // Arrange
  const archive = configuredStudy();
  const partial = { ...archive, finalOutcome: 'partial', captures: [...archive.captures.slice(0, 2), { phase: 'after', status: 'failed', reason: 'Renderer did not acknowledge.' }] };
  // Act / Assert
  assert.equal(decodeConfiguredStudy(partial, workspaceKey).finalOutcome, 'partial');
  assert.throws(() => decodeConfiguredStudy({ ...archive, captures: [archive.captures[0], archive.captures[0]] }, workspaceKey), /duplicate image/);
  assert.throws(() => decodeConfiguredStudy({ ...archive, captures: [{ phase: 'before', status: 'captured', base64: Buffer.from('wrong pixels').toString('base64'), hash: sha256('light') }] }, workspaceKey), /image changed/);
});
