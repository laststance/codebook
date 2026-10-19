import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname, uptime } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { renderWikiPages } from './render-wiki.mjs';

const MANIFEST = 'codebook-wiki.json';
const RECEIPT = 'codebook-publication.json';
const HASH = /^[a-f0-9]{64}$/;
const reserved = path => [MANIFEST, RECEIPT].includes(path.split('/')[0].toLowerCase());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const isMissing = error => error.code === 'ENOENT';
/** The system errors of a move that passes once another process lets go of the folder or file: Windows answers them while an indexer, a virus scanner or a watcher holds it for a moment. Read by {@link renameRetried}. */
const PASSING_RENAME_ERRORS = ['EPERM', 'EBUSY'];
/** How many times {@link renameRetried} tries a move that fails with a passing error, and by how much its wait before the next try grows each time, in milliseconds: at most 2.25 seconds of waiting in all. */
const RENAME_TRIES = 10, RENAME_RETRY_STEP_MS = 50;

/** Moves a folder or file as `rename` does, and tries again, a bounded number of times with a growing wait ({@link RENAME_TRIES}), while the move fails with an error that passes once another process lets go of it ({@link PASSING_RENAME_ERRORS}); any other error, and the last passing one, is passed on at once. Called by {@link publishWiki} for the moves of the swap and the move of the prior Wiki back, and by {@link recoverWikiPublication} and {@link restoreManifest} for theirs. @throws What the last try of `rename` rejects with. @example await renameRetried('/repo/.codebook/wiki', '/repo/.codebook/wiki.previous-1') // resolves after a passing EBUSY */
async function renameRetried(from, to) {
  for (let tries = 1; ; tries++) {
    try { return await rename(from, to); }
    catch (error) {
      if (!PASSING_RENAME_ERRORS.includes(error.code) || tries >= RENAME_TRIES) throw error;
      await delay(tries * RENAME_RETRY_STEP_MS);
    }
  }
}

/** Whether bytes start with a signature, at an offset: a format's first bytes. Called by the tests of {@link RASTER_ASSET_FORMATS}. @example startsWith(Buffer.from('GIF89a'), 'GIF89a') // => true */
const startsWith = (bytes, signature, at = 0) => bytes.subarray(at, at + signature.length).equals(Buffer.from(signature, 'latin1'));

/** The brands an ISO media file names in its first box (`ftyp`): the major brand, then each compatible one, up to the box's end. Called by the AVIF test of {@link RASTER_ASSET_FORMATS}. @example brandsOf(Buffer.from('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1avif', 'latin1')) // => ['mif1', 'mif1', 'avif'] */
const brandsOf = bytes => {
  const end = Math.min(bytes.length, bytes.length >= 4 ? bytes.readUInt32BE(0) : 0), brands = [bytes.toString('latin1', 8, 12)];
  // The compatible brands follow the minor version, four bytes each.
  for (let at = 16; at + 4 <= end; at += 4) brands.push(bytes.toString('latin1', at, at + 4));
  return brands;
};

/** The formats an asset may have, by its extension in lower case, each with the test of the bytes it starts with: the raster images an article shows. Nothing else may be an asset: an HTML, SVG, script or style file would run or fetch in a page opened from disk, where no reader sends a policy. Read by {@link formatTestOf}. */
const RASTER_ASSET_FORMATS = {
  png: bytes => startsWith(bytes, '\x89PNG\r\n\x1a\n'),
  jpg: bytes => startsWith(bytes, '\xff\xd8\xff'),
  jpeg: bytes => startsWith(bytes, '\xff\xd8\xff'),
  gif: bytes => startsWith(bytes, 'GIF87a') || startsWith(bytes, 'GIF89a'),
  webp: bytes => startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8),
  avif: bytes => startsWith(bytes, 'ftyp', 4) && brandsOf(bytes).some(brand => brand === 'avif' || brand === 'avis'),
};

/** The test of the bytes an asset must start with, by its extension in lower case ({@link RASTER_ASSET_FORMATS}); one that no bytes pass for any other extension. Called by {@link requireRasterAsset}. @example formatTestOf('assets/flow.PNG')(bytes) // => true for the bytes of a PNG image */
const formatTestOf = path => {
  const extension = extname(path).slice(1).toLowerCase();
  return Object.hasOwn(RASTER_ASSET_FORMATS, extension) ? RASTER_ASSET_FORMATS[extension] : () => false;
};

/** Refuses an asset of a candidate that is no raster image ({@link RASTER_ASSET_FORMATS}) by its extension and by its first bytes, before anything is written; the asset is read as a regular file of the stage, never through a link ({@link regularBytes}). The learner's own files in the Wiki folder, which no manifest lists, are not judged. Called by {@link publishWiki} for every asset its manifest lists. @example await requireRasterAsset('/repo/.codebook/next', 'assets/notes.html') // throws: Wiki asset assets/notes.html is not a PNG, JPEG, GIF, WebP or AVIF image by its name or its first bytes. … */
async function requireRasterAsset(stage, path) {
  if (!formatTestOf(path)(await regularBytes(join(stage, path))))
    throw new Error('Wiki asset ' + path + ' is not a PNG, JPEG, GIF, WebP or AVIF image by its name or its first bytes. Nothing was written. Convert it to one of these formats, or delete the file from the stage and its entry from assets, then publish again.');
}

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

/** Whether a real path is the project root itself or lies below it. Called by {@link requireOwnFolder} and {@link enteredProjectAt}. @example isInProject('/repo', '/repo/.codebook') // => true; isInProject('/repo', '/elsewhere') // => false */
const isInProject = (root, path) => { const within = relative(root, path); return within === '' || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep); };

/** Whether the real path of an entry lies in the project; an entry whose real path the system cannot name (`EACCES` for a folder of another user, `EINVAL` for some junctions on Windows) counts as one that leaves it, so it is refused inside the project with the sentence of a link instead of the system's error. Called by {@link isOwnFolder} and {@link enteredProjectAt}. @example await isRealPathInProject('/repo/.codebook', '/repo') // => true for a folder of the project's own */
const isRealPathInProject = (path, root) => realpath(path).then(real => isInProject(root, real), () => false);

/** Looks at one entry without following it; called by {@link enteredProjectAt} and {@link requireRegularFolder}. @returns The entry's status, or undefined when nothing stands there. @example await lookAt('/repo/.codebook') // => undefined in a project without it */
const lookAt = path => lstat(path).catch(error => { if (isMissing(error)) return undefined; throw error; });

/** Whether an entry is a directory as a look without following answers it: no link and no file. Called by {@link isOwnFolder}. @example isRegularFolder(await lstat('/repo/.codebook/wiki')) // => true for a folder */
const isRegularFolder = stat => stat.isDirectory() && !stat.isSymbolicLink();

/** Whether an entry is a folder of the project's own: a directory as a look without following answers it and, where `mustStayInProject` holds, one whose real path stays in the project, so a junction on Windows to another volume, which lstat calls a directory, is none. Called by {@link requireOwnFolder} and {@link requireRegularFolder}. @example await isOwnFolder('/repo/.codebook', stat, '/repo', true) // => false while `.codebook` leads out of the project */
const isOwnFolder = async (path, stat, root, mustStayInProject) => isRegularFolder(stat) && (!mustStayInProject || await isRealPathInProject(path, root));

/** The refusal of a Wiki folder that is no folder of its own, for {@link locations}; the same sentence for a link, a file and a junction that leads out of the project. @example outputRefusalOf('/repo/.codebook/wiki') // => 'The Wiki folder /repo/.codebook/wiki is a link, a file or a folder that leads out of the project. …' */
const outputRefusalOf = path => 'The Wiki folder ' + path + ' is a link, a file or a folder that leads out of the project. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.';

/** The refusal of a stage beside the Wiki folder that is no folder of its own, for {@link locations}; its step is the stage's own. @example stageRefusalOf('/repo/.codebook/wiki.stage-1') // => 'The Wiki stage /repo/.codebook/wiki.stage-1 is a link, a file or a folder that leads out of the project. …' */
const stageRefusalOf = path => 'The Wiki stage ' + path + ' is a link, a file or a folder that leads out of the project. Nothing was written. Remove it, then prepare the Wiki again.';

/** The refusal of an output inside the project whose path passes through a folder that is no folder of the project's own, for the path it names; for {@link requireOwnFolder} and {@link holdOfPath}. @example linkedPathRefusalOf('/repo/.codebook') // => 'The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: /repo/.codebook. …' */
const linkedPathRefusalOf = path => 'The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ' + path + '. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.';

/** The refusal of the prior Wiki an interrupted publish kept beside the Wiki folder when it is no folder of its own, for {@link recoverWikiPublication}; recovery moves nothing then. @example backupRefusalOf('/repo/.codebook/wiki.previous-1') // => 'The prior Wiki kept at /repo/.codebook/wiki.previous-1 is a link, a file or a folder that leads out of the project. …' */
const backupRefusalOf = path => 'The prior Wiki kept at ' + path + ' is a link, a file or a folder that leads out of the project. Nothing was moved. Inspect it, then run --recover again.';

/** Refuses an entry on the output's path inside the project that is no folder of the project's own: a link, a file, or a folder whose real path leaves the project (a junction on Windows that lstat calls a directory). Called by {@link enteredProjectAt} for the folders above the output; the output and its stage are held to the same rule by {@link requireRegularFolder} through {@link isOwnFolder}. @example await requireOwnFolder('/repo/wiki-link', stat, '/repo') // throws while wiki-link is a link */
async function requireOwnFolder(path, stat, root) {
  if (!(await isOwnFolder(path, stat, root, true))) throw new Error(linkedPathRefusalOf(path));
}

/** Looks at one entry of the output's path, in the order {@link requireOwnFoldersToOutput} walks it: inside the project it must be a folder of the project's own ({@link requireOwnFolder}); before it, its real path says whether the project begins here. @returns Whether the path is inside the project from this entry on; undefined for a missing entry, below which nothing exists yet. @example await enteredProjectAt('/repo/.codebook', '/repo', true) // => true for a folder of the project's own */
async function enteredProjectAt(path, root, hasEntered) {
  const stat = await lookAt(path);
  if (!stat) return undefined;
  if (hasEntered) await requireOwnFolder(path, stat, root);
  return hasEntered || isRealPathInProject(path, root);
}

/** Refuses an output whose path, once it has entered the project, passes through a link or through an entry that is no folder of the project's own, before anything is created, read or written there: the stage, the journal and the backup lie beside the output, so a cloned repository that carries `.codebook` (or any folder on the way) as a link would have the publisher write outside the project. The folders up to the point where the path enters the project are the learner's choice, as is an output outside the project. Called by {@link locations} first. @returns Whether the output's folder lies inside the project, so the output itself is held to the same rule ({@link requireRegularFolder}); false when a folder on the path is missing, so no output stands there yet. @example await requireOwnFoldersToOutput('/repo/wiki-link/wiki', '/repo') // throws while /repo/wiki-link is a link; => true for /repo/.codebook/wiki */
async function requireOwnFoldersToOutput(requested, root) {
  const parent = dirname(requested);
  let path = parse(parent).root, hasEntered = false;
  for (const part of relative(path, parent).split(sep).filter(Boolean)) {
    path = join(path, part);
    hasEntered = await enteredProjectAt(path, root, hasEntered);
    // Nothing below a missing folder exists yet; the preparation creates it as a folder of the project's own.
    if (hasEntered === undefined) return false;
  }
  return hasEntered;
}


/** Refuses a Wiki folder, a stage beside it or the prior Wiki a publish kept beside it that is no folder of its own, with the sentence `refusalOf` words for it: a link, a file or a special file, and, when the output lies inside the project, a folder whose real path leaves the project (a junction on Windows to another volume, which lstat calls a directory), by the rule {@link requireOwnFolder} holds the folders above it to; a path that holds nothing yet passes. Called by {@link locations} for the output and the stage, and by {@link recoverWikiPublication} for the kept prior Wiki before it reads or moves it. @example await requireRegularFolder('/repo/.codebook/wiki', '/repo', true, outputRefusalOf) // throws while wiki is a junction to another volume */
async function requireRegularFolder(path, root, isOutputInProject, refusalOf) {
  const stat = await lookAt(path);
  if (stat && !(await isOwnFolder(path, stat, root, isOutputInProject))) throw new Error(refusalOf(path));
}

/** The folders one recursive mkdir made, deepest first: from the folder it was asked for up to the first one it created, which it answers; none when it created none. Called by {@link createParentOf} and {@link makeFolderHeld}. @example madeFoldersOf('/repo/.codebook', '/repo/.codebook/sub') // => ['/repo/.codebook/sub', '/repo/.codebook'] */
function madeFoldersOf(made, parent) {
  const folders = [];
  // From the folder asked for up to the first one made.
  for (let folder = parent; made !== undefined && folder.length >= made.length; folder = dirname(folder)) folders.push(folder);
  return folders;
}

/** Removes folders the preparation or the publish made, in the order given, each with rmdir: that removes only an empty folder and follows no link at its own name, so a folder that holds something now, or is gone, stays as it is. Called by {@link createParentOf}, {@link prepareWikiStage} and {@link makeFolderHeld} before they refuse. @example await removeMadeFolders(['/repo/.codebook/wiki.stage-1', '/repo/.codebook']) */
async function removeMadeFolders(folders) {
  for (const folder of folders) await rmdir(folder).catch(() => undefined);
}

/** Makes the output's parent, then looks at the output's path again ({@link requireOwnFoldersToOutput}): a folder that was missing at the first look, or that another process swapped for a link since, is refused there, and the folders this call made are removed. The look also says for certain whether the output lies inside the project, since no folder on the path is missing now. Called by {@link locations} for a preparation. @returns Whether the output lies inside the project, and the folders made, deepest first. @example await createParentOf('/repo/.codebook/wiki', '/repo') // => { isOutputInProject: true, madeFolders: ['/repo/.codebook'] } */
async function createParentOf(requested, root) {
  const madeFolders = madeFoldersOf(await mkdir(dirname(requested), { recursive: true }), dirname(requested));
  try { return { isOutputInProject: await requireOwnFoldersToOutput(requested, root), madeFolders }; }
  catch (error) { await removeMadeFolders(madeFolders); throw error; }
}

/** Resolves paths for {@link prepareWikiStage}, {@link publishWiki} and recovery without following directory aliases. @example await locations('/repo', '/repo/.codebook/wiki') */
async function locations(projectRoot, outputDirectory, stageDirectory, createParent = false) {
  const root = await realpath(projectRoot), requested = resolve(outputDirectory);
  // Checked before the parent is created: a missing folder behind a link would otherwise be made outside the project.
  const isInProjectBefore = await requireOwnFoldersToOutput(requested, root);
  const { isOutputInProject, madeFolders } = createParent ? await createParentOf(requested, root) : { isOutputInProject: isInProjectBefore, madeFolders: [] };
  const output = join(await realpath(dirname(requested)), basename(requested));
  const within = relative(output, root);
  // An output inside the project (the default .codebook/wiki) is accepted; only the project root itself, or a folder that contains it, is refused.
  if (!isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep)) throw new Error('The Wiki output cannot be the project root or a folder that contains it. A folder inside the project, such as .codebook/wiki, is accepted.');
  const stage = stageDirectory === undefined ? undefined : join(await realpath(dirname(resolve(stageDirectory))), basename(resolve(stageDirectory)));
  if (stage !== undefined && (dirname(stage) !== dirname(output) || stage === output)) throw new Error('The Wiki stage must be a distinct sibling of its output.');
  // The output and the stage themselves are held to the rule of the folders above them: the prior Wiki is read and the new one written there.
  await requireRegularFolder(output, root, isOutputInProject, outputRefusalOf);
  if (stage !== undefined) await requireRegularFolder(stage, root, isOutputInProject, stageRefusalOf);
  return { root, output, stage, journal: output + '.publish-journal.json', isOutputInProject, madeFolders };
}

/** Validates a captured ownership inventory used by candidate and published receipts. @example validHashes({ 'index.html': hash }) */
function validHashes(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([path, hash]) => safePath(path) && !reserved(path) && typeof hash === 'string' && HASH.test(hash));
}

/** Loads independent metadata for {@link inspectOutput} and prepared-candidate checks before a write ({@link parseReceipt}). @example await readReceipt('/wiki', '/repo') */
async function readReceipt(directory, root, optional = false) {
  const bytes = await regularBytes(join(directory, RECEIPT), optional);
  return bytes === undefined ? undefined : parseReceipt(bytes, root);
}

/** Parses and checks the bytes of a publication record, of a candidate or of a published Wiki. Called by {@link readReceipt}, and by {@link publishWiki}, which keeps the candidate's bytes to put them back after a refusal. @returns The record. @throws The refusal of an invalid record or of an invalid retained manifest. @example parseReceipt(await readFile('/repo/.codebook/next/codebook-publication.json'), '/repo') // => { schemaVersion: 1, kind: 'candidate', … } */
function parseReceipt(bytes, root) {
  let receipt;
  try { receipt = JSON.parse(bytes); } catch (cause) { throw new Error('The Wiki publication record is invalid; output was preserved.', { cause }); }
  if (!isReceiptOf(receipt, root) || !isValidBaseline(receipt.baseline)) throw new Error('The Wiki publication record is invalid; output was preserved.');
  if (!retainsItsManifest(receipt)) throw new Error('The retained Wiki manifest is invalid; output was preserved.');
  return receipt;
}

/** Whether a parsed publication record names this project, a kind of record the publisher writes and an absolute output. Called by {@link parseReceipt}. @example isReceiptOf({ schemaVersion: 1, repositoryRoot: '/repo', kind: 'candidate', output: '/repo/.codebook/wiki' }, '/repo') // => true */
const isReceiptOf = (receipt, root) => receipt?.schemaVersion === 1 && receipt.repositoryRoot === root && ['candidate', 'published'].includes(receipt.kind) &&
  typeof receipt.output === 'string' && isAbsolute(receipt.output);

/** Whether a publication record's baseline is none, for a new output, or a whole capture of the generation it replaces: the manifest's text with its SHA-256 digest, the digests of the owned files, and whether it was adopted as legacy. Called by {@link parseReceipt}. @example isValidBaseline(null) // => true */
const isValidBaseline = baseline => baseline === null || Boolean(baseline) && HASH.test(baseline.manifestSha256) && typeof baseline.manifestText === 'string' &&
  digest(baseline.manifestText) === baseline.manifestSha256 && validHashes(baseline.ownedFiles) && typeof baseline.legacy === 'boolean';

/** Whether a published record retains its manifest's text with that text's SHA-256 digest; a candidate's record retains none. Called by {@link parseReceipt}. @example retainsItsManifest({ kind: 'candidate' }) // => true */
const retainsItsManifest = receipt => receipt.kind !== 'published' || typeof receipt.manifestText === 'string' && HASH.test(receipt.manifestSha256) && digest(receipt.manifestText) === receipt.manifestSha256;

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

/** Whether the output's parent, and the entries beside the output given with it, still lie where the paths were resolved: their real paths inside the project, and the parent still the folder, by device and inode, it was then. Both are compared as bigints: an NTFS file id may lie above 2^53, where two JavaScript numbers of different ids are equal. A folder that cannot be looked at counts as moved. Called by {@link holdOfPath}. @example await isWhereItWasResolved('/repo/.codebook', parentIdentity, ['/repo/.codebook/wiki.stage-1'], '/repo') // => false once .codebook was swapped for a link */
const isWhereItWasResolved = (parent, identity, entries, root) => Promise.all([stat(parent, { bigint: true }), ...[parent, ...entries].map(path => realpath(path))]).then(
  ([now, ...realPaths]) => realPaths.every(real => isInProject(root, real)) && now.dev === identity.dev && now.ino === identity.ino,
  () => false);

/** A refusal of a step whose path no longer holds, marked so that the preparation and the recovery remove what they wrote ({@link removeWritten}); a publish removes what it wrote for every refusal before its swap. Called by {@link holdOfPath}, {@link makeFolderHeld} and {@link restoreManifestHeld}. @example throw holdRefusalOf(linkedPathRefusalOf('/repo/.codebook')) */
const holdRefusalOf = sentence => Object.assign(new Error(sentence), { isHoldRefusal: true });

/** Takes the look at the output's parent once the paths are resolved, for a preparation, a publish or a recovery, and answers the check that holds every later write to it: for an output inside the project, the parent and `entries` must still be where they were ({@link isWhereItWasResolved}), or the step is refused with the parent's sentence. The race left: between a check and the write or move after it, such a swap can still lead the write elsewhere; Node's file system has no call that writes relative to a folder it holds open, so no check closes that window. Called by {@link prepareWikiStage}, {@link publishWiki} and {@link recoverWikiPublication}. @returns The check, which resolves when the path still holds and throws otherwise. @example const requirePathHeld = await holdOfPath(paths, [paths.stage]); await requirePathHeld() // throws once .codebook was swapped for a link */
async function holdOfPath(paths, entries) {
  const parent = dirname(paths.output), identity = await stat(parent, { bigint: true });
  return async () => {
    if (!paths.isOutputInProject || await isWhereItWasResolved(parent, identity, entries, paths.root)) return;
    throw holdRefusalOf(linkedPathRefusalOf(parent));
  };
}

/** Whether a status and another status or the record of a written file ({@link writeOwnFile}), all with bigint ids, are of one file: the same device and file id. Called by {@link folderLookOf}, {@link isSameFileAt} and {@link isSameFileId}. @example isSameFile(await stat(a, { bigint: true }), await stat(a, { bigint: true })) // => true */
const isSameFile = (status, other) => status.dev === other.dev && status.ino === other.ino;

/** Takes the look a publish holds each folder of its stage to before it writes into it: the folder's real path must be the stage's real path with the folder's place in it, so no link stands on the way inside the stage, and its device and file id must stay those it had when the publish first wrote there. Called by {@link publishWiki} and {@link prepareWikiStage} for the candidate, and by {@link restoreManifestHeld} for the Wiki folder, once each. @returns The look, which answers whether a folder still holds; a folder that cannot be looked at does not, nor does any folder of a stage whose real path could not be named when the look was taken. @example const isFolderWhereItWas = await folderLookOf('/repo/.codebook/next'); await isFolderWhereItWas('/repo/.codebook/next/pages') // => false once pages was swapped for a link */
async function folderLookOf(stage) {
  const realStage = await realpath(stage).catch(() => undefined), firstSeen = new Map();
  return folder => Promise.all([realpath(folder), stat(folder, { bigint: true })]).then(([real, status]) => {
    if (!firstSeen.has(folder)) firstSeen.set(folder, status);
    // A stage whose real path could not be named when the look was taken has nothing to compare with, so no folder of it holds.
    return realStage !== undefined && real === join(realStage, relative(stage, folder)) && isSameFile(status, firstSeen.get(folder));
  }, () => false);
}

/** Makes a folder of the stage, then holds the output's path ({@link holdOfPath}) and the folder itself ({@link folderLookOf}) before anything is written into it; a refusal removes the folders this mkdir made ({@link removeMadeFolders}). Called by {@link publishWiki} for the folder of each page and of each kept manual file, before and after its write, and for the stage before its manifest, its record and the moves, and by {@link writeFilesHeld} for each file of a new candidate, before and after its write. @returns The folders this mkdir made, deepest first. @example await makeFolderHeld('/repo/.codebook/next/pages', requirePathHeld, isFolderWhereItWas) // => ['/repo/.codebook/next/pages'] */
async function makeFolderHeld(folder, requirePathHeld, isFolderWhereItWas) {
  const madeFolders = madeFoldersOf(await mkdir(folder, { recursive: true }), folder);
  try {
    await requirePathHeld();
    if (!(await isFolderWhereItWas(folder))) throw holdRefusalOf(stageRefusalOf(folder));
  } catch (error) { await removeMadeFolders(madeFolders); throw error; }
  return madeFolders;
}

/** Whether the entry at a written file's path, looked at without following it, is a regular file with the device and file id the record names ({@link writeOwnFile}). Called by {@link removeWritten} and {@link writeOwnFile}. @example await isSameFileAt({ path: '/repo/.codebook/next/index.html', dev: 2049n, ino: 131074n }) // => false once a link stands at the path */
const isSameFileAt = file => lstat(file.path, { bigint: true }).then(status => status.isFile() && isSameFile(status, file), () => false);

/** Writes a new file a step records as its own through one handle, and answers what {@link removeWritten} needs to tell that file from any other at its path: the SHA-256 digest of the bytes, and the device and file id of the file the handle wrote, as bigints (an NTFS file id may lie above 2^53). The open is exclusive ('wx'): it refuses any entry at the name, a link or a second name of another file included, so the write never lands in a file the step did not make. Once another process swaps a folder on the path for a link, the path leads to another file, maybe a published file of the same name and bytes, whose identity this is not. A write that fails answers nothing, and neither does a close that fails, since the bytes it handed on may be lost (a full disk or a quota met at the close on a network or synced file system); the file the open made holds part of the bytes at most then, and is removed ({@link removeUnwrittenFile}) before the failure is passed on, so no partial copy is left that no record names (a full disk, a file size limit). A status read that fails leaves nothing that tells the file the open made from a file another process put at its name since, so the path is kept, and the refusal names it for the learner to judge ({@link unreadStatusRefusalOf}). Called by {@link writeFilesHeld}, {@link replaceOwnFile}, {@link replaceOwnFileThrough} and {@link restoreManifestHeld}, and by {@link publishWiki} for each copy of a learner's file. @returns The file's record: its path, the digest of its bytes, and its `dev` and `ino`. @throws What the open, the write or the close rejects with, the first of them; `EEXIST` while an entry stands at the name; for a status read that fails, the refusal that names the kept file, with that failure as its cause. @example await writeOwnFile('/repo/.codebook/next/codebook-publication.json', receiptText) // => { path: '/repo/.codebook/next/codebook-publication.json', hash: '…', dev: 2049n, ino: 131074n } */
async function writeOwnFile(path, bytes) {
  const handle = await open(path, 'wx');
  let file, failure, hasFailed = false;
  try {
    const { dev, ino } = await handle.stat({ bigint: true });
    file = { path, hash: digest(bytes), dev, ino };
    await handle.writeFile(bytes);
  } catch (error) { failure = error; hasFailed = true; }
  // A close that fails may lose bytes the write handed on, so the file counts as not written; the first failure is the one passed on.
  await handle.close().catch(error => { if (!hasFailed) { failure = error; hasFailed = true; } });
  if (!hasFailed) return file;
  // Without the status of the file the open made, the file at the path cannot be proved its own: it is kept and named.
  if (file === undefined) throw new Error(unreadStatusRefusalOf(path, failure), { cause: failure });
  await removeUnwrittenFile(file);
  throw failure;
}

/** The refusal of a write whose status read failed right after its exclusive open made the file ({@link writeOwnFile}): it names the file, which it kept, and the failure. Called by {@link writeOwnFile}. @example unreadStatusRefusalOf('/repo/.codebook/next/manual.txt', eioError) // => 'The publisher made /repo/.codebook/next/manual.txt but could not read its status: EIO: i/o error. The file there may be another one now, so it was kept. …' */
const unreadStatusRefusalOf = (path, failure) => 'The publisher made ' + path + ' but could not read its status: ' + failure.message + '. The file there may be another one now, so it was kept. Delete it if it holds nothing of yours, then try again.';

/** Removes the file a failed {@link writeOwnFile} made, which holds part of the bytes at most: the path may lead to another file by now, so it is removed only while it is that file, by its device and file id ({@link isSameFileAt}), and no byte of another file is lost. Called by {@link writeOwnFile} once the write or the close failed. @param file - The record of the file the open made. @example await removeUnwrittenFile({ path: '/repo/.codebook/next/manual.txt', hash: '…', dev: 2049n, ino: 131074n }) */
async function removeUnwrittenFile(file) {
  if (await isSameFileAt(file)) await unlink(file.path).catch(() => undefined);
}

/** Writes a file of the candidate in place of the entry that stands at its name, without following that entry: the entry is removed first, which removes a link itself or one name of a file with several, never what it leads to, then the file is written new ({@link writeOwnFile}), whose exclusive open refuses an entry put there in between. A link put at the name of a rendered page after the publisher listed the candidate therefore leads no write out of the candidate; a stop between the removal and the write leaves the page missing or partial, which the next render writes again. Called by {@link publishWiki} for the rendered pages. @returns The new file's record ({@link writeOwnFile}). @throws What the removal rejects with, other than a missing entry (a folder at the name), and what {@link writeOwnFile} throws. @example await replaceOwnFile('/repo/.codebook/next/index.html', html) // => { path: '/repo/.codebook/next/index.html', hash: '…', dev: 2049n, ino: 131075n } */
async function replaceOwnFile(path, bytes) {
  await unlink(path).catch(error => { if (!isMissing(error)) throw error; });
  return writeOwnFile(path, bytes);
}

/** The file beside a candidate's manifest or record through which a publish puts the finalized one, or the prepared one again, in place ({@link replaceOwnFileThrough}), and through which it puts its journal in place again ({@link JOURNAL_UPDATE}); it carries the id of the publish's journal, so the recovery of a stopped publish knows it ({@link restoreStoppedCandidate}). @example finalizingPathOf('/repo/.codebook/next', '6f1c…', 'codebook-wiki.json') // => '/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json' */
const finalizingPathOf = (stage, id, name) => join(stage, '.codebook-publish-' + id + '-' + name);

/** The name, after the journal's id ({@link finalizingPathOf}), of the file in the candidate through which a publish puts its journal in place again each time it names one more copy of a learner's file ({@link journalOfCopiesOf}); a stop before the move leaves the file for the recovery to remove ({@link removeFinalizingFiles}). */
const JOURNAL_UPDATE = 'publish-journal.json';

/** Writes a candidate's manifest or record in place of the entry at its name through a new file beside it ({@link writeOwnFile}), which a move then puts at the name ({@link renameRetried}): the move replaces the entry itself, a link or one name of a file with several, never what it leads to, so a link put at the name after the publisher read it leads no write out of the candidate; and a stop of the publish leaves the name with the bytes it had or with the new ones, never without them. A failed move removes the file beside it while it is the one written; a stop before the move leaves it for the recovery ({@link restoreStoppedCandidate}). Called by {@link publishWiki}, {@link restoreFinalized} and {@link restoreStoppedCandidate}. @returns The record of the file now at the name ({@link writeOwnFile}). @throws What {@link writeOwnFile} or the last move rejects with. @example await replaceOwnFileThrough('/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json', '/repo/.codebook/next/codebook-wiki.json', manifestText) // => { path: '/repo/.codebook/next/codebook-wiki.json', hash: '…', dev: 2049n, ino: 131076n } */
async function replaceOwnFileThrough(temporary, path, bytes) {
  const file = await writeOwnFile(temporary, bytes);
  try { await renameRetried(temporary, path); }
  catch (error) { if (await isSameFileAt(file)) await unlink(temporary).catch(() => undefined); throw error; }
  return { ...file, path };
}

/** Whether a file a step wrote is still its own: its path names the file the step wrote, by its device and file id ({@link isSameFileAt}), and that file still holds the step's bytes, by their SHA-256 digest. Called by {@link removeWritten} and {@link restoreFinalized}. @example await isStillWritten(await writeOwnFile('/repo/.codebook/next/index.html', html)) // => true until the file is edited, removed or a link stands on its path */
async function isStillWritten(file) {
  if (!(await isSameFileAt(file))) return false;
  const current = await regularBytes(file.path, true).catch(() => undefined);
  return current !== undefined && digest(current) === file.hash;
}

/** Puts back the bytes a candidate's manifest or record had before a refused publish finalized it: the publish's own file at the path ({@link isStillWritten}) takes the prepared bytes again, through the file beside it ({@link replaceOwnFileThrough}), as does a name another writer emptied; an entry another writer put there stays. Called by {@link restoreFinalizedFiles} for every refusal of {@link publishWiki} before its swap, while the path and the candidate hold. @param finalized - The path, the file beside it, the bytes it had as prepared, and the record of the file the publish put there, absent while that did not end. @example await restoreFinalized({ path: '/repo/.codebook/next/codebook-wiki.json', temporary: '/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json', prepared: manifestBytes, file }) */
async function restoreFinalized({ path, temporary, prepared, file }) {
  if (await lookAt(path) === undefined || file !== undefined && await isStillWritten(file)) await replaceOwnFileThrough(temporary, path, prepared);
}

/** Removes the files a refused step wrote that are still its own, last written first, then the folders it made, each empty ({@link removeMadeFolders}). A file is the step's own while its path names the file the step wrote, by its device and file id ({@link writeOwnFile}), and that file still holds the step's bytes, by their SHA-256 digest; a file whose bytes were edited since, that is gone, or that a link on its path now leads to in its place, such as a published file of the same name and bytes, stays as it is. Digests keep rollback evidence bounded per file without retaining image Buffers. Called by {@link writeFilesHeld} and {@link restoreManifestHeld} when a hold refuses, by {@link prepareWikiStage} for a refusal after the candidate's files are written, and by {@link publishWiki} for every refusal before its swap. @example await removeWritten([await writeOwnFile('/repo/.codebook/next/codebook-publication.json', receiptText)], ['/repo/.codebook/next']) */
async function removeWritten(written, folders) {
  for (const file of [...written].reverse()) {
    // Only the file the step wrote, with its bytes: through a folder swapped for a link, the path names another file.
    if (await isStillWritten(file)) await unlink(file.path).catch(() => undefined);
  }
  await removeMadeFolders(folders);
}

/** Writes the files of a step, each new, with the hold of its folder before and after it ({@link makeFolderHeld}); a refused hold removes what the step wrote that is still its own and the folders it made, with `madeBefore` after them ({@link removeWritten}). An asset read failure rolls back completed writes too, but keeps the initial empty stage as preparation did before lazy reads. Ordinary write errors keep the files written before them; the failed write's own partial file is removed ({@link writeOwnFile}). Called by {@link prepareWikiStage} for a new candidate's files. @returns The records of the files written ({@link writeOwnFile}) and the folders made, deepest first, which a later refusal of the step removes ({@link removeWritten}). @example await writeFilesHeld([['/repo/.codebook/next/codebook-publication.json', receiptText]], requirePathHeld, isFolderWhereItWas, ['/repo/.codebook/next']) */
async function writeFilesHeld(files, requirePathHeld, isFolderWhereItWas, madeBefore) {
  const written = [], made = [];
  try {
    for await (const [path, bytes] of files) {
      made.unshift(...(await makeFolderHeld(dirname(path), requirePathHeld, isFolderWhereItWas)));
      written.push(await writeOwnFile(path, bytes));
      // Held after the write too, so a swap during it is seen before the next file.
      await makeFolderHeld(dirname(path), requirePathHeld, isFolderWhereItWas);
    }
  } catch (error) {
    if (error.isHoldRefusal) await removeWritten(written, [...made, ...madeBefore]);
    else if (error.isCandidateReadFailure) await removeWritten(written, made);
    throw error;
  }
  return { written, made };
}

/** Yields the files a new candidate starts with: its receipt, then the prior Wiki's manifest and assets. Each asset is read as a regular file ({@link regularBytes}) only when {@link writeFilesHeld} asks for the next file, after writing the previous one. Called by {@link prepareWikiStage}; no complete asset inventory of Buffers is kept. @example for await (const [path, bytes] of candidateFilesOf('/repo/.codebook/next', receipt, undefined, '/repo/.codebook/wiki')) console.log(path, bytes.length); */
async function* candidateFilesOf(stage, receipt, prior, output) {
  yield [join(stage, RECEIPT), JSON.stringify(receipt)];
  if (!prior) return;
  yield [join(stage, MANIFEST), prior.bytes];
  // Read one image per completed guarded write; earlier image bytes can be released.
  for (const path of prior.manifest.assets) {
    let bytes;
    try { bytes = await regularBytes(join(output, path)); }
    catch (error) { throw Object.assign(error, { isCandidateReadFailure: true }); }
    yield [join(stage, path), bytes];
  }
}

/** Handles the CLI preparation step before agent edits, retaining current output and an exact recovery baseline. @example await prepareWikiStage({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function prepareWikiStage({ projectRoot, outputDirectory, stageDirectory, adoptExisting = false }) {
  const paths = await locations(projectRoot, outputDirectory, stageDirectory, true);
  const { root, output, journal } = paths, stage = paths.stage ?? output + '.stage-' + randomUUID();
  // The look at the folder the paths were resolved in, taken now, so a swap on the path before the stage is written is seen ({@link holdOfPath}).
  const requirePathHeld = await holdOfPath(paths, [stage]);
  await requireNoJournal(journal);
  const prior = await inspectOutput(output, root, { allowLegacy: adoptExisting });
  await mkdir(stage); // An existing candidate is never overwritten or silently reused.
  // A stage that no longer lies where it was made is refused before anything is written into it, and it and the folders the preparation made are removed, each empty.
  try { await requirePathHeld(); } catch (error) { await removeMadeFolders([stage, ...paths.madeFolders]); throw error; }
  const receipt = { schemaVersion: 1, kind: 'candidate', repositoryRoot: root, output, baseline: baselineOf(prior) };
  // Every file of the candidate is written only while the path and the candidate's folders hold; a refusal removes what was written.
  const { written, made } = await writeFilesHeld(candidateFilesOf(stage, receipt, prior, output), requirePathHeld, await folderLookOf(stage), [stage, ...paths.madeFolders]);
  try {
    await requireNoJournal(journal);
    assertBaseline(receipt.baseline, await inspectOutput(output, root, { allowLegacy: adoptExisting }));
  } catch (error) {
    // A publish that began, or a Wiki that changed, after the candidate was written refuses it: what the preparation wrote and the folders it made are removed, each still its own, so the next preparation into the same folder is not refused for it.
    await removeWritten(written, [...made, stage, ...paths.madeFolders]);
    throw error;
  }
  return { stage, manifest: join(stage, MANIFEST), output, legacyAdopted: Boolean(prior && !prior.receipt) };
}

/** Removes only the journal/claim bytes owned by the completing operation. @example await removeOwnedRecord(path, bytes) */
async function removeOwnedRecord(path, bytes) {
  const current = await regularBytes(path, true);
  if (!current || !current.equals(Buffer.from(bytes))) throw new Error('Publication ownership changed; the recovery record was preserved: ' + path);
  await unlink(path);
}

/** Reads a candidate's manifest and refuses a candidate that holds a file its manifest does not list, named so the step that removes it is clear, or an asset that is no raster image, before anything is rendered or written. Called by {@link publishWiki}. @returns The manifest's bytes, the manifest and the paths it owns. @throws The refusal of the stray file or of the asset. @example await readCandidateManifest('/repo/.codebook/next', '/repo') // => { bytes, manifest, owned } */
async function readCandidateManifest(stage, root) {
  const bytes = await regularBytes(join(stage, MANIFEST)), { manifest, owned } = parseManifest(bytes, root);
  const files = await listFiles(stage);
  // A file of the stage the manifest does not list is named, so the step that removes it is clear.
  const stray = files.find(path => ![MANIFEST, RECEIPT].includes(path) && !owned.has(path));
  if (stray !== undefined) throw new Error('The staged Wiki contains a file outside its published manifest: ' + stray + ". Nothing was written. Delete it from the stage, or list it among the manifest's pages or assets, then publish again.");
  // An asset is a raster image or nothing; checked before anything is rendered or written.
  for (const path of manifest.assets) await requireRasterAsset(stage, path);
  return { bytes, manifest, owned };
}

/** Reads a candidate's record ({@link parseReceipt}) and refuses a candidate that was not prepared for this output, or a finalized one whose manifest changed. Called by {@link publishWiki} after the pages are rendered. @returns The record's bytes, kept to put them back after a refusal, and the record. @throws The refusal of an unprepared or changed candidate. @example await readCandidateRecord('/repo/.codebook/next', '/repo', '/repo/.codebook/wiki', manifestBytes) // => { receiptBytes, receipt } */
async function readCandidateRecord(stage, root, output, bytes) {
  const receiptBytes = await regularBytes(join(stage, RECEIPT), true), receipt = receiptBytes === undefined ? undefined : parseReceipt(receiptBytes, root);
  if (!receipt || receipt.output !== output) throw new Error('Use --prepare before editing a Wiki candidate for this output.');
  if (receipt.kind === 'published' && digest(bytes) !== receipt.manifestSha256) throw new Error('A previously finalized candidate changed. Preserve it and use --prepare again.');
  return { receiptBytes, receipt };
}

/** The held write of a publish into its candidate: the folder of the file is made and held before the write ({@link makeFolderHeld}), and held after it too, as the preparation's writes are, so a swap during the last page write is seen before a preview returns, and one of a page's own folder before the publish goes on. Each file is recorded in `written`, each folder made in `made`, for {@link removeWritten}. Called by {@link publishWiki}. @returns The write, given a path, its bytes, and the writer: {@link replaceOwnFile} for a page, which takes the place of the entry at its name, or {@link writeOwnFile} for a copy of a learner's file, which is new. @example await heldWriterOf(requirePathHeld, isFolderWhereItWas, written, made)('/repo/.codebook/next/index.html', html, replaceOwnFile) */
function heldWriterOf(requirePathHeld, isFolderWhereItWas, written, made) {
  return async (path, content, write) => {
    made.unshift(...(await makeFolderHeld(dirname(path), requirePathHeld, isFolderWhereItWas)));
    written.push(await write(path, content));
    await makeFolderHeld(dirname(path), requirePathHeld, isFolderWhereItWas);
  };
}

/** Writes the rendered pages into the candidate, each held ({@link heldWriterOf}); a refusal removes the pages written that are still the publish's own and the folders it made ({@link removeWritten}). Called by {@link publishWiki}, for a preview as for a publish. @example await writePagesHeld(rendered, '/repo/.codebook/next', writeHeld, written, made) */
async function writePagesHeld(rendered, stage, writeHeld, written, made) {
  try { for (const [path, html] of rendered) await writeHeld(join(stage, path), html, replaceOwnFile); }
  catch (error) { await removeWritten(written, made); throw error; }
}

/** The text of a candidate's finalized manifest: the manifest with the SHA-256 digest of each owned file of the candidate, which the manifest takes as its `ownedFiles`. Called by {@link publishWiki}. @example await finalizedManifestTextOf(manifest, owned, '/repo/.codebook/next') // => '{\n  "schemaVersion": 1, …' */
async function finalizedManifestTextOf(manifest, owned, stage) {
  const ownedFiles = Object.create(null);
  for (const path of owned) ownedFiles[path] = digest(await regularBytes(join(stage, path)));
  manifest.ownedFiles = ownedFiles;
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** The journal of a publish, with the backup name of the prior Wiki and the text of the candidate's finalized record. The journal keeps the candidate's prepared manifest and record, so the recovery of a publish stopped after it finalized them puts them back ({@link restoreStoppedCandidate}), names its owner as `system` tells it ({@link ownerHere}), and names in `learnerCopies` each learner's file whose copy into the candidate began, none yet ({@link journalOfCopiesOf}). Called by {@link publishWiki} before it writes the journal. @returns The journal's record, the backup's path (none without a prior Wiki) and the finalized record's text. @example await publishJournalOf(paths, prior, receipt, manifestText, manifestBytes, receiptBytes, SYSTEM_HERE) // => { record: { projectRoot: '/repo', …, operation: 'publish', …, learnerCopies: [] }, backup: '/repo/.codebook/wiki.previous-…', finalizedReceiptText: '{…}' } */
async function publishJournalOf({ root, output, stage }, prior, receipt, manifestText, bytes, receiptBytes, system) {
  const backup = prior ? output + '.previous-' + randomUUID() : undefined;
  const manifestSha256 = digest(manifestText), finalizedReceiptText = JSON.stringify({ ...receipt, kind: 'published', manifestSha256, manifestText });
  const record = { projectRoot: root, output, stage, backup, pid: process.pid, owner: await ownerHere(system), id: randomUUID(), operation: 'publish', manifestSha256, priorManifestSha256: prior ? digest(prior.bytes) : undefined, priorLegacy: receipt.baseline?.legacy === true,
    finalizedReceiptSha256: digest(finalizedReceiptText), prepared: { manifest: bytes.toString('base64'), receipt: receiptBytes.toString('base64') }, learnerCopies: [] };
  return { record, backup, finalizedReceiptText };
}

/** The journal of a publish as it names each copy of a learner's file into the candidate before the copy begins ({@link copyLearnerFiles}): the path joins the journal's `learnerCopies`, and the journal takes its place again through a file in the candidate ({@link JOURNAL_UPDATE}, {@link replaceOwnFileThrough}), once the output's path and the candidate hold ({@link makeFolderHeld}). A stop at any point leaves a whole journal that names every copy that began, so the recovery removes only what such a copy left ({@link learnerCopiesIn}). Called by {@link publishWiki} for the journal it wrote. @returns The journal's bytes as they stand now, by which the publish removes the journal ({@link removeOwnedRecord}), and `recordCopyBegun`, which names one more copy. @throws What {@link makeFolderHeld} or {@link replaceOwnFileThrough} throws; the journal keeps its bytes then. @example const journalNow = journalOfCopiesOf(record, '/repo/.codebook/wiki.publish-journal.json', '/repo/.codebook/next', requirePathHeld, isFolderWhereItWas); await journalNow.recordCopyBegun('manual.txt'); journalNow.bytes // => '{"projectRoot":"/repo",…,"learnerCopies":["manual.txt"]}' */
function journalOfCopiesOf(record, journal, stage, requirePathHeld, isFolderWhereItWas) {
  const journalNow = { bytes: JSON.stringify(record) };
  journalNow.recordCopyBegun = async path => {
    const bytes = JSON.stringify({ ...record, learnerCopies: [...record.learnerCopies, path] });
    await makeFolderHeld(stage, requirePathHeld, isFolderWhereItWas);
    await replaceOwnFileThrough(finalizingPathOf(stage, record.id, JOURNAL_UPDATE), journal, bytes);
    record.learnerCopies.push(path);
    journalNow.bytes = bytes;
  };
  return journalNow;
}

/** The finalizing write of a candidate's manifest or record: each entry, the path with the file beside it ({@link finalizingPathOf}) and the bytes it had as prepared, is recorded in `finalized` before the write ({@link replaceOwnFileThrough}), so every refusal before the swap puts the prepared bytes back ({@link restoreFinalized}) and a refused publish leaves no finalized candidate that refuses the learner's next edit. Called by {@link publishWiki}. @returns The write, given the name, the finalized text and the prepared bytes. @example await finalizerOf('/repo/.codebook/next', journalId, finalized)('codebook-wiki.json', manifestText, manifestBytes) */
function finalizerOf(stage, id, finalized) {
  return async (name, text, prepared) => {
    const entry = { path: join(stage, name), temporary: finalizingPathOf(stage, id, name), prepared };
    finalized.push(entry);
    entry.file = await replaceOwnFileThrough(entry.temporary, entry.path, text);
  };
}

/** The learner's files of a Wiki: its files that its manifest does not list, other than its manifest and its record; none without a Wiki. Called by {@link publishWiki}, {@link requireLearnerFilesUnchanged} and {@link learnerCopiesIn}. @example learnerFilesOf(wiki) // => ['manual.txt'] */
const learnerFilesOf = wiki => wiki ? wiki.files.filter(path => ![MANIFEST, RECEIPT].includes(path) && !wiki.owned.has(path)) : [];

/** Copies the learner's files of the prior Wiki into the candidate, each held and new ({@link heldWriterOf}, {@link writeOwnFile}), after refusing one that stands where the update has an owned file or folder; the journal names each copy before it begins (`recordCopyBegun`, {@link journalOfCopiesOf}). Called by {@link publishWiki}. @returns The SHA-256 digest of each copy's bytes, by path, for {@link requireLearnerFilesUnchanged}. @throws The refusal of a conflicting file. @example await copyLearnerFiles(['manual.txt'], owned, '/repo/.codebook/wiki', '/repo/.codebook/next', writeHeld, journalNow.recordCopyBegun) // => { 'manual.txt': '…' } */
async function copyLearnerFiles(manual, owned, output, stage, writeHeld, recordCopyBegun) {
  const manualHashes = Object.create(null);
  for (const path of manual) {
    if ([...owned].some(ownedPath => ownedPath === path || ownedPath.startsWith(path + '/') || path.startsWith(ownedPath + '/')))
      throw new Error('A manual Wiki file conflicts with the update: ' + path);
    const content = await regularBytes(join(output, path));
    manualHashes[path] = digest(content);
    // The journal names the copy before its file exists, so the recovery tells a part it left from a file the learner put there.
    await recordCopyBegun(path);
    await writeHeld(join(stage, path), content, writeOwnFile);
  }
  return manualHashes;
}

/** Refuses a publish whose learner's files changed while it copied them: another number of them, or one whose bytes differ from its copy. Called by {@link publishWiki} at its recheck before the swap. @throws The refusal of the change. @example await requireLearnerFilesUnchanged(current, ['manual.txt'], manualHashes, '/repo/.codebook/wiki') */
async function requireLearnerFilesUnchanged(current, manual, manualHashes, output) {
  const currentManual = learnerFilesOf(current);
  if (currentManual.length !== manual.length) throw new Error('Manual Wiki files changed during publication; output was preserved.');
  for (const path of currentManual) if (manualHashes[path] !== digest(await regularBytes(join(output, path)))) throw new Error('A manual Wiki file changed during publication: ' + path);
}

/** Undoes a publish refused before its swap. The prior Wiki goes back first, so the time without a Wiki folder does not grow with what the publish wrote into the candidate. The candidate is not moved before the swap, so what this publish wrote still stands where it wrote it; a refusal of any kind removes it ({@link removeWritten}). The candidate's prepared manifest and record are put back ({@link restoreFinalizedFiles}) only while the path and the candidate hold; a refused hold leaves the finalized ones, which publish again unchanged, and the publish's own refusal is the one reported. Called by {@link publishWiki}. @param refusal - The publish's own refusal, which the undo answers. @returns The failure of the undo, either of which keeps the journal for --recover: that of a move back that failed, or else of a restore that failed, with the publish's own refusal kept in its message and its cause ({@link undoFailureOf}); undefined otherwise. @example await undoRefusedPublish({ output, stage, backup, movedOld: true, written, made, finalized, requirePathHeld, isFolderWhereItWas, refusal }) // => undefined */
async function undoRefusedPublish({ output, stage, backup, movedOld, written, made, finalized, requirePathHeld, isFolderWhereItWas, refusal }) {
  const moveBackFailure = movedOld ? await renameRetried(backup, output).then(() => undefined, cause => new Error('Publication failed; the prior Wiki remains at ' + backup + '. Run --recover.', { cause })) : undefined;
  await removeWritten(written, made);
  const restoreFailure = finalized.length > 0 && await requirePathHeld().then(() => isFolderWhereItWas(stage), () => false) ? await restoreFinalizedFiles(finalized, stage) : undefined;
  return undoFailureOf(refusal, moveBackFailure ?? restoreFailure);
}

/** The failure of the undo of a refused publish ({@link undoRefusedPublish}) as the publish answers it: the undo's sentence, which says what --recover must do, then the publish's own refusal, which started the undo; its cause holds both, the refusal first and then the undo's failure with its own cause. Called by {@link undoRefusedPublish}. @returns The answer; undefined when the undo did not fail. @example undoFailureOf(exdevError, moveBackFailure).message // => "Publication failed; the prior Wiki remains at /repo/.codebook/wiki.previous-…. Run --recover. The publish was refused first: EXDEV: cross-device link not permitted, rename …" */
const undoFailureOf = (refusal, failure) => failure && new Error(failure.message + ' The publish was refused first: ' + refusal.message, { cause: new AggregateError([refusal, failure], 'The publish’s refusal, then the failure of its undo') });

/** Puts the prepared bytes back in each candidate file a refused publish finalized ({@link restoreFinalized}), each tried whatever became of the one before. A restore that fails leaves the candidate's manifest and record a pair that may not publish again: the prepared manifest beside a record marked published for the finalized one, which the next publish refuses as a changed finalized candidate. So the failure is answered, and the publish keeps its journal, which still holds the prepared bytes, for --recover to put them back ({@link restoreStoppedCandidate}). Called by {@link undoRefusedPublish} while the path and the candidate hold. @returns The refusal that names the candidate and the first failure, with that failure as its cause; undefined when every file was put back. @example await restoreFinalizedFiles(finalized, '/repo/.codebook/next') // => undefined */
async function restoreFinalizedFiles(finalized, stage) {
  let failure;
  for (const entry of finalized) await restoreFinalized(entry).catch(error => { failure ??= error; });
  return failure === undefined ? undefined : new Error('Publication failed; the candidate’s prepared manifest and record could not be put back in ' + stage + ': ' + failure.message + '. Run --recover.', { cause: failure });
}

/** Publishes a prepared candidate while retaining exact prior metadata, generated files and manual files. @param options.system - The system whose process and boot the journal records of its owner ({@link SYSTEM_HERE}, which the CLI passes). @example await publishWiki({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki', stageDirectory: '/repo/.codebook/wiki.stage' }) */
export async function publishWiki({ projectRoot, outputDirectory, stageDirectory, renderOnly = false, system = SYSTEM_HERE }) {
  // The read of the owner the journal names (PowerShell on Windows, sysctl and ps on macOS) starts now and runs beside the rendering; a preview writes no journal and asks nothing.
  if (!renderOnly) ownerHere(system);
  const paths = await locations(projectRoot, outputDirectory, stageDirectory), { root, output, stage, journal } = paths;
  if (!stage) throw new Error('The Wiki publisher requires a prepared stage.');
  // Every write below is held to the look the paths were resolved with.
  const requirePathHeld = await holdOfPath(paths, [stage]), isFolderWhereItWas = await folderLookOf(stage);
  await requireNoJournal(journal);
  const { bytes, manifest, owned } = await readCandidateManifest(stage, root);
  // Validate authored content without modifying either the stage or published output.
  const rendered = await renderWikiPages(manifest, { projectRoot: root, outputDirectory: output });
  const { receiptBytes, receipt } = await readCandidateRecord(stage, root, output, bytes);
  const inspectPrior = () => inspectOutput(output, root, { allowLegacy: receipt.baseline?.legacy === true });
  let prior = await inspectPrior();
  assertBaseline(receipt.baseline, prior);
  // The pages and the learner's files this publish wrote into the candidate, and the folders it made there: every refusal before the swap removes what is still its own ({@link removeWritten}), so no copy of a learner's file is left to refuse the next publish as a file outside the manifest.
  const written = [], made = [], writeHeld = heldWriterOf(requirePathHeld, isFolderWhereItWas, written, made);
  await writePagesHeld(rendered, stage, writeHeld, written, made);
  if (renderOnly) return { stage, renderedPages: rendered.size };
  const manifestText = await finalizedManifestTextOf(manifest, owned, stage);
  const { record, backup, finalizedReceiptText } = await publishJournalOf(paths, prior, receipt, manifestText, bytes, receiptBytes, system);
  const journalNow = journalOfCopiesOf(record, journal, stage, requirePathHeld, isFolderWhereItWas);
  await writeFile(journal, journalNow.bytes, { flag: 'wx' });
  const finalized = [], finalize = finalizerOf(stage, record.id, finalized);
  let movedOld = false, swapped = false;
  try {
    await requirePathHeld();
    prior = await inspectPrior();
    assertBaseline(receipt.baseline, prior);
    const manual = learnerFilesOf(prior), manualHashes = await copyLearnerFiles(manual, owned, output, stage, writeHeld, journalNow.recordCopyBegun);
    await makeFolderHeld(stage, requirePathHeld, isFolderWhereItWas);
    // The manifest and the record take the place of the entries at their names, which a link put there after they were read does not lead out of the candidate, and which a stop never leaves empty.
    await finalize(MANIFEST, manifestText, bytes);
    await finalize(RECEIPT, finalizedReceiptText, receiptBytes);
    // Recheck after acquiring the journal and copying files; a stale generation cannot win a later swap.
    const current = await inspectPrior();
    assertBaseline(receipt.baseline, current);
    await requireLearnerFilesUnchanged(current, manual, manualHashes, output);
    await makeFolderHeld(stage, requirePathHeld, isFolderWhereItWas);
    if (backup) { await renameRetried(output, backup); movedOld = true; }
    await renameRetried(stage, output);
    swapped = true;
    await removeOwnedRecord(journal, journalNow.bytes);
    return { output, previousOutput: backup, publishedFiles: owned.size, preservedManualFiles: manual.length };
  } catch (error) {
    if (swapped) throw error; // Cleanup failure must not roll back an already usable new generation.
    const undoFailure = await undoRefusedPublish({ output, stage, backup, movedOld, written, made, finalized, requirePathHeld, isFolderWhereItWas, refusal: error });
    if (undoFailure !== undefined) throw undoFailure;
    await removeOwnedRecord(journal, journalNow.bytes);
    throw error;
  }
}

/** The paths of the copies of the learner's files that a stopped publish made in its candidate: each file of the candidate that the candidate's manifest does not list, at a path whose copy the journal names as begun ({@link copiesBegunOf}), that stands at the place of a learner's file in the Wiki (a file the Wiki's manifest does not list) and that holds the start of that file's bytes or all of them ({@link isStartOf}): a kill while the publish wrote a copy leaves the part written so far, an empty file at the least, and the whole file stays in the Wiki. A file with other bytes, and a file at a path whose copy did not begin, which the learner put there, stay, for the next publish to name. Called by {@link restoreStoppedCandidate}. @param wiki - The Wiki that stands in the Wiki folder now, as {@link inspectOutput} read it. @param begun - The paths whose copy the journal names as begun. @returns The paths, relative to the candidate. @throws What reading the candidate's manifest, listing the candidate or reading a file rejects with: a candidate that cannot be judged is left as it is. @example await learnerCopiesIn('/repo/.codebook/next', wiki, '/repo/.codebook/wiki', '/repo', new Set(['manual.txt'])) // => ['manual.txt'] */
async function learnerCopiesIn(stage, wiki, output, root, begun) {
  const { owned } = parseManifest(await regularBytes(join(stage, MANIFEST)), root);
  const copiedFiles = new Set(learnerFilesOf(wiki).filter(path => begun.has(path))), copies = [];
  for (const path of await listFiles(stage))
    if (!owned.has(path) && copiedFiles.has(path) && isStartOf(await regularBytes(join(stage, path)), await regularBytes(join(output, path)))) copies.push(path);
  return copies;
}

/** The paths whose copy into the candidate a publish journal names as begun (`learnerCopies`, {@link journalOfCopiesOf}); none for a journal of an earlier version, which names no copies, so its recovery keeps every file of the candidate. Called by {@link restoreStoppedCandidate}. @example copiesBegunOf({ learnerCopies: ['manual.txt'] }) // => Set { 'manual.txt' } */
const copiesBegunOf = record => new Set(Array.isArray(record.learnerCopies) ? record.learnerCopies : []);

/** Whether the bytes of a file are the start of another file's bytes, or all of them: what a copy holds once a kill stopped its write, which goes from the first byte on, or once the write ended. Called by {@link learnerCopiesIn}. @example isStartOf(Buffer.from('The learner ke'), Buffer.from('The learner kept these notes')) // => true */
const isStartOf = (part, whole) => part.length <= whole.length && whole.subarray(0, part.length).equals(part);

/** The prepared manifest and record a publish journal keeps, by name, for the files whose finalized bytes, by their SHA-256 digest, the journal names: the manifest's `manifestSha256` and the record's `finalizedReceiptSha256`. Called by {@link restoreStoppedCandidate}. @returns The pairs; none for a journal of an earlier version, which keeps neither, or for one whose kept bytes are not text of base64. @example preparedFilesOf(record) // => [{ name: 'codebook-wiki.json', finalizedSha256: '…', prepared: <Buffer> }, { name: 'codebook-publication.json', … }] */
function preparedFilesOf(record) {
  const { prepared } = record, isBase64 = text => typeof text === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(text);
  if (!isBase64(prepared?.manifest) || !isBase64(prepared?.receipt) || !HASH.test(record.manifestSha256) || !HASH.test(record.finalizedReceiptSha256)) return [];
  return [{ name: MANIFEST, finalizedSha256: record.manifestSha256, prepared: Buffer.from(prepared.manifest, 'base64') },
    { name: RECEIPT, finalizedSha256: record.finalizedReceiptSha256, prepared: Buffer.from(prepared.receipt, 'base64') }];
}

/** Puts the candidate of a stopped publish back as it was prepared and removes what that publish left there that no next publish accepts as a file of the candidate: the files through which it put the finalized manifest and record, or its journal, in place ({@link finalizingPathOf}), known by the journal's id; the manifest and the record it finalized, which take the prepared bytes the journal keeps again ({@link preparedFilesOf}) while they hold the finalized bytes, so the learner's next edit is not refused as a change of a finalized candidate; and what the copies of the learner's files that its journal names as begun left ({@link learnerCopiesIn}), which the Wiki still holds whole. A candidate that is gone, because it became the Wiki, or that is no folder of its own is left; so is any copy in a candidate whose manifest cannot be read or that holds a link, and the next publish names what it refuses. Each removal and write is held to the output's path ({@link holdOfPath}), to the candidate's folder it lies in ({@link folderLookOf}) and to a stage that is, as the folders stand then, neither the Wiki folder nor the kept prior Wiki under another name ({@link requireStageOfItsOwn}). Called by {@link restoreCandidateOfJournal} for a publish journal, once the prior Wiki, the new one or none stands in the Wiki folder. @param wiki - The Wiki in the Wiki folder, as {@link inspectOutput} read it; null for none. @throws The refusal of a hold ({@link candidateHoldOf}), that of a stage that names the Wiki folder or the kept prior Wiki among them; the journal is kept then. @example await restoreStoppedCandidate(record, wiki, paths, requirePathHeld) */
async function restoreStoppedCandidate(record, wiki, paths, requirePathHeld) {
  const { root, output } = paths, stage = record.stage, entry = await lookAt(stage);
  // A candidate that became the Wiki is gone; one that is no folder of its own is not entered, and the next publish refuses it with its sentence.
  if (entry === undefined || !(await isOwnFolder(stage, entry, root, paths.isOutputInProject))) return;
  // The Wiki folder may stand only now, moved back from its backup name: a stage that names it under another name is refused before each removal and write.
  const requireHeld = candidateHoldOf(requirePathHeld, await folderLookOf(stage), () => requireStageOfItsOwn(record, output));
  const removeHeld = async path => { await requireHeld(path); await unlink(path); };
  // A journal of an earlier version names no id, and its publish wrote no file beside the manifest or the record.
  if (isRecordId(record.id)) {
    await removeFinalizingFiles(stage, record.id, removeHeld);
    await restorePreparedFiles(record, stage, requireHeld);
  }
  const copies = wiki ? await learnerCopiesIn(stage, wiki, output, root, copiesBegunOf(record)).catch(() => []) : [];
  for (const path of copies) await removeHeld(join(stage, path));
}

/** Whether a journal's or a claim's id is a random UUID, as the publisher writes it. Called by {@link restoreStoppedCandidate} and {@link isManifestJournal}. @example isRecordId('6f1c2a7e-…') // => true for a whole UUID */
const isRecordId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

/** The hold of a file of a stopped publish's candidate: the output's path ({@link holdOfPath}) and the candidate's folder the file lies in ({@link folderLookOf}) must still be where they were, and the candidate must not be the Wiki folder or the kept prior Wiki under another name (`requireStageHere`, {@link requireStageOfItsOwn}). Called by {@link restoreStoppedCandidate}. @returns The check, which resolves while all three hold and throws the refusal of the first that does not. @example await candidateHoldOf(requirePathHeld, isFolderWhereItWas, () => requireStageOfItsOwn(record, output))('/repo/.codebook/next/manual.txt') */
const candidateHoldOf = (requirePathHeld, isFolderWhereItWas, requireStageHere) => async path => {
  await requirePathHeld();
  await requireStageHere();
  if (!(await isFolderWhereItWas(dirname(path)))) throw holdRefusalOf(stageRefusalOf(dirname(path)));
};

/** Removes the files beside a candidate's manifest and record through which a stopped publish was putting the finalized ones, or its journal ({@link JOURNAL_UPDATE}), in place ({@link finalizingPathOf}), each a regular file, each removal held. Called by {@link restoreStoppedCandidate}. @example await removeFinalizingFiles('/repo/.codebook/next', journalId, removeHeld) */
async function removeFinalizingFiles(stage, id, removeHeld) {
  for (const name of [MANIFEST, RECEIPT, JOURNAL_UPDATE]) if ((await lookAt(finalizingPathOf(stage, id, name)))?.isFile()) await removeHeld(finalizingPathOf(stage, id, name));
}

/** Puts the prepared manifest and record a publish journal keeps ({@link preparedFilesOf}) back in its candidate: only a file that still holds the bytes this publish finalized takes the prepared bytes again, through the file beside it ({@link replaceOwnFileThrough}); an edit since stays. Called by {@link restoreStoppedCandidate}. @example await restorePreparedFiles(record, '/repo/.codebook/next', requireHeld) */
async function restorePreparedFiles(record, stage, requireHeld) {
  for (const { name, finalizedSha256, prepared } of preparedFilesOf(record)) {
    const current = await regularBytes(join(stage, name), true).catch(() => undefined);
    if (current === undefined || digest(current) !== finalizedSha256) continue;
    await requireHeld(join(stage, name));
    await replaceOwnFileThrough(finalizingPathOf(stage, record.id, name), join(stage, name), prepared);
  }
}

/** How far apart two boot times, each the wall clock minus the uptime, may lie and still name one boot of a machine that names its boot by no id (Windows, and a Mac whose boot session could not be read): a correction of the clock moves them. Read by {@link isOfEarlierBootTime}. */
const BOOT_TIME_TOLERANCE_MS = 60_000;
/** How long a query of a process's start (`ps` on macOS, PowerShell on Windows) or of the boot session (`sysctl` on macOS) may run before it is ended, and how many bytes it may print. Read by {@link queryText}. */
const START_QUERY_TIMEOUT_MS = 3_000, START_QUERY_MAX_BYTES = 1024;
/** The field of `/proc/<pid>/stat`, counted from the first after the command name, that holds the process's start in clock ticks since the boot (field 22). Read by {@link linuxStartOf}. */
const LINUX_STAT_START_INDEX = 19;

/** Runs a query program by its full path, without a shell, bounded in time and in output ({@link START_QUERY_TIMEOUT_MS}): the runner of {@link SYSTEM_HERE}, which {@link macStartOf}, {@link windowsStartOf} and {@link bootHere} run their queries with. @returns What it printed, trimmed; undefined when it fails, runs too long, prints too much or prints nothing. @example await queryText('/bin/ps', ['-o', 'lstart=', '-p', '4242'], { LC_ALL: 'C', TZ: 'UTC' }) // => 'Mon Oct  5 09:12:33 2026' */
const queryText = (program, args, env) => new Promise(resolve => execFile(program, args, { env, timeout: START_QUERY_TIMEOUT_MS, maxBuffer: START_QUERY_MAX_BYTES, killSignal: 'SIGKILL', windowsHide: true },
  (error, stdout) => resolve(error ? undefined : String(stdout).trim() || undefined)));

/** The system the publisher runs on, as the owner judgement asks it about processes and the boot: its `platform`, which picks the query of a process's start ({@link START_QUERIES}), the boot's form ({@link bootHere}) and the space of process ids ({@link processSpaceHere}); its `environment`, which names the Windows folder PowerShell is started from ({@link windowsStartOf}); and `run`, the runner of the bounded queries ({@link queryText}). The CLI passes it to the step it runs, and a step called without one asks it too; the publisher's tests name another system with a stand-in runner, so the queries of macOS and Windows run on every system. Read by {@link publishWiki} and {@link recoverWikiPublication}. */
const SYSTEM_HERE = Object.freeze({ platform: process.platform, environment: process.env, run: queryText });

/** The start of a Linux process: the clock ticks since the boot in `/proc/<pid>/stat`. The query of {@link START_QUERIES} on Linux. @returns `linux:<ticks>`; undefined when the file cannot be read or holds no start. @example await linuxStartOf(process.pid) // => 'linux:16362446' */
async function linuxStartOf(pid) {
  const stat = await readFile('/proc/' + pid + '/stat', 'utf8').catch(() => '');
  // The fields are counted after the last ")": the command name may hold any text.
  const ticks = stat.slice(stat.lastIndexOf(')') + 1).trim().split(' ')[LINUX_STAT_START_INDEX];
  return stat.includes(')') && /^\d+$/.test(ticks ?? '') ? 'linux:' + ticks : undefined;
}

/** The start of a macOS process: what `ps` prints in the C locale and in UTC, so two callers with different ones read the same text, run by the runner of `system` ({@link SYSTEM_HERE}). The query of {@link START_QUERIES} on macOS. @returns `ps:<text>`; undefined for any other answer. @example await macStartOf(4242, SYSTEM_HERE) // => 'ps:Mon Oct  5 09:12:33 2026' */
async function macStartOf(pid, system) {
  const text = await system.run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { LC_ALL: 'C', TZ: 'UTC' });
  return text !== undefined && /^[\x20-\x7e]{1,64}$/.test(text) ? 'ps:' + text : undefined;
}

/** A UTC time in the round-trip form PowerShell's `ToString('o')` prints, with its whole seconds and its fraction as groups; an error text never has it. Read by {@link windowsStartOf}, {@link utcTimeOfWmiCreation} and {@link windowsTicksOf}. */
const WINDOWS_UTC_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;
/** What the Windows start query prints before a creation time it read from the process table (Win32_Process, by WMI) because PowerShell may not read the process's start. Read by {@link windowsStartCommand} and {@link windowsStartOf}. */
const PROCESS_TABLE_MARK = 'wmi:';
/** A creation time as WMI's DMTF text names it (`yyyymmddHHMMSS.mmmmmm` and the offset from UTC in minutes with its sign, as `20261005181233.123456+540`), with its date and time fields, its microseconds, the offset's sign and the offset as groups; an error text never has it. Read by {@link utcTimeOfWmiCreation}. */
const WMI_CREATION_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/;
/** How many milliseconds a minute of a UTC offset holds. Read by {@link utcTimeOfWmiCreation}. */
const MS_PER_MINUTE = 60_000;
/** How many digits of a second a Windows start counts (100 ns ticks), and how many such ticks a millisecond has. Read by {@link windowsTicksOf}. */
const WINDOWS_TICK_DIGITS = 7, WINDOWS_TICKS_PER_MS = 10_000n;
/** How many 100 ns ticks the microsecond holds to which the process table names a creation time: a recorded start less than this far from it is that process's. Read by {@link startOfProcessTableTime}. */
const WINDOWS_PROCESS_TABLE_PRECISION_TICKS = 10n;

/** Counts a UTC time in round-trip form ({@link WINDOWS_UTC_TIME}) in 100 ns ticks since the epoch, so two Windows times of different precision can be compared. Called by {@link startOfProcessTableTime}. @returns The ticks; undefined for a text that is no such time. @example windowsTicksOf('2026-10-05T09:12:33.1234567Z') // => 17911915531234567n */
function windowsTicksOf(text) {
  const parts = WINDOWS_UTC_TIME.exec(text), secondsMs = parts ? Date.parse(parts[1] + 'Z') : Number.NaN;
  if (!Number.isFinite(secondsMs)) return undefined;
  return BigInt(secondsMs) * WINDOWS_TICKS_PER_MS + BigInt((parts[2] ?? '').padEnd(WINDOWS_TICK_DIGITS, '0').slice(0, WINDOWS_TICK_DIGITS));
}

/** Converts a creation time of the Windows process table, as WMI names it ({@link WMI_CREATION_TIME}), to the round-trip UTC form of every other Windows start. WMI names the time in local digits with the offset from UTC it used for them, so the time is taken back to UTC by that very offset: a conversion by the time zone's rules gives the hour that repeats at the end of daylight saving time one offset only, and a process created in the other half of that hour would be named an hour off. The same conversion as the extension's process-start reader. Called by {@link windowsStartOf} for the answer of the query's fallback ({@link windowsStartCommand}). @param creation - The creation time as WMI's DMTF text. @returns The time in UTC to the 100 ns, its last digit `0` (the table names microseconds); undefined for a text of another shape and for a date or a time out of range. @example utcTimeOfWmiCreation('20261025013000.123456+060') // => '2026-10-25T00:30:00.1234560Z', and utcTimeOfWmiCreation('20261025013000.123456+000') // => '2026-10-25T01:30:00.1234560Z' */
function utcTimeOfWmiCreation(creation) {
  const parts = WMI_CREATION_TIME.exec(creation);
  if (!parts) return undefined;
  const [, year, month, day, hour, minute, second, microseconds, sign, offsetMinutes] = parts;
  const digits = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second, digitsAsUtcMs = Date.parse(digits + 'Z');
  // A field out of its range (a 13th month, a 30th of February) names no time.
  if (!Number.isFinite(digitsAsUtcMs) || new Date(digitsAsUtcMs).toISOString().slice(0, 19) !== digits) return undefined;
  // The digits are the time at the named offset: UTC lies that many minutes earlier east of Greenwich and later west of it.
  const offsetMs = (sign === '-' ? -1 : 1) * Number(offsetMinutes) * MS_PER_MINUTE;
  const utc = new Date(digitsAsUtcMs - offsetMs).toISOString().slice(0, 19) + '.' + microseconds + '0Z';
  return WINDOWS_UTC_TIME.test(utc) ? utc : undefined;
}

/** Names a process by the creation time the Windows process table gave for it, when PowerShell may not read the process's start. The table names the time to the microsecond, while a recorded start was read to the 100 ns by its own process: a recorded Windows start less than {@link WINDOWS_PROCESS_TABLE_PRECISION_TICKS} ticks from the table's time is that process's and is answered as it is, so {@link processStateOf} finds it equal; any other is answered as the table names it, which no recorded start equals. Called by {@link windowsStartOf}. @param creation - The creation time in round-trip UTC form, as {@link utcTimeOfWmiCreation} converted it. @param expectedStart - The start the journal or the claim records for this process id, if any. @returns `expectedStart` for a Windows start of the same microsecond; `win:<creation>` otherwise. @example startOfProcessTableTime('2026-10-05T09:12:33.1234560Z', 'win:2026-10-05T09:12:33.1234567Z') // => 'win:2026-10-05T09:12:33.1234567Z' */
function startOfProcessTableTime(creation, expectedStart) {
  const creationTicks = windowsTicksOf(creation), expectedTicks = expectedStart?.startsWith('win:') ? windowsTicksOf(expectedStart.slice('win:'.length)) : undefined;
  // Only a Windows start of the same microsecond is confirmed; a start of another form or without a time never is.
  if (creationTicks !== undefined && expectedTicks !== undefined && expectedTicks - creationTicks > -WINDOWS_PROCESS_TABLE_PRECISION_TICKS && expectedTicks - creationTicks < WINDOWS_PROCESS_TABLE_PRECISION_TICKS)
    return expectedStart;
  return 'win:' + creation;
}

/** The PowerShell command that asks when a process was created: the process's start, and where this user may not read it (a process of another user, or one run as administrator), its creation time from the process table (Win32_Process through WMI, `Get-WmiObject` of Windows PowerShell 5.1) behind {@link PROCESS_TABLE_MARK}, in the one bounded query; a process id that names no process ends it with an error before the table is asked. The table's time is printed as WMI's DMTF text, in local digits with the offset from UTC they were written with, and is converted by that offset ({@link utcTimeOfWmiCreation}): PowerShell's own conversion of a local time to UTC takes the offset of the time zone's rules, which give the repeated hour at the end of daylight saving time one offset only. The same command as the extension's process-start reader. Called by {@link windowsStartOf}. @example windowsStartCommand(4242) // => "$process = Get-Process -Id 4242 -ErrorAction Stop; try { … } … 'wmi:' + (Get-WmiObject -Class Win32_Process -Filter 'ProcessId=4242' -ErrorAction Stop).CreationDate }" */
const windowsStartCommand = pid => ['$process = Get-Process -Id ' + pid + ' -ErrorAction Stop', 'try { $start = $process.StartTime } catch { $start = $null }',
  "if ($null -ne $start) { $start.ToUniversalTime().ToString('o') } else { '" + PROCESS_TABLE_MARK + "' + (Get-WmiObject -Class Win32_Process -Filter 'ProcessId=" + pid + "' -ErrorAction Stop).CreationDate }"].join('; ');

/** The start of a Windows process: the creation time PowerShell prints in UTC ({@link windowsStartCommand}), PowerShell started by its full path under the system root that the environment of `system` names, never found on the search path, and run by the runner of `system` ({@link SYSTEM_HERE}). Where this user may not read the process's start, the process table's creation time answers, converted to UTC by its own offset ({@link utcTimeOfWmiCreation}, {@link startOfProcessTableTime}), so a process id that went to a process of another user does not keep a stopped publish's journal for as long as that process runs. The query of {@link START_QUERIES} on Windows. @param expectedStart - The start a journal or a claim records for this process id, which a creation time of the process table may confirm. @returns `win:<time>`; undefined without a system root and for any other answer. @example await windowsStartOf(4242, SYSTEM_HERE, undefined) // => 'win:2026-10-05T09:12:33.1234567Z' */
async function windowsStartOf(pid, system, expectedStart) {
  const systemRoot = [system.environment.SystemRoot, system.environment.windir].find(path => /^[A-Za-z]:[\\/]/.test(path ?? ''));
  const text = systemRoot === undefined ? undefined : await system.run(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', windowsStartCommand(pid)]);
  if (text !== undefined && WINDOWS_UTC_TIME.test(text)) return 'win:' + text;
  // A creation time read from the process table names the process to the microsecond only, in WMI's text with its offset from UTC.
  const creation = text?.startsWith(PROCESS_TABLE_MARK) ? utcTimeOfWmiCreation(text.slice(PROCESS_TABLE_MARK.length)) : undefined;
  return creation !== undefined ? startOfProcessTableTime(creation, expectedStart) : undefined;
}

/** The query of a process's start on each system whose starts the publisher reads. Read by {@link processStartOf}. */
const START_QUERIES = { linux: linuxStartOf, darwin: macStartOf, win32: windowsStartOf };

/** When a process began, as its system tells it ({@link START_QUERIES} by the platform of `system`), so that a process id another process took since is told from the process a journal or a claim records. Called by {@link ownerHere} for this process and by {@link processStateOf} for the process that has a recorded id now. @param expectedStart - The start a journal or a claim records for the process id, which a Windows creation time named to the microsecond may confirm ({@link windowsStartOf}). @returns The start with its system's form before a colon (`linux:`, `ps:`, `win:`); undefined when it cannot be read, and on any other system. @example await processStartOf(process.pid, SYSTEM_HERE, undefined) // => 'linux:16362446' */
async function processStartOf(pid, system, expectedStart) {
  return Object.hasOwn(START_QUERIES, system.platform) ? START_QUERIES[system.platform](pid, system, expectedStart) : undefined;
}

/** The program that names macOS's boot session, by its full path, so no program of the current directory or the search path answers instead. Read by {@link bootHere}. */
const MAC_SYSCTL_PATH = '/usr/sbin/sysctl';
/** The boot session's id as `sysctl -n kern.bootsessionuuid` prints it: a UUID. Read by {@link bootHere}. */
const BOOT_SESSION_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** The boot of this machine that this process runs under, by the platform of `system`: the kernel's boot id on Linux; on macOS the boot session's id (`kern.bootsessionuuid`, by the runner of `system`, bounded as a start query is), so a Mac that took another host name from the network under one boot is still this machine ({@link placeStateOf}), with the boot time beside it for a record that names no id; elsewhere, and on a Mac whose session cannot be read, the boot time alone, the wall clock minus the uptime, which a correction of the clock moves ({@link BOOT_TIME_TOLERANCE_MS}). Called by {@link ownerHere}. @example await bootHere(SYSTEM_HERE) // => { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' } on Linux, { id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14', atMs: 1790000000000 } on macOS, { atMs: 1790000000000 } on Windows */
async function bootHere(system) {
  const atMs = Date.now() - Math.round(uptime() * 1000);
  if (system.platform === 'darwin') {
    const session = await system.run(MAC_SYSCTL_PATH, ['-n', 'kern.bootsessionuuid']);
    return session !== undefined && BOOT_SESSION_UUID.test(session) ? { id: session, atMs } : { atMs };
  }
  // Windows names its boot by no id.
  if (system.platform === 'win32') return { atMs };
  const id = await readFile('/proc/sys/kernel/random/boot_id', 'utf8').then(text => text.trim(), () => '');
  return id ? { id } : { atMs };
}

/** The space of process ids this process probes: its system (the platform of `system`), and on Linux its pid namespace, which two containers or two WSL distributions of one kernel do not share; `linux@` when the namespace cannot be read, which then counts as one space with every other record of this host and boot that could not read it either. Called by {@link ownerHere}. @example await processSpaceHere(SYSTEM_HERE) // => 'linux@4026531836' */
async function processSpaceHere(system) {
  if (system.platform !== 'linux') return system.platform;
  return 'linux@' + (/^pid:\[(\d+)\]$/.exec(await readlink('/proc/self/ns/pid').catch(() => ''))?.[1] ?? '');
}

/** The form of the host name an owner records ({@link ownerHostOf}): letters, digits, dots, hyphens and underscores, from a letter or a digit on, at most 253 characters, as a machine's name is in DNS. A refusal names it and the learner passes it back on a command line (`--gone-host`), so no other text may stand in it. Read by {@link ownerHostOf} and {@link isOwnerForm}. */
const OWNER_HOST_FORM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
/** The form of the space of process ids an owner records ({@link processSpaceHere}): `linux@` and the number of a pid namespace, or none where it cannot be read, or the name of another platform. A refusal names it and the learner passes it back (`--gone-space`). Read by {@link isOwnerForm}. */
const OWNER_SPACE_FORM = /^(?:linux@\d{0,20}|[a-z0-9]{1,16})$/;
/** How many characters of a host name outside {@link OWNER_HOST_FORM} its stand-in keeps, and how many hexadecimal digits of the name's SHA-256 follow them. Read by {@link ownerHostOf}. */
const OWNER_HOST_KEPT_CHARACTERS = 64, OWNER_HOST_DIGEST_DIGITS = 12;

/** The host name an owner records for this machine: its name where it is in {@link OWNER_HOST_FORM}, and otherwise a stand-in of that form, made from the name alone, so every process of this machine records the same one. A computer's name may hold a space, an apostrophe or letters of another script, which a recovery refuses in a record. Called by {@link ownerHere}. @param name - The machine's host name, as `node:os` gives it. @returns The name, or `host-`, the name with each run of other characters as `_`, a hyphen and the start of the name's SHA-256. @example ownerHostOf("Ryota's PC") // => 'host-Ryota_s_PC-aabcbfb3906e' */
const ownerHostOf = name => OWNER_HOST_FORM.test(name) ? name
  : 'host-' + name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, OWNER_HOST_KEPT_CHARACTERS) + '-' + digest(name).slice(0, OWNER_HOST_DIGEST_DIGITS);

/** The read of {@link ownerHere}, once per process and system. */
const ownerReadings = new WeakMap();

/** What a journal or a recovery claim of this process records of its owner beside the process id, so a later recovery tells whether that owner can still be at work: the machine's host name in the form a recovery accepts ({@link ownerHostOf}), the space of process ids ({@link processSpaceHere}), the boot ({@link bootHere}) and the process's start ({@link processStartOf}), each as `system` tells it ({@link SYSTEM_HERE}). Read once per process and system: {@link publishWiki} and {@link recoverWikiPublication} start the read first, without waiting for it, so its queries run beside their other steps; {@link publishJournalOf}, {@link claimRecovery} and {@link manifestJournalOf} wait for it before a journal or a claim is written, and {@link requireExited} before it judges an owner. @returns The owner, without the process id. @example await ownerHere(SYSTEM_HERE) // => { host: 'workstation', space: 'linux@4026531836', boot: { id: '0c1d…' }, start: 'linux:16362446' } */
function ownerHere(system) {
  if (!ownerReadings.has(system)) {
    // The space, the boot and the start are read side by side: on macOS and Windows each may start a program.
    const reading = Promise.all([processSpaceHere(system), bootHere(system), processStartOf(process.pid, system, undefined)]).then(([space, boot, start]) => ({ host: ownerHostOf(hostname()), space, boot, start }));
    // A step refused before it waits for the read must not end the process with an unhandled rejection; a step that waits still gets the failure.
    reading.catch(() => undefined);
    ownerReadings.set(system, reading);
  }
  return ownerReadings.get(system);
}

/** Whether a recorded boot is in the form {@link bootHere} gives: a boot id, or a boot time. Called by {@link isOwnerForm}. @example isBootForm({ atMs: 1790000000000 }) // => true */
const isBootForm = boot => typeof boot?.id === 'string' || Number.isFinite(boot?.atMs);

/** Whether a recorded owner is in the form {@link ownerHere} writes: a host name of {@link OWNER_HOST_FORM} and a space of {@link OWNER_SPACE_FORM}, which a refusal may name, a boot ({@link isBootForm}) and, if any, a start. Called by {@link requireOwnerForm}. @example isOwnerForm({ host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-1' } }) // => true */
const isOwnerForm = owner => owner !== null && typeof owner === 'object' && typeof owner.host === 'string' && OWNER_HOST_FORM.test(owner.host) &&
  typeof owner.space === 'string' && OWNER_SPACE_FORM.test(owner.space) && isBootForm(owner.boot) && (owner.start === undefined || typeof owner.start === 'string');

/** Whether no process has an id here, probed with signal 0: `ESRCH` alone says so; a process of another user that runs answers `EPERM`, which says it exists. Called by {@link ownerStateOf} and {@link processStateOf}. @example isProcessIdFree(process.pid) // => false */
function isProcessIdFree(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

/** Judges the owner a journal or a recovery claim records: `gone` when it cannot be at work any more, `running` while it may run here, `elsewhere` when it ran on another machine or in another space of process ids, which no probe here reaches. A record of an earlier version names its process id alone and is judged by that id here, as then. A record with its owner: one of another host name is of another machine, unless both name one boot id; an earlier boot ended every process of it, by its boot id, or, where neither names one and the record has no start, by a boot time that lies apart by more than {@link BOOT_TIME_TOLERANCE_MS}; a process id no process has is gone; a process id another process has now, which began at another time than the recorded start, is gone too. Called by {@link requireExited}, with the owner `system` tells of this process ({@link ownerHere}). @example await ownerStateOf({ pid: 4242, owner: { host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-1' } } }, { host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-2' } }, SYSTEM_HERE) // => 'gone' */
async function ownerStateOf({ pid, owner }, here, system) {
  if (owner === undefined) return isProcessIdFree(pid) ? 'gone' : 'running';
  return placeStateOf(owner, here) ?? processStateOf(pid, owner, system);
}

/** Judges a recorded owner by where it ran, before its process id is probed: `elsewhere` for another machine (another host name, unless both name one boot id) or another space of process ids, `gone` for an earlier boot of this machine ({@link isOfEarlierBootTime} where neither names a boot id). Called by {@link ownerStateOf}. @returns The state; undefined when the owner ran under this boot, in this space, and its process id decides ({@link processStateOf}). @example placeStateOf({ host: 'other', space: 'linux@1', boot: { id: 'boot-1' } }, { host: 'workstation', space: 'linux@1', boot: { id: 'boot-2' } }) // => 'elsewhere' */
function placeStateOf(owner, here) {
  const hasBootIds = owner.boot.id !== undefined && here.boot.id !== undefined;
  // A machine is known by its host name, or, under another one, by its exact boot.
  if (owner.host !== here.host && !(hasBootIds && owner.boot.id === here.boot.id)) return 'elsewhere';
  if (hasBootIds && owner.boot.id !== here.boot.id) return 'gone';
  if (owner.space !== here.space) return 'elsewhere';
  return isOfEarlierBootTime(owner, here, hasBootIds) ? 'gone' : undefined;
}

/** Whether a recorded owner without a start ran under an earlier boot by the boot times alone, which lie apart by more than {@link BOOT_TIME_TOLERANCE_MS}: a boot time decides only for a record without a start, since a correction of the clock moves it and a start decides better, and only where neither side names a boot id. Called by {@link placeStateOf}. @example isOfEarlierBootTime({ boot: { atMs: 0 } }, { boot: { atMs: 3600000 } }, false) // => true */
const isOfEarlierBootTime = (owner, here, hasBootIds) => owner.start === undefined && !hasBootIds && Number.isFinite(owner.boot.atMs) && Number.isFinite(here.boot.atMs) &&
  Math.abs(owner.boot.atMs - here.boot.atMs) > BOOT_TIME_TOLERANCE_MS;

/** Judges a recorded owner of this boot and space by its process id: `gone` when no process has the id, or when the process that has it now began at another time than the recorded start, as `system` tells it ({@link processStartOf}); `running` otherwise, also when the start cannot be read. Called by {@link ownerStateOf}. @example await processStateOf(process.pid, { start: 'linux:1' }, SYSTEM_HERE) // => 'gone' */
async function processStateOf(pid, owner, system) {
  if (isProcessIdFree(pid)) return 'gone';
  const liveStart = owner.start === undefined ? undefined : await processStartOf(pid, system, owner.start);
  return liveStart !== undefined && liveStart !== owner.start ? 'gone' : 'running';
}

/** Refuses recovery while a recorded publisher or recovery process may still own the operation ({@link ownerStateOf}), or when it ran where this recovery cannot look at it, unless the learner confirmed that place gone ({@link isOwnerAt}). Called by {@link resumeJournal} for a journal and by {@link claimRecovery} for an earlier claim. @param recorded - The parsed journal or claim, with its `pid` and, from this version on, its `owner`. @param ownerJudgement - The `system` this recovery runs on ({@link SYSTEM_HERE}) and the `goneOwners`, the places the learner named with `--gone-host` and `--gone-space`, one pair for each (none when absent): an owner judged `elsewhere` at one of those host names and spaces counts as gone; one judged `running` never does. @throws The refusal of an invalid owner, of one that may still run, and of one of another machine or space of process ids, which names the way out for a place that cannot come back: the two options set to that place, or, where the learner named places already, one more pair. @example await requireExited({ pid: 1 }, { system: SYSTEM_HERE }) // throws: The prior Wiki publisher process 1 may still be running; inspect it before recovery. */
async function requireExited(recorded, { system, goneOwners = [] }) {
  requireOwnerForm(recorded);
  const { pid, owner } = recorded;
  const state = await ownerStateOf({ pid, owner }, await ownerHere(system), system);
  // An owner in a place the learner confirmed gone counts as gone; the options never end an owner that may still run here.
  if (state === 'gone' || state === 'elsewhere' && isOwnerAt(owner, goneOwners)) return;
  // Where the learner named places already, the place of this owner is one more pair beside them: a stopped recovery may have run in a second place that cannot come back.
  const wayOut = goneOwners.length === 0 ? '--gone-host and --gone-space set to that host name and space' : 'one more --gone-host and --gone-space pair set to that host name and space, keeping the pairs already named';
  if (state === 'elsewhere') throw new Error('The prior Wiki publisher process ' + pid + ' ran on ' + placeOf(owner) + ', where this recovery cannot look at it. Run --recover there after it exits. If that place cannot come back (a rebuilt container, a machine that is gone), run --recover here with ' + wayOut + ', only after the learner confirms that no publisher runs there.');
  throw new Error('The prior Wiki publisher process ' + pid + ' may still be running; inspect it before recovery.');
}

/** Refuses a journal or a recovery claim whose process id or owner is not in the form this publisher writes ({@link isOwnerForm}), before any refusal names its owner: a journal or a claim a cloned repository carries may name any text as its host name and space, which the agent would read and pass back on a command line. Called by {@link requireExited}, {@link requireGoneOwnersOf} and {@link claimOwnersOf}. @param recorded - The parsed journal or claim. @throws The refusal of an invalid owner. @example requireOwnerForm({ pid: 4242, owner: { host: 'devbox$(touch owned)', space: 'linux@1', boot: { id: 'boot-1' } } }) // throws: The Wiki recovery owner is invalid. */
function requireOwnerForm(recorded) {
  const { pid, owner } = recorded ?? {};
  if (!Number.isSafeInteger(pid) || pid < 1 || owner !== undefined && !isOwnerForm(owner)) throw new Error('The Wiki recovery owner is invalid.');
}

/** The host name and the space of process ids of an owner, as a refusal names them. Called by {@link requireExited} and {@link goneOwnerRefusalOf}. @example placeOf({ host: 'devbox', space: 'linux@4026531836' }) // => '"devbox" (linux@4026531836)' */
const placeOf = owner => JSON.stringify(owner.host) + ' (' + owner.space + ')';

/** Whether a recorded owner ran at one of the places, each a host name and a space of process ids, that the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place). Called by {@link requireExited} and {@link requireGoneOwnersOf}. @param owner - The owner a journal or a claim records; undefined for a record of an earlier version, which names none and is at no place. @param goneOwners - The places, each `{ host, space }`. @example isOwnerAt({ host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' } }, [{ host: 'devbox', space: 'linux@1' }]) // => true */
const isOwnerAt = (owner, goneOwners) => owner !== undefined && goneOwners.some(place => owner.host === place.host && owner.space === place.space);

/** The refusal of a `--gone-host` and `--gone-space` pair that names no owner's place: another host name or space than those the journal's owner and the stopped recovery claims of its chain record, or no journal with an owner at all. Called by {@link requireGoneOwnersOf} and {@link recoverWikiPublication}. @param goneOwner - The place named that no owner records. @param owner - The journal's owner, held to its form; undefined for a journal of an earlier version, which names none, and where no journal stands. @param claimOwners - The owners the stopped recovery claims of the journal's chain record, held to their form ({@link claimOwnersOf}); a place the journal's owner names too is named once. @example goneOwnerRefusalOf({ host: 'devbox', space: 'linux@1' }, undefined, []) // => '--gone-host and --gone-space name "devbox" (linux@1), but no Wiki publication journal with an owner stands. …' */
function goneOwnerRefusalOf(goneOwner, owner, claimOwners) {
  const claimPlaces = [...new Set(claimOwners.map(placeOf))].filter(place => owner === undefined || place !== placeOf(owner));
  // A journal of an earlier version names no owner, while a claim beside it may.
  if (owner === undefined && claimPlaces.length === 0) return '--gone-host and --gone-space name ' + placeOf(goneOwner) + ', but no Wiki publication journal with an owner stands. Nothing was moved. Run --recover without them.';
  return '--gone-host and --gone-space name ' + placeOf(goneOwner) + ', but the Wiki publication journal names ' + (owner === undefined ? 'no owner' : placeOf(owner)) +
    (claimPlaces.length === 0 ? '' : ' and its stopped recoveries name ' + claimPlaces.join(', ')) + '. Nothing was moved. Name the host name and the space that the refusal of --recover names, or run --recover without them.';
}

/** Refuses a place the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place) unless it is the host name and the space of the owner the journal records or of an owner a stopped recovery claim of its chain records ({@link claimOwnersOf}), before any owner is judged, so the options never end a publish or a recovery they do not name; the journal's owner and the claims' are held to their form first ({@link requireOwnerForm}), so the refusal never names an owner of another form; without the options nothing is read or refused here. Called by {@link resumeJournal}. @param record - The parsed journal. @param journal - The journal's path, beside which its claims stand. @param bytes - The journal's bytes, whose digest names its first claim. @param goneOwners - The places, each `{ host, space }`; none when absent. @throws The refusal of an invalid owner or claim, of claims that form a cycle, and that of {@link goneOwnerRefusalOf}. @example await requireGoneOwnersOf({ pid: 4242, owner: { host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' } } }, journal, bytes, [{ host: 'devbox', space: 'linux@2' }]) // throws where no claim of 'devbox' (linux@2) stands */
async function requireGoneOwnersOf(record, journal, bytes, goneOwners = []) {
  if (goneOwners.length === 0) return;
  requireOwnerForm(record);
  const claimOwners = await claimOwnersOf(journal, bytes), owners = [record.owner, ...claimOwners];
  const unnamed = goneOwners.find(place => !owners.some(owner => isOwnerAt(owner, [place])));
  if (unnamed !== undefined) throw new Error(goneOwnerRefusalOf(unnamed, record.owner, claimOwners));
}

/** Reads a stopped recovery claim, the exclusive record of an earlier recovery of a journal ({@link claimRecovery}), which must name the id its successor's claim is named by. Called by {@link claimRecovery} and {@link claimOwnersOf}. @param optional - Whether a missing claim is answered with undefined instead of refused. @returns The claim's bytes and its record; undefined for a missing claim when `optional`. @throws The refusal of a claim without a valid id, and of one that is no regular file; it is preserved. @example await stoppedClaimAt(journal + '.recovery-' + digest(bytes), true) // => { bytes: <Buffer …>, record: { pid: 4242, owner: { host: 'devbox', … }, id: '11111111-1111-4111-8111-111111111111' } } */
async function stoppedClaimAt(path, optional) {
  const bytes = await regularBytes(path, optional);
  if (bytes === undefined) return undefined;
  const record = JSON.parse(bytes);
  if (typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/.test(record.id)) throw new Error('The Wiki recovery claim is invalid; it was preserved.');
  return { bytes, record };
}

/** The owners the stopped recovery claims of a journal's chain record, in the chain's order, each held to the form {@link ownerHere} writes ({@link requireOwnerForm}) before a refusal may name it; a claim of an earlier version names none. It only reads, so the places the learner confirmed gone are checked before any owner is judged or a claim is written. Called by {@link requireGoneOwnersOf}. @returns The owners the claims name. @throws The refusals of {@link stoppedClaimAt} and of an invalid owner, and that of claims that form a cycle. @example await claimOwnersOf(journal, bytes) // => [{ host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' }, start: 'linux:42' }] */
async function claimOwnersOf(journal, bytes) {
  const owners = [], visited = new Set();
  // The chain runs from the journal's digest through each claim's id, as {@link claimRecovery} walks it, and ends at the first id no claim is named by.
  for (let parent = digest(bytes); !visited.has(parent);) {
    visited.add(parent);
    const claim = await stoppedClaimAt(journal + '.recovery-' + parent, true);
    if (claim === undefined) return owners;
    requireOwnerForm(claim.record);
    if (claim.record.owner !== undefined) owners.push(claim.record.owner);
    parent = claim.record.id;
  }
  throw new Error('The Wiki recovery claims form a cycle; all records were preserved.');
}

/** Claims stopped recovery attempts through append-only exclusive records, without unlinking another contender's lock; each claim names its owner as the `system` of `ownerJudgement` tells it ({@link ownerHere}), and an earlier claim ({@link stoppedClaimAt}) is judged by it and by the places the learner confirmed gone ({@link requireExited}). @example await claimRecovery(journal, journalBytes, { system: SYSTEM_HERE }) */
async function claimRecovery(journal, bytes, ownerJudgement) {
  // Journal hash -> exclusive owner -> stopped owner ID -> exclusive successor; a live owner stops traversal.
  const claims = [], visited = new Set();
  let parent = digest(bytes);
  while (!visited.has(parent)) {
    visited.add(parent);
    const path = journal + '.recovery-' + parent, claimBytes = JSON.stringify({ pid: process.pid, owner: await ownerHere(ownerJudgement.system), id: randomUUID() });
    try { await writeFile(path, claimBytes, { flag: 'wx' }); claims.push({ path, bytes: claimBytes }); return claims; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previous = await stoppedClaimAt(path, false);
    await requireExited(previous.record, ownerJudgement);
    claims.push({ path, bytes: previous.bytes });
    parent = previous.record.id;
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

/** Ends a resumed metadata recovery whose edited manifest the learner changed again after its process stopped: the staging file it wrote in the Wiki folder is removed while it holds the retained manifest, so no file of the recovery's is left there for the next publish to carry over as the learner's, and the edit it kept beside the Wiki stays. The refusal it answers is marked, so {@link recoverWikiPublication} removes the journal and recovers again from the manifest as it is now. Called by {@link restoreManifest}. @returns The marked refusal, to be thrown. @example throw await endSupersededRestore(record, requireHeld) */
async function endSupersededRestore(record, requireHeld) {
  const temporary = await regularBytes(record.temporaryManifest, true).catch(() => undefined);
  if (temporary !== undefined && digest(temporary) === record.manifestSha256) { await requireHeld(); await unlink(record.temporaryManifest); }
  return Object.assign(new Error('The altered Wiki manifest changed again after an interrupted recovery; that recovery was ended.'), { isSupersededRestore: true });
}

/** Restores only receipt-verified metadata, retaining altered bytes before the atomic rename; each write goes through `writeHeld`, and the rename waits for `requireHeld` ({@link restoreManifestHeld}). A recovery resumed after its process stopped (`isResumed`) whose edited manifest changed again since is ended ({@link endSupersededRestore}); one that runs from its start refuses such a change, which happened while it ran. @example await restoreManifest(record, paths, writeHeld, requireHeld, false) */
async function restoreManifest(record, paths, writeHeld, requireHeld, isResumed) {
  const { root, output } = paths;
  let state = await recoveryState(root, output, record.sourceStage);
  if (!holdsRetainedGeneration(state, record)) throw new Error('The retained Wiki generation changed; recovery was stopped.');
  if (state.actual && digest(state.actual) === record.manifestSha256) return;
  await requireRecordedEdit(state, record, requireHeld, isResumed);
  await keepEditedManifest(state, record, writeHeld);
  await writeStagingManifest(state, record, writeHeld);
  state = await recoveryState(root, output, record.sourceStage);
  if (!holdsRetainedGeneration(state, record) || actualDigestOf(state) !== record.modifiedManifestSha256)
    throw new Error('The Wiki changed before metadata recovery; all files were preserved.');
  await requireHeld();
  await renameRetried(record.temporaryManifest, join(output, MANIFEST));
}

/** Whether a recovery state still holds the generation a metadata recovery journal retains: a record, or a legacy adoption, whose manifest has the journal's SHA-256 digest. Called by {@link restoreManifest} before and after its writes. @example holdsRetainedGeneration(state, record) // => true while the Wiki's record is the one recovered */
const holdsRetainedGeneration = (state, record) => Boolean(state) && Boolean(state.receipt || state.legacyRecovery) && digest(state.bytes) === record.manifestSha256;

/** The SHA-256 digest of the manifest that stands in the Wiki folder in a recovery state, or null for none. Called by {@link restoreManifest} and {@link requireRecordedEdit}. @example actualDigestOf({ actual: undefined }) // => null */
const actualDigestOf = state => state.actual ? digest(state.actual) : null;

/** Refuses a metadata recovery whose edited manifest is no longer the one its journal recorded. An edit after the stopped recovery's process ended is the learner's latest; it is kept by a new recovery, not refused for good ({@link endSupersededRestore}); one while this recovery runs is refused. Called by {@link restoreManifest}. @throws The marked refusal of a superseded recovery, or the refusal of a change during recovery. @example await requireRecordedEdit(state, record, requireHeld, false) */
async function requireRecordedEdit(state, record, requireHeld, isResumed) {
  if (actualDigestOf(state) === record.modifiedManifestSha256) return;
  if (isResumed) throw await endSupersededRestore(record, requireHeld);
  throw new Error('The altered Wiki manifest changed during recovery; it was preserved.');
}

/** Keeps the edited manifest beside the Wiki before the generated one takes its place: a copy kept by an earlier run of this recovery must hold the same bytes, and none is written again then. Called by {@link restoreManifest}. @throws The refusal of a kept copy that differs. @example await keepEditedManifest(state, record, writeHeld) */
async function keepEditedManifest(state, record, writeHeld) {
  if (!state.actual) return;
  const retained = await regularBytes(record.modifiedManifestBackup, true);
  if (retained && !retained.equals(state.actual)) throw new Error('The retained edited manifest conflicts with recovery; it was preserved.');
  if (!retained) await writeHeld(record.modifiedManifestBackup, state.actual);
}

/** Writes the staging file of the retained manifest in the Wiki folder, which the rename then puts in the manifest's place; a staging file an earlier run of this recovery wrote must hold the retained manifest whole, and none is written again then. Called by {@link restoreManifest}. @throws The refusal of an incomplete staging file. @example await writeStagingManifest(state, record, writeHeld) */
async function writeStagingManifest(state, record, writeHeld) {
  const temporary = await regularBytes(record.temporaryManifest, true);
  if (temporary && digest(temporary) !== record.manifestSha256) throw new Error('The recovery staging file is incomplete; inspect it without overwriting it.');
  if (!temporary) await writeHeld(record.temporaryManifest, state.bytes);
}

/** Restores an edited manifest ({@link restoreManifest}) only while the output's path and the Wiki folder hold: each write is held before and after it and the rename before it, by the path ({@link holdOfPath}) and the Wiki folder itself ({@link folderLookOf}), and a refused hold removes what this recovery wrote that is still its own ({@link removeWritten}). Called by {@link recoverWikiPublication}, with whether the journal is one a stopped recovery left (`isResumed`). @example await restoreManifestHeld(record, paths, requirePathHeld, false) */
async function restoreManifestHeld(record, paths, requirePathHeld, isResumed) {
  const isOutputWhereItWas = await folderLookOf(paths.output), written = [];
  const requireHeld = async () => {
    await requirePathHeld();
    if (!(await isOutputWhereItWas(paths.output))) throw holdRefusalOf(outputRefusalOf(paths.output));
  };
  // The hold is taken before and after each write, so a swap during the write is seen before anything else is read or moved.
  const writeHeld = async (path, bytes) => { await requireHeld(); written.push(await writeOwnFile(path, bytes)); await requireHeld(); };
  try { await restoreManifest(record, paths, writeHeld, requireHeld, isResumed); }
  catch (error) { if (error.isHoldRefusal) await removeWritten(written, []); throw error; }
}

/** Recovers stopped swaps or manifest-only drift; altered metadata and manual files remain available. A stopped publish is recovered whatever the published manifest holds now, since the retained manifest of the Wiki's record decides; a manifest edited meanwhile is restored by the next recovery. A stopped metadata recovery whose edited manifest changed again since is ended and recovered once more from the manifest as it is now, so each edit is kept beside the Wiki. @param options.goneOwners - The places, each the host name and the space of process ids (`{ host, space }`), that the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place): places that cannot come back, such as a rebuilt container or a machine that is gone, where no publisher or recovery runs; each accepted only when it is the place of the journal's owner or of an owner a stopped recovery claim of its chain records ({@link requireGoneOwnersOf}), never taken without the learner. @param options.system - The system whose processes and boot the owner of a journal or a claim is judged by ({@link SYSTEM_HERE}, which the CLI passes). @example await recoverWikiPublication({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function recoverWikiPublication({ projectRoot, outputDirectory, stageDirectory, goneOwners = [], system = SYSTEM_HERE }) {
  // The read of this recovery's owner, which judges a journal's or a claim's owner and names its own, starts now and runs beside the steps before them.
  ownerHere(system);
  const paths = await locations(projectRoot, outputDirectory, stageDirectory), { journal } = paths;
  // Every write and move below is held to the look the paths were resolved with.
  const requirePathHeld = await holdOfPath(paths, []);
  const found = await regularBytes(journal, true);
  // A journal found here is one a stopped publish or recovery left; this recovery writes its own below.
  const isResumed = found !== undefined;
  // A place confirmed gone names the owner of a journal or of its claims; without a journal it names none.
  if (goneOwners.length > 0 && !isResumed) throw new Error(goneOwnerRefusalOf(goneOwners[0], undefined, []));
  const opened = isResumed ? await resumeJournal(found, paths, requirePathHeld, { system, goneOwners }) : await startManifestRecovery(paths, requirePathHeld, system);
  if (opened.result !== undefined) return opened.result;
  const { record, bytes, claims } = opened;
  let completed = false, result;
  try {
    await requirePathHeld();
    if (!(await regularBytes(journal)).equals(bytes)) throw new Error('The Wiki publication journal changed during recovery.');
    result = record.operation === 'restore-manifest' ? await recoverManifestJournal(record, paths, requirePathHeld, isResumed) : await recoverPublishJournal(record, paths, requirePathHeld);
    await removeOwnedRecord(journal, bytes);
    completed = true;
  } finally {
    // Keep stopped ancestors on failure: removing them could let a new contender skip an active descendant.
    const cleanup = completed ? claims.reverse() : claims.slice(-1);
    for (const claim of cleanup) await removeOwnedRecord(claim.path, claim.bytes);
  }
  // The ended recovery's journal is gone, so this one starts from the manifest as it is now and writes a journal of its own: it cannot be superseded in turn.
  return result ?? recoverWikiPublication({ projectRoot, outputDirectory, stageDirectory, system });
}

/** Takes up the journal a stopped publish or recovery left: it must name this project and output and a known operation, each place the learner confirmed gone must be its owner's or that of a stopped recovery claim of its chain ({@link requireGoneOwnersOf}), its owner must have exited ({@link requireExited}, by `ownerJudgement`), and the path must hold before the claim ({@link claimRecovery}). Called by {@link recoverWikiPublication}. @returns The journal's record and bytes and the claims taken. @throws The refusal of a journal of another output, of a place confirmed gone that is not its owner's, of an owner that may still run and of a changed path. @example await resumeJournal(bytes, paths, requirePathHeld, { system: SYSTEM_HERE }) // => { record: { operation: 'publish', … }, bytes, claims: [{ path, bytes }] } */
async function resumeJournal(bytes, { root, output, journal }, requirePathHeld, ownerJudgement) {
  const record = JSON.parse(bytes);
  if (record?.projectRoot !== root || record.output !== output || !['publish', 'restore-manifest', undefined].includes(record.operation))
    throw new Error('The Wiki publication journal does not identify this output; inspect it without moving files.');
  await requireGoneOwnersOf(record, journal, bytes, ownerJudgement.goneOwners);
  await requireExited(record, ownerJudgement);
  await requirePathHeld();
  return { record, bytes, claims: await claimRecovery(journal, bytes, ownerJudgement) };
}

/** Starts the recovery of an edited manifest when no journal stands: the retained publication must be there, a manifest that is the retained one needs nothing, and otherwise this recovery's own journal is written ({@link manifestJournalOf}) while the path holds; a journal written after a swap is this recovery's own, and it is removed with the refusal. Called by {@link recoverWikiPublication}. @returns `{ result }` when the manifest is current; the journal's record and bytes, with no claims, otherwise. @throws The refusal of a Wiki without a retained publication, and of a changed path. @example await startManifestRecovery(paths, requirePathHeld, SYSTEM_HERE) // => { result: { status: 'published-current', output: '/repo/.codebook/wiki' } } */
async function startManifestRecovery(paths, requirePathHeld, system) {
  const { root, output, journal } = paths;
  const state = await recoveryState(root, output, paths.stage);
  if (!state || !state.receipt && !state.legacyRecovery) throw new Error('No retained Wiki publication is available for recovery.');
  if (state.actual && state.actual.equals(state.bytes)) return { result: { status: 'published-current', output } };
  const record = await manifestJournalOf(state, paths, system), bytes = Buffer.from(JSON.stringify(record));
  await requirePathHeld();
  await writeFile(journal, bytes, { flag: 'wx' });
  await requirePathHeld().catch(async error => { await removeOwnedRecord(journal, bytes); throw error; });
  return { record, bytes, claims: [] };
}

/** The journal of a recovery of an edited manifest: the retained manifest's digest, the edited one's (null for a missing manifest), where the edit is kept beside the Wiki and where the staging file goes, by a new id, the prepared stage of a legacy adoption, and its owner as `system` tells it ({@link ownerHere}). Called by {@link startManifestRecovery}. @example await manifestJournalOf(state, paths, SYSTEM_HERE) // => { projectRoot: '/repo', output: '/repo/.codebook/wiki', operation: 'restore-manifest', … } */
async function manifestJournalOf(state, { root, output, stage }, system) {
  const id = randomUUID();
  return { projectRoot: root, output, operation: 'restore-manifest', pid: process.pid, owner: await ownerHere(system), id, manifestSha256: digest(state.bytes),
    modifiedManifestSha256: state.actual ? digest(state.actual) : null,
    modifiedManifestBackup: output + '.modified-manifest-' + id + '.json', temporaryManifest: join(output, '.codebook-restore-' + id + '.json'), sourceStage: state.legacyRecovery ? stage : undefined };
}

/** Whether a metadata recovery journal is whole: the retained manifest's digest, the edited one's or null, its id, and the paths of the kept edit and of the staging file that id names. Called by {@link recoverManifestJournal}. @example isManifestJournal(record, '/repo/.codebook/wiki') // => true for a journal the publisher wrote */
const isManifestJournal = (record, output) => HASH.test(record.manifestSha256) && (record.modifiedManifestSha256 === null || HASH.test(record.modifiedManifestSha256)) &&
  isRecordId(record.id) && record.modifiedManifestBackup === output + '.modified-manifest-' + record.id + '.json' && record.temporaryManifest === join(output, '.codebook-restore-' + record.id + '.json');

/** Recovers an edited manifest by its journal ({@link restoreManifestHeld}). Called by {@link recoverWikiPublication}. @returns `manifest-restored`, with where the edit is kept; undefined for a superseded recovery, which leaves no result: its journal is removed and the recovery runs again. @throws The refusal of an invalid journal, and what the restore refuses. @example await recoverManifestJournal(record, paths, requirePathHeld, false) // => { status: 'manifest-restored', output: '/repo/.codebook/wiki', modifiedManifestBackup: '/repo/.codebook/wiki.modified-manifest-….json' } */
async function recoverManifestJournal(record, paths, requirePathHeld, isResumed) {
  const { output } = paths;
  if (!isManifestJournal(record, output)) throw new Error('The Wiki metadata recovery journal is invalid.');
  return restoreManifestHeld(record, paths, requirePathHeld, isResumed).then(
    () => ({ status: 'manifest-restored', output, modifiedManifestBackup: record.modifiedManifestSha256 === null ? undefined : record.modifiedManifestBackup }),
    error => { if (error.isSupersededRestore) return undefined; throw error; });
}

/** Whether a path a publish journal names is an entry of its own directly beside the output, in the normal form the publisher writes it in: a journal a cloned repository carries can name the output's parent followed by `..` or `.`, whose parent folder is the output's too, and the recovery would take the folder it leads to (the project root, the output's parent) for the candidate and remove its files. The resolved path must be the path itself, so no `..`, `.`, doubled or trailing separator stands in it, and its name must be neither empty nor the output's. Called by {@link isSiblingStage} and {@link isSiblingBackup}. @example isSiblingPath('/repo/.codebook/..', '/repo/.codebook/wiki') // => false */
const isSiblingPath = (path, output) => typeof path === 'string' && resolve(path) === path && basename(path) !== '' && dirname(path) === dirname(output) && path !== output;

/** Whether a publish journal's stage is a distinct sibling of the output in its normal form ({@link isSiblingPath}). Called by {@link requirePublishJournal}. @example isSiblingStage('/repo/.codebook/next', '/repo/.codebook/wiki') // => true */
const isSiblingStage = (stage, output) => isSiblingPath(stage, output);

/** Whether a publish journal names no backup, or a backup beside the output in its normal form ({@link isSiblingPath}) under the name the publisher gives it ({@link isPublishersOwnName}): the backup is named in the recovery's answer and refusals, so a journal a cloned repository carries brings no text of its own into them. Called by {@link requirePublishJournal}. @example isSiblingBackup('/repo/.codebook/wiki.previous-6f1c2a7e-…', '/repo/.codebook/wiki') // => true */
const isSiblingBackup = (backup, output) => backup === undefined || isSiblingPath(backup, output) && isPublishersOwnName(backup, output, '.previous-');

/** Whether a path is a name the publisher gives an entry beside the output by itself: the output's path, the kind (`.previous-` for the kept prior Wiki, `.stage-` for the candidate --prepare names without --stage) and a random UUID ({@link isRecordId}), so it holds no text but the output's own and hex. Called by {@link isSiblingBackup} and {@link nameableStageOf}. @example isPublishersOwnName('/repo/.codebook/wiki.stage-6f1c2a7e-…', '/repo/.codebook/wiki', '.stage-') // => true */
const isPublishersOwnName = (path, output, kind) => path.startsWith(output + kind) && isRecordId(path.slice((output + kind).length));

/** The stage of a publish journal as the recovery may name it to the agent: the journal's stage when its name holds no text of the journal's own, the name --prepare gives a candidate ({@link isPublishersOwnName}) or the stage the caller gave with --stage; undefined otherwise, as an agent's own name is to a recovery not given it again. Called by {@link recoverPublishJournal} and {@link restoreCandidateOfJournal}. @example nameableStageOf({ stage: '/repo/.codebook/next $(touch x)' }, { output: '/repo/.codebook/wiki', stage: undefined }) // => undefined */
const nameableStageOf = (record, paths) => record.stage === paths.stage || isPublishersOwnName(record.stage, paths.output, '.stage-') ? record.stage : undefined;

/** The refusal of a recovery whose candidate could not be put back when the recovery may not name that candidate ({@link nameableStageOf}). Read by {@link restoreCandidateOfJournal}. */
const UNREPEATED_STAGE_REFUSAL = 'The candidate the Wiki publication journal names could not be put back as prepared, and the journal was kept. Its name comes from the journal alone, so it is not repeated here. Run --recover with --stage set to the candidate you prepared to see why.';

/** Puts back the candidate of a stopped publish ({@link restoreStoppedCandidate}) and answers its refusal without the candidate's name where the recovery may not name it ({@link nameableStageOf}) and the refusal holds that name, as a refusal of the file system does: the refusal is then {@link UNREPEATED_STAGE_REFUSAL}, with the one it replaces as its cause, so no text of the journal's reaches the agent. Called by {@link recoverPublishJournal}, {@link keepCurrentWiki} and {@link restorePriorWiki}. @throws The refusal, or the one that names no candidate. @example await restoreCandidateOfJournal(record, wiki, paths, requirePathHeld) */
const restoreCandidateOfJournal = (record, wiki, paths, requirePathHeld) => restoreStoppedCandidate(record, wiki, paths, requirePathHeld).catch(error => {
  throw nameableStageOf(record, paths) === undefined && String(error?.message).includes(basename(record.stage)) ? new Error(UNREPEATED_STAGE_REFUSAL, { cause: error }) : error;
});

/** Whether a publish journal names the generations it moves: the new manifest's digest, whether the prior Wiki was adopted as legacy and, with a backup, the prior manifest's digest. Called by {@link requirePublishJournal}. @example namesGenerations({ manifestSha256: '…', priorLegacy: false }) // => true for a journal without a backup */
const namesGenerations = record => HASH.test(record.manifestSha256) && typeof record.priorLegacy === 'boolean' && (record.backup === undefined || HASH.test(record.priorManifestSha256));

/** Whether a publish journal's stage is, on this file system, the Wiki folder or the kept prior Wiki under another name: a file system that ignores the case of names (macOS, Windows), or that takes a short name or a name with a trailing dot for the same entry (Windows), gives one folder several names beside the output, and the recovery would take the Wiki for the candidate and remove the learner's files from it, each the same bytes as itself. The stage is one of them by device and file id ({@link isSameFileId}), or by its real path, which `realpath` names as `realpath.native` does: in the case, the long name and the form without a trailing dot that the folder has on macOS and Windows, so a volume that answers a file id of 0 for every entry (some SMB and FAT volumes) is judged too. Called by {@link requireStageOfItsOwn}. @example await isOtherNameOfAGeneration('/repo/.codebook/WIKI', '/repo/.codebook/wiki', undefined) // => true where names of another case name one folder */
async function isOtherNameOfAGeneration(stage, output, backup) {
  const [stageLook, ...generationLooks] = await Promise.all([stage, output, backup].map(entryLookOf));
  return generationLooks.some(look => isSameFileId(stageLook.status, look.status) || stageLook.real !== undefined && stageLook.real === look.real);
}

/** How the file system names an entry: its status, read without following it and with bigint ids, and its real path; each undefined where it cannot be read, as for a missing entry, and both for no path. Called by {@link isOtherNameOfAGeneration}. @example await entryLookOf('/repo/.codebook/WIKI') // => { status: <BigIntStats>, real: '/repo/.codebook/wiki' } where names of another case name one folder */
const entryLookOf = async path => path === undefined ? {} : { status: await lstat(path, { bigint: true }).catch(() => undefined), real: await realpath(path).catch(() => undefined) };

/** Whether two statuses, both read, name one file by a file id that tells: the same device and file id ({@link isSameFile}), the id not 0, which some volumes answer for every entry. Called by {@link isOtherNameOfAGeneration}. @example isSameFileId({ dev: 1n, ino: 0n }, { dev: 1n, ino: 0n }) // => false */
const isSameFileId = (status, other) => status !== undefined && other !== undefined && status.ino !== 0n && isSameFile(status, other);

/** The refusal of a publish journal that names no sibling stage or backup of its own. Read by {@link requirePublishJournal} and {@link requireStageOfItsOwn}. */
const SIBLING_JOURNAL_REFUSAL = 'The Wiki publication journal does not identify a sibling stage/backup.';

/** Refuses a publish journal whose stage is, as the folders stand now, the Wiki folder or the kept prior Wiki under another name ({@link isOtherNameOfAGeneration}). Called by {@link requirePublishJournal} before anything the journal names is read or moved, and by {@link restoreStoppedCandidate} before each removal and write in the candidate, since a Wiki folder that was missing at the first check may stand by then, moved back from its backup name ({@link restorePriorWiki}). @throws The refusal of {@link SIBLING_JOURNAL_REFUSAL}; the journal is preserved. @example await requireStageOfItsOwn({ stage: '/repo/.codebook/WIKI', backup: undefined }, '/repo/.codebook/wiki') // throws where names of another case name one folder */
async function requireStageOfItsOwn(record, output) {
  if (await isOtherNameOfAGeneration(record.stage, output, record.backup)) throw new Error(SIBLING_JOURNAL_REFUSAL);
}

/** Refuses a publish journal that names no sibling stage or backup, a stage that is the Wiki folder or the kept prior Wiki under another name ({@link requireStageOfItsOwn}), or, for this version's publish, not the generations it moves. Called by {@link recoverPublishJournal} before anything the journal names is read or moved. @throws The refusal of the journal; it is preserved. @example await requirePublishJournal(record, '/repo/.codebook/wiki') */
async function requirePublishJournal(record, output) {
  if (!isSiblingStage(record.stage, output) || !isSiblingBackup(record.backup, output)) throw new Error(SIBLING_JOURNAL_REFUSAL);
  await requireStageOfItsOwn(record, output);
  if (record.operation === 'publish' && !namesGenerations(record)) throw new Error('The Wiki publication journal is missing generation identity; it was preserved.');
}

/** Recovers a stopped publish by its journal: the Wiki that stands is kept ({@link keepCurrentWiki}), else the kept prior Wiki is moved back ({@link restorePriorWiki}), else there was none and the candidate is reported where the recovery may name it ({@link nameableStageOf}). The record's retained manifest decides which generation stands; an edit of the published manifest since is left to the next recovery. Called by {@link recoverWikiPublication}. @returns `published-or-restored`, `previous-restored` or `no-prior-wiki`, the last with the stage only where the recovery may name it. @throws The refusal of an invalid journal, and what the steps refuse. @example await recoverPublishJournal(record, paths, requirePathHeld) // => { status: 'no-prior-wiki', stage: '/repo/.codebook/next' } */
async function recoverPublishJournal(record, paths, requirePathHeld) {
  const { root, output } = paths;
  await requirePublishJournal(record, output);
  const current = await inspectOutput(output, root, { allowLegacy: record.operation === undefined || record.priorLegacy === true, allowManifestDrift: true });
  if (current) return keepCurrentWiki(record, current, paths, requirePathHeld);
  if (record.backup) return restorePriorWiki(record, paths, requirePathHeld);
  await restoreCandidateOfJournal(record, null, paths, requirePathHeld);
  return { status: 'no-prior-wiki', stage: nameableStageOf(record, paths) };
}

/** Keeps the Wiki that stands after a stopped publish: for this version's publish it must be the prior or the new generation, and the new one must have its record. What the stopped publish left in its candidate goes ({@link restoreCandidateOfJournal}) whichever generation stands: the manifest's digest cannot tell them apart for a candidate byte-identical to the Wiki (prepared and published without an edit), and a candidate that became the Wiki is gone, which that step leaves at once. Called by {@link recoverPublishJournal}. @returns `published-or-restored`, with the backup the journal names. @throws The refusal of a Wiki of neither generation, and of a new one without its record. @example await keepCurrentWiki(record, current, paths, requirePathHeld) // => { status: 'published-or-restored', output: '/repo/.codebook/wiki', previousOutput: undefined } */
async function keepCurrentWiki(record, current, paths, requirePathHeld) {
  const isPublish = record.operation === 'publish', isNewGeneration = digest(current.bytes) === record.manifestSha256;
  if (isPublish && ![record.manifestSha256, record.priorManifestSha256].includes(digest(current.bytes)))
    throw new Error('The current Wiki does not match the interrupted publication.');
  if (isPublish && isNewGeneration && !current.receipt)
    throw new Error('The newly published Wiki is missing its publication record.');
  await restoreCandidateOfJournal(record, current, paths, requirePathHeld);
  return { status: 'published-or-restored', output: paths.output, previousOutput: record.backup };
}

/** Moves the prior Wiki a stopped publish kept beside the Wiki folder back into its place: it is read and moved there, so it is held to the rule of the output ({@link requireRegularFolder}) and must be the generation the journal names; then what the stopped publish left in its candidate goes ({@link restoreCandidateOfJournal}). Called by {@link recoverPublishJournal}. @returns `previous-restored`. @throws The refusal of a kept Wiki that is no folder of its own or of another generation, and of a changed path. @example await restorePriorWiki(record, paths, requirePathHeld) // => { status: 'previous-restored', output: '/repo/.codebook/wiki' } */
async function restorePriorWiki(record, paths, requirePathHeld) {
  const { root, output } = paths;
  await requireRegularFolder(record.backup, root, paths.isOutputInProject, backupRefusalOf);
  const prior = await inspectOutput(record.backup, root, { allowLegacy: true });
  if (!prior || record.priorManifestSha256 && digest(prior.bytes) !== record.priorManifestSha256) throw new Error('The prior Wiki does not match the publication journal.');
  await requirePathHeld();
  await renameRetried(record.backup, output);
  await restoreCandidateOfJournal(record, prior, paths, requirePathHeld);
  return { status: 'previous-restored', output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const mode = ['--prepare', '--recover'].includes(args[0]) ? args.shift() : 'publish';
  // A recovery alone takes the places the learner confirmed gone, one --gone-host and --gone-space pair for each place.
  const repeated = new Set(mode === '--recover' ? ['--gone-host', '--gone-space'] : []);
  const allowed = new Set(['--project', '--output', '--stage', ...repeated]);
  const flags = new Set(mode === '--prepare' ? ['--adopt-existing'] : mode === 'publish' ? ['--render-only'] : []);
  const options = {}, gone = { '--gone-host': [], '--gone-space': [] }, seen = new Set();
  let valid = true;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key) && !repeated.has(key)) { valid = false; break; }
    seen.add(key);
    if (flags.has(key)) options[key] = true;
    else if (allowed.has(key) && args[index + 1] && !args[index + 1].startsWith('--')) {
      if (repeated.has(key)) gone[key].push(args[++index]);
      else options[key] = args[++index];
    } else { valid = false; break; }
  }
  // Each place confirmed gone has its host name and its space: the nth --gone-host pairs with the nth --gone-space.
  if (!valid || !options['--project'] || !options['--output'] || mode === 'publish' && !options['--stage'] || gone['--gone-host'].length !== gone['--gone-space'].length) {
    console.error('Usage: node publish-wiki.mjs --prepare --project ROOT --output WIKI [--stage NEW_STAGE] [--adopt-existing]\n       node publish-wiki.mjs --project ROOT --output WIKI --stage STAGE [--render-only]\n       node publish-wiki.mjs --recover --project ROOT --output WIKI [--stage PREPARED_STAGE] [--gone-host HOST --gone-space SPACE]...');
    process.exitCode = 2;
  } else {
    const operation = mode === '--prepare' ? prepareWikiStage : mode === '--recover' ? recoverWikiPublication : publishWiki;
    const goneOwners = gone['--gone-host'].map((host, index) => ({ host, space: gone['--gone-space'][index] }));
    // The system the publisher runs on is the one its owner judgement asks ({@link SYSTEM_HERE}).
    operation({ projectRoot: options['--project'], outputDirectory: options['--output'], stageDirectory: options['--stage'], adoptExisting: options['--adopt-existing'] === true, renderOnly: options['--render-only'] === true, goneOwners, system: SYSTEM_HERE })
      .then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(String(error)); process.exitCode = 1; });
  }
}
