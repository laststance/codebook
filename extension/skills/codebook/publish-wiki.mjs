import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderWikiPages } from './render-wiki.mjs';

const MANIFEST = 'codebook-wiki.json';
const RECEIPT = 'codebook-publication.json';
const HASH = /^[a-f0-9]{64}$/;
const reserved = path => [MANIFEST, RECEIPT].includes(path.split('/')[0].toLowerCase());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const isMissing = error => error.code === 'ENOENT';

/** Parses inventory for {@link publishWiki} and recovery before any owned file can be replaced. @example parseManifest(bytes, '/repo') */
function parseManifest(bytes, projectRoot) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.schemaVersion !== 1 || manifest.repositoryRoot !== projectRoot || !Array.isArray(manifest.pages) || !Array.isArray(manifest.assets))
    throw new Error('The Wiki manifest does not identify this project and a complete page inventory.');
  const owned = new Set(['index.html', ...manifest.pages.map(page => page?.path), ...manifest.assets]);
  if ([...owned].some(path => !safePath(path) || reserved(path))) throw new Error('The Wiki manifest contains an unsafe or reserved owned path.');
  return { manifest, owned };
}

/** Reads publisher metadata and owned files without accepting a symlink or special file. @example await regularBytes('/wiki/codebook-wiki.json') */
async function regularBytes(path, optional = false) {
  let stat;
  try { stat = await lstat(path); } catch (error) { if (optional && isMissing(error)) return undefined; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Wiki publication requires a regular file: ' + path);
  return readFile(path);
}

/** Inventories stage/output for the shared publisher; linked and special files remain untouched. @example await listFiles('/repo/.codebook/wiki') */
async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Wiki publication refuses a linked file: ' + path);
    if (entry.isDirectory()) files.push(...await listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Wiki publication refuses a special file: ' + path);
  }
  return files;
}

/** Resolves paths for {@link prepareWikiStage}, {@link publishWiki} and recovery without following directory aliases. @example await locations('/repo', '/repo/.codebook/wiki') */
async function locations(projectRoot, outputDirectory, stageDirectory, createParent = false) {
  const root = await realpath(projectRoot), requested = resolve(outputDirectory);
  if (createParent) await mkdir(dirname(requested), { recursive: true });
  const output = join(await realpath(dirname(requested)), basename(requested));
  const within = relative(output, root);
  if (!isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep)) throw new Error('The Wiki output must be outside the project root itself.');
  const stage = stageDirectory === undefined ? undefined : join(await realpath(dirname(resolve(stageDirectory))), basename(resolve(stageDirectory)));
  if (stage !== undefined && (dirname(stage) !== dirname(output) || stage === output)) throw new Error('The Wiki stage must be a distinct sibling of its output.');
  for (const path of [output, stage].filter(Boolean)) {
    const stat = await lstat(path).catch(error => { if (isMissing(error)) return undefined; throw error; });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('The Wiki directory must be regular: ' + path);
  }
  return { root, output, stage, journal: output + '.publish-journal.json' };
}

/** Validates a captured ownership inventory used by candidate and published receipts. @example validHashes({ 'index.html': hash }) */
function validHashes(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([path, hash]) => safePath(path) && !reserved(path) && typeof hash === 'string' && HASH.test(hash));
}

/** Loads independent metadata for {@link inspectOutput} and prepared-candidate checks before a write. @example await readReceipt('/wiki', '/repo') */
async function readReceipt(directory, root, optional = false) {
  const bytes = await regularBytes(join(directory, RECEIPT), optional);
  if (bytes === undefined) return undefined;
  let receipt;
  try { receipt = JSON.parse(bytes); } catch (cause) { throw new Error('The Wiki publication record is invalid; output was preserved.', { cause }); }
  const baseline = receipt?.baseline;
  if (receipt?.schemaVersion !== 1 || receipt.repositoryRoot !== root || !['candidate', 'published'].includes(receipt.kind) ||
    typeof receipt.output !== 'string' || !isAbsolute(receipt.output) ||
    baseline !== null && (!baseline || !HASH.test(baseline.manifestSha256) || typeof baseline.manifestText !== 'string' || digest(baseline.manifestText) !== baseline.manifestSha256 || !validHashes(baseline.ownedFiles) || typeof baseline.legacy !== 'boolean'))
    throw new Error('The Wiki publication record is invalid; output was preserved.');
  if (receipt.kind === 'published' && (typeof receipt.manifestText !== 'string' || !HASH.test(receipt.manifestSha256) || digest(receipt.manifestText) !== receipt.manifestSha256))
    throw new Error('The retained Wiki manifest is invalid; output was preserved.');
  return receipt;
}

/** Checks current output against its retained manifest before preview, replacement or recovery. @example await inspectOutput('/wiki', '/repo') */
async function inspectOutput(output, root, { allowLegacy = false, allowManifestDrift = false } = {}) {
  const stat = await lstat(output).catch(error => { if (isMissing(error)) return undefined; throw error; });
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The prior Wiki output is not a regular directory.');
  const files = await listFiles(output), receipt = await readReceipt(output, root, true);
  if (!receipt && !allowLegacy) throw new Error('The prior Wiki has no publication record. Inspect it, then use --prepare with --adopt-existing.');
  if (receipt && receipt.kind !== 'published') throw new Error('The prior Wiki publication record is not published.');
  const actual = await regularBytes(join(output, MANIFEST), Boolean(receipt));
  const bytes = receipt ? Buffer.from(receipt.manifestText) : actual;
  const parsed = parseManifest(bytes, root), hashes = Object.create(null);
  if (receipt && !validHashes(parsed.manifest.ownedFiles)) throw new Error('The retained Wiki ownership inventory is invalid.');
  // The receipt is independent of the mutable manifest that previously escaped every ownership check.
  if (receipt && !allowManifestDrift && (actual === undefined || digest(actual) !== receipt.manifestSha256))
    throw new Error('The published Wiki manifest changed after generation. Preserve the edit and run --recover; do not adopt or republish it.');
  for (const path of parsed.owned) {
    hashes[path] = digest(await regularBytes(join(output, path)));
    if (parsed.manifest.ownedFiles && parsed.manifest.ownedFiles[path] !== hashes[path])
      throw new Error('A published Wiki file changed after generation: ' + path);
  }
  return { ...parsed, bytes, actual, receipt, files, hashes };
}

/** Captures the previous generation for {@link prepareWikiStage}; null denotes a new output. @example baselineOf(state) */
function baselineOf(state) {
  return state ? { manifestSha256: digest(state.bytes), manifestText: state.bytes.toString('utf8'), ownedFiles: state.hashes, legacy: !state.receipt } : null;
}

/** Rejects a stale candidate before it can overwrite another publisher's newer generation. @example assertBaseline(receipt.baseline, state) */
function assertBaseline(expected, state) {
  const actual = baselineOf(state);
  if (expected === null && actual === null) return;
  if (!expected || !actual || expected.manifestSha256 !== actual.manifestSha256 || expected.legacy !== actual.legacy ||
    Object.keys(expected.ownedFiles).length !== Object.keys(actual.ownedFiles).length ||
    Object.entries(expected.ownedFiles).some(([path, hash]) => actual.ownedFiles[path] !== hash))
    throw new Error('The Wiki output changed since this candidate was prepared. Preserve it and inspect --recover (with --stage for a legacy adoption) before preparing again.');
}

/** Keeps all ordinary entry points out of an unfinished publication transaction. @example await requireNoJournal('/wiki.publish-journal.json') */
async function requireNoJournal(journal) {
  if (await regularBytes(journal, true)) throw new Error('An earlier Wiki publication needs inspection. Run --recover after its process exits: ' + journal);
}

/** Handles the CLI preparation step before agent edits, retaining current output and an exact recovery baseline. @example await prepareWikiStage({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function prepareWikiStage({ projectRoot, outputDirectory, stageDirectory, adoptExisting = false }) {
  const paths = await locations(projectRoot, outputDirectory, stageDirectory, true);
  const { root, output, journal } = paths, stage = paths.stage ?? output + '.stage-' + randomUUID();
  await requireNoJournal(journal);
  const prior = await inspectOutput(output, root, { allowLegacy: adoptExisting });
  await mkdir(stage); // An existing candidate is never overwritten or silently reused.
  const receipt = { schemaVersion: 1, kind: 'candidate', repositoryRoot: root, output, baseline: baselineOf(prior) };
  await writeFile(join(stage, RECEIPT), JSON.stringify(receipt), { flag: 'wx' });
  if (prior) {
    await writeFile(join(stage, MANIFEST), prior.bytes, { flag: 'wx' });
    for (const path of prior.manifest.assets) {
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await copyFile(join(output, path), join(stage, path), constants.COPYFILE_EXCL);
    }
  }
  await requireNoJournal(journal);
  assertBaseline(receipt.baseline, await inspectOutput(output, root, { allowLegacy: adoptExisting }));
  return { stage, manifest: join(stage, MANIFEST), output, legacyAdopted: Boolean(prior && !prior.receipt) };
}

/** Removes only the journal/claim bytes owned by the completing operation. @example await removeOwnedRecord(path, bytes) */
async function removeOwnedRecord(path, bytes) {
  const current = await regularBytes(path, true);
  if (!current || !current.equals(Buffer.from(bytes))) throw new Error('Publication ownership changed; the recovery record was preserved: ' + path);
  await unlink(path);
}

/** Publishes a prepared candidate while retaining exact prior metadata, generated files and manual files. @example await publishWiki({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki', stageDirectory: '/repo/.codebook/wiki.stage' }) */
export async function publishWiki({ projectRoot, outputDirectory, stageDirectory, renderOnly = false }) {
  const { root, output, stage, journal } = await locations(projectRoot, outputDirectory, stageDirectory);
  if (!stage) throw new Error('The Wiki publisher requires a prepared stage.');
  await requireNoJournal(journal);
  const bytes = await regularBytes(join(stage, MANIFEST)), { manifest, owned } = parseManifest(bytes, root);
  const files = await listFiles(stage);
  if (files.some(path => ![MANIFEST, RECEIPT].includes(path) && !owned.has(path))) throw new Error('The staged Wiki contains a file outside its published manifest.');
  // Validate authored content without modifying either the stage or published output.
  const rendered = await renderWikiPages(manifest, { projectRoot: root, outputDirectory: output });
  const receipt = await readReceipt(stage, root, true);
  if (!receipt || receipt.output !== output) throw new Error('Use --prepare before editing a Wiki candidate for this output.');
  if (receipt.kind === 'published' && digest(bytes) !== receipt.manifestSha256) throw new Error('A previously finalized candidate changed. Preserve it and use --prepare again.');
  const inspectPrior = () => inspectOutput(output, root, { allowLegacy: receipt.baseline?.legacy === true });
  let prior = await inspectPrior();
  assertBaseline(receipt.baseline, prior);
  for (const [path, html] of rendered) {
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await writeFile(join(stage, path), html);
  }
  if (renderOnly) return { stage, renderedPages: rendered.size };
  const ownedFiles = Object.create(null);
  for (const path of owned) ownedFiles[path] = digest(await regularBytes(join(stage, path)));
  manifest.ownedFiles = ownedFiles;
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const backup = prior ? output + '.previous-' + randomUUID() : undefined;
  const record = { projectRoot: root, output, stage, backup, pid: process.pid, id: randomUUID(), operation: 'publish', manifestSha256: digest(manifestText), priorManifestSha256: prior ? digest(prior.bytes) : undefined, priorLegacy: receipt.baseline?.legacy === true };
  const journalBytes = JSON.stringify(record);
  await writeFile(journal, journalBytes, { flag: 'wx' });
  let movedOld = false, swapped = false;
  try {
    prior = await inspectPrior();
    assertBaseline(receipt.baseline, prior);
    const manual = prior ? prior.files.filter(path => ![MANIFEST, RECEIPT].includes(path) && !prior.owned.has(path)) : [];
    const manualHashes = Object.create(null);
    for (const path of manual) {
      if ([...owned].some(ownedPath => ownedPath === path || ownedPath.startsWith(path + '/') || path.startsWith(ownedPath + '/')))
        throw new Error('A manual Wiki file conflicts with the update: ' + path);
      const content = await regularBytes(join(output, path));
      manualHashes[path] = digest(content);
      await mkdir(dirname(join(stage, path)), { recursive: true });
      await writeFile(join(stage, path), content, { flag: 'wx' });
    }
    await writeFile(join(stage, MANIFEST), manifestText);
    await writeFile(join(stage, RECEIPT), JSON.stringify({ ...receipt, kind: 'published', manifestSha256: record.manifestSha256, manifestText }));
    // Recheck after acquiring the journal and copying files; a stale generation cannot win a later swap.
    const current = await inspectPrior();
    assertBaseline(receipt.baseline, current);
    const currentManual = current ? current.files.filter(path => ![MANIFEST, RECEIPT].includes(path) && !current.owned.has(path)) : [];
    if (currentManual.length !== manual.length) throw new Error('Manual Wiki files changed during publication; output was preserved.');
    for (const path of currentManual) if (manualHashes[path] !== digest(await regularBytes(join(output, path)))) throw new Error('A manual Wiki file changed during publication: ' + path);
    if (backup) { await rename(output, backup); movedOld = true; }
    await rename(stage, output);
    swapped = true;
    await removeOwnedRecord(journal, journalBytes);
    return { output, previousOutput: backup, publishedFiles: owned.size, preservedManualFiles: manual.length };
  } catch (error) {
    if (swapped) throw error; // Cleanup failure must not roll back an already usable new generation.
    if (movedOld) {
      try { await rename(backup, output); }
      catch (cause) { throw new Error('Publication failed; the prior Wiki remains at ' + backup + '. Run --recover.', { cause }); }
    }
    await removeOwnedRecord(journal, journalBytes);
    throw error;
  }
}

/** Refuses recovery while a recorded publisher or recovery process may still own the operation. @example requireExited(1234) */
function requireExited(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('The Wiki recovery owner is invalid.');
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
  throw new Error('The prior Wiki publisher process ' + pid + ' may still be running; inspect it before recovery.');
}

/** Claims stopped recovery attempts through append-only exclusive records, without unlinking another contender's lock. @example await claimRecovery(journal, journalBytes) */
async function claimRecovery(journal, bytes) {
  // Journal hash -> exclusive owner -> stopped owner ID -> exclusive successor; a live owner stops traversal.
  const claims = [], visited = new Set();
  let parent = digest(bytes);
  while (!visited.has(parent)) {
    visited.add(parent);
    const path = journal + '.recovery-' + parent, claimBytes = JSON.stringify({ pid: process.pid, id: randomUUID() });
    try { await writeFile(path, claimBytes, { flag: 'wx' }); claims.push({ path, bytes: claimBytes }); return claims; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previousBytes = await regularBytes(path), previous = JSON.parse(previousBytes);
    if (typeof previous.id !== 'string' || !/^[a-f0-9-]{36}$/.test(previous.id)) throw new Error('The Wiki recovery claim is invalid; it was preserved.');
    requireExited(previous.pid);
    claims.push({ path, bytes: previousBytes });
    parent = previous.id;
  }
  throw new Error('The Wiki recovery claims form a cycle; all records were preserved.');
}

/** Uses a prepared adoption snapshot only when old output has no published receipt; recovery never bypasses a present record. @example await recoveryState('/repo', '/wiki', '/wiki.stage') */
async function recoveryState(root, output, stageDirectory) {
  if (stageDirectory === undefined || await regularBytes(join(output, RECEIPT), true)) return inspectOutput(output, root, { allowManifestDrift: true });
  const { stage } = await locations(root, output, stageDirectory);
  const prepared = await readReceipt(stage, root), baseline = prepared.baseline;
  if (prepared.output !== output || !baseline?.legacy) throw new Error('This stage does not retain an inspected legacy Wiki baseline.');
  const bytes = Buffer.from(baseline.manifestText), parsed = parseManifest(bytes, root), files = await listFiles(output);
  if (Object.keys(baseline.ownedFiles).length !== parsed.owned.size) throw new Error('The legacy recovery inventory is incomplete.');
  for (const path of parsed.owned) {
    if (digest(await regularBytes(join(output, path))) !== baseline.ownedFiles[path]) throw new Error('A legacy Wiki file changed after preparation: ' + path);
  }
  return { ...parsed, bytes, actual: await regularBytes(join(output, MANIFEST), true), files, legacyRecovery: true };
}

/** Restores only receipt-verified metadata, retaining altered bytes before the atomic rename. @example await restoreManifest(record, paths) */
async function restoreManifest(record, paths) {
  const { root, output } = paths;
  let state = await recoveryState(root, output, record.sourceStage);
  if (!state || !state.receipt && !state.legacyRecovery || digest(state.bytes) !== record.manifestSha256) throw new Error('The retained Wiki generation changed; recovery was stopped.');
  if (state.actual && digest(state.actual) === record.manifestSha256) return;
  if ((state.actual ? digest(state.actual) : null) !== record.modifiedManifestSha256) throw new Error('The altered Wiki manifest changed during recovery; it was preserved.');
  if (state.actual) {
    const retained = await regularBytes(record.modifiedManifestBackup, true);
    if (retained && !retained.equals(state.actual)) throw new Error('The retained edited manifest conflicts with recovery; it was preserved.');
    if (!retained) await writeFile(record.modifiedManifestBackup, state.actual, { flag: 'wx' });
  }
  const temporary = await regularBytes(record.temporaryManifest, true);
  if (temporary && digest(temporary) !== record.manifestSha256) throw new Error('The recovery staging file is incomplete; inspect it without overwriting it.');
  if (!temporary) await writeFile(record.temporaryManifest, state.bytes, { flag: 'wx' });
  state = await recoveryState(root, output, record.sourceStage);
  if (!state || !state.receipt && !state.legacyRecovery || digest(state.bytes) !== record.manifestSha256 || (state.actual ? digest(state.actual) : null) !== record.modifiedManifestSha256)
    throw new Error('The Wiki changed before metadata recovery; all files were preserved.');
  await rename(record.temporaryManifest, join(output, MANIFEST));
}

/** Recovers stopped swaps or manifest-only drift; altered metadata and manual files remain available. @example await recoverWikiPublication({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function recoverWikiPublication({ projectRoot, outputDirectory, stageDirectory }) {
  const paths = await locations(projectRoot, outputDirectory, stageDirectory), { root, output, journal } = paths;
  let bytes = await regularBytes(journal, true), record, claims = [];
  if (bytes) {
    record = JSON.parse(bytes);
    if (record?.projectRoot !== root || record.output !== output || !['publish', 'restore-manifest', undefined].includes(record.operation))
      throw new Error('The Wiki publication journal does not identify this output; inspect it without moving files.');
    requireExited(record.pid);
    claims = await claimRecovery(journal, bytes);
  } else {
    const state = await recoveryState(root, output, paths.stage);
    if (!state || !state.receipt && !state.legacyRecovery) throw new Error('No retained Wiki publication is available for recovery.');
    if (state.actual && state.actual.equals(state.bytes)) return { status: 'published-current', output };
    const id = randomUUID();
    record = { projectRoot: root, output, operation: 'restore-manifest', pid: process.pid, id, manifestSha256: digest(state.bytes),
      modifiedManifestSha256: state.actual ? digest(state.actual) : null,
      modifiedManifestBackup: output + '.modified-manifest-' + id + '.json', temporaryManifest: join(output, '.codebook-restore-' + id + '.json'), sourceStage: state.legacyRecovery ? paths.stage : undefined };
    bytes = Buffer.from(JSON.stringify(record));
    await writeFile(journal, bytes, { flag: 'wx' });
  }
  let completed = false;
  try {
    if (!(await regularBytes(journal)).equals(bytes)) throw new Error('The Wiki publication journal changed during recovery.');
    let result;
    if (record.operation === 'restore-manifest') {
      if (!HASH.test(record.manifestSha256) || record.modifiedManifestSha256 !== null && !HASH.test(record.modifiedManifestSha256) ||
        typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/.test(record.id) ||
        record.modifiedManifestBackup !== output + '.modified-manifest-' + record.id + '.json' ||
        record.temporaryManifest !== join(output, '.codebook-restore-' + record.id + '.json')) throw new Error('The Wiki metadata recovery journal is invalid.');
      await restoreManifest(record, paths);
      result = { status: 'manifest-restored', output, modifiedManifestBackup: record.modifiedManifestSha256 === null ? undefined : record.modifiedManifestBackup };
    } else {
      if (typeof record.stage !== 'string' || dirname(record.stage) !== dirname(output) || record.stage === output ||
        record.backup !== undefined && (typeof record.backup !== 'string' || dirname(record.backup) !== dirname(output) || !record.backup.startsWith(output + '.previous-')))
        throw new Error('The Wiki publication journal does not identify a sibling stage/backup.');
      if (record.operation === 'publish' && (!HASH.test(record.manifestSha256) || typeof record.priorLegacy !== 'boolean' ||
        record.backup !== undefined && !HASH.test(record.priorManifestSha256)))
        throw new Error('The Wiki publication journal is missing generation identity; it was preserved.');
      const current = await inspectOutput(output, root, { allowLegacy: record.operation === undefined || record.priorLegacy === true });
      if (current) {
        if (record.operation === 'publish' && ![record.manifestSha256, record.priorManifestSha256].includes(digest(current.bytes)))
          throw new Error('The current Wiki does not match the interrupted publication.');
        if (record.operation === 'publish' && digest(current.bytes) === record.manifestSha256 && !current.receipt)
          throw new Error('The newly published Wiki is missing its publication record.');
        result = { status: 'published-or-restored', output, previousOutput: record.backup };
      } else if (record.backup) {
        const prior = await inspectOutput(record.backup, root, { allowLegacy: true });
        if (!prior || record.priorManifestSha256 && digest(prior.bytes) !== record.priorManifestSha256) throw new Error('The prior Wiki does not match the publication journal.');
        await rename(record.backup, output);
        result = { status: 'previous-restored', output };
      } else result = { status: 'no-prior-wiki', stage: record.stage };
    }
    await removeOwnedRecord(journal, bytes);
    completed = true;
    return result;
  } finally {
    // Keep stopped ancestors on failure: removing them could let a new contender skip an active descendant.
    const cleanup = completed ? claims.reverse() : claims.slice(-1);
    for (const claim of cleanup) await removeOwnedRecord(claim.path, claim.bytes);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const mode = ['--prepare', '--recover'].includes(args[0]) ? args.shift() : 'publish';
  const allowed = new Set(['--project', '--output', '--stage']);
  const flags = new Set(mode === '--prepare' ? ['--adopt-existing'] : mode === 'publish' ? ['--render-only'] : []);
  const options = {}, seen = new Set();
  let valid = true;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key)) { valid = false; break; }
    seen.add(key);
    if (flags.has(key)) options[key] = true;
    else if (allowed.has(key) && args[index + 1] && !args[index + 1].startsWith('--')) options[key] = args[++index];
    else { valid = false; break; }
  }
  if (!valid || !options['--project'] || !options['--output'] || mode === 'publish' && !options['--stage']) {
    console.error('Usage: node publish-wiki.mjs --prepare --project ROOT --output WIKI [--stage NEW_STAGE] [--adopt-existing]\n       node publish-wiki.mjs --project ROOT --output WIKI --stage STAGE [--render-only]\n       node publish-wiki.mjs --recover --project ROOT --output WIKI [--stage PREPARED_STAGE]');
    process.exitCode = 2;
  } else {
    const operation = mode === '--prepare' ? prepareWikiStage : mode === '--recover' ? recoverWikiPublication : publishWiki;
    operation({ projectRoot: options['--project'], outputDirectory: options['--output'], stageDirectory: options['--stage'], adoptExisting: options['--adopt-existing'] === true, renderOnly: options['--render-only'] === true })
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(String(error)); process.exitCode = 1; });
  }
}
