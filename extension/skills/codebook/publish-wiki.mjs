import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderWikiPages } from './render-wiki.mjs';

const MANIFEST = 'codebook-wiki.json';
const RECEIPT = 'codebook-publication.json';
const HASH = /^[a-f0-9]{64}$/;
const reserved = path => [MANIFEST, RECEIPT].includes(path.split('/')[0].toLowerCase());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = path => typeof path === 'string' && path !== '' && !isAbsolute(path) && !/[\\\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const isMissing = error => error.code === 'ENOENT';

/** Whether bytes start with a signature, at an offset: a format's first bytes. Called by the tests of {@link RASTER_ASSET_FORMATS}. @example startsWith(Buffer.from('GIF89a'), 'GIF89a') // => true */
const startsWith = (bytes, signature, at = 0) => bytes.subarray(at, at + signature.length).equals(Buffer.from(signature, 'latin1'));

/** The brands an ISO media file names in its first box (`ftyp`): the major brand, then each compatible one, up to the box's end. Called by the AVIF test of {@link RASTER_ASSET_FORMATS}. @example brandsOf(Buffer.from('\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00mif1avif', 'latin1')) // => ['mif1', 'mif1', 'avif'] */
const brandsOf = bytes => {
  const end = Math.min(bytes.length, bytes.length >= 4 ? bytes.readUInt32BE(0) : 0), brands = [bytes.toString('latin1', 8, 12)];
  // The compatible brands follow the minor version, four bytes each.
  for (let at = 16; at + 4 <= end; at += 4) brands.push(bytes.toString('latin1', at, at + 4));
  return brands;
};

/** The formats an asset may have, by its extension in lower case, each with the test of the bytes it starts with: the raster images an article shows. Nothing else may be an asset: an HTML, SVG, script or style file would run or fetch in a page opened from disk, where no reader sends a policy. Read by {@link requireRasterAsset}. */
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

/** Refuses an asset of a candidate that is no raster image ({@link RASTER_ASSET_FORMATS}) by its extension and by its first bytes, before anything is written; the asset is read as a regular file of the stage, never through a link ({@link regularBytes}). The learner's own files in the Wiki folder, which no manifest lists, are not judged. Called by {@link publishWiki} for every asset its manifest lists. @example await requireRasterAsset('/repo/.codebook/next', 'assets/notes.html') // throws: Wiki asset assets/notes.html must be a PNG, JPEG, GIF, WebP or AVIF image, … */
async function requireRasterAsset(stage, path) {
  if (!formatTestOf(path)(await regularBytes(join(stage, path))))
    throw new Error('Wiki asset ' + path + ' must be a PNG, JPEG, GIF, WebP or AVIF image, named .png, .jpg, .jpeg, .gif, .webp or .avif and holding the bytes of that format.');
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

/** The refusal of an output inside the project whose path passes through a folder that is no folder of the project's own, for the path it names; for {@link requireOwnFolder} and {@link requireStageWhereItWasMade}. @example linkedPathRefusalOf('/repo/.codebook') // => 'The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: /repo/.codebook. …' */
const linkedPathRefusalOf = path => 'The Wiki output lies inside the project, but its path passes through a link or an entry that is no folder of the project’s own: ' + path + '. Nothing was written. Replace it with a real folder, or choose an output folder outside the project.';

/** The refusal of the prior Wiki an interrupted publish kept beside the Wiki folder when it is no folder of its own, for {@link recoverWikiPublication}; recovery moves nothing then. @example backupRefusalOf('/repo/.codebook/wiki.previous-1') // => 'The prior Wiki kept at /repo/.codebook/wiki.previous-1 is a link, a file or a folder that leads out of the project. …' */
const backupRefusalOf = path => 'The prior Wiki kept at ' + path + ' is a link, a file or a folder that leads out of the project. Nothing was moved. Inspect it, then run --recover again.';

/** Refuses an entry on the output's path inside the project that is no folder of the project's own: a link, a file, or a folder whose real path leaves the project (a junction on Windows that lstat calls a directory). Called by {@link enteredProjectAt} for the folders above the output, and by {@link requireRegularFolder} for the output and its stage. @example await requireOwnFolder('/repo/wiki-link', stat, '/repo') // throws while wiki-link is a link */
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

/** Removes folders the preparation or the publish made, in the order given, each with rmdir: that removes only an empty folder and follows no link at its own name, so a folder that holds something now, or is gone, stays as it is. Called by {@link createParentOf}, {@link requireStageWhereItWasMade} and {@link makeFolderHeld} before they refuse. @example await removeMadeFolders(['/repo/.codebook/wiki.stage-1', '/repo/.codebook']) */
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

/** Whether the output's parent, and the entries beside the output given with it, still lie where the paths were resolved: their real paths inside the project, and the parent still the folder, by device and inode, it was then. A folder that cannot be looked at counts as moved. Called by {@link requireStageWhereItWasMade} and {@link holdOfPath}. @example await isWhereItWasResolved('/repo/.codebook', parentIdentity, ['/repo/.codebook/wiki.stage-1'], '/repo') // => false once .codebook was swapped for a link */
const isWhereItWasResolved = (parent, identity, entries, root) => Promise.all([stat(parent), ...[parent, ...entries].map(path => realpath(path))]).then(
  ([now, ...realPaths]) => realPaths.every(real => isInProject(root, real)) && now.dev === identity.dev && now.ino === identity.ino,
  () => false);

/** Takes the look at the output's parent once the paths are resolved, for a publish or a recovery, and answers the check that holds every later write to it: for an output inside the project, the parent and `entries` must still be where they were ({@link isWhereItWasResolved}), or the step is refused with the parent's sentence. The race left is the one {@link requireStageWhereItWasMade} names. Called by {@link publishWiki} and {@link recoverWikiPublication}. @returns The check, which resolves when the path still holds and throws otherwise. @example const requirePathHeld = await holdOfPath(paths, [paths.stage]); await requirePathHeld() // throws once .codebook was swapped for a link */
async function holdOfPath(paths, entries) {
  const parent = dirname(paths.output), identity = await stat(parent);
  return async () => {
    if (!paths.isOutputInProject || await isWhereItWasResolved(parent, identity, entries, paths.root)) return;
    throw new Error(linkedPathRefusalOf(parent));
  };
}

/** Makes a folder in the stage, then holds the path ({@link holdOfPath}) before anything is written into it; a refusal removes the folders this mkdir made ({@link removeMadeFolders}). Called by {@link publishWiki} for the folder of each page and each kept manual file. @example await makeFolderHeld('/repo/.codebook/next/pages', requirePathHeld) */
async function makeFolderHeld(folder, requirePathHeld) {
  const madeFolders = madeFoldersOf(await mkdir(folder, { recursive: true }), folder);
  try { await requirePathHeld(); } catch (error) { await removeMadeFolders(madeFolders); throw error; }
}

/** Refuses a stage that no longer lies where the preparation made it, before anything is written into it: for an output inside the project, another process may have swapped a folder on the path for a link since the path was looked at ({@link isWhereItWasResolved}). The stage and the folders the preparation made are then removed, each empty ({@link removeMadeFolders}). The race left: between this check and each later write or move, such a swap can still lead the write elsewhere; Node's file system has no call that writes relative to a folder it holds open, so no check closes that window. Called by {@link prepareWikiStage} once its stage stands. @example await requireStageWhereItWasMade(paths, '/repo/.codebook/wiki.stage-1', parentIdentity) // throws once .codebook leads out of the project */
async function requireStageWhereItWasMade(paths, stage, parentIdentity) {
  const parent = dirname(paths.output);
  if (!paths.isOutputInProject || await isWhereItWasResolved(parent, parentIdentity, [stage], paths.root)) return;
  await removeMadeFolders([stage, ...paths.madeFolders]);
  throw new Error(linkedPathRefusalOf(parent));
}

/** Handles the CLI preparation step before agent edits, retaining current output and an exact recovery baseline. @example await prepareWikiStage({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function prepareWikiStage({ projectRoot, outputDirectory, stageDirectory, adoptExisting = false }) {
  const paths = await locations(projectRoot, outputDirectory, stageDirectory, true);
  const { root, output, journal } = paths, stage = paths.stage ?? output + '.stage-' + randomUUID();
  // The folder the paths were resolved in, by device and inode, so a swap on the path before the stage is written is seen.
  const parentIdentity = await stat(dirname(output));
  await requireNoJournal(journal);
  const prior = await inspectOutput(output, root, { allowLegacy: adoptExisting });
  await mkdir(stage); // An existing candidate is never overwritten or silently reused.
  await requireStageWhereItWasMade(paths, stage, parentIdentity);
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
  const paths = await locations(projectRoot, outputDirectory, stageDirectory), { root, output, stage, journal } = paths;
  if (!stage) throw new Error('The Wiki publisher requires a prepared stage.');
  // Every write below is held to the look the paths were resolved with.
  const requirePathHeld = await holdOfPath(paths, [stage]);
  await requireNoJournal(journal);
  const bytes = await regularBytes(join(stage, MANIFEST)), { manifest, owned } = parseManifest(bytes, root);
  const files = await listFiles(stage);
  if (files.some(path => ![MANIFEST, RECEIPT].includes(path) && !owned.has(path))) throw new Error('The staged Wiki contains a file outside its published manifest.');
  // An asset is a raster image or nothing; checked before anything is rendered or written.
  for (const path of manifest.assets) await requireRasterAsset(stage, path);
  // Validate authored content without modifying either the stage or published output.
  const rendered = await renderWikiPages(manifest, { projectRoot: root, outputDirectory: output });
  const receipt = await readReceipt(stage, root, true);
  if (!receipt || receipt.output !== output) throw new Error('Use --prepare before editing a Wiki candidate for this output.');
  if (receipt.kind === 'published' && digest(bytes) !== receipt.manifestSha256) throw new Error('A previously finalized candidate changed. Preserve it and use --prepare again.');
  const inspectPrior = () => inspectOutput(output, root, { allowLegacy: receipt.baseline?.legacy === true });
  let prior = await inspectPrior();
  assertBaseline(receipt.baseline, prior);
  for (const [path, html] of rendered) {
    await makeFolderHeld(dirname(join(stage, path)), requirePathHeld);
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
    await requirePathHeld();
    prior = await inspectPrior();
    assertBaseline(receipt.baseline, prior);
    const manual = prior ? prior.files.filter(path => ![MANIFEST, RECEIPT].includes(path) && !prior.owned.has(path)) : [];
    const manualHashes = Object.create(null);
    for (const path of manual) {
      if ([...owned].some(ownedPath => ownedPath === path || ownedPath.startsWith(path + '/') || path.startsWith(ownedPath + '/')))
        throw new Error('A manual Wiki file conflicts with the update: ' + path);
      const content = await regularBytes(join(output, path));
      manualHashes[path] = digest(content);
      await makeFolderHeld(dirname(join(stage, path)), requirePathHeld);
      await writeFile(join(stage, path), content, { flag: 'wx' });
    }
    await requirePathHeld();
    await writeFile(join(stage, MANIFEST), manifestText);
    await writeFile(join(stage, RECEIPT), JSON.stringify({ ...receipt, kind: 'published', manifestSha256: record.manifestSha256, manifestText }));
    // Recheck after acquiring the journal and copying files; a stale generation cannot win a later swap.
    const current = await inspectPrior();
    assertBaseline(receipt.baseline, current);
    const currentManual = current ? current.files.filter(path => ![MANIFEST, RECEIPT].includes(path) && !current.owned.has(path)) : [];
    if (currentManual.length !== manual.length) throw new Error('Manual Wiki files changed during publication; output was preserved.');
    for (const path of currentManual) if (manualHashes[path] !== digest(await regularBytes(join(output, path)))) throw new Error('A manual Wiki file changed during publication: ' + path);
    await requirePathHeld();
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
  // Every write and move below is held to the look the paths were resolved with.
  const requirePathHeld = await holdOfPath(paths, []);
  let bytes = await regularBytes(journal, true), record, claims = [];
  if (bytes) {
    record = JSON.parse(bytes);
    if (record?.projectRoot !== root || record.output !== output || !['publish', 'restore-manifest', undefined].includes(record.operation))
      throw new Error('The Wiki publication journal does not identify this output; inspect it without moving files.');
    requireExited(record.pid);
    await requirePathHeld();
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
    await requirePathHeld();
    await writeFile(journal, bytes, { flag: 'wx' });
    // A journal written after a swap is this recovery's own; it is removed with the refusal.
    await requirePathHeld().catch(async error => { await removeOwnedRecord(journal, bytes); throw error; });
  }
  let completed = false;
  try {
    await requirePathHeld();
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
        // The kept prior Wiki is read and moved into the Wiki folder's place, so it is held to the rule of the output.
        await requireRegularFolder(record.backup, root, paths.isOutputInProject, backupRefusalOf);
        const prior = await inspectOutput(record.backup, root, { allowLegacy: true });
        if (!prior || record.priorManifestSha256 && digest(prior.bytes) !== record.priorManifestSha256) throw new Error('The prior Wiki does not match the publication journal.');
        await requirePathHeld();
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
