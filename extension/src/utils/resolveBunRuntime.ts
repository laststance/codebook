import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import {
  BUN_MINIMUM_VERSION,
  BUN_PROBE_FOLDER_PREFIX,
  BUN_VERSION_READ_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'

import { buildNodeServerEnvironment } from './buildNodeServerEnvironment'
import { isNewerExtensionVersion } from './isNewerExtensionVersion'

const executeFile = promisify(execFile)

/** What the Bun asked by {@link BUN_IDENTITY_SCRIPT} prints: its release and its own absolute path. */
const bunIdentitySchema = z.strictObject({
  version: z.string().min(1),
  executable: z.string().min(1),
})

/** The facts of an `execFile` failure that tell its kinds apart: the exit code (a number) or error code (a string), the signal, and whether `execFile` itself ended the run (its timeout, its output limit). */
const executionFailureSchema = z
  .object({
    code: z.union([z.string(), z.number()]).nullish(),
    signal: z.string().nullish(),
    killed: z.boolean().optional(),
  })
  .catch({})

/** The one-line script Bun runs to name itself: the PATH lookup ends at the real binary, so the run records the path it launches. */
const BUN_IDENTITY_SCRIPT =
  'console.log(JSON.stringify({version:Bun.version,executable:process.execPath}))'

/** Where {@link resolveBunRuntime} looks for Bun, in its order, as a refusal sentence names it. */
export const BUN_LOOKUP_DESCRIPTION =
  "the first bun on the editor's PATH, then ~/.bun/bin/bun"

/** The Bun a `loader: "bun"` node-server run launches: its absolute path and its release. */
export type ResolvedBunRuntime = { executable: string; version: string }

/** Runs one program with arguments and answers its stdout; {@link resolveBunRuntime} reads Bun through it, and tests replace it. */
export type RunBunProgram = (program: string, args: string[]) => Promise<string>

/**
 * Runs a candidate Bun once within {@link BUN_VERSION_READ_TIMEOUT_MS}; the default reader of {@link resolveBunRuntime}.
 *
 * The probe gets the same restricted environment as the server launch ({@link buildNodeServerEnvironment}) and a fresh private empty folder (mode 0700, made inside the OS temp folder by `mkdtemp` and removed after the read, also when the read fails or times out) as its working folder. A wrapper on the PATH or a `bunfig.toml` preload therefore never sees the editor's credentials or the opened repository's configuration, and no other local user can plant a `bunfig.toml` or `.env` there first, as they could in a shared `/tmp`, even when the version check refuses the run. A failed removal never replaces the read's own answer or error: a leftover empty private folder is harmless.
 *
 * Called by {@link resolveBunRuntime} when a `loader: "bun"` run resolves its Bun.
 * @param program - `bun` (looked up on the PATH) or an absolute path.
 * @param args - The arguments, here the identity script.
 * @returns The program's stdout.
 * @throws The `execFile` error: `ENOENT` when no such program exists, a timeout or a non-zero exit otherwise.
 * @example await runBunProgram('bun', ['-e', 'console.log(Bun.version)']) // => '1.4.5\n'
 */
export async function runBunProgram(
  program: string,
  args: string[],
): Promise<string> {
  // mkdtemp creates the folder with mode 0700, so nobody else can plant bunfig.toml or .env in it.
  const probeFolder = await mkdtemp(join(tmpdir(), BUN_PROBE_FOLDER_PREFIX))
  try {
    const { stdout } = await executeFile(program, args, {
      timeout: BUN_VERSION_READ_TIMEOUT_MS,
      // Only the allowlisted variables (PATH and HOME stay so the wrapper and Bun run); no credentials of the editor.
      env: buildNodeServerEnvironment(),
      // A private empty folder holds no project configuration (bunfig.toml, .env) for Bun to load.
      cwd: probeFolder,
      // A wrapper that handles SIGTERM must still end at the deadline, or the lookup would never answer.
      killSignal: 'SIGKILL',
    })
    return stdout
  } finally {
    // Cleanup errors are ignored so they never replace the probe's own answer or error.
    await rm(probeFolder, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Builds the refusal of a `loader: "bun"` run whose Bun is missing, unreadable or too old, raised before anything is launched.
 * @param message - What was found, in the learner's words.
 * @param recovery - What the learner does next.
 * @returns The `NODE_SERVER_SOURCE_REFUSED` {@link StudyError} with that recovery.
 * @example bunRefusal('… no bun was found …', 'Install Bun 1.4.4 or later …')
 */
function bunRefusal(message: string, recovery: string): StudyError {
  return new StudyError(
    'NODE_SERVER_SOURCE_REFUSED',
    message,
    message,
    recovery,
  )
}

/**
 * Says why a Bun that exists gave no identity, for its refusal; called by {@link askBunIdentity} so the learner is pointed at the real cause (slowness, a crash, a permission), never told a failed run was slow.
 * @param error - What `execFile` threw for the identity read.
 * @returns The clause after "found a Bun (…) that", naming only the exit code, error code or signal (never output or paths).
 * @example
 * bunIdentityFailureOf({ code: 1 }) // => 'ended `bun -e` with exit code 1'
 * bunIdentityFailureOf({ killed: true, signal: 'SIGTERM', code: null }) // => 'did not answer `bun -e` within 5 s'
 */
function bunIdentityFailureOf(error: unknown): string {
  const { code, signal, killed } = executionFailureSchema.parse(error)
  // A number is the exit code of a Bun that ran and failed.
  if (typeof code === 'number') return `ended \`bun -e\` with exit code ${code}`
  // execFile ends a run that outlives its timeout and marks it killed, with no code of its own.
  if (code === 'ETIMEDOUT' || (killed === true && !code))
    return `did not answer \`bun -e\` within ${BUN_VERSION_READ_TIMEOUT_MS / 1000} s`
  // Any other error code (a permission, the output limit) is named as it is.
  if (code) return `could not run \`bun -e\` (${code})`
  if (signal) return `was ended by ${signal} while answering \`bun -e\``
  return 'could not run `bun -e`'
}

/**
 * Asks one candidate for its identity; a candidate that does not exist answers `undefined`, so the lookup tries the next one.
 * @param program - The candidate Bun.
 * @param runProgram - Runs it ({@link RunBunProgram}).
 * @returns
 * - the identity output when the program ran
 * - `undefined` when no such program exists (`ENOENT`)
 * @throws The refusal naming the unreadable Bun when it exists but does not answer (a timeout, a crash, a non-zero exit).
 * @example await askBunIdentity('bun', runBunProgram) // => '{"version":"1.4.5","executable":"/Users/learner/.bun/bin/bun"}\n'
 */
async function askBunIdentity(
  program: string,
  runProgram: RunBunProgram,
): Promise<string | undefined> {
  try {
    return await runProgram(program, ['-e', BUN_IDENTITY_SCRIPT])
  } catch (error) {
    // A missing candidate lets the lookup go on; any other failure is a Bun that exists and does not answer.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined
    throw bunRefusal(
      `node-server's loader "bun" found a Bun (${BUN_LOOKUP_DESCRIPTION}) that ${bunIdentityFailureOf(error)}, so nothing was launched.`,
      `Check that \`bun --version\` works in a terminal, reinstall Bun ${BUN_MINIMUM_VERSION} or later if it does not, then start a new run.`,
    )
  }
}

/**
 * Finds the Bun a `loader: "bun"` node-server runs on and checks its release before anything is launched.
 *
 * Why it exists: Bun is the learner's own installation, outside the repository and the extension; a missing or too old Bun must be named before the server starts, never discovered as a crash.
 * When it runs: once per `loader: "bun"` start, from `resolveNodeServerLaunch`, before the port check and the launch.
 *
 * @param runProgram - Runs a candidate Bun ({@link RunBunProgram}); tests pass a fake.
 * @param home - The learner's home folder, where `~/.bun/bin/bun` lives.
 * @returns The absolute path of the Bun that answered and its release (without a pre-release suffix).
 * @throws `NODE_SERVER_SOURCE_REFUSED` when no Bun is found ({@link BUN_LOOKUP_DESCRIPTION}), when one does not answer or answers unreadably, or when its release is older than {@link BUN_MINIMUM_VERSION}.
 * @example
 * await resolveBunRuntime() // => { executable: '/Users/learner/.bun/bin/bun', version: '1.4.5' }
 */
export async function resolveBunRuntime(
  runProgram: RunBunProgram = runBunProgram,
  home: string = homedir(),
): Promise<ResolvedBunRuntime> {
  const candidates = ['bun', join(home, '.bun', 'bin', 'bun')]
  let output: string | undefined
  // The first candidate that exists answers; a later one is asked only when the earlier one does not exist.
  for (const candidate of candidates) {
    output = await askBunIdentity(candidate, runProgram)
    if (output !== undefined) break
  }
  if (output === undefined)
    throw bunRefusal(
      `node-server's loader "bun" needs Bun ${BUN_MINIMUM_VERSION} or later, and no bun was found (${BUN_LOOKUP_DESCRIPTION}), so nothing was launched.`,
      `Install Bun ${BUN_MINIMUM_VERSION} or later (https://bun.sh) so that \`bun\` is on the editor's PATH or in ~/.bun/bin, reload the editor window, then start a new run.`,
    )
  let identity: unknown
  // The identity is the last line Bun printed; text that is no JSON leaves it unknown, which the schema refuses.
  try {
    identity = JSON.parse(output.trim().split('\n').at(-1) ?? '')
  } catch {
    identity = undefined
  }
  const parsed = bunIdentitySchema.safeParse(identity)
  if (!parsed.success || !isAbsolute(parsed.data.executable))
    throw bunRefusal(
      `node-server's loader "bun" could not read the release of the Bun it found (${BUN_LOOKUP_DESCRIPTION}), so nothing was launched.`,
      `Check that \`bun --version\` prints a release in a terminal, reinstall Bun ${BUN_MINIMUM_VERSION} or later if it does not, then start a new run.`,
    )
  // A pre-release or build suffix (`1.4.6-canary.3+abc`) does not change which release line the Bun belongs to.
  const version = parsed.data.version.split(/[-+]/)[0] ?? ''
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw bunRefusal(
      `node-server's loader "bun" found a Bun whose release (${parsed.data.version}) is not a dotted release number, so nothing was launched.`,
      `Install a released Bun ${BUN_MINIMUM_VERSION} or later (https://bun.sh), then start a new run.`,
    )
  if (isNewerExtensionVersion(BUN_MINIMUM_VERSION, version))
    throw bunRefusal(
      `node-server's loader "bun" needs Bun ${BUN_MINIMUM_VERSION} or later, and the Bun found (${BUN_LOOKUP_DESCRIPTION}) is ${version}, so nothing was launched.`,
      `Update Bun to ${BUN_MINIMUM_VERSION} or later (\`bun upgrade\`), then start a new run.`,
    )
  return { executable: parsed.data.executable, version }
}
