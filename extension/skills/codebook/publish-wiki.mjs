import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rmdir, stat, unlink } from 'node:fs/promises';
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

/** Moves a folder or file as `rename` does, and tries again, a bounded number of times with a growing wait ({@link RENAME_TRIES}), while the move fails with an error that passes once another process lets go of it ({@link PASSING_RENAME_ERRORS}); any other error, and the last passing one, is passed on at once. Called by {@link publishWiki} for the moves of the swap, by {@link undoRefusedPublish} for the move of the prior Wiki back, by {@link replaceOwnFileThrough} for the move of a file into its name, and by {@link restorePriorWiki} and {@link restoreManifest} for the moves of a recovery. @throws What the last try of `rename` rejects with. @example await renameRetried('/repo/.codebook/wiki', '/repo/.codebook/wiki.previous-1') // resolves after a passing EBUSY */
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

/** Refuses an asset of a candidate that is no raster image ({@link RASTER_ASSET_FORMATS}) by its extension and by its first bytes, before anything is written; the asset is read as a regular file of the stage, never through a link ({@link regularBytes}). The learner's own files in the Wiki folder, which no manifest lists, are not judged. Called by {@link readCandidateManifest} for every asset the candidate's manifest lists. @example await requireRasterAsset('/repo/.codebook/next', 'assets/notes.html') // throws: Wiki asset assets/notes.html is not a PNG, JPEG, GIF, WebP or AVIF image by its name or its first bytes. … */
async function requireRasterAsset(stage, path) {
  if (!formatTestOf(path)(await regularBytes(join(stage, path))))
    throw new Error('Wiki asset ' + path + ' is not a PNG, JPEG, GIF, WebP or AVIF image by its name or its first bytes. Nothing was written. Convert it to one of these formats, or delete the file from the stage and its entry from assets, then publish again.');
}

/** The refusal of a Wiki manifest that is no JSON object: one a cloned repository carries may hold any text, which the parser's error would quote. Read by {@link parseManifest} and {@link manifestSyntaxRefusalOf}. */
const INVALID_MANIFEST_REFUSAL = 'The Wiki manifest is not a JSON object; its text is not repeated here.';

/** The whitespace JSON allows between its tokens. Read by {@link jsonSyntaxErrorOffsetOf}. */
const JSON_WHITESPACE = new Set([' ', '\t', '\n', '\r']);
/** A JSON string and a JSON number, each from where it starts, as RFC 8259 writes them. Read by {@link jsonScalarEndOf}. */
const JSON_STRING = /"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y, JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Where a JSON value without parts that starts at an offset ends: a string, a number, `true`, `false` or `null`. Called by {@link valueStep} and {@link keyStep}. @returns The offset after it; undefined where none starts there. @example jsonScalarEndOf('[true]', 1) // => 5 */
function jsonScalarEndOf(text, at) {
  for (const pattern of [JSON_STRING, JSON_NUMBER]) {
    pattern.lastIndex = at;
    if (pattern.test(text)) return pattern.lastIndex;
  }
  const literal = ['true', 'false', 'null'].find(word => text.startsWith(word, at));
  return literal === undefined ? undefined : at + literal.length;
}

/** The state a JSON walk is in after a whole value ({@link JSON_STEPS}): a comma or the end of the container that holds it, or the end of the text at the top. Called by the steps of {@link JSON_STEPS}. @param open - The open objects and arrays, innermost last. @example stateAfterValue(['[']) // => 'comma-or-end' */
const stateAfterValue = open => open.length > 0 ? 'comma-or-end' : 'end';

/** The step of a JSON walk that closes the innermost object or array, at the offset of its end ({@link JSON_STEPS}). Called by the steps of {@link JSON_STEPS} where an end may come. @returns The offset after the end and the state after the container. @example closeContainer(3, ['[']) // => { at: 4, expected: 'end' } */
function closeContainer(at, open) {
  open.pop();
  return { at: at + 1, expected: stateAfterValue(open) };
}

/** The step of a JSON walk where a value must start: an object or an array opens, or a value without parts is read whole ({@link jsonScalarEndOf}). Called by the steps of {@link JSON_STEPS} for a value. @returns The offset after the token and the state after it; undefined where no value starts there. @example valueStep('[1]', 0, []) // => { at: 1, expected: 'value-or-end' } */
function valueStep(text, at, open) {
  const char = text[at];
  if (char === '{' || char === '[') {
    open.push(char);
    return { at: at + 1, expected: char === '{' ? 'key-or-end' : 'value-or-end' };
  }
  const end = jsonScalarEndOf(text, at);
  return end === undefined ? undefined : { at: end, expected: stateAfterValue(open) };
}

/** The step of a JSON walk where an object's key must stand: a whole string ({@link jsonScalarEndOf}). Called by the steps of {@link JSON_STEPS} for a key. @returns The offset after the key and the state of the colon; undefined where no string starts there. @example keyStep('{"a":1}', 1) // => { at: 4, expected: 'colon' } */
function keyStep(text, at) {
  const end = text[at] === '"' ? jsonScalarEndOf(text, at) : undefined;
  return end === undefined ? undefined : { at: end, expected: 'colon' };
}

/** The step of a JSON walk after a value inside an object or an array: the end of that container, or a comma, after which a key or a value comes. Called by the steps of {@link JSON_STEPS}. @returns The offset after the token and the state after it; undefined for any other token. @example commaOrEndStep('[1,2]', 2, ['[']) // => { at: 3, expected: 'value' } */
function commaOrEndStep(text, at, open) {
  const isInObject = open.at(-1) === '{';
  if (text[at] === (isInObject ? '}' : ']')) return closeContainer(at, open);
  return text[at] === ',' ? { at: at + 1, expected: isInObject ? 'key' : 'value' } : undefined;
}

/** The steps of a JSON walk ({@link jsonSyntaxErrorOffsetOf}), by what may come next: a value, a value or the end of an array, a key, a key or the end of an object, a colon, a comma or the end of the open container, or the end of the text. Each step is given the text, the offset of the next token after whitespace and the open objects and arrays, and answers the offset after the token with the state after it, or undefined where the token cannot stand there. A container closes where its end may come: at once after it opened, or after one of its values. */
const JSON_STEPS = {
  value: valueStep,
  'value-or-end': (text, at, open) => text[at] === ']' ? closeContainer(at, open) : valueStep(text, at, open),
  key: keyStep,
  'key-or-end': (text, at, open) => text[at] === '}' ? closeContainer(at, open) : keyStep(text, at),
  colon: (text, at) => text[at] === ':' ? { at: at + 1, expected: 'value' } : undefined,
  'comma-or-end': commaOrEndStep,
  end: () => undefined,
};

/** Where a text stops being JSON: the offset of the first token that cannot stand where it stands (the start of a string, a number or a word that is not whole there), or the text's length where it ends too early. It walks the text with a stack of the open objects and arrays, one step for each token ({@link JSON_STEPS}), so no depth of nesting exhausts the call stack. Called by {@link manifestSyntaxRefusalOf} once the parser refused the text, since the parser's message names no position for every error and quotes the text for some. @returns The offset; undefined for a text that is JSON. @example jsonSyntaxErrorOffsetOf('[1,]') // => 3 */
function jsonSyntaxErrorOffsetOf(text) {
  const open = [];
  let at = 0, expected = 'value';
  for (;;) {
    while (JSON_WHITESPACE.has(text[at])) at++;
    // The text may end only after its one value.
    if (at >= text.length) return expected === 'end' ? undefined : at;
    const step = JSON_STEPS[expected](text, at, open);
    if (step === undefined) return at;
    ({ at, expected } = step);
  }
}

/** The refusal of a Wiki manifest that is no JSON, with the line and the column where its syntax breaks ({@link jsonSyntaxErrorOffsetOf}), both numbers, so the agent finds its own error in a candidate it edits and no text of the manifest is repeated; {@link INVALID_MANIFEST_REFUSAL} where no place is found. Called by {@link parseRecordOf} for {@link parseManifest}. @param text - The manifest as the parser read it. @example manifestSyntaxRefusalOf('{\n  "pages": [1,]\n}') // => 'The Wiki manifest is not a JSON object: its JSON syntax breaks at line 2, column 15; its text is not repeated here.' */
function manifestSyntaxRefusalOf(text) {
  const offset = jsonSyntaxErrorOffsetOf(text);
  if (offset === undefined) return INVALID_MANIFEST_REFUSAL;
  const before = text.slice(0, offset);
  return 'The Wiki manifest is not a JSON object: its JSON syntax breaks at line ' + before.split('\n').length + ', column ' + (offset - before.lastIndexOf('\n')) + '; its text is not repeated here.';
}

/** Parses inventory for {@link publishWiki} and recovery before any owned file can be replaced: the manifest of the Wiki, of the kept prior Wiki or of a candidate, and the one a record retains. A manifest that is no JSON is refused with the line and the column where its syntax breaks ({@link manifestSyntaxRefusalOf}), and JSON that is no object with {@link INVALID_MANIFEST_REFUSAL} ({@link parseRecordOf}), so none of its text reaches the agent. @throws Those refusals, and the refusal of a manifest that names another project, no whole inventory or an unsafe path. @example parseManifest(bytes, '/repo') */
function parseManifest(bytes, projectRoot) {
  const manifest = parseRecordOf(bytes, INVALID_MANIFEST_REFUSAL, manifestSyntaxRefusalOf);
  if (manifest.schemaVersion !== 1 || manifest.repositoryRoot !== projectRoot || !Array.isArray(manifest.pages) || !Array.isArray(manifest.assets))
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

/** Whether a real path is the project root itself or lies below it. Called by {@link isRealPathInProject} and {@link isWhereItWasResolved}. @example isInProject('/repo', '/repo/.codebook') // => true; isInProject('/repo', '/elsewhere') // => false */
const isInProject = (root, path) => { const within = relative(root, path); return within === '' || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep); };

/** Whether the real path of an entry lies in the project; an entry whose real path the system cannot name (`EACCES` for a folder of another user, `EINVAL` for some junctions on Windows) counts as one that leaves it, so it is refused inside the project with the sentence of a link instead of the system's error. Called by {@link isOwnFolder} and {@link enteredProjectAt}. @example await isRealPathInProject('/repo/.codebook', '/repo') // => true for a folder of the project's own */
const isRealPathInProject = (path, root) => realpath(path).then(real => isInProject(root, real), () => false);

/** Looks at one entry without following it; called by {@link enteredProjectAt}, {@link requireRegularFolder}, {@link restoreFinalized}, {@link restoreStoppedCandidate}, {@link finalizingFilesIn} and {@link removeFileOfRun}. @returns The entry's status, or undefined when nothing stands there. @example await lookAt('/repo/.codebook') // => undefined in a project without it */
const lookAt = path => lstat(path).catch(error => { if (isMissing(error)) return undefined; throw error; });

/** Whether an entry is a directory as a look without following answers it: no link and no file. Called by {@link isOwnFolder}. @example isRegularFolder(await lstat('/repo/.codebook/wiki')) // => true for a folder */
const isRegularFolder = stat => stat.isDirectory() && !stat.isSymbolicLink();

/** Whether an entry is a folder of the project's own: a directory as a look without following answers it and, where `mustStayInProject` holds, one whose real path stays in the project, so a junction on Windows to another volume, which lstat calls a directory, is none. Called by {@link requireOwnFolder}, {@link requireRegularFolder} and {@link restoreStoppedCandidate}. @example await isOwnFolder('/repo/.codebook', stat, '/repo', true) // => false while `.codebook` leads out of the project */
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

/** Refuses an output whose path, once it has entered the project, passes through a link or through an entry that is no folder of the project's own, before anything is created, read or written there: the stage, the journal and the backup lie beside the output, so a cloned repository that carries `.codebook` (or any folder on the way) as a link would have the publisher write outside the project. The folders up to the point where the path enters the project are the learner's choice, as is an output outside the project. Called by {@link locations} first, and by {@link createParentOf} again once the output's parent is made. @returns Whether the output's folder lies inside the project, so the output itself is held to the same rule ({@link requireRegularFolder}); false when a folder on the path is missing, so no output stands there yet. @example await requireOwnFoldersToOutput('/repo/wiki-link/wiki', '/repo') // throws while /repo/wiki-link is a link; => true for /repo/.codebook/wiki */
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


/** Refuses a Wiki folder, a stage beside it or the prior Wiki a publish kept beside it that is no folder of its own, with the sentence `refusalOf` words for it: a link, a file or a special file, and, when the output lies inside the project, a folder whose real path leaves the project (a junction on Windows to another volume, which lstat calls a directory), by the rule {@link requireOwnFolder} holds the folders above it to; a path that holds nothing yet passes. Called by {@link locations} for the output and the stage, and by {@link restorePriorWiki} for the kept prior Wiki before it reads or moves it. @example await requireRegularFolder('/repo/.codebook/wiki', '/repo', true, outputRefusalOf) // throws while wiki is a junction to another volume */
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

/** Removes folders the preparation or the publish made, in the order given, each with rmdir: that removes only an empty folder and follows no link at its own name, so a folder that holds something now, or is gone, stays as it is. Called by {@link createParentOf}, {@link prepareWikiStage} and {@link makeFolderHeld} before they refuse, and by {@link removeWritten} after the files it removes. @example await removeMadeFolders(['/repo/.codebook/wiki.stage-1', '/repo/.codebook']) */
async function removeMadeFolders(folders) {
  for (const folder of folders) await rmdir(folder).catch(() => undefined);
}

/** Makes the output's parent, then looks at the output's path again ({@link requireOwnFoldersToOutput}): a folder that was missing at the first look, or that another process swapped for a link since, is refused there, and the folders this call made are removed. The look also says for certain whether the output lies inside the project, since no folder on the path is missing now. Called by {@link locations} for a preparation. @returns Whether the output lies inside the project, and the folders made, deepest first. @example await createParentOf('/repo/.codebook/wiki', '/repo') // => { isOutputInProject: true, madeFolders: ['/repo/.codebook'] } */
async function createParentOf(requested, root) {
  const madeFolders = madeFoldersOf(await mkdir(dirname(requested), { recursive: true }), dirname(requested));
  try { return { isOutputInProject: await requireOwnFoldersToOutput(requested, root), madeFolders }; }
  catch (error) { await removeMadeFolders(madeFolders); throw error; }
}

/** Resolves paths for {@link prepareWikiStage}, {@link publishWiki} and recovery without following directory aliases: the output, the stage, and beside the output the journal and the publish lock ({@link takePublishLock}). @example await locations('/repo', '/repo/.codebook/wiki') */
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
  return { root, output, stage, journal: output + '.publish-journal.json', lock: output + '.publish-lock.json', isOutputInProject, madeFolders };
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

/** Parses and checks the bytes of a publication record, of a candidate or of a published Wiki. Called by {@link readReceipt}, and by {@link readCandidateRecord}, which keeps the candidate's bytes for {@link publishWiki} to put them back after a refusal. @returns The record. @throws The refusal of an invalid record or of an invalid retained manifest. @example parseReceipt(await readFile('/repo/.codebook/next/codebook-publication.json'), '/repo') // => { schemaVersion: 1, kind: 'candidate', … } */
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

/** A refusal of a step whose path no longer holds, marked so that the preparation and the recovery remove what they wrote ({@link removeWritten}); a publish removes what it wrote for every refusal before its swap. Called by {@link holdOfPath}, {@link makeFolderHeld}, {@link restoreManifestHeld} and {@link candidateHoldOf}. @example throw holdRefusalOf(linkedPathRefusalOf('/repo/.codebook')) */
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

/** Takes the look a publish holds each folder of its stage to before it writes into it: the folder's real path must be the stage's real path with the folder's place in it, so no link stands on the way inside the stage, and its device and file id must stay those it had when the publish first wrote there. Called by {@link publishWiki} and {@link prepareWikiStage} for the candidate, by {@link restoreStoppedCandidate} for the candidate of a stopped publish, and by {@link restoreManifestHeld} for the Wiki folder, once each. @returns The look, which answers whether a folder still holds; a folder that cannot be looked at does not, nor does any folder of a stage whose real path could not be named when the look was taken. @example const isFolderWhereItWas = await folderLookOf('/repo/.codebook/next'); await isFolderWhereItWas('/repo/.codebook/next/pages') // => false once pages was swapped for a link */
async function folderLookOf(stage) {
  const realStage = await realpath(stage).catch(() => undefined), firstSeen = new Map();
  return folder => Promise.all([realpath(folder), stat(folder, { bigint: true })]).then(([real, status]) => {
    if (!firstSeen.has(folder)) firstSeen.set(folder, status);
    // A stage whose real path could not be named when the look was taken has nothing to compare with, so no folder of it holds.
    return realStage !== undefined && real === join(realStage, relative(stage, folder)) && isSameFile(status, firstSeen.get(folder));
  }, () => false);
}

/** Makes a folder of the stage, then holds the output's path ({@link holdOfPath}) and the folder itself ({@link folderLookOf}) before anything is written into it; a refusal removes the folders this mkdir made ({@link removeMadeFolders}). Called by {@link heldWriterOf} for the folder of each page and of each kept manual file, before and after its write, by {@link publishWiki} for the stage before its manifest, its record and the moves, and by {@link writeFilesHeld} for each file of a new candidate, before and after its write. @returns The folders this mkdir made, deepest first. @example await makeFolderHeld('/repo/.codebook/next/pages', requirePathHeld, isFolderWhereItWas) // => ['/repo/.codebook/next/pages'] */
async function makeFolderHeld(folder, requirePathHeld, isFolderWhereItWas) {
  const madeFolders = madeFoldersOf(await mkdir(folder, { recursive: true }), folder);
  try {
    await requirePathHeld();
    if (!(await isFolderWhereItWas(folder))) throw holdRefusalOf(stageRefusalOf(folder));
  } catch (error) { await removeMadeFolders(madeFolders); throw error; }
  return madeFolders;
}

/** Whether the entry at a written file's path, looked at without following it, is a regular file with the device and file id the record names ({@link writeOwnFile}). Called by {@link isStillWritten}, {@link removeOwnFile} and {@link replaceOwnFileThrough}. @example await isSameFileAt({ path: '/repo/.codebook/next/index.html', dev: 2049n, ino: 131074n }) // => false once a link stands at the path */
const isSameFileAt = file => lstat(file.path, { bigint: true }).then(status => status.isFile() && isSameFile(status, file), () => false);

/** Writes a new file a step records as its own through one handle, and answers what {@link removeWritten} needs to tell that file from any other at its path: the SHA-256 digest of the bytes, and the device and file id of the file the handle wrote, as bigints (an NTFS file id may lie above 2^53). The open is exclusive ('wx'): it refuses any entry at the name, a link or a second name of another file included, so the write never lands in a file the step did not make. Once another process swaps a folder on the path for a link, the path leads to another file, maybe a published file of the same name and bytes, whose identity this is not. A write that fails answers nothing, and neither does a close that fails, since the bytes it handed on may be lost (a full disk or a quota met at the close on a network or synced file system); the file the open made holds part of the bytes at most then, and is removed ({@link removeOwnFile}) before the failure is passed on, so no partial copy is left that no record names (a full disk, a file size limit). A status read that fails leaves nothing that tells the file the open made from a file another process put at its name since, so the path is kept, and the refusal names it for the learner to judge ({@link unreadStatusRefusalOf}). Called by {@link writeFilesHeld}, {@link replaceOwnFile}, {@link replaceOwnFileThrough}, {@link restoreManifestHeld} and {@link writeWholeRecord}, by {@link publishJournalWriterOf} for the side file of a journal, and by {@link heldWriterOf} for each copy of a learner's file, which {@link copyLearnerFiles} hands it. @returns The file's record: its path, the digest of its bytes, and its `dev` and `ino`. @throws What the open, the write or the close rejects with, the first of them; `EEXIST` while an entry stands at the name; for a status read that fails, the refusal that names the kept file, with that failure as its cause. @example await writeOwnFile('/repo/.codebook/next/codebook-publication.json', receiptText) // => { path: '/repo/.codebook/next/codebook-publication.json', hash: '…', dev: 2049n, ino: 131074n } */
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
  await removeOwnFile(file);
  throw failure;
}

/** The refusal of a write whose status read failed right after its exclusive open made the file ({@link writeOwnFile}): it names the file, which it kept, and the failure. Called by {@link writeOwnFile} and {@link openCopiesList}. @example unreadStatusRefusalOf('/repo/.codebook/next/manual.txt', eioError) // => 'The publisher made /repo/.codebook/next/manual.txt but could not read its status: EIO: i/o error. The file there may be another one now, so it was kept. …' */
const unreadStatusRefusalOf = (path, failure) => 'The publisher made ' + path + ' but could not read its status: ' + failure.message + '. The file there may be another one now, so it was kept. Delete it if it holds nothing of yours, then try again.';

/** Removes a file the publisher made and no longer needs: the file a failed {@link writeOwnFile} made, which holds part of the bytes at most, the file beside a journal or a claim that {@link writeWholeRecord} gave the record's name, and the file a recovery read the file system's clock from. The path may lead to another file by now, so it is removed only while it is that file, by its device and file id ({@link isSameFileAt}), and no byte of another file is lost. Called by {@link writeOwnFile} once the write or the close failed, by {@link writeWholeRecord} once the record has its name or its write failed, by {@link fileSystemTimeBeside} for the file it read the file system's clock from, by {@link publishJournalWriterOf} for the list of copies and the side file of a journal it removes, and by {@link removeOrphan} for a list of copies a stopped run left. @param file - The record of the file the open made. @example await removeOwnFile({ path: '/repo/.codebook/next/manual.txt', hash: '…', dev: 2049n, ino: 131074n }) */
async function removeOwnFile(file) {
  if (await isSameFileAt(file)) await unlink(file.path).catch(() => undefined);
}

/** Writes a file of the candidate in place of the entry that stands at its name, without following that entry: the entry is removed first, which removes a link itself or one name of a file with several, never what it leads to, then the file is written new ({@link writeOwnFile}), whose exclusive open refuses an entry put there in between. A link put at the name of a rendered page after the publisher listed the candidate therefore leads no write out of the candidate; a stop between the removal and the write leaves the page missing or partial, which the next render writes again. Called by {@link heldWriterOf} for the rendered pages, which {@link writePagesHeld} hands it. @returns The new file's record ({@link writeOwnFile}). @throws What the removal rejects with, other than a missing entry (a folder at the name), and what {@link writeOwnFile} throws. @example await replaceOwnFile('/repo/.codebook/next/index.html', html) // => { path: '/repo/.codebook/next/index.html', hash: '…', dev: 2049n, ino: 131075n } */
async function replaceOwnFile(path, bytes) {
  await unlink(path).catch(error => { if (!isMissing(error)) throw error; });
  return writeOwnFile(path, bytes);
}

/** The file beside a candidate's manifest or record through which a publish puts the finalized one, or the prepared one again, in place ({@link replaceOwnFileThrough}); it carries the id of the publish's journal, so the recovery of a stopped publish knows it ({@link restoreStoppedCandidate}). @example finalizingPathOf('/repo/.codebook/next', '6f1c…', 'codebook-wiki.json') // => '/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json' */
const finalizingPathOf = (stage, id, name) => join(stage, '.codebook-publish-' + id + '-' + name);

/** The list beside a publish journal, named by the journal's id, of the learner's files whose copy into the candidate began ({@link publishJournalWriterOf}): one line for each, the path as JSON text, appended before that copy begins, so a publish writes one line for each copy and never the list again; it goes with the journal. A line that a stop cut short names a copy that had not begun ({@link pathsOfCopiesList}). @example copiesListPathOf('/repo/.codebook/wiki.publish-journal.json', '6f1c…') // => '/repo/.codebook/wiki.publish-journal.json.copies-6f1c…' */
const copiesListPathOf = (journal, id) => journal + '.copies-' + id;

/** The file beside a publish journal that keeps the candidate's prepared manifest and record ({@link publishJournalOf}), named by the journal's id and by the SHA-256 digest of its bytes, which the journal names too: the journal stays small enough for one write, so a stop never leaves it partial, even where it is written in place ({@link writeWholeRecord}), and the side file, written before the journal at a name no other step writes, holds the bytes the recovery checks by that digest ({@link preparedBytesOf}). One left without its journal is removed by the recovery that ends its run, whatever its bytes ({@link removeLeftoversOfRun}), and by the next publish while its bytes have the digest its name says ({@link removeStrayPreparedFiles}). @example preparedPathOf('/repo/.codebook/wiki.publish-journal.json', '6f1c…', 'ab12…') // => '/repo/.codebook/wiki.publish-journal.json.prepared-6f1c…-ab12…' */
const preparedPathOf = (journal, id, sha256) => journal + '.prepared-' + id + '-' + sha256;

/** The name of a side file of {@link preparedPathOf} after the journal's name and `.prepared-`: the journal's id, then the digest of its bytes. Read by {@link removeStrayPreparedFiles} and {@link removeLeftoversOfRun}. */
const PREPARED_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([a-f0-9]{64})$/;

/** Writes a candidate's manifest or record in place of the entry at its name through a new file beside it ({@link writeOwnFile}), which a move then puts at the name ({@link renameRetried}): the move replaces the entry itself, a link or one name of a file with several, never what it leads to, so a link put at the name after the publisher read it leads no write out of the candidate; and a stop of the publish leaves the name with the bytes it had or with the new ones, never without them. A failed move removes the file beside it while it is the one written; a stop before the move leaves it for the recovery ({@link restoreStoppedCandidate}). Called by {@link finalizerOf}, {@link restoreFinalized} and {@link restorePreparedFiles}. @returns The record of the file now at the name ({@link writeOwnFile}). @throws What {@link writeOwnFile} or the last move rejects with. @example await replaceOwnFileThrough('/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json', '/repo/.codebook/next/codebook-wiki.json', manifestText) // => { path: '/repo/.codebook/next/codebook-wiki.json', hash: '…', dev: 2049n, ino: 131076n } */
async function replaceOwnFileThrough(temporary, path, bytes) {
  const file = await writeOwnFile(temporary, bytes);
  try { await renameRetried(temporary, path); }
  catch (error) { if (await isSameFileAt(file)) await unlink(temporary).catch(() => undefined); throw error; }
  return { ...file, path };
}

/** Whether a file a step wrote is still its own: its path names the file the step wrote, by its device and file id ({@link isSameFileAt}), before and after its bytes are read, and those bytes are the step's, by their SHA-256 digest. The look after the read is what proves the bytes the file's: an editor's save that put a new file at the path while the read went on leaves the read with the bytes it began with, the step's, while the path names the new file. Called by {@link removeWritten}, {@link restoreFinalized} and {@link removeCopiesStillWritten}, and by {@link takePublishLock} for the lock it wrote. @example await isStillWritten(await writeOwnFile('/repo/.codebook/next/index.html', html)) // => true until the file is edited, removed or a link stands on its path */
async function isStillWritten(file) {
  if (!(await isSameFileAt(file))) return false;
  const current = await regularBytes(file.path, true).catch(() => undefined);
  // The path must still name the file the step wrote once its bytes are read: a file put there during the read is another one.
  return current !== undefined && digest(current) === file.hash && await isSameFileAt(file);
}

/** Puts back the bytes a candidate's manifest or record had before a refused publish finalized it: the publish's own file at the path ({@link isStillWritten}) takes the prepared bytes again, through the file beside it ({@link replaceOwnFileThrough}), as does a name another writer emptied; an entry another writer put there stays. Called by {@link restoreFinalizedFiles} for every refusal of {@link publishWiki} before its swap, while the path and the candidate hold. @param finalized - The path, the file beside it, the bytes it had as prepared, and the record of the file the publish put there, absent while that did not end. @example await restoreFinalized({ path: '/repo/.codebook/next/codebook-wiki.json', temporary: '/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json', prepared: manifestBytes, file }) */
async function restoreFinalized({ path, temporary, prepared, file }) {
  if (await lookAt(path) === undefined || file !== undefined && await isStillWritten(file)) await replaceOwnFileThrough(temporary, path, prepared);
}

/** Removes the files a refused step wrote that are still its own, last written first, then the folders it made, each empty ({@link removeMadeFolders}). A file is the step's own while its path names the file the step wrote, by its device and file id ({@link writeOwnFile}), and that file still holds the step's bytes, by their SHA-256 digest; a file whose bytes were edited since, that is gone, or that a link on its path now leads to in its place, such as a published file of the same name and bytes, stays as it is. Digests keep rollback evidence bounded per file without retaining image Buffers. Called by {@link writeFilesHeld} and {@link restoreManifestHeld} when a hold refuses, by {@link prepareWikiStage} for a refusal after the candidate's files are written, by {@link writePagesHeld} for a refused write of a page, and by {@link undoRefusedPublish} for every refusal of a publish before its swap. @example await removeWritten([await writeOwnFile('/repo/.codebook/next/codebook-publication.json', receiptText)], ['/repo/.codebook/next']) */
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

/** The file beside a journal, a recovery claim or a publish lock through which {@link writeWholeRecord} gives the record its name, named by the record's id, so the recovery that ends the record's run knows it ({@link removeLeftoversOfRun}). @example pendingPathOf('/repo/.codebook/wiki.publish-lock.json', '6f1c…') // => '/repo/.codebook/wiki.publish-lock.json.pending-6f1c…' */
const pendingPathOf = (path, id) => path + '.pending-' + id;

/** Writes a journal or a recovery claim whole under its name, and only while no entry stands there: the bytes go into a new file beside it first, named by the record's id ({@link pendingPathOf}, {@link writeOwnFile}), which a hard link then gives the name, so a stop at any point leaves the name with no file or with the whole record, never with an empty or a partial one that no recovery can read; the link refuses an entry at the name (`EEXIST`), as the exclusive create did before, so the journal still keeps a second publish or recovery out. A move would not: it puts the record in place of a journal that another step wrote meanwhile. A file system that cannot link (FAT and exFAT volumes, some network shares) gets the record by an exclusive create at its name ({@link writeOwnFile}), as the extension's own storage lock does there; a stop between that create and its write leaves a journal without a byte, which a later recovery ends ({@link endUnwrittenJournal}). The file beside the name is removed once the record has its name or its write failed, while it is still the file written ({@link removeOwnFile}); one whose status read failed is kept, as the refusal that names it says ({@link writeOwnFile}); a stop before that leaves it, a file that nothing reads, which the recovery that ends the record's run removes with it ({@link removeLeftoversOfRun}), or, where no recovery ends it by its id, once the record's owner is judged gone or, for a file a stop cut short, once it has stood for the grace ({@link removeOrphansBeside}). Called by {@link publishJournalWriterOf} and {@link startManifestRecovery} for their journal, by {@link claimRecovery} for its claim, and by {@link takePublishLock} for the publish lock, which keeps the record of the file it answers to tell its lock from any other at the name later. @param id - The record's id, which the file beside it is named by. @returns The record of the file the name was given ({@link writeOwnFile}): the file written beside it, which the link gave the name, or the one created in place. @throws `EEXIST` while an entry stands at the name, what the write rejects with, and the refusal that names a kept file whose status read failed. @example await writeWholeRecord('/repo/.codebook/wiki.publish-journal.json', journalText, record.id) */
async function writeWholeRecord(path, bytes, id) {
  // A file beside the name whose write failed is handled by its writer: removed when it is the one written, kept and named when its status could not be read.
  const pending = await writeOwnFile(pendingPathOf(path, id), bytes);
  try {
    // The link gives the name the very file written beside it, whose record is the record's then.
    return await link(pending.path, path).then(() => ({ ...pending, path }), error => {
      if (error.code === 'EEXIST') throw error;
      // A file system without hard links cannot give a written file a second name: the record is created in place there.
      return writeOwnFile(path, bytes);
    });
  } finally { await removeOwnFile(pending); }
}

/** Parses a journal or a recovery claim that a stopped step left, or a Wiki manifest, any of which a cloned repository may carry: text that is no JSON, or JSON that is no object, is refused with the fixed sentence given, the parser's error as its cause, so no text of the record reaches the agent (the parser's message quotes the record's start). @param refusalOfSyntax - Words the refusal of a text that is no JSON from that text, without repeating any of it ({@link manifestSyntaxRefusalOf} for a manifest); the fixed sentence when absent. @returns The record. @throws The refusal. Called by {@link resumeJournal}, {@link stoppedClaimAt}, {@link endStoppedLock} and {@link parseManifest}. @example parseRecordOf(Buffer.from('null'), 'The Wiki recovery claim is invalid; it was preserved.') // throws: The Wiki recovery claim is invalid; it was preserved. */
function parseRecordOf(bytes, refusal, refusalOfSyntax = () => refusal) {
  let record;
  try { record = JSON.parse(bytes); } catch (cause) { throw new Error(refusalOfSyntax(String(bytes)), { cause }); }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error(refusal);
  return record;
}

/** Removes only the journal, claim, publish lock or side file bytes owned by the completing operation: the file at the path must hold those bytes, or it is kept and the step refused. @example await removeOwnedRecord(path, bytes) */
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

/** The journal of a publish, with the backup name of the prior Wiki, the text of the candidate's finalized record, and the text of the file beside the journal that keeps the candidate's prepared manifest and record ({@link preparedPathOf}), which the journal names by its SHA-256 digest (`prepared.sha256`), so the recovery of a publish stopped after it finalized them puts them back ({@link restoreStoppedCandidate}) and the journal stays small. The journal names its owner as `system` tells it ({@link ownerHere}), and names in `learnerCopies` the learner's files whose copy into the candidate began when it was written: none, as the list beside it names each copy that begins later ({@link publishJournalWriterOf}), while the field itself tells this journal from one of an earlier version, which named no copies ({@link copiesBegunOf}). Its id is the id of the publish lock the publish holds ({@link takePublishLock}), so the recovery of a stopped publish ends that lock with the journal ({@link endLockOfRun}). Called by {@link publishWiki} before it writes the journal. @returns The journal's record, the backup's path (none without a prior Wiki), the finalized record's text and the side file's text. @example await publishJournalOf(paths, prior, receipt, manifestText, manifestBytes, receiptBytes, SYSTEM_HERE, lock.id) // => { record: { projectRoot: '/repo', …, operation: 'publish', …, prepared: { sha256: '…' }, learnerCopies: [] }, backup: '/repo/.codebook/wiki.previous-…', finalizedReceiptText: '{…}', preparedText: '{"manifest":"…","receipt":"…"}' } */
async function publishJournalOf({ root, output, stage }, prior, receipt, manifestText, bytes, receiptBytes, system, id) {
  const backup = prior ? output + '.previous-' + randomUUID() : undefined;
  const manifestSha256 = digest(manifestText), finalizedReceiptText = JSON.stringify({ ...receipt, kind: 'published', manifestSha256, manifestText });
  const preparedText = JSON.stringify({ manifest: bytes.toString('base64'), receipt: receiptBytes.toString('base64') });
  const record = { projectRoot: root, output, stage, backup, pid: process.pid, owner: await ownerHere(system), id, operation: 'publish', manifestSha256, priorManifestSha256: prior ? digest(prior.bytes) : undefined, priorLegacy: receipt.baseline?.legacy === true,
    finalizedReceiptSha256: digest(finalizedReceiptText), prepared: { sha256: digest(preparedText) }, learnerCopies: [] };
  return { record, backup, finalizedReceiptText, preparedText };
}

/** The journal of a publish and the files beside it, as the publish writes them: `write` puts the side file that keeps the candidate's prepared manifest and record in place first ({@link preparedPathOf}), new and whole, at a name no other step writes, then the journal that names its digest ({@link writeWholeRecord}), small enough for one write; a refused journal removes the side file again. Each copy of a learner's file into the candidate is named before the copy begins ({@link copyLearnerFiles}): the path is appended as one line to the list of copies beside the journal ({@link copiesListPathOf}), which the first copy creates, exclusive and without following a link, once the output's path holds ({@link openCopiesList}), and every later line goes through the handle of that create, so no line follows a link put at the list's name since; the journal is written once. A stop at any point leaves a list whose whole lines name every copy that began, so the recovery removes only what such a copy left ({@link learnerCopiesIn}). Called by {@link publishWiki} for the journal it writes. @param preparedText - The side file's text ({@link publishJournalOf}). @returns The journal's bytes, by which the publish removes the journal, `write`, `recordCopyBegun`, which names one more copy, `closeCopiesList`, which closes the list once the copies are made, and `remove`, which removes the list and the side file, each while it is the file created ({@link removeOwnFile}), and then the journal ({@link removeOwnedRecord}); a list or a side file whose removal fails stays for a later step, which removes it once no journal names it: the sweep for the list ({@link removeOrphansBeside}), the next publish for the side file ({@link removeStrayPreparedFiles}). @throws What the side file's write, the journal's, the list's create or an append rejects with; the list is removed with the journal then. @example const journalNow = publishJournalWriterOf(record, preparedText, '/repo/.codebook/wiki.publish-journal.json', requirePathHeld); await journalNow.write(); await journalNow.recordCopyBegun('manual.txt'); await journalNow.closeCopiesList(); await journalNow.remove() */
function publishJournalWriterOf(record, preparedText, journal, requirePathHeld) {
  const copiesList = copiesListPathOf(journal, record.id);
  // The list as it was created, with the handle its lines go through; none before the first copy. The side file as it was written.
  let list, preparedFile;
  const journalNow = { bytes: JSON.stringify(record) };
  journalNow.write = async () => {
    await requirePathHeld();
    preparedFile = await writeOwnFile(preparedPathOf(journal, record.id, record.prepared.sha256), preparedText);
    // A journal that another step wrote first keeps this publish out, and the side file goes with the refusal.
    await writeWholeRecord(journal, journalNow.bytes, record.id).catch(async error => { await removeOwnFile(preparedFile); throw error; });
  };
  journalNow.recordCopyBegun = async path => {
    if (list === undefined) {
      await requirePathHeld();
      list = await openCopiesList(copiesList);
    }
    await list.handle.writeFile(JSON.stringify(path) + '\n');
  };
  // A close that fails may lose the lines it was handed, so it fails the publish, as the close of a written file does ({@link writeOwnFile}).
  journalNow.closeCopiesList = async () => {
    const handle = list?.handle;
    if (list !== undefined) list.handle = undefined;
    await handle?.close();
  };
  // The list and the side file go first: the journal keeps every other step out until the end.
  journalNow.remove = async () => {
    await journalNow.closeCopiesList().catch(() => undefined);
    if (list !== undefined) await removeOwnFile(list.file);
    if (preparedFile !== undefined) await removeOwnFile(preparedFile);
    await removeOwnedRecord(journal, journalNow.bytes);
  };
  return journalNow;
}

/** Creates the list of copies beside a publish journal ({@link copiesListPathOf}) to append to: the open is exclusive ('ax'), so it refuses any entry at the name, a link included, and every line goes to the end of the file it made. Called by {@link publishJournalWriterOf} before the first copy. @returns The record of the file made, by its device and file id, which {@link removeOwnFile} removes it by, and the handle. @throws What the open rejects with; for a status read that fails, the refusal that names the kept file ({@link unreadStatusRefusalOf}). @example await openCopiesList('/repo/.codebook/wiki.publish-journal.json.copies-6f1c…') // => { file: { path: '…', dev: 2049n, ino: 131080n }, handle: <FileHandle> } */
async function openCopiesList(path) {
  const handle = await open(path, 'ax');
  try {
    const { dev, ino } = await handle.stat({ bigint: true });
    return { file: { path, dev, ino }, handle };
  } catch (failure) {
    await handle.close().catch(() => undefined);
    // Without its status the file cannot be told from one another process put at its name since: it is kept and named.
    throw new Error(unreadStatusRefusalOf(path, failure), { cause: failure });
  }
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

/** Copies the learner's files of the prior Wiki into the candidate, each held and new ({@link heldWriterOf}, {@link writeOwnFile}), after refusing one that stands where the update has an owned file or folder; the journal names each copy before it begins (`recordCopyBegun`, {@link publishJournalWriterOf}), and the list of copies is closed once they are made, or once a copy is refused. Called by {@link publishWiki}. @returns The SHA-256 digest of each copy's bytes, by path, for {@link requireLearnerFilesUnchanged}. @throws The refusal of a conflicting file. @example await copyLearnerFiles(['manual.txt'], owned, '/repo/.codebook/wiki', '/repo/.codebook/next', writeHeld, journalNow) // => { 'manual.txt': '…' } */
async function copyLearnerFiles(manual, owned, output, stage, writeHeld, journalNow) {
  const manualHashes = Object.create(null);
  try {
    for (const path of manual) {
      if ([...owned].some(ownedPath => ownedPath === path || ownedPath.startsWith(path + '/') || path.startsWith(ownedPath + '/')))
        throw new Error('A manual Wiki file conflicts with the update: ' + path);
      const content = await regularBytes(join(output, path));
      manualHashes[path] = digest(content);
      // The journal names the copy before its file exists, so the recovery tells a part it left from a file the learner put there.
      await journalNow.recordCopyBegun(path);
      await writeHeld(join(stage, path), content, writeOwnFile);
    }
  } catch (error) {
    // The refusal of a copy is the one reported; the list is removed with the journal.
    await journalNow.closeCopiesList().catch(() => undefined);
    throw error;
  }
  await journalNow.closeCopiesList();
  return manualHashes;
}

/** Refuses a publish whose learner's files changed while it copied them: another number of them, or one whose bytes differ from its copy. Called by {@link publishWiki} at its recheck before the swap. @throws The refusal of the change. @example await requireLearnerFilesUnchanged(current, ['manual.txt'], manualHashes, '/repo/.codebook/wiki') */
async function requireLearnerFilesUnchanged(current, manual, manualHashes, output) {
  const currentManual = learnerFilesOf(current);
  if (currentManual.length !== manual.length) throw new Error('Manual Wiki files changed during publication; output was preserved.');
  for (const path of currentManual) if (manualHashes[path] !== digest(await regularBytes(join(output, path)))) throw new Error('A manual Wiki file changed during publication: ' + path);
}

/** Undoes a publish refused before its swap. The prior Wiki goes back first, so the time without a Wiki folder does not grow with what the publish wrote into the candidate. The candidate is not moved before the swap, so what this publish wrote still stands where it wrote it; a refusal of any kind removes it ({@link removeWritten}). The candidate's prepared manifest and record are put back ({@link restoreFinalizedFiles}) only while the path and the candidate hold; a refused hold leaves the finalized ones, which publish again unchanged, and the publish's own refusal is the one reported. Called by {@link publishWiki}. @param refusal - The publish's own refusal, which the undo answers. @returns The failure of the undo, which keeps the journal for --recover: that of a move back that failed, or else that of a restore that failed, with the publish's own refusal kept in its message and its cause ({@link undoFailureOf}); undefined otherwise. @example await undoRefusedPublish({ output, stage, backup, movedOld: true, written, made, finalized, requirePathHeld, isFolderWhereItWas, refusal }) // => undefined */
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

/** Publishes a prepared candidate while retaining exact prior metadata, generated files and manual files, or, with `renderOnly`, writes its pages alone for a preview. Nothing is written before the publish lock ({@link underPublishLock}), so a second publish or preview of the same Wiki, by another agent or another editor window, is refused before it writes a page, with a sentence that names the lock. @param options.system - The system whose process and boot the lock and the journal record of their owner ({@link SYSTEM_HERE}, which the CLI passes). @example await publishWiki({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki', stageDirectory: '/repo/.codebook/wiki.stage' }) */
export async function publishWiki({ projectRoot, outputDirectory, stageDirectory, renderOnly = false, system = SYSTEM_HERE }) {
  // The read of the owner the lock and the journal name (PowerShell and reg.exe on Windows, sysctl, ps and ioreg on macOS) starts now and runs beside the rendering.
  ownerHere(system);
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
  return underPublishLock(paths, requirePathHeld, system, async lock => {
    // The pages and the learner's files this publish wrote into the candidate, and the folders it made there: every refusal before the swap removes what is still its own ({@link removeWritten}), so no copy of a learner's file is left to refuse the next publish as a file outside the manifest.
    const written = [], made = [], writeHeld = heldWriterOf(requirePathHeld, isFolderWhereItWas, written, made);
    await writePagesHeld(rendered, stage, writeHeld, written, made);
    if (renderOnly) return { stage, renderedPages: rendered.size };
    const manifestText = await finalizedManifestTextOf(manifest, owned, stage);
    const { record, backup, finalizedReceiptText, preparedText } = await publishJournalOf(paths, prior, receipt, manifestText, bytes, receiptBytes, system, lock.id);
    const journalNow = publishJournalWriterOf(record, preparedText, journal, requirePathHeld);
    await journalNow.write();
    const finalized = [], finalize = finalizerOf(stage, record.id, finalized);
    let movedOld = false, swapped = false;
    try {
      await requirePathHeld();
      prior = await inspectPrior();
      assertBaseline(receipt.baseline, prior);
      const manual = learnerFilesOf(prior), manualHashes = await copyLearnerFiles(manual, owned, output, stage, writeHeld, journalNow);
      await makeFolderHeld(stage, requirePathHeld, isFolderWhereItWas);
      // The manifest and the record take the place of the entries at their names, which a link put there after they were read does not lead out of the candidate, and which a stop never leaves empty.
      await finalize(MANIFEST, manifestText, bytes);
      await finalize(RECEIPT, finalizedReceiptText, receiptBytes);
      // Recheck after acquiring the journal and copying files; a stale generation cannot win a later swap.
      const current = await inspectPrior();
      assertBaseline(receipt.baseline, current);
      await requireLearnerFilesUnchanged(current, manual, manualHashes, output);
      // The lock must still be this publish's when the Wiki moves: a recovery may have ended it since it was taken.
      await lock.requireHeld();
      await makeFolderHeld(stage, requirePathHeld, isFolderWhereItWas);
      if (backup) { await renameRetried(output, backup); movedOld = true; }
      await renameRetried(stage, output);
      swapped = true;
      await journalNow.remove();
      return { output, previousOutput: backup, publishedFiles: owned.size, preservedManualFiles: manual.length };
    } catch (error) {
      if (swapped) throw error; // Cleanup failure must not roll back an already usable new generation.
      const undoFailure = await undoRefusedPublish({ output, stage, backup, movedOld, written, made, finalized, requirePathHeld, isFolderWhereItWas, refusal: error });
      if (undoFailure !== undefined) throw undoFailure;
      await journalNow.remove();
      throw error;
    }
  });
}

/** The refusal of a publish or a preview while another run holds the Wiki's publish lock ({@link takePublishLock}): it names the lock by its path alone, never by its text, and sends a stopped run's lock to --recover, which ends it under the gate of its owner ({@link endStoppedLock}). Called by {@link takePublishLock}. @example publishLockRefusalOf('/repo/.codebook/wiki.publish-lock.json') // => 'Another publish of this Wiki holds its publish lock /repo/.codebook/wiki.publish-lock.json, so nothing was written. …' */
const publishLockRefusalOf = lock => 'Another publish of this Wiki holds its publish lock ' + lock + ', so nothing was written. Wait until that publish ends, then publish again; if it was stopped, run --recover once its process exits.';

/** The refusal of a publish or a preview whose publish lock is no longer its own when it checks it ({@link takePublishLock}): a recovery ended it, or another run's lock stands at its name. It names the lock by its path alone, and the step undoes what it wrote before its swap, as for every refusal there. Called by {@link takePublishLock}. @example lostPublishLockRefusalOf('/repo/.codebook/wiki.publish-lock.json') // => 'The Wiki publish lock /repo/.codebook/wiki.publish-lock.json is no longer this publish’s: … so the Wiki was not changed. …' */
const lostPublishLockRefusalOf = lock => 'The Wiki publish lock ' + lock + ' is no longer this publish’s: another step ended or replaced it while this publish ran (a --recover takes a lock that stood empty past the grace for a stopped publish’s), so the Wiki was not changed. Publish again once no other publish or recovery of this Wiki runs.';

/** Takes the publish lock of a Wiki, `<output>.publish-lock.json`: a small record of this run's process id, its owner as `system` tells it ({@link ownerHere}) and a random id, written whole and only while no entry stands at its name ({@link writeWholeRecord}), so of two publishes or previews of one Wiki at once, the second is refused before it writes anything ({@link publishLockRefusalOf}). The lock lies beside the Wiki folder, as the journal does, so it is written only while the output's path holds, and a lock written once the path was swapped is removed with the refusal. On a file system without hard links the lock is created at its name and written after ({@link writeWholeRecord}), and a run held between the two past {@link UNWRITTEN_RECORD_GRACE_MS} may find it ended by a recovery, which takes an empty lock for a stopped publish's, while its write went into the removed file: the run goes on only while the lock's name holds the file it wrote, with this run's bytes ({@link isStillWritten}), checked once it is taken and again before the swap (`requireHeld`), else it stops without changing the Wiki ({@link lostPublishLockRefusalOf}). Called by {@link underPublishLock}. @returns The lock's id, which the publish's journal takes ({@link publishJournalOf}), `requireHeld`, which refuses once the lock is no longer this run's, and `release`, which removes the lock while it holds this run's bytes ({@link removeOwnedRecord}). @throws The refusal of a lock that stands, of a changed path, of a lock that is no longer this run's, and what the write rejects with. @example const lock = await takePublishLock(paths, requirePathHeld, SYSTEM_HERE); await lock.requireHeld(); await lock.release() */
async function takePublishLock({ lock }, requirePathHeld, system) {
  const id = randomUUID(), bytes = JSON.stringify({ pid: process.pid, owner: await ownerHere(system), id });
  await requirePathHeld();
  const file = await writeWholeRecord(lock, bytes, id).catch(error => { throw error.code === 'EEXIST' ? new Error(publishLockRefusalOf(lock), { cause: error }) : error; });
  // A lock written after a swap of the path lies behind it: it is this run's own, and goes with the refusal.
  await requirePathHeld().catch(async error => { await removeOwnedRecord(lock, bytes).catch(() => undefined); throw error; });
  const requireHeld = async () => { if (!(await isStillWritten(file))) throw new Error(lostPublishLockRefusalOf(lock)); };
  // A lock a recovery ended between its create and its write is no longer this run's: the run stops before it writes anything.
  await requireHeld();
  return { id, requireHeld, release: () => removeOwnedRecord(lock, bytes) };
}

/** Runs the writes of a publish or a preview under the Wiki's publish lock ({@link takePublishLock}), from before its first page until after its journal is removed: a journal that another step wrote before the lock was taken refuses the run ({@link requireNoJournal}), and a side file that a stopped publish left beside the journal's name is removed while it is the publisher's own ({@link removeStrayPreparedFiles}), as are the files stopped runs left beside the records ({@link removeOrphansBeside}); the lock is removed once the step ends, also when it is refused, whose own refusal is the one answered; a run stopped meanwhile leaves the lock for --recover ({@link endStoppedLock}). Called by {@link publishWiki}. @param step - The writes, given the lock: its id and `requireHeld` ({@link takePublishLock}). @returns What the step answers. @throws The refusal of the lock and of a journal, and what the step throws. @example await underPublishLock(paths, requirePathHeld, SYSTEM_HERE, async lock => ({ renderedPages: 1 })) */
async function underPublishLock(paths, requirePathHeld, system, step) {
  const lock = await takePublishLock(paths, requirePathHeld, system);
  let outcome;
  try {
    await requireNoJournal(paths.journal);
    // Under the lock and without a journal, a side file of a journal is one a stopped publish left; so is a file beside a record whose writer is gone.
    await removeStrayPreparedFiles(paths.journal);
    await removeOrphansBeside(paths, requirePathHeld, { system, goneOwners: [] });
    outcome = await step(lock);
  } catch (error) {
    // A lock this run cannot remove now is ended by --recover; the run's refusal is the one the agent needs.
    await lock.release().catch(() => undefined);
    throw error;
  }
  await lock.release();
  return outcome;
}

/** The paths of the copies of the learner's files that a stopped publish made in its candidate: each file of the candidate that the candidate's manifest does not list, at a path whose copy the journal names as begun ({@link copiesBegunOf}), or at any path for a journal of an earlier version, which names no copies, that stands at the place of a learner's file in the Wiki (a file the Wiki's manifest does not list) and that holds the start of that file's bytes or all of them ({@link isStartOf}): a kill while the publish wrote a copy leaves the part written so far, an empty file at the least, and the whole file stays in the Wiki. A file with other bytes, and a file at a path whose copy did not begin, which the learner put there, stay, for the next publish to name. Each copy is answered with the record of the file as it was checked, its device and file id and the digest of its bytes, so its removal holds only while it is that file with those bytes ({@link restoreStoppedCandidate}). Called by {@link restoreStoppedCandidate}. @param wiki - The Wiki that stands in the Wiki folder now, as {@link inspectOutput} read it. @param begun - The paths whose copy the journal names as begun; undefined for a journal of an earlier version, which names none, so every learner's file's place counts, by the bytes alone. @returns The copies, each its path relative to the candidate (`name`) and the record of the file checked (`file`, as {@link writeOwnFile} answers one); none for a candidate without a manifest. @throws What reading the candidate's manifest, listing the candidate or reading a file rejects with, which {@link restoreStoppedCandidate} judges ({@link noneUnlessUnread}). @example await learnerCopiesIn('/repo/.codebook/next', wiki, '/repo/.codebook/wiki', '/repo', new Set(['manual.txt'])) // => [{ name: 'manual.txt', file: { path: '/repo/.codebook/next/manual.txt', hash: '…', dev: 2049n, ino: 131077n } }] */
async function learnerCopiesIn(stage, wiki, output, root, begun) {
  const manifestBytes = await regularBytes(join(stage, MANIFEST), true);
  // A candidate without a manifest cannot tell its own files from copies, and the next publish refuses it for that.
  if (manifestBytes === undefined) return [];
  const { owned } = parseManifest(manifestBytes, root);
  // A journal of an earlier version names no copies: each learner's file may have been copied, and the bytes alone tell a copy.
  const copiedFiles = new Set(learnerFilesOf(wiki).filter(path => begun === undefined || begun.has(path))), copies = [];
  for (const name of await listFiles(stage)) {
    if (owned.has(name) || !copiedFiles.has(name)) continue;
    const { bytes, file } = await regularFileOf(join(stage, name));
    if (isStartOf(bytes, await regularBytes(join(output, name)))) copies.push({ name, file });
  }
  return copies;
}

/** Reads a regular file of a candidate without following a link, with the record of the file read: its path, the SHA-256 digest of its bytes, and its device and file id as bigints, the status read before the bytes, so a file put at the path in between is not the one recorded. Called by {@link learnerCopiesIn}. @returns The bytes and the record ({@link writeOwnFile} answers one of the same form). @throws The refusal of an entry that is no regular file, and what the look or the read rejects with. @example await regularFileOf('/repo/.codebook/next/manual.txt') // => { bytes: <Buffer …>, file: { path: '/repo/.codebook/next/manual.txt', hash: '…', dev: 2049n, ino: 131077n } } */
async function regularFileOf(path) {
  const status = await lstat(path, { bigint: true });
  if (!status.isFile()) throw new Error('Wiki publication requires a regular file: ' + path);
  const bytes = await readFile(path);
  return { bytes, file: { path, hash: digest(bytes), dev: status.dev, ino: status.ino } };
}

/** The paths whose copy into the candidate a publish journal names as begun: its `learnerCopies` and the list of copies beside it ({@link copiesListPathOf}, {@link publishJournalWriterOf}), which names none while it is missing or no list of paths, as before the first copy ({@link pathsOfCopiesList}), or while a link, a folder or another entry that is no file stands at its name; a read of it that fails at that moment stops the recovery ({@link noneUnlessUnread}). A journal of an earlier version names no copies, and its publish may have copied each learner's file, so it answers undefined: its recovery takes every file at a learner's file's place whose bytes start that file for a copy ({@link learnerCopiesIn}), the rule before the journal named the copies, as the Wiki keeps the whole file; keeping them would leave a candidate the next publish refuses after an answer of success. Called by {@link restoreStoppedCandidate}. @throws The refusal of a read that failed ({@link unreadRecoveryRefusalOf}). @example await copiesBegunOf({ id: '6f1c…', learnerCopies: [] }, '/repo/.codebook/wiki.publish-journal.json') // => Set { 'manual.txt' } where the list beside the journal holds the line "manual.txt" */
async function copiesBegunOf(record, journal) {
  if (!Array.isArray(record.learnerCopies)) return undefined;
  const listed = isRecordId(record.id) ? await regularBytes(copiesListPathOf(journal, record.id), true).then(pathsOfCopiesList, noneUnlessUnread([])) : [];
  return new Set([...record.learnerCopies, ...listed]);
}

/** The paths a list of copies beside a publish journal names ({@link copiesListPathOf}): one for each whole line, its JSON text; the text after the last line break is a line whose append a stop cut short, whose copy had not begun, and is dropped. A list a cloned repository carries may hold any text: one with a whole line that is no JSON text of a path names nothing, and none of its text is repeated. Called by {@link copiesBegunOf}. @param bytes - The list's bytes; undefined for no list. @returns The paths; none for no list. @example pathsOfCopiesList(Buffer.from('"manual.txt"\n"notes/la')) // => ['manual.txt'] */
function pathsOfCopiesList(bytes) {
  if (bytes === undefined) return [];
  const lines = String(bytes).split('\n');
  lines.pop();
  const paths = lines.map(line => { try { return JSON.parse(line); } catch { return undefined; } });
  return paths.every(path => typeof path === 'string') ? paths : [];
}

/** Whether the bytes of a file are the start of another file's bytes, or all of them: what a copy holds once a kill stopped its write, which goes from the first byte on, or once the write ended. Called by {@link learnerCopiesIn}. @example isStartOf(Buffer.from('The learner ke'), Buffer.from('The learner kept these notes')) // => true */
const isStartOf = (part, whole) => part.length <= whole.length && whole.subarray(0, part.length).equals(part);

/** The prepared manifest and record a publish journal keeps ({@link preparedBytesOf}), by name, for the files whose finalized bytes, by their SHA-256 digest, the journal names: the manifest's `manifestSha256` and the record's `finalizedReceiptSha256`. Called by {@link finalizedFilesIn}. @returns The pairs; none for a journal of an earlier version, which keeps neither, and for one whose kept bytes are missing or not whole. @throws The refusal of a read of the side file that failed ({@link unreadRecoveryRefusalOf}). @example await preparedFilesOf(record, '/repo/.codebook/wiki.publish-journal.json') // => [{ name: 'codebook-wiki.json', finalizedSha256: '…', prepared: <Buffer> }, { name: 'codebook-publication.json', … }] */
async function preparedFilesOf(record, journal) {
  const prepared = HASH.test(record.manifestSha256) && HASH.test(record.finalizedReceiptSha256) ? await preparedBytesOf(record, journal) : undefined;
  if (prepared === undefined) return [];
  return [{ name: MANIFEST, finalizedSha256: record.manifestSha256, prepared: prepared.manifest },
    { name: RECEIPT, finalizedSha256: record.finalizedReceiptSha256, prepared: prepared.receipt }];
}

/** The candidate's prepared manifest and record that a publish journal keeps: in the file beside it that its `prepared.sha256` names ({@link preparedPathOf}), read only when its bytes have that digest, or, for a journal an earlier build of this version wrote, in the journal itself as base64 text. A file a cloned repository carries may hold any text, which is not repeated. Called by {@link preparedFilesOf}. @returns The two files' bytes; undefined where none are kept, where the side file is missing or holds other bytes, and where the kept text is no base64. @throws The refusal of a read of the side file that failed ({@link unreadRecoveryRefusalOf}). @example await preparedBytesOf(record, '/repo/.codebook/wiki.publish-journal.json') // => { manifest: <Buffer>, receipt: <Buffer> } */
async function preparedBytesOf(record, journal) {
  const kept = await keptPreparedOf(record, journal);
  if (!isBase64Text(kept?.manifest) || !isBase64Text(kept?.receipt)) return undefined;
  return { manifest: Buffer.from(kept.manifest, 'base64'), receipt: Buffer.from(kept.receipt, 'base64') };
}

/** The prepared manifest and record a publish journal keeps, as base64 text: in the side file its `prepared.sha256` names ({@link preparedPathOf}), read only when its bytes have that digest, or in the journal itself where it names no side file (a journal an earlier build of this version wrote). Called by {@link preparedBytesOf}. @returns The kept object, which {@link preparedBytesOf} checks; undefined where the side file is missing, is no file, holds other bytes or is no JSON. @throws The refusal of a read of the side file that failed at that moment, which says nothing of its bytes ({@link noneUnlessUnread}). @example await keptPreparedOf(record, '/repo/.codebook/wiki.publish-journal.json') // => { manifest: 'eyJz…', receipt: 'eyJz…' } */
async function keptPreparedOf(record, journal) {
  const kept = record.prepared;
  if (!HASH.test(kept?.sha256) || !isRecordId(record.id)) return kept;
  const bytes = await regularBytes(preparedPathOf(journal, record.id, kept.sha256), true).catch(noneUnlessUnread(undefined));
  // The side file holds the bytes the journal names by their digest, or none count.
  if (bytes === undefined || digest(bytes) !== kept.sha256) return undefined;
  try { return JSON.parse(bytes); } catch { return undefined; }
}

/** Whether a value is base64 text, the form in which a journal keeps a candidate's prepared bytes. Called by {@link preparedBytesOf}. @example isBase64Text('eyJhIjoxfQ==') // => true */
const isBase64Text = text => typeof text === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(text);

/** Removes the side files beside a publish journal's name that keep a candidate's prepared bytes ({@link preparedPathOf}) and whose journal is gone: each one of the publisher's own form whose bytes have the digest its name says, so a file a stop cut short, which the recovery of its run removes ({@link removeLeftoversOfRun}), and any other file stay. Called by {@link underPublishLock} under the lock, where no journal stands, so any side file is a stopped publish's. @example await removeStrayPreparedFiles('/repo/.codebook/wiki.publish-journal.json') */
async function removeStrayPreparedFiles(journal) {
  const folder = dirname(journal), prefix = basename(journal) + '.prepared-';
  for (const name of await readdir(folder).catch(() => [])) {
    const parts = name.startsWith(prefix) ? PREPARED_NAME.exec(name.slice(prefix.length)) : null;
    if (parts === null) continue;
    const path = join(folder, name), bytes = await regularBytes(path, true).catch(() => undefined);
    // Only a whole side file of the publisher's: its bytes have the digest its name says.
    if (bytes !== undefined && digest(bytes) === parts[2]) await removeOwnedRecord(path, bytes).catch(() => undefined);
  }
}

/** The refusal of a recovery whose look at a file a stopped publish left, in its candidate or beside its journal, failed with a system error at that moment (`EACCES` for a file this user may not read, `EBUSY` or `EPERM` while a scanner or an indexer on Windows holds it): it gives the system's error code alone, never the error's message, which names a path the journal may have given. Called by {@link noneUnlessUnread}. @example unreadRecoveryRefusalOf('EACCES') // => 'The recovery could not read a file of the stopped publish (EACCES), so it changed nothing more in its candidate and kept the Wiki publication journal and the files beside it. …' */
const unreadRecoveryRefusalOf = code => 'The recovery could not read a file of the stopped publish (' + code + '), so it changed nothing more in its candidate and kept the Wiki publication journal and the files beside it. Run --recover again once the file can be read: another program may hold it open, as a scanner or an indexer can on Windows, or this user may not read it.';

/** The handler of a failed look of a recovery at a file a stopped publish left ({@link restoreStoppedCandidate}): a failure of the system's, which has an error code, says nothing of the file, so it stops the recovery with the refusal that names that code ({@link unreadRecoveryRefusalOf}), the failure as its cause, and the journal, the list of copies and the side file stay for the next recovery; taken for a changed or missing file, it would have the recovery remove them and leave a candidate that never publishes again. Any other failure is the publisher's own refusal of an entry that is no file of the publish (a link, a folder, a special file, a manifest that is no JSON object), which answers `none`, as before. Called by {@link holdsFinalizedBytes}, {@link keptPreparedOf}, {@link copiesBegunOf} and {@link restoreStoppedCandidate}. @param none - What a look that met no file of the publish answers. @returns The handler, given the failure. @throws The refusal of a failure of the system's. @example await regularBytes('/repo/.codebook/next/codebook-publication.json', true).catch(noneUnlessUnread(undefined)) // throws the refusal for EACCES */
const noneUnlessUnread = none => failure => {
  if (typeof failure?.code === 'string') throw new Error(unreadRecoveryRefusalOf(errorCodeOf(failure)), { cause: failure });
  return none;
};

/** Puts the candidate of a stopped publish back as it was prepared and removes what that publish left there that no next publish accepts as a file of the candidate: the files through which it put the finalized manifest and record in place ({@link finalizingFilesIn}), known by the journal's id; the manifest and the record it finalized, which take the prepared bytes the journal keeps again ({@link finalizedFilesIn}) while they hold the finalized bytes, so the learner's next edit is not refused as a change of a finalized candidate; and what the copies of the learner's files that its journal, or the list beside it, names as begun left ({@link copiesBegunOf}, {@link learnerCopiesIn}), which the Wiki still holds whole. All of it is looked at first, and nothing is written or removed before the candidate is proved this publication's own: a journal a cloned repository carries may name any folder beside the Wiki folder as its stage, another Wiki among them, with the digests of that folder's manifest and record, so only a stage by the name --prepare gives it or the one given with --stage now ({@link isNameableStage}) is changed; another one that holds something to change is refused with {@link UNREPEATED_STAGE_REFUSAL}, every file of it kept, and the journal is kept for a recovery with that --stage. A candidate that is gone, because it became the Wiki, or that is no folder of its own is left; so is any copy in a candidate without a manifest, with a manifest that is no JSON object or that holds a link, and the next publish names what it refuses. A look that fails at that moment (a file this user may not read, one a scanner or an indexer holds on Windows) is no answer, so the recovery stops there, before it changed anything in the candidate, and keeps the journal, the list of copies and the side file for the next one ({@link noneUnlessUnread}). Each removal and write is held to the output's path ({@link holdOfPath}), to the candidate's folder it lies in ({@link folderLookOf}) and to a stage that is, as the folders stand then, neither the Wiki folder nor the kept prior Wiki under another name ({@link requireStageOfItsOwn}). A copy is removed only while it is still the file that was checked, with the bytes it had then ({@link isStillWritten}): a learner who saves the copy while the recovery puts the candidate back keeps that save, and the answer names the copy. Called by {@link restoreCandidateOfJournal} for a publish journal, once the prior Wiki, the new one or none stands in the Wiki folder. @param wiki - The Wiki in the Wiki folder, as {@link inspectOutput} read it; null for none. @returns The paths, relative to the candidate, of the copies that changed after they were checked and were kept; none where nothing changed. @throws The refusal of a hold ({@link candidateHoldOf}), that of a stage that names the Wiki folder or the kept prior Wiki among them, that of a stage the recovery cannot prove its own, and that of a look that failed ({@link unreadRecoveryRefusalOf}); the journal is kept then. @example await restoreStoppedCandidate(record, wiki, paths, requirePathHeld) // => [] */
async function restoreStoppedCandidate(record, wiki, paths, requirePathHeld) {
  const { root, output } = paths, stage = record.stage, entry = await lookAt(stage);
  // A candidate that became the Wiki is gone; one that is no folder of its own is not entered, and the next publish refuses it with its sentence.
  if (entry === undefined || !(await isOwnFolder(stage, entry, root, paths.isOutputInProject))) return [];
  // The Wiki folder may stand only now, moved back from its backup name: a stage that names it under another name is refused before each removal and write.
  const requireHeld = candidateHoldOf(requirePathHeld, await folderLookOf(stage), () => requireStageOfItsOwn(record, output));
  const removeHeld = async path => { await requireHeld(path); await unlink(path); };
  // A journal of an earlier version names no id, and its publish wrote no file beside the manifest or the record.
  const hasId = isRecordId(record.id);
  const finalizing = hasId ? await finalizingFilesIn(stage, record.id) : [], finalized = hasId ? await finalizedFilesIn(record, stage, paths.journal) : [];
  // A candidate whose copies cannot be judged, by a link in it or a manifest that is no JSON object, is left for the next publish to name; a read that fails at this moment stops the recovery instead.
  const copies = wiki ? await learnerCopiesIn(stage, wiki, output, root, await copiesBegunOf(record, paths.journal)).catch(noneUnlessUnread([])) : [];
  // A candidate that holds nothing the stopped publish left is as it was prepared, whoever's it is.
  if (finalizing.length + finalized.length + copies.length === 0) return [];
  await requireStageOfItsOwn(record, output);
  // Only a candidate proved this publication's own is changed: a stage by a name of the journal's own may be any folder beside the Wiki folder.
  if (nameableStageOf(record, paths) === undefined) throw new Error(UNREPEATED_STAGE_REFUSAL);
  for (const path of finalizing) await removeHeld(path);
  await restorePreparedFiles(finalized, record.id, stage, requireHeld);
  return removeCopiesStillWritten(copies, requireHeld);
}

/** Removes the copies of the learner's files a stopped publish left in its candidate ({@link learnerCopiesIn}), each held first (`requireHeld`) and only while it is still the file the recovery checked, with the bytes it had then ({@link isStillWritten}); a copy the learner saved since stays. Called by {@link restoreStoppedCandidate}. @param copies - The copies, each its path in the candidate (`name`) and the record of the file checked (`file`). @returns The paths, relative to the candidate, of the copies that changed and were kept. @throws The refusal of a hold, and what a removal rejects with. @example await removeCopiesStillWritten(copies, requireHeld) // => ['manual.txt'] */
async function removeCopiesStillWritten(copies, requireHeld) {
  const changedCopies = [];
  for (const { name, file } of copies) {
    await requireHeld(file.path);
    // A copy that is no longer the file checked, or holds other bytes now, is the learner's save: it stays.
    if (await isStillWritten(file)) await unlink(file.path);
    else changedCopies.push(name);
  }
  return changedCopies;
}

/** Whether a journal's or a claim's id is a random UUID, as the publisher writes it. Called by {@link restoreStoppedCandidate}, {@link copiesBegunOf}, {@link keptPreparedOf}, {@link isManifestJournal}, {@link isPublishersOwnName}, {@link endStoppedLock}, {@link runRecovery} and {@link wholeRecordOf}. @example isRecordId('6f1c2a7e-…') // => true for a whole UUID */
const isRecordId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

/** The hold of a file of a stopped publish's candidate: the output's path ({@link holdOfPath}) and the candidate's folder the file lies in ({@link folderLookOf}) must still be where they were, and the candidate must not be the Wiki folder or the kept prior Wiki under another name (`requireStageHere`, {@link requireStageOfItsOwn}). Called by {@link restoreStoppedCandidate}. @returns The check, which resolves while all three hold and throws the refusal of the first that does not. @example await candidateHoldOf(requirePathHeld, isFolderWhereItWas, () => requireStageOfItsOwn(record, output))('/repo/.codebook/next/manual.txt') */
const candidateHoldOf = (requirePathHeld, isFolderWhereItWas, requireStageHere) => async path => {
  await requirePathHeld();
  await requireStageHere();
  if (!(await isFolderWhereItWas(dirname(path)))) throw holdRefusalOf(stageRefusalOf(dirname(path)));
};

/** The files beside a candidate's manifest and record through which a stopped publish was putting the finalized ones in place ({@link finalizingPathOf}), each a regular file; it only looks. Called by {@link restoreStoppedCandidate}, which removes them. @returns Their paths. @example await finalizingFilesIn('/repo/.codebook/next', journalId) // => ['/repo/.codebook/next/.codebook-publish-6f1c…-codebook-wiki.json'] */
async function finalizingFilesIn(stage, id) {
  const files = [];
  for (const name of [MANIFEST, RECEIPT]) if ((await lookAt(finalizingPathOf(stage, id, name)))?.isFile()) files.push(finalizingPathOf(stage, id, name));
  return files;
}

/** Whether a candidate's manifest or record still holds the bytes a stopped publish finalized, by their SHA-256 digest; a missing file does not, nor a link, a folder or another entry that is no file at its name. A read that fails at that moment says nothing of the bytes, so it stops the recovery, which keeps its records for the next one ({@link noneUnlessUnread}): taken for a changed file, it would leave the candidate's manifest and record a pair that never publishes again. Called by {@link finalizedFilesIn} and {@link restorePreparedFiles}. @param file - The pair the journal keeps ({@link preparedFilesOf}). @throws The refusal of a read that failed ({@link unreadRecoveryRefusalOf}). @example await holdsFinalizedBytes('/repo/.codebook/next', { name: 'codebook-wiki.json', finalizedSha256: '…' }) // => true until the learner edits the manifest */
async function holdsFinalizedBytes(stage, { name, finalizedSha256 }) {
  const current = await regularBytes(join(stage, name), true).catch(noneUnlessUnread(undefined));
  return current !== undefined && digest(current) === finalizedSha256;
}

/** The prepared manifest and record a publish journal keeps ({@link preparedFilesOf}) whose files in the candidate still hold the bytes the publish finalized ({@link holdsFinalizedBytes}); it only looks. Called by {@link restoreStoppedCandidate}, which puts them back ({@link restorePreparedFiles}). @returns The pairs. @example await finalizedFilesIn(record, '/repo/.codebook/next', '/repo/.codebook/wiki.publish-journal.json') // => [{ name: 'codebook-wiki.json', finalizedSha256: '…', prepared: <Buffer> }] */
async function finalizedFilesIn(record, stage, journal) {
  const files = [];
  for (const file of await preparedFilesOf(record, journal)) if (await holdsFinalizedBytes(stage, file)) files.push(file);
  return files;
}

/** Puts the prepared manifest and record back in a candidate ({@link finalizedFilesIn}): only a file that still holds the bytes the publish finalized, looked at again just before, takes the prepared bytes again, through the file beside it ({@link replaceOwnFileThrough}); an edit since stays. Called by {@link restoreStoppedCandidate}. @example await restorePreparedFiles(finalized, journalId, '/repo/.codebook/next', requireHeld) */
async function restorePreparedFiles(files, id, stage, requireHeld) {
  for (const file of files) {
    if (!(await holdsFinalizedBytes(stage, file))) continue;
    await requireHeld(join(stage, file.name));
    await replaceOwnFileThrough(finalizingPathOf(stage, id, file.name), join(stage, file.name), file.prepared);
  }
}

/** How far apart two boot times, each the wall clock minus the uptime, may lie and still name one boot of a machine that names its boot by no id (Windows, and a Mac whose boot session could not be read): a correction of the clock moves them. Read by {@link isOfEarlierBootTime}. */
const BOOT_TIME_TOLERANCE_MS = 60_000;
/** How long a query of a process's start (`ps` on macOS, PowerShell on Windows), of the boot session (`sysctl` on macOS) or of the computer's id ({@link machineHere}) may run before it is ended, and how many bytes a query may print unless its caller names another bound. Read by {@link queryText}. */
const START_QUERY_TIMEOUT_MS = 3_000, START_QUERY_MAX_BYTES = 1024;
/** The field of `/proc/<pid>/stat`, counted from the first after the command name, that holds the process's start in clock ticks since the boot (field 22). Read by {@link linuxStartOf}. */
const LINUX_STAT_START_INDEX = 19;

/** Runs a query program by its full path, without a shell, bounded in time and in output ({@link START_QUERY_TIMEOUT_MS}): the runner of {@link SYSTEM_HERE}, which {@link macStartOf}, {@link windowsStartOf}, {@link bootHere}, {@link macMachineIdOf} and {@link windowsMachineIdOf} run their queries with. @param env - The environment of the program; undefined for this process's. @param maxBytes - How many bytes it may print ({@link START_QUERY_MAX_BYTES} unless named). @returns What it printed, trimmed; undefined when it fails, runs too long, prints too much or prints nothing. @example await queryText('/bin/ps', ['-o', 'lstart=', '-p', '4242'], { LC_ALL: 'C', TZ: 'UTC' }) // => 'Mon Oct  5 09:12:33 2026' */
const queryText = (program, args, env, maxBytes = START_QUERY_MAX_BYTES) => new Promise(resolve => execFile(program, args, { env, timeout: START_QUERY_TIMEOUT_MS, maxBuffer: maxBytes, killSignal: 'SIGKILL', windowsHide: true },
  (error, stdout) => resolve(error ? undefined : String(stdout).trim() || undefined)));

/** The system the publisher runs on, as the owner judgement asks it about processes, the boot and the computer: its `platform`, which picks the query of a process's start ({@link START_QUERIES}), the boot's form ({@link bootHere}), the space of process ids ({@link processSpaceHere}) and the query of the computer's id ({@link MACHINE_ID_QUERIES}); its `environment`, which names the Windows folder PowerShell and `reg.exe` are started from ({@link windowsStartOf}, {@link windowsMachineIdOf}); and `run`, the runner of the bounded queries ({@link queryText}). The CLI passes it to the step it runs, and a step called without one asks it too; the publisher's tests name another system with a stand-in runner, so the queries of macOS and Windows run on every system. Read by {@link publishWiki} and {@link recoverWikiPublication}. */
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

/** Converts a creation time of the Windows process table, as WMI names it ({@link WMI_CREATION_TIME}), to the round-trip UTC form of every other Windows start. WMI names the time in local digits with the offset from UTC it used for them, so the time is taken back to UTC by that very offset. Win32_Process's provider (`cimwin32.dll`) sets the time through the WMI provider framework (`CInstance::SetDateTime` of `framedynos.dll`), which asks `WBEMTime::GetLocalOffsetForDate` once for the UTC creation time, adds that offset to it for the digits and prints the same offset, so the digits less the offset are the UTC time also where that offset is wrong for the date. A conversion by the time zone's rules gives the hour that repeats at the end of daylight saving time one offset only, and a process created in the other half of that hour would be named an hour off. The same conversion as the extension's process-start reader. Called by {@link windowsStartOf} for the answer of the query's fallback ({@link windowsStartCommand}). @param creation - The creation time as WMI's DMTF text. @returns The time in UTC to the 100 ns, its last digit `0` (the table names microseconds); undefined for a text of another shape and for a date or a time out of range. @example utcTimeOfWmiCreation('20261025013000.123456+060') // => '2026-10-25T00:30:00.1234560Z', and utcTimeOfWmiCreation('20261025013000.123456+000') // => '2026-10-25T01:30:00.1234560Z' */
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

/** The Windows folder that the environment of `system` names as the system root (`SystemRoot`, else `windir`), from which PowerShell and `reg.exe` are started by their full paths, never found on the search path. Called by {@link windowsStartOf} and {@link windowsMachineIdOf}. @returns The folder; undefined where neither names a folder of a drive. @example windowsSystemRootOf({ environment: { SystemRoot: 'C:\\Windows' } }) // => 'C:\\Windows' */
const windowsSystemRootOf = system => [system.environment.SystemRoot, system.environment.windir].find(path => /^[A-Za-z]:[\\/]/.test(path ?? ''));

/** The start of a Windows process: the creation time PowerShell prints in UTC ({@link windowsStartCommand}), PowerShell started by its full path under the system root that the environment of `system` names, never found on the search path, and run by the runner of `system` ({@link SYSTEM_HERE}). Where this user may not read the process's start, the process table's creation time answers, converted to UTC by its own offset ({@link utcTimeOfWmiCreation}, {@link startOfProcessTableTime}), so a process id that went to a process of another user does not keep a stopped publish's journal for as long as that process runs. The query of {@link START_QUERIES} on Windows. @param expectedStart - The start a journal or a claim records for this process id, which a creation time of the process table may confirm. @returns `win:<time>`; undefined without a system root and for any other answer. @example await windowsStartOf(4242, SYSTEM_HERE, undefined) // => 'win:2026-10-05T09:12:33.1234567Z' */
async function windowsStartOf(pid, system, expectedStart) {
  const systemRoot = windowsSystemRootOf(system);
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

/** The space of process ids a Linux process records where it may not read its pid namespace (`/proc/self/ns/pid`), and the start of every Linux space, which the namespace's number follows. Read by {@link processSpaceHere} and {@link namesItsSpace}. */
const LINUX_SPACE_WITHOUT_NAMESPACE = 'linux@';

/** Whether a recorded space of process ids names one space: a platform's name does, and so does `linux@` with the number of a pid namespace, while {@link LINUX_SPACE_WITHOUT_NAMESPACE} alone may be any pid namespace of its machine (two containers of one kernel and one host name may each record it), so a record of it is never judged by its process id, also by a recovery that may not read its own namespace either, as the extension judges a Linux start without a namespace ({@link canJudgeOwnerHere}). Called by {@link placeStateOf} and {@link requireExited}. @example namesItsSpace('linux@') // => false, and namesItsSpace('linux@4026531836') // => true */
const namesItsSpace = space => space !== LINUX_SPACE_WITHOUT_NAMESPACE;

/** The space of process ids this process probes: its system (the platform of `system`), and on Linux its pid namespace, which two containers or two WSL distributions of one kernel do not share; {@link LINUX_SPACE_WITHOUT_NAMESPACE} when the namespace cannot be read, which names no space ({@link namesItsSpace}). Called by {@link ownerHere}. @example await processSpaceHere(SYSTEM_HERE) // => 'linux@4026531836' */
async function processSpaceHere(system) {
  if (system.platform !== 'linux') return system.platform;
  return LINUX_SPACE_WITHOUT_NAMESPACE + (/^pid:\[(\d+)\]$/.exec(await readlink('/proc/self/ns/pid').catch(() => ''))?.[1] ?? '');
}

/** The files a Linux computer keeps its id in, in the order they are read: systemd's, then the copy of D-Bus, which a system without systemd may keep alone. Read by {@link linuxMachineIdOf}. */
const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
/** A Linux computer's id as `machine-id(5)` gives it: 32 hexadecimal digits in lower case, so an empty file and `uninitialized` name none. Read by {@link linuxMachineIdOf}. */
const LINUX_MACHINE_ID = /^[0-9a-f]{32}$/;
/** How many bytes of a Linux computer's id file are read: the id and its line end with room to spare, so a longer file names no id. Read by {@link boundedFileTextOf}. */
const MACHINE_ID_FILE_MAX_BYTES = 64;
/** The program that names a Mac's hardware UUID, by its full path, so no program of the current directory or the search path answers instead. Read by {@link macMachineIdOf}. */
const MAC_IOREG_PATH = '/usr/sbin/ioreg';
/** The line of a Mac's hardware UUID in what `ioreg -rd1 -c IOPlatformExpertDevice` prints, with the UUID as its group. Read by {@link macMachineIdOf}. */
const MAC_PLATFORM_UUID = /^\s*"IOPlatformUUID" = "([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})"$/im;
/** The key of the registry that holds a Windows computer's id (`MachineGuid`), as `reg.exe` names it. Read by {@link windowsMachineIdOf}. */
const WINDOWS_CRYPTOGRAPHY_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';
/** The line of a Windows computer's id in what `reg.exe query` prints for it, with the GUID as its group. Read by {@link windowsMachineIdOf}. */
const WINDOWS_MACHINE_GUID = /^\s*MachineGuid\s+REG_SZ\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/im;
/** How many bytes a query of the computer's id may print: `ioreg` prints every property of the Mac's platform device beside its UUID, a few kilobytes. Read by {@link macMachineIdOf} and {@link windowsMachineIdOf}. */
const MACHINE_ID_QUERY_MAX_BYTES = 65_536;
/** What a computer's id is digested behind, so the digest an owner records is this publisher's own and not the id's plain SHA-256: `machine-id(5)` asks that the id itself never leaves the computer, and a journal lies in the project folder, which a commit can publish. Read by {@link machineHere}. */
const MACHINE_DIGEST_CONTEXT = 'codebook-wiki-publisher-owner-machine:';

/** Reads the start of a small file, bounded in time ({@link START_QUERY_TIMEOUT_MS}) and in size ({@link MACHINE_ID_FILE_MAX_BYTES}). Called by {@link linuxMachineIdOf}. @returns The text, trimmed; undefined when it cannot be read in time, is longer than the bound, or holds nothing. @example await boundedFileTextOf('/etc/machine-id') // => 'e58f781eda8c48a988f3936f3ce684c3' */
async function boundedFileTextOf(path) {
  const reading = open(path, 'r').then(async handle => {
    try {
      // One byte past the bound tells a longer file from one of the bound's size.
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(MACHINE_ID_FILE_MAX_BYTES + 1), 0, MACHINE_ID_FILE_MAX_BYTES + 1, 0);
      return bytesRead > MACHINE_ID_FILE_MAX_BYTES ? undefined : buffer.toString('latin1', 0, bytesRead).trim() || undefined;
    } finally { await handle.close(); }
  });
  return Promise.race([reading, delay(START_QUERY_TIMEOUT_MS, undefined, { ref: false })]).catch(() => undefined);
}

/** A Linux computer's id: the first of {@link LINUX_MACHINE_ID_PATHS} that holds one ({@link LINUX_MACHINE_ID}). The query of {@link MACHINE_ID_QUERIES} on Linux. @returns The id; undefined where neither file holds one (a container without systemd, a system not set up yet). @example await linuxMachineIdOf() // => 'e58f781eda8c48a988f3936f3ce684c3' */
async function linuxMachineIdOf() {
  for (const path of LINUX_MACHINE_ID_PATHS) {
    const text = await boundedFileTextOf(path);
    if (text !== undefined && LINUX_MACHINE_ID.test(text)) return text;
  }
  return undefined;
}

/** A Mac's hardware UUID (`IOPlatformUUID`), as `ioreg` prints it for the platform device, run by the runner of `system` ({@link SYSTEM_HERE}) and bounded as a start query is, with room for every property `ioreg` prints beside it ({@link MACHINE_ID_QUERY_MAX_BYTES}). The query of {@link MACHINE_ID_QUERIES} on macOS. @returns The UUID; undefined for any other answer. @example await macMachineIdOf(SYSTEM_HERE) // => '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14' */
async function macMachineIdOf(system) {
  const text = await system.run(MAC_IOREG_PATH, ['-rd1', '-c', 'IOPlatformExpertDevice'], undefined, MACHINE_ID_QUERY_MAX_BYTES);
  return text === undefined ? undefined : MAC_PLATFORM_UUID.exec(text)?.[1];
}

/** A Windows computer's id (`MachineGuid` of {@link WINDOWS_CRYPTOGRAPHY_KEY}, in the registry's 64-bit view), as `reg.exe` prints it, started by its full path under the system root that the environment of `system` names, never found on the search path, and run by the runner of `system` ({@link SYSTEM_HERE}). The query of {@link MACHINE_ID_QUERIES} on Windows. @returns The GUID; undefined without a system root and for any other answer. @example await windowsMachineIdOf(SYSTEM_HERE) // => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' */
async function windowsMachineIdOf(system) {
  const systemRoot = windowsSystemRootOf(system);
  const text = systemRoot === undefined ? undefined : await system.run(win32.join(systemRoot, 'System32', 'reg.exe'),
    ['query', WINDOWS_CRYPTOGRAPHY_KEY, '/v', 'MachineGuid', '/reg:64'], undefined, MACHINE_ID_QUERY_MAX_BYTES);
  return text === undefined ? undefined : WINDOWS_MACHINE_GUID.exec(text)?.[1];
}

/** The query of the computer's id on each system whose id the publisher reads. Read by {@link machineHere}. */
const MACHINE_ID_QUERIES = { linux: linuxMachineIdOf, darwin: macMachineIdOf, win32: windowsMachineIdOf };

/** The digest of this computer's id that an owner records ({@link ownerHere}), by the platform of `system` ({@link MACHINE_ID_QUERIES}): the SHA-256 of the id in lower case behind {@link MACHINE_DIGEST_CONTEXT}, never the id. A computer's id does not follow its host name, so an owner of another boot with this host name is an earlier boot of this computer only where both name this digest ({@link isSameMachine}), and an owner that names another digest is another computer's, whatever its boot ({@link isOfAnotherMachine}): another computer may have the same host name, and the first pid namespace of Linux has one number on every machine. Called by {@link ownerHere}. @returns The digest, 64 hexadecimal digits; undefined where the id cannot be read, and on any other system. @example await machineHere(SYSTEM_HERE) // => '4c0f…' (64 digits) */
async function machineHere(system) {
  const id = Object.hasOwn(MACHINE_ID_QUERIES, system.platform) ? await MACHINE_ID_QUERIES[system.platform](system) : undefined;
  return id === undefined ? undefined : digest(MACHINE_DIGEST_CONTEXT + id.toLowerCase());
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

/** What a journal, a recovery claim or a publish lock of this process records of its owner beside the process id, so a later recovery tells whether that owner can still be at work: the machine's host name in the form a recovery accepts ({@link ownerHostOf}), the space of process ids ({@link processSpaceHere}), the boot ({@link bootHere}), the process's start ({@link processStartOf}) and, where it can be read, the digest of the computer's id ({@link machineHere}), each as `system` tells it ({@link SYSTEM_HERE}). Read once per process and system: {@link publishWiki} and {@link recoverWikiPublication} start the read first, without waiting for it, so its queries run beside their other steps; {@link takePublishLock}, {@link publishJournalOf}, {@link claimRecovery} and {@link manifestJournalOf} wait for it before a lock, a journal or a claim is written, and {@link requireExited} before it judges an owner. @returns The owner, without the process id. @example await ownerHere(SYSTEM_HERE) // => { host: 'workstation', space: 'linux@4026531836', boot: { id: '0c1d…' }, start: 'linux:16362446', machine: '4c0f…' } */
function ownerHere(system) {
  if (!ownerReadings.has(system)) {
    // The space, the boot, the start and the computer's id are read side by side: on macOS and Windows each may start a program.
    const reading = Promise.all([processSpaceHere(system), bootHere(system), processStartOf(process.pid, system, undefined), machineHere(system)])
      .then(([space, boot, start, machine]) => ({ host: ownerHostOf(hostname()), space, boot, start, machine }));
    // A step refused before it waits for the read must not end the process with an unhandled rejection; a step that waits still gets the failure.
    reading.catch(() => undefined);
    ownerReadings.set(system, reading);
  }
  return ownerReadings.get(system);
}

/** Whether a recorded boot is in the form {@link bootHere} gives: a boot id, or a boot time. Called by {@link isOwnerForm}. @example isBootForm({ atMs: 1790000000000 }) // => true */
const isBootForm = boot => typeof boot?.id === 'string' || Number.isFinite(boot?.atMs);

/** Whether a recorded owner is in the form {@link ownerHere} writes: a host name of {@link OWNER_HOST_FORM} and a space of {@link OWNER_SPACE_FORM}, which a refusal may name, a boot ({@link isBootForm}), if any, a start and, if any, the digest of the computer's id ({@link machineHere}), 64 hexadecimal digits and nothing else. Called by {@link requireOwnerForm}. @example isOwnerForm({ host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-1' } }) // => true */
const isOwnerForm = owner => owner !== null && typeof owner === 'object' && typeof owner.host === 'string' && OWNER_HOST_FORM.test(owner.host) &&
  typeof owner.space === 'string' && OWNER_SPACE_FORM.test(owner.space) && isBootForm(owner.boot) && (owner.start === undefined || typeof owner.start === 'string') &&
  (owner.machine === undefined || typeof owner.machine === 'string' && HASH.test(owner.machine));

/** Whether no process has an id here, probed with signal 0: `ESRCH` alone says so; a process of another user that runs answers `EPERM`, which says it exists. Called by {@link ownerStateOf} and {@link processStateOf}. @example isProcessIdFree(process.pid) // => false */
function isProcessIdFree(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

/** Judges the owner a journal or a recovery claim records: `gone` when it cannot be at work any more, `running` while it may run here, `elsewhere` when it ran on another machine, in another space of process ids or in a Linux space that names no pid namespace ({@link namesItsSpace}), which no probe here reaches. A record of an earlier version names its process id alone and is judged by that id here, as then. A record with its owner: one of another host name is of another machine, unless both name one boot id, and so is one that names another digest of the computer's id than this recovery, whatever its boot ({@link isOfAnotherMachine}); another boot, by its boot id, or, where neither names one and the record has no start, by a boot time that lies apart by more than {@link BOOT_TIME_TOLERANCE_MS}, is an earlier boot of this machine, which ended every process of it, only where both name one digest of the computer's id ({@link isSameMachine}), and otherwise of another machine with this host name; a process id no process has is gone; a process id another process has now, which began at another time than the recorded start, is gone too. Called by {@link requireExited}, with the owner `system` tells of this process ({@link ownerHere}). @example await ownerStateOf({ pid: 4242, owner: { host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-1' }, machine: '4c0f…' } }, { host: 'workstation', space: 'linux@4026531836', boot: { id: 'boot-2' }, machine: '4c0f…' }, SYSTEM_HERE) // => 'gone' */
async function ownerStateOf({ pid, owner }, here, system) {
  if (owner === undefined) return isProcessIdFree(pid) ? 'gone' : 'running';
  return placeStateOf(owner, here) ?? processStateOf(pid, owner, system);
}

/** Judges a recorded owner by where it ran, before its process id is probed: `elsewhere` for another machine (another host name, unless both name one boot id, or another digest of the computer's id where both name one, {@link isOfAnotherMachine}), another space of process ids or a space that names none ({@link namesItsSpace}); another boot ({@link isOfEarlierBootTime} where neither names a boot id) is `gone`, an earlier boot of this machine, only where both name one digest of the computer's id ({@link isSameMachine}), and `elsewhere` otherwise: another computer may have this host name, and the first pid namespace of Linux has one number on every machine, so a record of 0.2.30.0, which names no digest, needs the learner's pair once. The digest is compared before any boot: a Windows record names no boot id and a start, as does a Mac's whose boot session could not be read, so no boot tells another computer with this host name from this one, and its process id would be probed here. Called by {@link ownerStateOf}. @returns The state; undefined when the owner ran under this boot, in this space, and its process id decides ({@link processStateOf}). @example placeStateOf({ host: 'workstation', space: 'linux@1', boot: { id: 'boot-1' } }, { host: 'workstation', space: 'linux@1', boot: { id: 'boot-2' }, machine: '4c0f…' }) // => 'elsewhere' */
function placeStateOf(owner, here) {
  const hasBootIds = owner.boot.id !== undefined && here.boot.id !== undefined;
  // A machine is known by its host name, or, under another one, by its exact boot.
  if (owner.host !== here.host && !(hasBootIds && owner.boot.id === here.boot.id)) return 'elsewhere';
  // Another digest of the computer's id is another computer, whatever its boot: no process id of it can be probed here.
  if (isOfAnotherMachine(owner, here)) return 'elsewhere';
  // Another boot id is an earlier boot of this machine only by the digest of its id, whatever space ran under it: a pid namespace gets another number after a restart.
  if (hasBootIds && owner.boot.id !== here.boot.id) return isSameMachine(owner, here) ? 'gone' : 'elsewhere';
  // A space that names no pid namespace may be any space of this machine, also where this recovery's names none either.
  if (owner.space !== here.space || !namesItsSpace(owner.space)) return 'elsewhere';
  // A boot time apart is another boot as well, and an earlier one of this machine by the same digest alone.
  if (isOfEarlierBootTime(owner, here, hasBootIds)) return isSameMachine(owner, here) ? 'gone' : 'elsewhere';
  return undefined;
}

/** Whether a recorded owner and this recovery name one computer by the digest of its id ({@link machineHere}): both name one, and it is the same. A host name does not tell two computers apart, and a boot id or a boot time that differs is as much another computer's as an earlier boot's. Called by {@link placeStateOf}. @example isSameMachine({ machine: '4c0f…' }, { machine: '4c0f…' }) // => true, and isSameMachine({}, { machine: '4c0f…' }) // => false */
const isSameMachine = (owner, here) => owner.machine !== undefined && owner.machine === here.machine;

/** Whether a recorded owner and this recovery name two computers by the digests of their ids ({@link machineHere}): both name one, and they differ. A record that names none (one of 0.2.30.0) or a recovery that cannot read its own is not proved another computer's by it. Called by {@link placeStateOf}, before any boot is compared, and by {@link requireExited}, whose refusal names the other computer then. @example isOfAnotherMachine({ machine: '0f1e…' }, { machine: '4c0f…' }) // => true, and isOfAnotherMachine({}, { machine: '4c0f…' }) // => false */
const isOfAnotherMachine = (owner, here) => owner.machine !== undefined && here.machine !== undefined && owner.machine !== here.machine;

/** Whether a recorded owner ran under another boot than this recovery: by the boot ids where both name one, else by the boot times of a record without a start ({@link isOfEarlierBootTime}). Called by {@link requireExited} for an owner judged `elsewhere`, whose refusal says then that another computer may have this host name. @example isOfAnotherBoot({ boot: { id: 'boot-1' } }, { boot: { id: 'boot-2' } }) // => true */
const isOfAnotherBoot = (owner, here) => owner.boot.id !== undefined && here.boot.id !== undefined ? owner.boot.id !== here.boot.id : isOfEarlierBootTime(owner, here, false);

/** Whether a recorded owner without a start ran under another boot by the boot times alone, which lie apart by more than {@link BOOT_TIME_TOLERANCE_MS}: a boot time decides only for a record without a start, since a correction of the clock moves it and a start decides better, and only where neither side names a boot id; that boot is an earlier one of this machine only by the digest of the computer's id ({@link placeStateOf}). Called by {@link placeStateOf} and {@link isOfAnotherBoot}. @example isOfEarlierBootTime({ boot: { atMs: 0 } }, { boot: { atMs: 3600000 } }, false) // => true */
const isOfEarlierBootTime = (owner, here, hasBootIds) => owner.start === undefined && !hasBootIds && Number.isFinite(owner.boot.atMs) && Number.isFinite(here.boot.atMs) &&
  Math.abs(owner.boot.atMs - here.boot.atMs) > BOOT_TIME_TOLERANCE_MS;

/** Judges a recorded owner of this boot and space by its process id: `gone` when no process has the id, or when the process that has it now began at another time than the recorded start, as `system` tells it ({@link processStartOf}); `running` otherwise, also when the start cannot be read. Called by {@link ownerStateOf}. @example await processStateOf(process.pid, { start: 'linux:1' }, SYSTEM_HERE) // => 'gone' */
async function processStateOf(pid, owner, system) {
  if (isProcessIdFree(pid)) return 'gone';
  const liveStart = owner.start === undefined ? undefined : await processStartOf(pid, system, owner.start);
  return liveStart !== undefined && liveStart !== owner.start ? 'gone' : 'running';
}

/** Refuses recovery while a recorded publisher or recovery process may still own the operation ({@link ownerStateOf}), or when it ran where this recovery cannot look at it, unless the learner confirmed that place gone ({@link isOwnerAt}). Called by {@link resumeJournal} for a journal, by {@link endStoppedLock} for a publish lock, by {@link claimRecovery} for an earlier claim and by {@link isOrphanStopped} for the writer a file beside a record names. @param recorded - The parsed journal or claim, with its `pid` and, from this version on, its `owner`. @param ownerJudgement - The `system` this recovery runs on ({@link SYSTEM_HERE}) and the `goneOwners`, the places the learner named with `--gone-host` and `--gone-space`, one pair for each (none when absent): an owner judged `elsewhere` at one of those host names and spaces counts as gone; one judged `running` never does. @throws The refusal of an invalid owner, of one that may still run, and of one of another machine or space of process ids, or of this host name under another boot that the digest of the computer's id does not prove this machine's ({@link isOfAnotherBoot}), or of this host name on another computer by that digest ({@link isOfAnotherMachine}), which names the way out for a place that cannot come back: the two options set to that place, or, where the learner named places already, one more pair; for a space that names no pid namespace, which no recovery can look at, that pair is the only way out. @example await requireExited({ pid: 1 }, { system: SYSTEM_HERE }) // throws: The prior Wiki publisher process 1 may still be running; inspect it before recovery. */
async function requireExited(recorded, { system, goneOwners = [] }) {
  requireOwnerForm(recorded);
  const { pid, owner } = recorded, here = await ownerHere(system);
  const state = await ownerStateOf({ pid, owner }, here, system);
  // An owner in a place the learner confirmed gone counts as gone; the options never end an owner that may still run here.
  if (state === 'gone' || state === 'elsewhere' && isOwnerAt(owner, goneOwners)) return;
  // Where the learner named places already, the place of this owner is one more pair beside them: a stopped recovery may have run in a second place that cannot come back.
  const wayOut = goneOwners.length === 0 ? '--gone-host and --gone-space set to that host name and space' : 'one more --gone-host and --gone-space pair set to that host name and space, keeping the pairs already named';
  // No recovery anywhere can look at a process of a space that names no pid namespace, so the learner's confirmation is the only way out.
  if (state === 'elsewhere' && !namesItsSpace(owner.space)) throw new Error('The prior Wiki publisher process ' + pid + ' ran on ' + placeOf(owner) + ', a space of process ids whose pid namespace it could not read, where no recovery can look at it. Run --recover here with ' + wayOut + ', only after the learner confirms that no publisher runs there.');
  // An owner of this host name under another boot that the digest of the computer's id does not prove this machine's may be this computer before a restart or another computer of that name.
  if (state === 'elsewhere' && owner.host === here.host && isOfAnotherBoot(owner, here)) throw new Error('The prior Wiki publisher process ' + pid + ' ran on ' + placeOf(owner) + ' under another boot, which this recovery cannot prove was this computer before a restart: another computer may have the same host name. If another computer with this host name may be publishing this Wiki, run --recover there after it exits. Otherwise, or if that computer cannot come back, run --recover here with ' + wayOut + ', only after the learner confirms that no publisher runs there.');
  // An owner of this host name whose computer's id has another digest ran on another computer, or on this one before its id changed.
  if (state === 'elsewhere' && owner.host === here.host && isOfAnotherMachine(owner, here)) throw new Error('The prior Wiki publisher process ' + pid + ' ran on ' + placeOf(owner) + ' on another computer with the same host name: the digest of the computer’s id it records is not this computer’s. If that computer may be publishing this Wiki, run --recover there after it exits. If it cannot come back, or it was this computer before its id changed (a reinstall gives a new one), run --recover here with ' + wayOut + ', only after the learner confirms that no publisher runs there.');
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

/** Whether a recorded owner ran at one of the places, each a host name and a space of process ids, that the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place). Called by {@link requireExited}, {@link requireGoneOwnersOf} and {@link requireOrphanWritersAt}. @param owner - The owner a journal or a claim records; undefined for a record of an earlier version, which names none and is at no place. @param goneOwners - The places, each `{ host, space }`. @example isOwnerAt({ host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' } }, [{ host: 'devbox', space: 'linux@1' }]) // => true */
const isOwnerAt = (owner, goneOwners) => owner !== undefined && goneOwners.some(place => owner.host === place.host && owner.space === place.space);

/** The refusal of a `--gone-host` and `--gone-space` pair that names no owner's place: another host name or space than those the journal's or the publish lock's owner and the stopped recovery claims of its chain record, or no journal or lock with an owner at all, nor, where neither stands, a writer that a file a stopped run left beside them names ({@link requireOrphanWritersAt}); it names the record that stands. Called by {@link requireGoneOwnersOf}, {@link requireOrphanWritersAt} and {@link endUnwrittenRecord}. @param goneOwner - The place named that no owner records. @param owner - The journal's owner, held to its form; undefined for a journal of an earlier version, which names none, and where no journal stands. @param recordName - The record the owner is read from, as the refusal names it: the Wiki publication journal, or the Wiki publish lock where no journal stands ({@link endStoppedLock}). @param claimOwners - The owners the stopped recovery claims of the journal's chain record, held to their form ({@link claimOwnersOf}); a place the journal's owner names too is named once. @example goneOwnerRefusalOf({ host: 'devbox', space: 'linux@1' }, undefined, []) // => '--gone-host and --gone-space name "devbox" (linux@1), but no Wiki publication journal with an owner stands. …' */
function goneOwnerRefusalOf(goneOwner, owner, claimOwners, recordName = 'Wiki publication journal') {
  const claimPlaces = [...new Set(claimOwners.map(placeOf))].filter(place => owner === undefined || place !== placeOf(owner));
  // A journal of an earlier version names no owner, while a claim beside it may.
  if (owner === undefined && claimPlaces.length === 0) return '--gone-host and --gone-space name ' + placeOf(goneOwner) + ', but no ' + recordName + ' with an owner stands. Nothing was moved. Run --recover without them.';
  return '--gone-host and --gone-space name ' + placeOf(goneOwner) + ', but the ' + recordName + ' names ' + (owner === undefined ? 'no owner' : placeOf(owner)) +
    (claimPlaces.length === 0 ? '' : ' and its stopped recoveries name ' + claimPlaces.join(', ')) + '. Nothing was moved. Name the host name and the space that the refusal of --recover names, or run --recover without them.';
}

/** Refuses a place the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place) unless it is the host name and the space of the owner the journal records or of an owner a stopped recovery claim of its chain records ({@link claimOwnersOf}), before any owner is judged, so the options never end a publish or a recovery they do not name; the journal's owner and the claims' are held to their form first ({@link requireOwnerForm}), so the refusal never names an owner of another form; without the options nothing is read or refused here. Called by {@link resumeJournal} for a journal and by {@link endStoppedLock} for a publish lock. @param record - The parsed journal. @param journal - The journal's path, beside which its claims stand. @param bytes - The journal's bytes, whose digest names its first claim. @param goneOwners - The places, each `{ host, space }`; none when absent. @param recordName - The record, as a refusal names it ({@link goneOwnerRefusalOf}); the journal when absent. @throws The refusal of an invalid owner or claim, of claims that form a cycle, and that of {@link goneOwnerRefusalOf}. @example await requireGoneOwnersOf({ pid: 4242, owner: { host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' } } }, journal, bytes, [{ host: 'devbox', space: 'linux@2' }]) // throws where no claim of 'devbox' (linux@2) stands */
async function requireGoneOwnersOf(record, journal, bytes, goneOwners = [], recordName) {
  if (goneOwners.length === 0) return;
  requireOwnerForm(record);
  const claimOwners = await claimOwnersOf(journal, bytes), owners = [record.owner, ...claimOwners];
  const unnamed = goneOwners.find(place => !owners.some(owner => isOwnerAt(owner, [place])));
  if (unnamed !== undefined) throw new Error(goneOwnerRefusalOf(unnamed, record.owner, claimOwners, recordName));
}

/** The refusal of a recovery claim that is no record the publisher writes: no JSON object, or one without a valid id. Read by {@link stoppedClaimAt}. */
const INVALID_CLAIM_REFUSAL = 'The Wiki recovery claim is invalid; it was preserved.';

/** Reads a stopped recovery claim, the exclusive record of an earlier recovery of a journal ({@link claimRecovery}), which must name the id its successor's claim is named by. Called by {@link claimRecovery}, {@link claimOwnersOf} and {@link claimChainOf}. @param optional - Whether a missing claim is answered with undefined instead of refused. @returns The claim's bytes and its record; no record for a claim without a byte, which an earlier version leaves when it stops between the exclusive create of its claim and the write of it; undefined for a missing claim when `optional`. @throws The refusal of a claim that is no JSON object or has no valid id ({@link INVALID_CLAIM_REFUSAL}), and of one that is no regular file; it is preserved. @example await stoppedClaimAt(journal + '.recovery-' + digest(bytes), true) // => { bytes: <Buffer …>, record: { pid: 4242, owner: { host: 'devbox', … }, id: '11111111-1111-4111-8111-111111111111' } } */
async function stoppedClaimAt(path, optional) {
  const bytes = await regularBytes(path, optional);
  if (bytes === undefined) return undefined;
  // A claim without a byte names no owner and no id, so no claim can follow it ({@link endUnwrittenClaim}).
  if (bytes.length === 0) return { bytes, record: undefined };
  const record = parseRecordOf(bytes, INVALID_CLAIM_REFUSAL);
  if (typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/.test(record.id)) throw new Error(INVALID_CLAIM_REFUSAL);
  return { bytes, record };
}

/** The owners the stopped recovery claims of a journal's chain record, in the chain's order, each held to the form {@link ownerHere} writes ({@link requireOwnerForm}) before a refusal may name it; a claim of an earlier version names none, and one without a byte ends the chain. It only reads, so the places the learner confirmed gone are checked before any owner is judged or a claim is written. Called by {@link requireGoneOwnersOf}. @returns The owners the claims name. @throws The refusals of {@link stoppedClaimAt} and of an invalid owner, and that of claims that form a cycle. @example await claimOwnersOf(journal, bytes) // => [{ host: 'devbox', space: 'linux@1', boot: { id: 'boot-1' }, start: 'linux:42' }] */
async function claimOwnersOf(journal, bytes) {
  const owners = [], visited = new Set();
  // The chain runs from the journal's digest through each claim's id, as {@link claimRecovery} walks it, and ends at the first id no claim is named by.
  for (let parent = digest(bytes); !visited.has(parent);) {
    visited.add(parent);
    const claim = await stoppedClaimAt(journal + '.recovery-' + parent, true);
    // A claim without a byte names no owner, and no claim can be named by an id it never wrote: the chain ends there.
    if (claim === undefined || claim.record === undefined) return owners;
    requireOwnerForm(claim.record);
    if (claim.record.owner !== undefined) owners.push(claim.record.owner);
    parent = claim.record.id;
  }
  throw new Error('The Wiki recovery claims form a cycle; all records were preserved.');
}

/** Claims stopped recovery attempts of a journal, or of a publish lock ({@link endStoppedLock}), through append-only exclusive records beside it, without unlinking another contender's lock; each claim names its owner as the `system` of `ownerJudgement` tells it ({@link ownerHere}), and an earlier claim ({@link stoppedClaimAt}) is judged by it and by the places the learner confirmed gone ({@link requireExited}); an earlier claim without a byte is ended ({@link endUnwrittenClaim}) and its place claimed. @example await claimRecovery(journal, journalBytes, { system: SYSTEM_HERE }) */
async function claimRecovery(journal, bytes, ownerJudgement) {
  // Journal hash -> exclusive owner -> stopped owner ID -> exclusive successor; a live owner stops traversal.
  const claims = [];
  let parent = digest(bytes);
  for (const visited = new Set([parent]); ;) {
    const path = journal + '.recovery-' + parent, id = randomUUID(), claimBytes = JSON.stringify({ pid: process.pid, owner: await ownerHere(ownerJudgement.system), id });
    try { await writeWholeRecord(path, claimBytes, id); claims.push({ path, bytes: claimBytes }); return claims; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const previous = await stoppedClaimAt(path, false);
    // A claim without a byte has no successor: once it is ended, this recovery claims its place.
    if (previous.record === undefined) { await endUnwrittenClaim(path); continue; }
    await requireExited(previous.record, ownerJudgement);
    claims.push({ path, bytes: previous.bytes });
    parent = previous.record.id;
    if (visited.has(parent)) throw new Error('The Wiki recovery claims form a cycle; all records were preserved.');
    visited.add(parent);
  }
}

/** The refusal of a recovery claim without a byte changed within {@link UNWRITTEN_RECORD_GRACE_MS}, whose recovery may be writing it now. Read by {@link endUnwrittenClaim}. */
const UNWRITTEN_CLAIM_REFUSAL = 'The Wiki recovery claim is empty, and the recovery that created it may be writing it now. Nothing was moved. Run --recover again once that process exits.';

/** Ends a recovery claim without a byte, which an earlier version leaves when it stops between the exclusive create of its claim and the write of it: that version wrote the claim in one call and began its recovery only once the call returned, so such a recovery moved and wrote nothing, and no claim can follow it, as a successor is named by the id it never wrote. It is removed once it has stood unchanged for {@link UNWRITTEN_RECORD_GRACE_MS} ({@link hasStoodUnwritten}), and its place is claimed again by the recovery that ends it; without that, the recovery stays refused for it while the skill forbids deleting a record. Called by {@link claimRecovery}. @throws The refusal of a claim changed within the grace ({@link UNWRITTEN_CLAIM_REFUSAL}), that of a claim whose age cannot be judged ({@link unreadClockRefusalOf}), and that of a claim that got bytes meanwhile ({@link removeOwnedRecord}); the claim is kept then. @example await endUnwrittenClaim('/repo/.codebook/wiki.publish-journal.json.recovery-3f2a…') */
async function endUnwrittenClaim(path) {
  if (!(await hasStoodUnwritten(path, 'Wiki recovery claim'))) throw new Error(UNWRITTEN_CLAIM_REFUSAL);
  await removeOwnedRecord(path, Buffer.alloc(0));
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

/** Ends a resumed metadata recovery whose edited manifest the learner changed again after its process stopped: the staging file it wrote in the Wiki folder is removed while it holds the retained manifest, so no file of the recovery's is left there for the next publish to carry over as the learner's, and the edit it kept beside the Wiki stays. The refusal it answers is marked, so {@link runRecovery} removes the journal and {@link recoverAt} recovers again from the manifest as it is now. Called by {@link requireRecordedEdit}. @returns The marked refusal, to be thrown. @example throw await endSupersededRestore(record, requireHeld) */
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

/** Restores an edited manifest ({@link restoreManifest}) only while the output's path and the Wiki folder hold: each write is held before and after it and the rename before it, by the path ({@link holdOfPath}) and the Wiki folder itself ({@link folderLookOf}), and a refused hold removes what this recovery wrote that is still its own ({@link removeWritten}). Called by {@link recoverManifestJournal}, with whether the journal is one a stopped recovery left (`isResumed`). @example await restoreManifestHeld(record, paths, requirePathHeld, false) */
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

/** Recovers stopped swaps or manifest-only drift; altered metadata and manual files remain available. A stopped publish is recovered whatever the published manifest holds now, since the retained manifest of the Wiki's record decides; a manifest edited meanwhile is restored by the next recovery. A stopped metadata recovery whose edited manifest changed again since is ended and recovered once more from the manifest as it is now, so each edit is kept beside the Wiki. A journal without a byte, which names no step, is ended alone ({@link endUnwrittenJournal}). Where no journal stands, a publish lock that a stopped publish or preview left is ended under the gate of its owner ({@link endStoppedLock}); the lock of a run whose journal a recovery ended goes after that journal ({@link endLockOfRun}). @param options.goneOwners - The places, each the host name and the space of process ids (`{ host, space }`), that the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place): places that cannot come back, such as a rebuilt container or a machine that is gone, where no publisher or recovery runs; each accepted only when it is the place of the journal's owner, or of the lock's where no journal stands, or of an owner a stopped recovery claim of its chain records ({@link requireGoneOwnersOf}), or, where neither stands, of a writer a file a stopped run left beside them names, which the sweep at the end then removes ({@link requireOrphanWritersAt}), never taken without the learner. @param options.system - The system whose processes and boot the owner of a journal or a claim is judged by ({@link SYSTEM_HERE}, which the CLI passes). @example await recoverWikiPublication({ projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' }) */
export async function recoverWikiPublication({ projectRoot, outputDirectory, stageDirectory, goneOwners = [], system = SYSTEM_HERE }) {
  // The read of this recovery's owner, which judges a journal's or a claim's owner and names its own, starts now and runs beside the steps before them.
  ownerHere(system);
  const paths = await locations(projectRoot, outputDirectory, stageDirectory);
  // Every write and move below is held to the look the paths were resolved with.
  const requirePathHeld = await holdOfPath(paths, []);
  const result = await recoverAt(paths, requirePathHeld, { projectRoot, outputDirectory, stageDirectory, goneOwners, system });
  // Once the recovery ended what it found, what stopped runs left beside the Wiki folder that no record names goes too.
  await removeOrphansBeside(paths, requirePathHeld, { system, goneOwners });
  return result;
}

/** The recovery of {@link recoverWikiPublication} at the paths it resolved: it opens the recovery ({@link openRecovery}), which may end there, recovers by the journal it opened ({@link runRecovery}), and runs once more after a superseded manifest recovery. Called by {@link recoverWikiPublication}. @param options - What {@link recoverWikiPublication} was called with. @returns What the recovery did, as {@link recoverWikiPublication} answers it. @throws The refusals of the steps it takes. @example await recoverAt(paths, requirePathHeld, { projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki', goneOwners: [], system: SYSTEM_HERE }) // => { status: 'published-current', output: '/repo/.codebook/wiki' } */
async function recoverAt(paths, requirePathHeld, { projectRoot, outputDirectory, stageDirectory, goneOwners, system }) {
  const opened = await openRecovery(paths, requirePathHeld, { system, goneOwners });
  if (opened.result !== undefined) return opened.result;
  const result = await runRecovery(opened, paths, requirePathHeld);
  // The ended recovery's journal is gone, so this one starts from the manifest as it is now and writes a journal of its own: it cannot be superseded in turn.
  return result ?? recoverWikiPublication({ projectRoot, outputDirectory, stageDirectory, system });
}

/** Opens a recovery at the paths {@link recoverWikiPublication} resolved: a journal without a byte is ended alone ({@link endUnwrittenJournal}), a journal a stopped step left is taken up ({@link resumeJournal}), a publish lock without a journal is ended under the gate of its owner ({@link endStoppedLock}), or, where the journal of its run stands once its recovery is claimed, that journal is opened instead, places confirmed gone without either are refused unless each is that of a writer a file a stopped run left beside them names ({@link requireOrphanWritersAt}), and otherwise an edited manifest's recovery starts ({@link startManifestRecovery}). Called by {@link recoverAt}. @param ownerJudgement - The system and the places the learner confirmed gone. @returns `{ result }` for a recovery that ended here; otherwise the journal's record and bytes, the claims taken and whether the journal was one a stopped step left (`isResumed`). @throws The refusals of the steps it takes. @example await openRecovery(paths, requirePathHeld, { system: SYSTEM_HERE, goneOwners: [] }) // => { result: { status: 'published-current', output: '/repo/.codebook/wiki' } } */
async function openRecovery(paths, requirePathHeld, ownerJudgement) {
  const found = await regularBytes(paths.journal, true), { goneOwners } = ownerJudgement;
  // A journal without a byte names no step and no owner: its writer stopped between creating and writing it, or is writing it now.
  if (found?.length === 0) return { result: await endUnwrittenJournal(paths, requirePathHeld, goneOwners) };
  // A journal found here is one a stopped publish or recovery left; this recovery writes its own below.
  if (found !== undefined) return { ...await resumeJournal(found, paths, requirePathHeld, ownerJudgement), isResumed: true };
  // Without a journal, a publish lock that a stopped publish or preview left is ended under the gate of its owner.
  const lockBytes = await regularBytes(paths.lock, true);
  if (lockBytes !== undefined) {
    const result = await endStoppedLock(lockBytes, paths, requirePathHeld, ownerJudgement);
    // A journal that came once the lock's recovery was claimed is opened as one a stopped step left.
    return result === undefined ? openRecovery(paths, requirePathHeld, ownerJudgement) : { result };
  }
  // A place confirmed gone names the owner of a journal, of a lock or of their claims; without either it may name only the writer of a file a stopped run left beside them, which the sweep after this recovery ends.
  if (goneOwners.length > 0) await requireOrphanWritersAt(paths, goneOwners);
  return { ...await startManifestRecovery(paths, requirePathHeld, ownerJudgement.system), isResumed: false };
}

/** Recovers by the journal a recovery opened ({@link openRecovery}): while the path holds and the journal is the one claimed, the stopped publish or the edited manifest is recovered ({@link recoverPublishJournal}, {@link recoverManifestJournal}), what the run left beside its journal goes, by the journal's id, before the journal ({@link removeLeftoversOfRun}), the claims are released ({@link releaseClaims}), and the publish lock of that run goes after it ({@link endLockOfRun}). Called by {@link recoverAt}. @param opened - The journal's record and bytes, the claims taken, and whether the journal was one a stopped step left. @returns What the recovery did; undefined for a superseded manifest recovery, whose journal was removed. @throws The refusal of a changed path or journal, and what the recovery refuses; the journal is kept then. @example await runRecovery(opened, paths, requirePathHeld) // => { status: 'published-or-restored', output: '/repo/.codebook/wiki', previousOutput: undefined } */
async function runRecovery({ record, bytes, claims, isResumed }, paths, requirePathHeld) {
  let completed = false, result;
  try {
    await requirePathHeld();
    if (!(await regularBytes(paths.journal)).equals(bytes)) throw new Error('The Wiki publication journal changed during recovery.');
    result = record.operation === 'restore-manifest' ? await recoverManifestJournal(record, paths, requirePathHeld, isResumed) : await recoverPublishJournal(record, paths, requirePathHeld);
    // What the run left beside its journal goes with it, first, by the journal's id, so none of it is left without its journal.
    if (isRecordId(record.id)) await removeLeftoversOfRun(paths, record.id);
    await removeOwnedRecord(paths.journal, bytes);
    completed = true;
  } finally { await releaseClaims(claims, completed); }
  // The publish lock of the run whose journal ended goes after it; a lock of another run stays for its own recovery.
  if (record.operation !== 'restore-manifest' && isRecordId(record.id)) await endLockOfRun(record.id, paths.lock);
  return result;
}

/** How long a journal, a recovery claim or a publish lock without a byte must have stood unchanged, by the clock of the file system that holds it, before a recovery takes it for one whose writer stopped between the exclusive create and the write ({@link hasStoodUnwritten}): a step that runs is between the two for the time of one small write only; the same grace ends a file a stopped run left beside such a record ({@link removeOrphansBeside}). The grace the extension gives a storage lock left empty. Read by {@link hasStoodUnwritten} and {@link graceJudgeOf}. */
const UNWRITTEN_RECORD_GRACE_MS = 10_000;
/** How many nanoseconds a millisecond holds, for the file times read as bigints. Read by {@link hasStoodUnwritten} and {@link graceJudgeOf}. */
const NS_PER_MS = 1_000_000n;
/** What the publisher writes into the file beside a record that it reads the file system's clock from ({@link fileSystemTimeBeside}): one line break, so the file system stamps a write on it. Read by {@link fileSystemTimeBeside}, by {@link readOrphan}, which reads no larger clock file, and by {@link isOrphanStopped}, which takes a file of these bytes, or of none, for a clock file. */
const CLOCK_FILE_BYTES = '\n';

/** Whether a journal, a recovery claim or a publish lock without a byte has stood unchanged for {@link UNWRITTEN_RECORD_GRACE_MS}, by its last change and by the clock of the file system that stamped it ({@link fileSystemTimeBeside}), never by this computer's: a file server, or the Windows host under a WSL2 window, stamps by its own clock, which this computer's may run minutes ahead of, so a record just created would look old. A younger one may belong to a step that is writing it now. Called by {@link endUnwrittenRecord} and {@link endUnwrittenClaim}. @param recordName - The record, as the refusal of an unread clock names it. @throws Where the file system's clock cannot be read, the refusal that gives the system's reason ({@link unreadClockRefusalOf}); the record is kept. @example await hasStoodUnwritten('/repo/.codebook/wiki.publish-journal.json', 'Wiki publication journal') // => true a minute after an earlier version was stopped between creating and writing it */
const hasStoodUnwritten = async (path, recordName) => {
  const changed = (await lstat(path, { bigint: true })).mtimeNs, now = await fileSystemTimeBeside(path);
  if (now.failure !== undefined) throw new Error(unreadClockRefusalOf(recordName, now.failure));
  return now.time - changed > BigInt(UNWRITTEN_RECORD_GRACE_MS) * NS_PER_MS;
};

/** What {@link unreadClockRefusalOf} says of the clock file for each step of {@link fileSystemTimeBeside} that can fail, the create, the write and the status read, and the advice that fits that step: a create fails for a full disk, a quota or a folder this user may not write; a write of a file just made for a full disk or a disk error; a status read for a disk error, after which the file is kept, as it cannot be told from another one ({@link fileSystemTimeBeside}), until a later recovery removes it ({@link removeOrphansBeside}). Read by {@link unreadClockRefusalOf}. */
const UNREAD_CLOCK_STEPS = {
  created: { happened: 'could not be created beside it', advice: 'Free space there, or give this user write access to that folder, then run --recover again.' },
  written: { happened: 'was created beside it, but could not be written', advice: 'Free space there, or check that volume for errors, then run --recover again.' },
  read: { happened: 'was created and written beside it, but its status could not be read', advice: 'Check that volume for errors, then run --recover again; a later recovery removes that file.' },
};

/** The refusal of a record without a byte whose age cannot be judged, because the file through which the publisher reads the file system's clock could not be created, written or looked at beside it: it says which of those steps failed, with the advice that fits it ({@link UNREAD_CLOCK_STEPS}), and gives the system's error code, never a path or a text the repository holds. Called by {@link hasStoodUnwritten}. @param recordName - The record, as the refusal names it. @param failure - The step that failed (`created`, `written` or `read`) and the system's error code ({@link errorCodeOf}), as {@link fileSystemTimeBeside} answers them. @example unreadClockRefusalOf('Wiki publication journal', { step: 'written', code: 'ENOSPC' }) // => 'The Wiki publication journal is empty, and its age cannot be judged: … was created beside it, but could not be written (ENOSPC). It was kept, and nothing was moved. …' */
const unreadClockRefusalOf = (recordName, { step, code }) => 'The ' + recordName + ' is empty, and its age cannot be judged: the file through which the publisher reads the clock of the file system that holds it ' + UNREAD_CLOCK_STEPS[step].happened + ' (' + code + '). It was kept, and nothing was moved. ' + UNREAD_CLOCK_STEPS[step].advice;

/** The code of a system error, such as `ENOSPC`, as a refusal may give it: only a code of the system's form, never the error's message, which names paths. Called by {@link fileSystemTimeBeside} and {@link noneUnlessUnread}. @example errorCodeOf(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })) // => 'ENOSPC' */
const errorCodeOf = error => typeof error?.code === 'string' && /^E[A-Z0-9]{1,15}$/.test(error.code) ? error.code : 'no error code';

/** The present by the clock of the file system that holds a record: the time it stamps on a file the publisher creates beside the record (`<record>.clock-<uuid>`) and writes ({@link CLOCK_FILE_BYTES}), read through the handle that created it, so another process's cleanup that removes the file right after its create cannot take the time away; the file is removed afterwards while it is still the one created ({@link removeOwnFile}); one a stop leaves is removed by a later recovery or publish once it has stood for the grace ({@link removeOrphansBeside}). Called by {@link hasStoodUnwritten} and {@link graceJudgeOf}. @returns `{ time }`, the time in nanoseconds since the epoch as a bigint; or `{ failure }`, when the file cannot be created, written or looked at: the step that failed first (`created`, `written` or `read`) and the system's error code ({@link errorCodeOf}), for {@link unreadClockRefusalOf}. @example await fileSystemTimeBeside('/repo/.codebook/wiki.publish-journal.json') // => { time: 1790000000123456789n } */
async function fileSystemTimeBeside(path) {
  const clockFile = path + '.clock-' + randomUUID();
  let handle, failure;
  try { handle = await open(clockFile, 'wx'); } catch (error) { return { failure: { step: 'created', code: errorCodeOf(error) } }; }
  await handle.writeFile(CLOCK_FILE_BYTES).catch(error => { failure = { step: 'written', code: errorCodeOf(error) }; });
  // A write that failed is the step the refusal names; the status is read still, so the file can go.
  const status = await handle.stat({ bigint: true }).catch(error => { failure ??= { step: 'read', code: errorCodeOf(error) }; });
  await handle.close().catch(() => undefined);
  // Without its status the file cannot be told from one another process put at its name since: it is kept.
  if (status !== undefined) await removeOwnFile({ path: clockFile, dev: status.dev, ino: status.ino });
  return failure === undefined ? { time: status.mtimeNs } : { failure };
}

/** The refusal of a journal without a byte changed within {@link UNWRITTEN_RECORD_GRACE_MS}, whose step may be writing it now. Read by {@link endUnwrittenJournal}. */
const UNWRITTEN_JOURNAL_REFUSAL = 'The Wiki publication journal is empty, and the step that created it may be writing it now. Nothing was moved. Run --recover again once that process exits.';

/** Ends a journal without a byte: one an earlier version leaves when it stops between the exclusive create of its journal and the write of it, which it does before a publish copies, finalizes or moves anything and before a recovery writes anything, and one this version leaves so on a file system that cannot link ({@link writeWholeRecord}). It names no owner and no step, and nothing it guards was changed yet, so it is removed once it has stood unchanged for {@link UNWRITTEN_RECORD_GRACE_MS} ({@link endUnwrittenRecord}), past which no step that runs is still between the two; without that, every preparation and publish would stay refused for it while the skill forbids deleting a journal. Places confirmed gone are refused, as such a journal names no owner. Called by {@link openRecovery}. @returns `unwritten-journal-removed`. @throws The refusal of places confirmed gone, that of a journal changed within the grace ({@link UNWRITTEN_JOURNAL_REFUSAL}), that of a journal whose age cannot be judged ({@link unreadClockRefusalOf}), and that of a changed path. @example await endUnwrittenJournal(paths, requirePathHeld, []) // => { status: 'unwritten-journal-removed', output: '/repo/.codebook/wiki' } */
async function endUnwrittenJournal({ output, journal }, requirePathHeld, goneOwners) {
  await endUnwrittenRecord(journal, UNWRITTEN_JOURNAL_REFUSAL, requirePathHeld, goneOwners, 'Wiki publication journal');
  return { status: 'unwritten-journal-removed', output };
}

/** Ends a journal or a publish lock without a byte once it has stood unchanged for {@link UNWRITTEN_RECORD_GRACE_MS} ({@link hasStoodUnwritten}): it names no owner, so places confirmed gone are refused, and a younger one is refused with the sentence given, as its writer may be writing it now. Called by {@link endUnwrittenJournal} and {@link endStoppedLock}. @param refusal - The refusal of a record changed within the grace. @param recordName - The record, as the refusal of places confirmed gone names it ({@link goneOwnerRefusalOf}). @throws The refusal of places confirmed gone, that refusal, that of a record whose age cannot be judged ({@link unreadClockRefusalOf}), that of a changed path, and that of a record that got bytes meanwhile ({@link removeOwnedRecord}). @example await endUnwrittenRecord('/repo/.codebook/wiki.publish-lock.json', UNWRITTEN_LOCK_REFUSAL, requirePathHeld, []) */
async function endUnwrittenRecord(path, refusal, requirePathHeld, goneOwners, recordName) {
  if (goneOwners.length > 0) throw new Error(goneOwnerRefusalOf(goneOwners[0], undefined, [], recordName));
  if (!(await hasStoodUnwritten(path, recordName))) throw new Error(refusal);
  await requirePathHeld();
  await removeOwnedRecord(path, Buffer.alloc(0));
}

/** Removes the claims a recovery took ({@link claimRecovery}) once it ends: all of them, newest first, once it completed; otherwise only its own, the last, and the stopped ancestors stay, since removing them could let a new contender skip an active descendant. A claim left once its record is gone, by a stop before this release or a removal here that failed, goes with a later sweep once its writer is judged gone ({@link removeOrphansBeside}). Called by {@link runRecovery} and {@link endStoppedLock}. @param completed - Whether the recovery completed. @example await releaseClaims(claims, true) */
async function releaseClaims(claims, completed) {
  for (const claim of completed ? [...claims].reverse() : claims.slice(-1)) await removeOwnedRecord(claim.path, claim.bytes);
}

/** The publish lock as the refusals of `--gone-host` and `--gone-space` name it ({@link goneOwnerRefusalOf}). Read by {@link endStoppedLock}. */
const PUBLISH_LOCK_NAME = 'Wiki publish lock';

/** The refusal of a publish lock that is no record the publisher writes: no JSON object, or one without a valid id or an owner; a lock a cloned repository carries may hold any text, which is not repeated. Read by {@link endStoppedLock}. */
const INVALID_LOCK_REFUSAL = 'The Wiki publish lock is invalid; it was preserved.';

/** The refusal of a publish lock without a byte changed within {@link UNWRITTEN_RECORD_GRACE_MS}, whose publish may be writing it now. Read by {@link endStoppedLock}. */
const UNWRITTEN_LOCK_REFUSAL = 'The Wiki publish lock is empty, and the publish that created it may be writing it now. Nothing was moved. Run --recover again once that process exits.';

/** Ends the publish lock that a stopped publish or preview left without a journal ({@link takePublishLock}): stopped before its journal, or after the journal was removed, while it wrote the candidate's pages, or a preview. The lock is judged by the gate of a journal: it must be a record the publisher writes ({@link INVALID_LOCK_REFUSAL}, none of its text repeated), each place the learner confirmed gone must be its owner's or that of a stopped recovery claim of it ({@link requireGoneOwnersOf}), its owner must have exited ({@link requireExited}), and the recovery claims it as it claims a journal ({@link claimRecovery}), so two recoveries never end one lock. A lock without a byte, which a publish leaves where links fail when it stops between the lock's create and its write, names no owner and is ended once it has stood for the grace ({@link endUnwrittenRecord}). Nothing in the candidate is changed: a publish writes no copy and finalizes nothing before its journal, and the pages it wrote are written again by the next one; the side file of a journal, whole or cut short, and the files beside the lock and the journal through which they were to get their names, which a publish stopped before or while writing the journal left, go with the lock, by its id ({@link removeLeftoversOfRun}). A journal its publish wrote after the recovery first looked for one, before that publish stopped, names the files beside it that the journal's recovery needs, so the lock's recovery looks for a journal again once it claimed the lock, and leaves the lock and those files to the journal's recovery when one stands ({@link openRecovery}), which ends the lock after the journal ({@link endLockOfRun}). Called by {@link openRecovery} where no journal stood. @param bytes - The lock's bytes. @returns `publish-lock-removed`; undefined where a journal stands once the lock is claimed, whose claim this recovery released. @throws The refusals of an invalid lock, of a place confirmed gone that is not its owner's, of an owner that may still run, of a young lock without a byte and of a changed path; the lock is kept then. @example await endStoppedLock(bytes, paths, requirePathHeld, { system: SYSTEM_HERE, goneOwners: [] }) // => { status: 'publish-lock-removed', output: '/repo/.codebook/wiki' } */
async function endStoppedLock(bytes, paths, requirePathHeld, ownerJudgement) {
  const { lock, output } = paths;
  // A lock without a byte names no owner: its publish stopped between creating and writing it, or is writing it now.
  if (bytes.length === 0) {
    await endUnwrittenRecord(lock, UNWRITTEN_LOCK_REFUSAL, requirePathHeld, ownerJudgement.goneOwners, PUBLISH_LOCK_NAME);
    return { status: 'publish-lock-removed', output };
  }
  const record = parseRecordOf(bytes, INVALID_LOCK_REFUSAL);
  // No earlier version writes a lock, so one without an owner is none of the publisher's.
  if (!isRecordId(record.id) || record.owner === undefined) throw new Error(INVALID_LOCK_REFUSAL);
  await requireGoneOwnersOf(record, lock, bytes, ownerJudgement.goneOwners, PUBLISH_LOCK_NAME);
  await requireExited(record, ownerJudgement);
  await requirePathHeld();
  const claims = await claimRecovery(lock, bytes, ownerJudgement);
  let completed = false, hasJournal = false;
  try {
    await requirePathHeld();
    if (!(await regularBytes(lock)).equals(bytes)) throw new Error('The Wiki publish lock changed during recovery.');
    // A journal the stopped publish wrote after the first look names the files beside it: its recovery goes first, and ends the lock.
    hasJournal = await regularBytes(paths.journal, true) !== undefined;
    if (!hasJournal) {
      // What the stopped publish left beside its lock and its journal goes first, by its id; the lock keeps every other step out until the end.
      await removeLeftoversOfRun(paths, record.id);
      await removeOwnedRecord(lock, bytes);
      completed = true;
    }
  } finally { await releaseClaims(claims, completed); }
  return hasJournal ? undefined : { status: 'publish-lock-removed', output };
}

/** Removes the publish lock of the run whose journal a recovery ended, known by the id the journal takes from it ({@link publishJournalOf}); a lock of another run, one that is no record the publisher writes, an entry that is no regular file, and a lock whose removal fails stay, for the next recovery to judge by their own gate ({@link endStoppedLock}). Called by {@link runRecovery} once the journal is removed. @example await endLockOfRun('6f1c…', '/repo/.codebook/wiki.publish-lock.json') */
async function endLockOfRun(id, lock) {
  const bytes = await regularBytes(lock, true).catch(() => undefined);
  let held;
  try { held = bytes === undefined ? undefined : JSON.parse(bytes); } catch { held = undefined; }
  // A lock this recovery cannot remove now stays for the next one, which ends it by its owner's gate; the Wiki is recovered either way.
  if (held?.id === id) await removeOwnedRecord(lock, bytes).catch(() => undefined);
}

/** Removes what a stopped run left beside the Wiki folder, by the id of the journal or the publish lock a recovery ends after its owner's gate ({@link requireExited}): the list of copies ({@link copiesListPathOf}), every side file that keeps the candidate's prepared bytes, whole or cut short ({@link preparedPathOf}), and the files beside the journal and the lock through which they were to get their names ({@link pendingPathOf}); the id is random for each run, so no file of another run has it, and the gate proves that the run stopped, so none of them is still written. Each must be a regular file; a link or a folder at its name stays ({@link removeFileOfRun}). Called by {@link runRecovery} and {@link endStoppedLock} before they remove the journal or the lock. @throws What a look or a removal rejects with, other than a missing file; the journal or the lock is kept then, for the next recovery. @example await removeLeftoversOfRun(paths, '6f1c…') */
async function removeLeftoversOfRun({ journal, lock }, id) {
  const folder = dirname(journal), sidePrefix = basename(journal) + '.prepared-';
  const sideFiles = (await readdir(folder)).filter(name => name.startsWith(sidePrefix) && PREPARED_NAME.exec(name.slice(sidePrefix.length))?.[1] === id);
  for (const path of [copiesListPathOf(journal, id), ...sideFiles.map(name => join(folder, name)), pendingPathOf(journal, id), pendingPathOf(lock, id)]) await removeFileOfRun(path);
}

/** Removes a file of a run that a recovery ended, when a regular file stands at its name; a link or a folder there stays, and a link is never followed. Called by {@link removeLeftoversOfRun}. @throws What the look or the removal rejects with, other than a missing file. @example await removeFileOfRun('/repo/.codebook/wiki.publish-journal.json.copies-6f1c…') */
async function removeFileOfRun(path) {
  if ((await lookAt(path))?.isFile()) await unlink(path).catch(error => { if (!isMissing(error)) throw error; });
}

/** The largest file beside a journal, a claim or a lock that {@link readOrphan} reads as a record: such a record is a few hundred bytes since the journal keeps the prepared bytes in a file of their own ({@link preparedPathOf}); a larger file at such a name is none of the publisher's and stays. A list of copies is not read ({@link readOrphan}). */
const PENDING_RECORD_MAX_BYTES = 65_536;

/** What follows the name of a journal or a publish lock in the name of a file a run writes beside it: the claim it belongs to, if any (`.recovery-<digest or id>`), then `.pending-<id>` for the file through which the record gets its name ({@link pendingPathOf}) or `.clock-<uuid>` for the file a recovery reads the file system's clock from ({@link fileSystemTimeBeside}). Read by {@link orphanNamed}. */
const ORPHAN_NAME = /^(?:\.recovery-(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?\.(pending|clock)-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** What follows the name of a journal or a publish lock in the name of a recovery claim of it ({@link claimRecovery}): `.recovery-`, then the SHA-256 digest of the record's bytes for the first claim, or the id of the claim before it. Read by {@link orphanNamed}. */
const CLAIM_NAME = /^\.recovery-(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
/** What follows the name of a journal in the name of its list of copies ({@link copiesListPathOf}): `.copies-` and the journal's id. Read by {@link orphanNamed}. */
const COPIES_NAME = /^\.copies-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** Removes the files beside the Wiki folder that stopped runs left and that no record a recovery ends names ({@link orphansBeside}): a file through which a journal, a claim or a lock was to get its name, stopped before that link ({@link pendingPathOf}); a clock file of a recovery stopped while it read the file system's clock ({@link fileSystemTimeBeside}); a recovery claim that no journal or lock that stands leads to any more, left by a recovery stopped between the removal of its record and the release of its claims, or whose release failed ({@link releaseClaims}); and a list of copies that no journal or lock that stands names, left by a publish whose removal of it failed ({@link publishJournalWriterOf}). A file that holds a whole record names its own writer, and goes once the owner gate judges that writer gone ({@link requireExited}, with the places the learner confirmed gone); one whose writer may still run, or runs elsewhere, stays. An empty file, or one a stop cut short, names no writer, and goes once it has stood unchanged for {@link UNWRITTEN_RECORD_GRACE_MS} by the file system's clock: a step that runs writes it, links it and removes it in an instant, and reads its clock file through the handle it created it with; so does a list of copies, which a publish appends to only while its journal stands. A claim that is no whole record stays. Only regular files of the publisher's names are read, a record of bounded size ({@link PENDING_RECORD_MAX_BYTES}, {@link CLOCK_FILE_BYTES}) and a list not at all, a link is never followed, each removal is held to the output's path and removes only the bytes read, or for a list the file looked at ({@link removeOrphan}), and nothing that fails here fails the step. Called by {@link recoverWikiPublication} once a recovery ended what it found, and by {@link underPublishLock} under the lock. @example await removeOrphansBeside(paths, requirePathHeld, { system: SYSTEM_HERE, goneOwners: [] }) */
async function removeOrphansBeside(paths, requirePathHeld, ownerJudgement) {
  const hasStoodPastGrace = graceJudgeOf(paths.journal);
  for (const orphan of await orphansBeside(paths)) {
    if (await isOrphanStopped(orphan, ownerJudgement, hasStoodPastGrace)) await requirePathHeld().then(() => removeOrphan(orphan)).catch(() => undefined);
  }
}

/** The files beside the Wiki folder of the names stopped runs leave ({@link orphanNamed}), each read without following a link ({@link readOrphan}) and with the writer it names, if any ({@link withWriterOf}). The journal and the lock that stand are read after the folder is listed ({@link standingRunsOf}): a run that runs wrote its record before the list of copies or the claim that it names, so a file listed here that a record that stands names is seen named. Called by {@link removeOrphansBeside} and {@link requireOrphanWritersAt}. @returns The files, each as {@link readOrphan} answers it with `writer` and `isNamedByNoRecord`. @example await orphansBeside(paths) // => [{ path: '/repo/.codebook/wiki.publish-lock.json.pending-6f1c…', kind: 'pending', id: '6f1c…', status, bytes, writer: { pid: 4242, owner: {…}, id: '6f1c…' }, isNamedByNoRecord: true }] */
async function orphansBeside({ journal, lock }) {
  const folder = dirname(journal), bases = [basename(journal), basename(lock)];
  const names = await readdir(folder).catch(() => []);
  // A record that stands but cannot be read names no file for certain: then no claim or list is taken.
  const standing = await standingRunsOf([journal, lock]).catch(() => undefined), orphans = [];
  for (const name of names) {
    const orphan = await readOrphan(orphanNamed(folder, name, bases));
    if (orphan !== undefined) orphans.push(withWriterOf(orphan, standing));
  }
  return orphans;
}

/** The ids the journal and the publish lock that stand take, and the claims of their chains, from the claim named by the digest of each one's bytes through each claim's id ({@link claimChainOf}), as {@link claimRecovery} walks them: a claim of such a chain, stopped or not, is kept for that record's recovery, and a list of copies such an id names is a run's that may still append to it. Called by {@link orphansBeside}. @param records - The paths of the journal and of the lock. @returns The ids and the claims' paths. @throws What reading a record or a claim of a chain rejects with, other than a missing one: a record no look can read leaves every claim and list beside it. @example await standingRunsOf(['/repo/.codebook/wiki.publish-journal.json', '/repo/.codebook/wiki.publish-lock.json']) // => { ids: Set { '6f1c…' }, claims: Set { '/repo/.codebook/wiki.publish-lock.json.recovery-3f2a…' } } */
async function standingRunsOf(records) {
  const ids = new Set(), claims = new Set();
  for (const record of records) {
    const bytes = await regularBytes(record, true);
    if (bytes === undefined) continue;
    const id = wholeRecordOf(bytes)?.id;
    if (id !== undefined) ids.add(id);
    for (const claim of await claimChainOf(record, bytes)) claims.add(claim);
  }
  return { ids, claims };
}

/** The paths of the claims of a record's chain ({@link claimRecovery}): the claim named by the digest of the record's bytes, then the one named by each claim's id, up to the first name at which no claim with a record stands, or a name met before. Called by {@link standingRunsOf}. @throws The refusals of {@link stoppedClaimAt}. @example await claimChainOf('/repo/.codebook/wiki.publish-lock.json', lockBytes) // => Set { '/repo/.codebook/wiki.publish-lock.json.recovery-3f2a…' } */
async function claimChainOf(record, bytes) {
  const chain = new Set();
  for (let path = record + '.recovery-' + digest(bytes); !chain.has(path);) {
    chain.add(path);
    const claim = await stoppedClaimAt(path, true);
    // A missing claim or one without a byte ends the chain, as no claim can be named by an id it never wrote.
    if (claim?.record === undefined) break;
    path = record + '.recovery-' + claim.record.id;
  }
  return chain;
}

/** The file beside a journal or a publish lock that a name in their folder names, when the name is one a run gives such a file: a file through which a record gets its name or a clock file ({@link ORPHAN_NAME}), a recovery claim ({@link CLAIM_NAME}), or, beside the journal, a list of copies ({@link COPIES_NAME}). Called by {@link orphansBeside}. @param bases - The names of the journal and the lock, in that order. @returns The file's path, its kind (`pending`, `clock`, `claim` or `copies`) and the id its name says, none for a claim; undefined for any other name. @example orphanNamed('/repo/.codebook', 'wiki.publish-lock.json.pending-6f1c…', ['wiki.publish-journal.json', 'wiki.publish-lock.json']) // => { path: '/repo/.codebook/wiki.publish-lock.json.pending-6f1c…', kind: 'pending', id: '6f1c…' } */
function orphanNamed(folder, name, bases) {
  const base = bases.find(record => name.startsWith(record));
  if (base === undefined) return undefined;
  const rest = name.slice(base.length), path = join(folder, name), parts = ORPHAN_NAME.exec(rest);
  if (parts !== null) return { path, kind: parts[1], id: parts[2] };
  if (CLAIM_NAME.test(rest)) return { path, kind: 'claim' };
  // Only a journal has a list of copies.
  const list = base === bases[0] ? COPIES_NAME.exec(rest) : null;
  return list === null ? undefined : { path, kind: 'copies', id: list[1] };
}

/** Reads a file of {@link orphanNamed} without following a link: only a regular file, and of a record or a clock file only one of the size its kind may have ({@link PENDING_RECORD_MAX_BYTES}, {@link CLOCK_FILE_BYTES}); a list of copies is judged by its status alone, so its bytes are not read, whatever its size. Called by {@link orphansBeside}. @param orphan - The file; undefined for none. @returns The file with its status, its times as bigints, and its bytes, none for a list; undefined for none, for a link, a folder or a larger file, and for one that cannot be looked at or read. @example await readOrphan({ path: '/repo/.codebook/wiki.publish-journal.json.clock-6f1c…', kind: 'clock', id: '6f1c…' }) // => { path: '…', kind: 'clock', id: '6f1c…', status: <BigIntStats>, bytes: <Buffer 0a> } */
async function readOrphan(orphan) {
  const status = orphan === undefined ? undefined : await lstat(orphan.path, { bigint: true }).catch(() => undefined);
  if (!status?.isFile()) return undefined;
  if (orphan.kind === 'copies') return { ...orphan, status };
  if (status.size > BigInt(orphan.kind === 'clock' ? CLOCK_FILE_BYTES.length : PENDING_RECORD_MAX_BYTES)) return undefined;
  const bytes = await regularBytes(orphan.path, true).catch(() => undefined);
  return bytes === undefined ? undefined : { ...orphan, status, bytes };
}

/** A file of {@link readOrphan} with what judges it: whether no journal or lock that stands names it (`isNamedByNoRecord`; never where those could not be read), by its id for a list of copies, by the chains of claims for a claim ({@link standingRunsOf}); and the writer it names (`writer`): the whole record of a file through which a record was to get its name, with the id its name says, or the whole record of a claim that no record that stands leads to, with any id ({@link wholeRecordOf}). Called by {@link orphansBeside}. @param standing - The ids and the claims of the records that stand; undefined where they could not be read. @example withWriterOf(claim, { ids: new Set(), claims: new Set() }) // => { …claim, isNamedByNoRecord: true, writer: { pid: 4242, owner: {…}, id: '…' } } */
function withWriterOf(orphan, standing) {
  const isNamedByNoRecord = standing !== undefined && !(orphan.kind === 'claim' ? standing.claims.has(orphan.path) : standing.ids.has(orphan.id));
  const isWholeRecord = orphan.kind === 'pending' || orphan.kind === 'claim' && isNamedByNoRecord;
  return { ...orphan, isNamedByNoRecord, writer: isWholeRecord ? wholeRecordOf(orphan.bytes, orphan.id) : undefined };
}

/** Whether a file of {@link orphansBeside} was left by a run that stopped: one that names its writer ({@link withWriterOf}) once the owner gate judges that writer gone ({@link requireExited}); an empty file through which a record was to get its name, one a stop cut short, a clock file of the publisher's bytes, and a list of copies that no record that stands names, by their age alone (`hasStoodPastGrace`, {@link graceJudgeOf}); any other file was not, a claim without its writer among them. Called by {@link removeOrphansBeside}. @param ownerJudgement - The system and the places the learner confirmed gone. @example await isOrphanStopped(orphan, { system: SYSTEM_HERE, goneOwners: [] }, graceJudgeOf(journal)) // => true for a file beside the lock whose writer's process is gone */
async function isOrphanStopped({ kind, status, bytes, writer, isNamedByNoRecord }, ownerJudgement, hasStoodPastGrace) {
  if (writer !== undefined) return requireExited(writer, ownerJudgement).then(() => true, () => false);
  if (kind === 'pending') return hasStoodPastGrace(status);
  if (kind === 'clock') return (bytes.length === 0 || bytes.equals(Buffer.from(CLOCK_FILE_BYTES))) && hasStoodPastGrace(status);
  // A publish appends to its list only while its journal stands; one that no record names any more is a stopped run's once it has stood for the grace.
  return kind === 'copies' && isNamedByNoRecord && hasStoodPastGrace(status);
}

/** Removes a file of {@link orphansBeside} that a stopped run left: a record or a clock file only while it holds the bytes read ({@link removeOwnedRecord}), a list of copies only while it is the file looked at, by its device and file id ({@link removeOwnFile}). Called by {@link removeOrphansBeside}. @throws What {@link removeOwnedRecord} rejects with. @example await removeOrphan(orphan) */
const removeOrphan = orphan => orphan.kind === 'copies' ? removeOwnFile({ path: orphan.path, dev: orphan.status.dev, ino: orphan.status.ino }) : removeOwnedRecord(orphan.path, orphan.bytes);

/** Refuses a place the learner confirmed gone (`--gone-host`, `--gone-space`, one pair for each place) where no journal or lock stands, unless it is the place of the writer that a file a stopped run left beside them names ({@link orphansBeside}): a file through which a journal, a lock or a claim was to get its name, or a claim no record leads to any more, which the sweep after the recovery then ends with that pair ({@link removeOrphansBeside}); so a publish killed in a place that cannot come back, just before the link of its lock, leaves no file that no recovery can end. The writers' text reaches no refusal: the refusal names the learner's pair alone. Called by {@link openRecovery}. @param goneOwners - The places, each `{ host, space }`. @throws The refusal of {@link goneOwnerRefusalOf} for a place that no such writer names. @example await requireOrphanWritersAt(paths, [{ host: 'devbox', space: 'linux@1' }]) // throws where no file beside the Wiki folder names a writer of 'devbox' (linux@1) */
async function requireOrphanWritersAt(paths, goneOwners) {
  const writers = (await orphansBeside(paths)).flatMap(orphan => orphan.writer === undefined ? [] : [orphan.writer.owner]);
  const unnamed = goneOwners.find(place => !writers.some(owner => isOwnerAt(owner, [place])));
  if (unnamed !== undefined) throw new Error(goneOwnerRefusalOf(unnamed, undefined, []));
}

/** The judge of whether a file beside a journal has stood unchanged past {@link UNWRITTEN_RECORD_GRACE_MS} by the clock of the file system that holds it, which is read once, when it is first asked ({@link fileSystemTimeBeside}); where that clock cannot be read, no file has. Called by {@link removeOrphansBeside}. @returns The judge, given a file's status with bigint times. @example await graceJudgeOf('/repo/.codebook/wiki.publish-journal.json')(status) // => true for a file last changed a minute ago */
function graceJudgeOf(journal) {
  let now;
  return async status => {
    now ??= await fileSystemTimeBeside(journal);
    return now.failure === undefined && now.time - status.mtimeNs > BigInt(UNWRITTEN_RECORD_GRACE_MS) * NS_PER_MS;
  };
}

/** The record a file beside a journal, a claim or a lock holds when it is whole, as {@link writeWholeRecord} writes one, and the record of a journal or a lock that stands: a JSON object with a process id and the id given, or, where none is given, any id of the publisher's form ({@link isRecordId}). Called by {@link withWriterOf} and {@link standingRunsOf}. @param id - The id the file's name says; undefined for a claim or a record that stands, whose name says none. @returns The record; undefined for an empty file, one a stop cut short and any other text. @example wholeRecordOf(Buffer.from('{"pid":4242,"owner":{…},"id":"6f1c…"}'), '6f1c…') // => { pid: 4242, owner: {…}, id: '6f1c…' } */
function wholeRecordOf(bytes, id) {
  let record;
  try { record = JSON.parse(bytes); } catch { return undefined; }
  return record !== null && typeof record === 'object' && (id === undefined ? isRecordId(record.id) : record.id === id) && Number.isSafeInteger(record.pid) ? record : undefined;
}

/** Takes up the journal a stopped publish or recovery left: it must name this project and output and a known operation, each place the learner confirmed gone must be its owner's or that of a stopped recovery claim of its chain ({@link requireGoneOwnersOf}), its owner must have exited ({@link requireExited}, by `ownerJudgement`), and the path must hold before the claim ({@link claimRecovery}). Called by {@link openRecovery}. @returns The journal's record and bytes and the claims taken. @throws The refusal of a journal that is no JSON object ({@link parseRecordOf}), of a journal of another output, of a place confirmed gone that is not its owner's, of an owner that may still run and of a changed path. @example await resumeJournal(bytes, paths, requirePathHeld, { system: SYSTEM_HERE }) // => { record: { operation: 'publish', … }, bytes, claims: [{ path, bytes }] } */
async function resumeJournal(bytes, { root, output, journal }, requirePathHeld, ownerJudgement) {
  const record = parseRecordOf(bytes, 'The Wiki publication journal is invalid; it was preserved.');
  if (record?.projectRoot !== root || record.output !== output || !['publish', 'restore-manifest', undefined].includes(record.operation))
    throw new Error('The Wiki publication journal does not identify this output; inspect it without moving files.');
  await requireGoneOwnersOf(record, journal, bytes, ownerJudgement.goneOwners);
  await requireExited(record, ownerJudgement);
  await requirePathHeld();
  return { record, bytes, claims: await claimRecovery(journal, bytes, ownerJudgement) };
}

/** Starts the recovery of an edited manifest when no journal stands: the retained publication must be there, a manifest that is the retained one needs nothing, and otherwise this recovery's own journal is written ({@link manifestJournalOf}) while the path holds; a journal written after a swap is this recovery's own, and it is removed with the refusal. Called by {@link openRecovery}. @returns `{ result }` when the manifest is current; the journal's record and bytes, with no claims, otherwise. @throws The refusal of a Wiki without a retained publication, and of a changed path. @example await startManifestRecovery(paths, requirePathHeld, SYSTEM_HERE) // => { result: { status: 'published-current', output: '/repo/.codebook/wiki' } } */
async function startManifestRecovery(paths, requirePathHeld, system) {
  const { root, output, journal } = paths;
  const state = await recoveryState(root, output, paths.stage);
  if (!state || !state.receipt && !state.legacyRecovery) throw new Error('No retained Wiki publication is available for recovery.');
  if (state.actual && state.actual.equals(state.bytes)) return { result: { status: 'published-current', output } };
  const record = await manifestJournalOf(state, paths, system), bytes = Buffer.from(JSON.stringify(record));
  await requirePathHeld();
  await writeWholeRecord(journal, bytes, record.id);
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

/** The refusal of a metadata recovery journal whose prepared stage of a legacy adoption ({@link manifestJournalOf}) is a name the recovery may not take ({@link isNameableStage}): the recovery would read that stage, and the refusal of a read names it. Read by {@link recoverManifestJournal}. */
const UNREAD_SOURCE_STAGE_REFUSAL = 'The prepared stage the Wiki metadata recovery journal names comes from the journal alone, so it was not read and is not repeated here. Nothing was moved, and the journal was kept. Run --recover with --stage set to the candidate you prepared.';

/** Recovers an edited manifest by its journal ({@link restoreManifestHeld}). Called by {@link runRecovery}. @returns `manifest-restored`, with where the edit is kept; undefined for a superseded recovery, which leaves no result: its journal is removed and the recovery runs again. @throws The refusal of an invalid journal, that of a prepared stage named by the journal alone ({@link UNREAD_SOURCE_STAGE_REFUSAL}), and what the restore refuses. @example await recoverManifestJournal(record, paths, requirePathHeld, false) // => { status: 'manifest-restored', output: '/repo/.codebook/wiki', modifiedManifestBackup: '/repo/.codebook/wiki.modified-manifest-….json' } */
async function recoverManifestJournal(record, paths, requirePathHeld, isResumed) {
  const { output } = paths;
  if (!isManifestJournal(record, output)) throw new Error('The Wiki metadata recovery journal is invalid.');
  // The prepared stage of a legacy adoption is read, and a refusal of the file system names it: a stage by a name of the journal's own is not read.
  if (record.sourceStage !== undefined && !isNameableStage(record.sourceStage, paths)) throw new Error(UNREAD_SOURCE_STAGE_REFUSAL);
  return restoreManifestHeld(record, paths, requirePathHeld, isResumed).then(
    () => ({ status: 'manifest-restored', output, modifiedManifestBackup: record.modifiedManifestSha256 === null ? undefined : record.modifiedManifestBackup }),
    error => { if (error.isSupersededRestore) return undefined; throw error; });
}

/** Whether a path a publish journal names is an entry of its own directly beside the output, in the normal form the publisher writes it in: a journal a cloned repository carries can name the output's parent followed by `..` or `.`, whose parent folder is the output's too, and the recovery would take the folder it leads to (the project root, the output's parent) for the candidate and remove its files. The resolved path must be the path itself, so no `..`, `.`, doubled or trailing separator stands in it, and its name must be neither empty nor the output's. Called by {@link requirePublishJournal} for the stage and by {@link isSiblingBackup}. @example isSiblingPath('/repo/.codebook/..', '/repo/.codebook/wiki') // => false */
const isSiblingPath = (path, output) => typeof path === 'string' && resolve(path) === path && basename(path) !== '' && dirname(path) === dirname(output) && path !== output;

/** Whether a publish journal names no backup, or a backup beside the output in its normal form ({@link isSiblingPath}) under the name the publisher gives it ({@link isPublishersOwnName}): the backup is named in the recovery's answer and refusals, so a journal a cloned repository carries brings no text of its own into them. Called by {@link requirePublishJournal}. @example isSiblingBackup('/repo/.codebook/wiki.previous-6f1c2a7e-…', '/repo/.codebook/wiki') // => true */
const isSiblingBackup = (backup, output) => backup === undefined || isSiblingPath(backup, output) && isPublishersOwnName(backup, output, '.previous-');

/** Whether a path is a name the publisher gives an entry beside the output by itself: the output's path, the kind (`.previous-` for the kept prior Wiki, `.stage-` for the candidate --prepare names without --stage) and a random UUID ({@link isRecordId}), so it holds no text but the output's own and hex. Called by {@link isSiblingBackup} and {@link isNameableStage}. @example isPublishersOwnName('/repo/.codebook/wiki.stage-6f1c2a7e-…', '/repo/.codebook/wiki', '.stage-') // => true */
const isPublishersOwnName = (path, output, kind) => path.startsWith(output + kind) && isRecordId(path.slice((output + kind).length));

/** Whether a stage a journal names holds no text of the journal's own, so the recovery may read it and name it to the agent: the name --prepare gives a candidate ({@link isPublishersOwnName}), or the stage the caller gave with --stage now; an agent's own name is not, to a recovery not given it again. Called by {@link nameableStageOf} for a publish journal's candidate and by {@link recoverManifestJournal} for a metadata recovery journal's prepared stage. @example isNameableStage('/repo/.codebook/next $(touch x)', { output: '/repo/.codebook/wiki', stage: undefined }) // => false */
const isNameableStage = (stage, paths) => typeof stage === 'string' && (stage === paths.stage || isPublishersOwnName(stage, paths.output, '.stage-'));

/** The stage of a publish journal as the recovery may name it to the agent ({@link isNameableStage}); undefined otherwise. Called by {@link recoverPublishJournal}, {@link restoreCandidateOfJournal} and {@link restoreStoppedCandidate}, whose gate refuses a candidate that holds what a stopped publish left and that it may not name, before it changes anything in it. @example nameableStageOf({ stage: '/repo/.codebook/next $(touch x)' }, { output: '/repo/.codebook/wiki', stage: undefined }) // => undefined */
const nameableStageOf = (record, paths) => isNameableStage(record.stage, paths) ? record.stage : undefined;

/** The refusal of a recovery that did not put back the candidate a journal names by a name the recovery may not take or repeat ({@link isNameableStage}): one that holds something a stopped publish may have left ({@link restoreStoppedCandidate}), or whose look failed with a refusal that names it ({@link restoreCandidateOfJournal}). Nothing in the candidate was changed and the journal is kept; the agent is sent to the recovery with the --stage it prepared, and, where that cannot match because the journal names another folder (a journal a cloned repository carries), to the learner, so no run of the same command answers the same sentence for good. Read by {@link restoreStoppedCandidate} and {@link restoreCandidateOfJournal}. */
const UNREPEATED_STAGE_REFUSAL = 'The candidate the Wiki publication journal names was not put back as prepared, and the journal was kept. Its name comes from the journal alone, so it is not repeated here, and nothing in it was changed. Run --recover with --stage set to the candidate you prepared. If that gives this answer again, the journal does not name your candidate: show the journal to the learner, and do not delete it.';

/** Puts back the candidate of a stopped publish ({@link restoreStoppedCandidate}) and answers its refusal without the candidate's name where the recovery may not name it ({@link nameableStageOf}) and the refusal holds the candidate's path, as a refusal of the file system or of a hold does for the path of a file or a folder in it: the refusal is then {@link UNREPEATED_STAGE_REFUSAL}, with the one it replaces as its cause, so no text of the journal's reaches the agent. The path is matched whole, not the candidate's name alone: a fixed refusal of the publisher's own, such as {@link SIBLING_JOURNAL_REFUSAL}, may hold a word that is also the candidate's name (`Wiki`), and it passes unchanged, so the agent is not sent round to a --stage that cannot match. Called by {@link recoverPublishJournal}, {@link keepCurrentWiki} and {@link restorePriorWiki}. @returns The paths of the copies that changed after they were checked and were kept ({@link restoreStoppedCandidate}). @throws The refusal, or the one that names no candidate. @example await restoreCandidateOfJournal(record, wiki, paths, requirePathHeld) */
const restoreCandidateOfJournal = (record, wiki, paths, requirePathHeld) => restoreStoppedCandidate(record, wiki, paths, requirePathHeld).catch(error => {
  throw nameableStageOf(record, paths) === undefined && String(error?.message).includes(record.stage) ? new Error(UNREPEATED_STAGE_REFUSAL, { cause: error }) : error;
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
  if (!isSiblingPath(record.stage, output) || !isSiblingBackup(record.backup, output)) throw new Error(SIBLING_JOURNAL_REFUSAL);
  await requireStageOfItsOwn(record, output);
  if (record.operation === 'publish' && !namesGenerations(record)) throw new Error('The Wiki publication journal is missing generation identity; it was preserved.');
}

/** The part of a recovery's answer that names the copies of the learner's files in the candidate that changed after the recovery checked them and were kept ({@link restoreStoppedCandidate}), by their paths in the candidate, without their bytes; nothing where none was kept, so the answer stays as it was. Called by {@link recoverPublishJournal}, {@link keepCurrentWiki} and {@link restorePriorWiki}. @example changedFilesKeptOf(['manual.txt']) // => { changedFilesKept: ['manual.txt'] } */
const changedFilesKeptOf = changedCopies => changedCopies.length > 0 ? { changedFilesKept: changedCopies } : {};

/** Recovers a stopped publish by its journal: the Wiki that stands is kept ({@link keepCurrentWiki}), else the kept prior Wiki is moved back ({@link restorePriorWiki}), else there was none and the candidate is reported where the recovery may name it ({@link nameableStageOf}). The record's retained manifest decides which generation stands; an edit of the published manifest since is left to the next recovery. Called by {@link runRecovery}. @returns `published-or-restored`, `previous-restored` or `no-prior-wiki`, the last with the stage only where the recovery may name it; each with `changedFilesKept` where copies of the learner's files changed while the candidate was put back and were kept ({@link changedFilesKeptOf}). @throws The refusal of an invalid journal, and what the steps refuse. @example await recoverPublishJournal(record, paths, requirePathHeld) // => { status: 'no-prior-wiki', stage: '/repo/.codebook/next' } */
async function recoverPublishJournal(record, paths, requirePathHeld) {
  const { root, output } = paths;
  await requirePublishJournal(record, output);
  const current = await inspectOutput(output, root, { allowLegacy: record.operation === undefined || record.priorLegacy === true, allowManifestDrift: true });
  if (current) return keepCurrentWiki(record, current, paths, requirePathHeld);
  if (record.backup) return restorePriorWiki(record, paths, requirePathHeld);
  const changedCopies = await restoreCandidateOfJournal(record, null, paths, requirePathHeld);
  return { status: 'no-prior-wiki', stage: nameableStageOf(record, paths), ...changedFilesKeptOf(changedCopies) };
}

/** Keeps the Wiki that stands after a stopped publish: for this version's publish it must be the prior or the new generation, and the new one must have its record. What the stopped publish left in its candidate goes ({@link restoreCandidateOfJournal}) whichever generation stands: the manifest's digest cannot tell them apart for a candidate byte-identical to the Wiki (prepared and published without an edit), and a candidate that became the Wiki is gone, which that step leaves at once. Called by {@link recoverPublishJournal}. @returns `published-or-restored`, with the backup the journal names and the kept changed copies ({@link changedFilesKeptOf}). @throws The refusal of a Wiki of neither generation, and of a new one without its record. @example await keepCurrentWiki(record, current, paths, requirePathHeld) // => { status: 'published-or-restored', output: '/repo/.codebook/wiki', previousOutput: undefined } */
async function keepCurrentWiki(record, current, paths, requirePathHeld) {
  const isPublish = record.operation === 'publish', isNewGeneration = digest(current.bytes) === record.manifestSha256;
  if (isPublish && ![record.manifestSha256, record.priorManifestSha256].includes(digest(current.bytes)))
    throw new Error('The current Wiki does not match the interrupted publication.');
  if (isPublish && isNewGeneration && !current.receipt)
    throw new Error('The newly published Wiki is missing its publication record.');
  const changedCopies = await restoreCandidateOfJournal(record, current, paths, requirePathHeld);
  return { status: 'published-or-restored', output: paths.output, previousOutput: record.backup, ...changedFilesKeptOf(changedCopies) };
}

/** Moves the prior Wiki a stopped publish kept beside the Wiki folder back into its place: it is read and moved there, so it is held to the rule of the output ({@link requireRegularFolder}) and must be the generation the journal names by its record's retained manifest, whatever its manifest holds now (an edit made after the publish's last check is restored by the next recovery, as one of the standing Wiki is); then what the stopped publish left in its candidate goes ({@link restoreCandidateOfJournal}). Called by {@link recoverPublishJournal}. @returns `previous-restored`, with the kept changed copies ({@link changedFilesKeptOf}). @throws The refusal of a kept Wiki that is no folder of its own or of another generation, and of a changed path. @example await restorePriorWiki(record, paths, requirePathHeld) // => { status: 'previous-restored', output: '/repo/.codebook/wiki' } */
async function restorePriorWiki(record, paths, requirePathHeld) {
  const { root, output } = paths;
  await requireRegularFolder(record.backup, root, paths.isOutputInProject, backupRefusalOf);
  // The kept prior Wiki's manifest may have been edited since the publish's last check, as the standing Wiki's may: its record's retained manifest decides, and the next recovery restores the edit.
  const prior = await inspectOutput(record.backup, root, { allowLegacy: true, allowManifestDrift: true });
  if (!prior || record.priorManifestSha256 && digest(prior.bytes) !== record.priorManifestSha256) throw new Error('The prior Wiki does not match the publication journal.');
  await requirePathHeld();
  await renameRetried(record.backup, output);
  const changedCopies = await restoreCandidateOfJournal(record, prior, paths, requirePathHeld);
  return { status: 'previous-restored', output, ...changedFilesKeptOf(changedCopies) };
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
