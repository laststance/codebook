import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** The manifest every shard of the sharded measured health run writes beside its `raw` folder of V8 coverage dumps. */
export const SHARD_MANIFEST_FILE = 'manifest.json'
/** Folder of a shard's output that holds its V8 coverage dumps. */
export const SHARD_RAW_FOLDER = 'raw'
/** Identity fields that must be equal in every shard and in the merge: what the coverage was measured with and on. */
export const SHARD_IDENTITY_FIELDS = [
  'node',
  'c8',
  'v8ToIstanbul',
  'c8rcSha256',
  'distHash',
  'srcHash',
  'checkout',
]
/** A script coverage whose URL contains this proves a dump measured product code (the extension's compiled output). */
const PRODUCT_SCRIPT_MARK = '/extension/dist/'
/** How many names a refusal lists before "and N more". */
const SHOWN_LIMIT = 5

/** Hashes bytes as the manifests record dumps. @example sha256Of(Buffer.from('a')) // => 'ca978112…' */
export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Lists at most {@link SHOWN_LIMIT} names for a refusal. @example listed(['a', 'b']) // => 'a, b' */
function listed(names) {
  const hidden = names.length - SHOWN_LIMIT
  const more = hidden > 0 ? ` and ${hidden} more` : ''
  return `${names.slice(0, SHOWN_LIMIT).join(', ')}${more}`
}

/** Reads one shard's manifest from its folder and names the folder when it is missing or no JSON. @example await readManifest('/tmp/shards/health-shard-1') // => { shard: 1, total: 3, … } */
async function readManifest(folder) {
  let text
  try {
    text = await readFile(join(folder, SHARD_MANIFEST_FILE), 'utf8')
  } catch (error) {
    throw new Error(
      `${folder} has no readable ${SHARD_MANIFEST_FILE} (${error.code ?? error.message}).`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${join(folder, SHARD_MANIFEST_FILE)} is no JSON.`)
  }
}

/** Reads the manifests of every sub-folder of the merge folder, each with its folder. @example await readManifests('/tmp/shards') // => [{ folder: '/tmp/shards/health-shard-1', manifest: { shard: 1, … } }] */
async function readManifests(folder) {
  const names = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  return Promise.all(
    names.map(async (name) => ({
      folder: join(folder, name),
      manifest: await readManifest(join(folder, name)),
    })),
  )
}

/** Refuses a set of manifests that is not exactly shards 1 to N once each, all of one total, each from a passing run. @example assertCompleteShards([{ manifest: { shard: 1, total: 2, exitCode: 0 } }]) // throws 'Expected 2 shard manifests, found 1 …' */
function assertCompleteShards(entries) {
  const total = entries[0]?.manifest.total
  if (!Number.isInteger(total) || total < 1)
    throw new Error(`The shard manifests name no shard total (${total}).`)
  const otherTotals = entries.filter((entry) => entry.manifest.total !== total)
  if (otherTotals.length > 0)
    throw new Error(
      `The shard manifests disagree on the shard total: ${total} and ${otherTotals[0].manifest.total}.`,
    )
  const present = entries.map((entry) => entry.manifest.shard)
  const missing = Array.from({ length: total }, (_, index) => index + 1).filter(
    (shard) => !present.includes(shard),
  )
  if (entries.length !== total || missing.length > 0)
    throw new Error(
      `Expected ${total} shard manifests, found ${entries.length}; missing shard ${listed(missing.map(String)) || 'none (a shard is listed twice)'}.`,
    )
  for (const { manifest } of entries)
    if (manifest.exitCode !== 0)
      throw new Error(
        `Shard ${manifest.shard} ended with exit ${manifest.exitCode}; a failed shard measures no health.`,
      )
}

/** Refuses a shard whose identity differs from the merge's in any of {@link SHARD_IDENTITY_FIELDS}. @example assertSameIdentity({ shard: 1, identity: { node: '24' } }, { node: '25' }) // throws */
function assertSameIdentity(manifest, identity) {
  const differing = SHARD_IDENTITY_FIELDS.filter(
    (field) => manifest.identity?.[field] !== identity[field],
  )
  if (differing.length > 0)
    throw new Error(
      `Shard ${manifest.shard} was measured with another identity than the merge: ${differing
        .map(
          (field) =>
            `${field} is ${manifest.identity?.[field]} there, ${identity[field]} here`,
        )
        .join('; ')}.`,
    )
}

/** Refuses file lists that run a file twice, miss a planned file or run an unplanned one. @example assertPlannedFiles([{ shard: 1, files: ['a'] }], ['a', 'b']) // throws 'Planned test files that no shard ran: b.' */
function assertPlannedFiles(manifests, plannedFiles) {
  const seen = new Set()
  for (const { shard, files } of manifests)
    for (const file of files) {
      if (seen.has(file))
        throw new Error(
          `Test file ${file} ran twice (again in shard ${shard}).`,
        )
      seen.add(file)
    }
  const planned = new Set(plannedFiles)
  const missing = plannedFiles.filter((file) => !seen.has(file))
  const unplanned = [...seen].filter((file) => !planned.has(file))
  if (missing.length + unplanned.length > 0)
    throw new Error(
      `The shards did not run the planned test files: not run [${listed(missing)}], not planned [${listed(unplanned)}].`,
    )
}

/**
 * Reads every file of one shard's raw folder, checks it against the manifest and returns the dumps.
 * @param entry - `{ folder, manifest }` of one shard.
 * @returns The shard's dumps: `{ shard, name, path }`.
 * @throws When the raw folder holds a file the manifest does not list or lacks a listed one, a file's SHA-256 differs, a file is no V8 coverage object, the shard has fewer dumps than files, or no dump covers product code.
 * @example
 * await checkShardDumps({ folder: '/tmp/shards/health-shard-1', manifest }) // => [{ shard: 1, name: 'shard-1-coverage-1.json', path: '/tmp/…' }]
 */
async function checkShardDumps({ folder, manifest }) {
  const raw = join(folder, SHARD_RAW_FOLDER)
  const onDisk = await readdir(raw).catch(() => [])
  const listedDumps = manifest.dumps ?? []
  const unlisted = onDisk.filter(
    (name) => !listedDumps.some((dump) => dump.name === name),
  )
  const absent = listedDumps
    .map((dump) => dump.name)
    .filter((name) => !onDisk.includes(name))
  if (unlisted.length + absent.length > 0)
    throw new Error(
      `Shard ${manifest.shard}'s raw folder differs from its manifest: not listed [${listed(unlisted)}], missing [${listed(absent)}].`,
    )
  let hasProductCoverage = false
  for (const { name, sha256 } of listedDumps) {
    const bytes = await readFile(join(raw, name))
    if (sha256Of(bytes) !== sha256)
      throw new Error(
        `Dump ${name} of shard ${manifest.shard} does not match the SHA-256 its manifest lists.`,
      )
    let dump
    try {
      dump = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new Error(
        `Dump ${name} of shard ${manifest.shard} is no JSON, so it is no V8 coverage.`,
      )
    }
    if (!Array.isArray(dump?.result))
      throw new Error(
        `Dump ${name} of shard ${manifest.shard} is no V8 coverage object (it has no "result" array).`,
      )
    if (
      dump.result.some((script) =>
        String(script?.url).includes(PRODUCT_SCRIPT_MARK),
      )
    )
      hasProductCoverage = true
  }
  if (manifest.files.length > 0) {
    if (listedDumps.length < manifest.files.length)
      throw new Error(
        `Shard ${manifest.shard} wrote ${listedDumps.length} dumps for ${manifest.files.length} test files; every file runs in a process of its own.`,
      )
    if (!hasProductCoverage)
      throw new Error(
        `Shard ${manifest.shard} holds no coverage of a script under extension/dist/, so it measured no product code.`,
      )
  }
  return listedDumps.map(({ name }) => ({
    shard: manifest.shard,
    name,
    path: join(raw, name),
  }))
}

/**
 * Validates the results of all shards before the merge turns them into one coverage map; called by `scripts/checkHealth.mjs` in `--merge` mode, which maps the thrown message to a refused run (exit 2).
 *
 * Checks, in order: the expected number of manifests, every exit code 0, equal identity in every manifest and the merge, every planned test file run exactly once, and strict dump validation: every file of each raw folder is listed, matches its SHA-256 and parses as a V8 coverage object, each shard with files has at least one dump per file and some coverage of a script under `extension/dist/`.
 * @param input.folder - Folder with one sub-folder per shard, each holding `manifest.json` and `raw/`.
 * @param input.plannedFiles - The test files the merge's own build lists (`dist/tests/*.test.js`).
 * @param input.identity - The merge's own values for {@link SHARD_IDENTITY_FIELDS}.
 * @returns `{ total, dumps, summary }`: the shard count, every dump `{ shard, name, path }`, and the summed test counts of the manifests.
 * @throws An `Error` naming the first reason the shard results cannot be merged.
 * @example
 * await checkHealthShards({ folder: '/tmp/shards', plannedFiles: ['dist/tests/a.test.js'], identity }) // => { total: 3, dumps: […], summary: { tests: 12, … } }
 */
export async function checkHealthShards({ folder, plannedFiles, identity }) {
  const entries = (await readManifests(folder)).toSorted(
    (left, right) => left.manifest.shard - right.manifest.shard,
  )
  assertCompleteShards(entries)
  for (const { manifest } of entries) assertSameIdentity(manifest, identity)
  assertPlannedFiles(
    entries.map(({ manifest }) => manifest),
    plannedFiles,
  )
  const dumps = []
  for (const entry of entries) dumps.push(...(await checkShardDumps(entry)))
  const summary = {}
  for (const { manifest } of entries)
    for (const [name, count] of Object.entries(manifest.summary ?? {}))
      summary[name] = (summary[name] ?? 0) + count
  return { total: entries.length, dumps, summary }
}
