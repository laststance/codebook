import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import {
  BUN_MINIMUM_VERSION,
  BUN_PROBE_FOLDER_PREFIX,
  BUN_VERSION_READ_MAX_OUTPUT_BYTES,
  BUN_VERSION_READ_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'

import { buildNodeServerEnvironment } from './buildNodeServerEnvironment'
import { isNewerExtensionVersion } from './isNewerExtensionVersion'
import { signalProcessGroup } from './signalProcessGroup'
import { windowsSystemProgramPath } from './windowsSystemProgramPath'

/** A SemVer release: its three numbers, an optional pre-release (`canary.1`) and an ignored build suffix (`+local`). */
const SEMVER_PATTERN =
  /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** What the Bun asked by {@link BUN_IDENTITY_SCRIPT} prints: its release and its own absolute path. */
const bunIdentitySchema = z.strictObject({
  version: z.string().min(1),
  executable: z.string().min(1),
})

/** The facts of a failed probe that tell its kinds apart: the exit code (a number) or error code (a string), the signal, and whether the run was ended by its own deadline. */
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
 * Ends a probe's whole process tree, so that a wrapper's child dies with the wrapper; called by {@link runBunProgram} at the deadline.
 *
 * POSIX: the probe leads its own process group, which gets `SIGKILL`. Windows: `taskkill /T /F` from the trusted system folder ({@link windowsSystemProgramPath}); without that path only the leader is ended. Any failure falls back to ending the leader alone.
 * @param child - The started probe.
 * @example endProbeTree(child) // the wrapper and the Bun it started are both gone shortly after
 */
function endProbeTree(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined) return
  try {
    if (process.platform !== 'win32') {
      signalProcessGroup(pid, 'SIGKILL')
      return
    }
    const taskkill = windowsSystemProgramPath(['System32', 'taskkill.exe'])
    // Without a trusted taskkill path no program is started; the leader alone is ended.
    if (taskkill === undefined) {
      child.kill('SIGKILL')
      return
    }
    spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => undefined)
  } catch {
    child.kill('SIGKILL')
  }
}

/**
 * Runs a candidate Bun once within a deadline ({@link BUN_VERSION_READ_TIMEOUT_MS} unless told otherwise); the default reader of {@link resolveBunRuntime}.
 *
 * The probe gets the same restricted environment as the server launch ({@link buildNodeServerEnvironment}) and a fresh private empty folder (mode 0700, made inside the OS temp folder by `mkdtemp` and removed after the read, also when the read fails or times out) as its working folder. A wrapper on the PATH or a `bunfig.toml` preload therefore never sees the editor's credentials or the opened repository's configuration, and no other local user can plant a `bunfig.toml` or `.env` there first, as they could in a shared `/tmp`, even when the version check refuses the run. A failed removal never replaces the read's own answer or error: a leftover empty private folder is harmless.
 *
 * The probe leads its own process group (POSIX) and the deadline ends the whole tree ({@link endProbeTree}), so a `bun` wrapper that starts the real Bun as a child and waits leaves nothing running when it times out.
 *
 * Called by {@link resolveBunRuntime} when a `loader: "bun"` run resolves its Bun.
 * @param program - `bun` (looked up on the PATH) or an absolute path.
 * @param args - The arguments, here the identity script.
 * @param timeoutMs - The deadline; tests shorten it.
 * @returns The program's stdout.
 * @throws An error shaped like `execFile`'s: `ENOENT` when no such program exists, `EACCES` when it is not executable, an error with code `ETIMEDOUT` at the deadline, a non-zero exit otherwise.
 * @example await runBunProgram('bun', ['-e', 'console.log(Bun.version)']) // => '1.4.5\n'
 */
export async function runBunProgram(
  program: string,
  args: string[],
  timeoutMs: number = BUN_VERSION_READ_TIMEOUT_MS,
): Promise<string> {
  // mkdtemp creates the folder with mode 0700, so nobody else can plant bunfig.toml or .env in it.
  const probeFolder = await mkdtemp(join(tmpdir(), BUN_PROBE_FOLDER_PREFIX))
  let timer: NodeJS.Timeout | undefined
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(program, args, {
        // Only the allowlisted variables (PATH and HOME stay so the wrapper and Bun run); no credentials of the editor.
        env: buildNodeServerEnvironment(),
        // A private empty folder holds no project configuration (bunfig.toml, .env) for Bun to load.
        cwd: probeFolder,
        // Its own process group lets the deadline end a wrapper's children too.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      const chunks: Buffer[] = []
      let outputBytes = 0
      let failure: Error | undefined
      // The first failure wins; the whole tree ends with it.
      const fail = (error: Error): void => {
        if (failure) return
        failure = error
        endProbeTree(child)
      }
      timer = setTimeout(
        () =>
          fail(
            Object.assign(new Error(`Command timed out: ${program}`), {
              code: 'ETIMEDOUT',
            }),
          ),
        timeoutMs,
      )
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        // A probe that floods its output is ended, never buffered without bound.
        if (outputBytes > BUN_VERSION_READ_MAX_OUTPUT_BYTES)
          fail(
            Object.assign(new Error('Output limit exceeded'), {
              code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            }),
          )
        else chunks.push(chunk)
      })
      // A failed start (ENOENT, EACCES) arrives as an error with its own code.
      child.on('error', (error) => reject(failure ?? error))
      child.on('close', (code, signal) => {
        if (failure) reject(failure)
        else if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
        else
          reject(
            Object.assign(new Error(`Command failed: ${program}`), {
              code,
              signal,
            }),
          )
      })
    })
  } finally {
    clearTimeout(timer)
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
  // A run that outlives its deadline reads as not answering.
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
 * - `undefined` when no such program exists (`ENOENT`) or it cannot be executed (`EACCES`, so a stray non-executable `bun` earlier on the PATH does not hide a valid `~/.bun/bin/bun`)
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
    // A missing or non-executable candidate lets the lookup go on; any other failure is a Bun that exists and does not answer.
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EACCES')
    )
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
 * @returns The absolute path of the Bun that answered and its release exactly as it reported it (a pre-release such as `1.4.5-canary.1+local` keeps its suffix).
 * @throws `NODE_SERVER_SOURCE_REFUSED` when no Bun is found ({@link BUN_LOOKUP_DESCRIPTION}), when one does not answer or answers unreadably, or when its release is older than {@link BUN_MINIMUM_VERSION} (a pre-release of the minimum is older than it).
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
  const version = parsed.data.version
  const release = SEMVER_PATTERN.exec(version)
  if (!release)
    throw bunRefusal(
      `node-server's loader "bun" found a Bun whose release (${version}) is not a release number, so nothing was launched.`,
      `Install a released Bun ${BUN_MINIMUM_VERSION} or later (https://bun.sh), then start a new run.`,
    )
  const [, numbers = '', preRelease] = release
  // SemVer precedence: a pre-release of the minimum is below it, a pre-release of a later release is above it.
  const belowMinimum =
    isNewerExtensionVersion(BUN_MINIMUM_VERSION, numbers) ||
    (preRelease !== undefined &&
      !isNewerExtensionVersion(numbers, BUN_MINIMUM_VERSION))
  if (belowMinimum)
    throw bunRefusal(
      `node-server's loader "bun" needs Bun ${BUN_MINIMUM_VERSION} or later, and the Bun found (${BUN_LOOKUP_DESCRIPTION}) is ${version}, so nothing was launched.`,
      `Update Bun to ${BUN_MINIMUM_VERSION} or later (\`bun upgrade\`), then start a new run.`,
    )
  return { executable: parsed.data.executable, version }
}
