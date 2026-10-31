import { join } from 'node:path'

import { z } from 'zod'

import {
  delegatedScriptName,
  devScriptScope,
  enterDelegation,
  isBunProject,
  isYarnBerryProject,
  type LineScope,
  nextArguments,
  projectMarkerFolders,
  readProjectFile,
} from './readDeclaredDevelopmentPort'
import {
  readPreScriptRules,
  type PreScriptRules,
  type PreScriptRun,
} from './readPreScriptRules'
import {
  tokenizeDevelopmentScript,
  UnreadScriptError,
} from './tokenizeDevelopmentScript'

/**
 * What Codebook leaves out of the project's own `dev` script when it starts `next dev --webpack` itself.
 *
 * - `none`: the script runs `next dev` with nothing before it.
 * - `skipped`: `statements` statements run before `next dev` (a `predev` or `pre<name>` script counts as one when the package manager that runs it runs pre scripts, or when Codebook cannot tell; {@link readPreScriptRules}); Codebook runs none of them.
 * - `unknown`: the script could not be read, so whether it prepares anything before `next dev` was not checked.
 *
 * `envSettings` names, never values, the environment settings the script gives `next dev` (`A=1 next dev`, `cross-env X=1 next dev`, `export X=1`) that Codebook does not apply; `PORT` is never listed, since Codebook starts the app on the declared port ({@link readDeclaredDevelopmentPort}).
 */
export type NextDevPreparation =
  | { status: 'none'; envSettings?: string[] }
  | { status: 'skipped'; statements: number; envSettings?: string[] }
  | { status: 'unknown' }

/** One reading of {@link readNextDevPreparation}: what `codebook_status` reports as `preparation`, and whether a pre script it counts may not run. */
export type NextDevPreparationReading = {
  preparation: NextDevPreparation
  /** Whether a counted pre script's package manager (or its version) is unknown, so the script may or may not run; {@link describeNextDevPreparation} words it as a note, never as a field. */
  preScriptUncertain: boolean
}

/** The reading of a script that could not be read; frozen, since every caller receives this one object. */
const UNKNOWN_READING: NextDevPreparationReading = Object.freeze({
  preparation: Object.freeze({ status: 'unknown' }),
  preScriptUncertain: false,
})

/** The pre-script rules of one read and whether a pre script was counted under an unknown rule; one object shared by every line of the read. */
type PreScriptTally = { rules: PreScriptRules; uncertain: boolean }

/** Programs that run other commands in parallel or by pattern: whether `next dev` runs after them, or inside them, cannot be read. */
const COMMAND_RUNNER_PROGRAMS: ReadonlySet<string> = new Set([
  'concurrently',
  'npm-run-all',
  'npm-run-all2',
  'run-p',
  'run-s',
])

/** A word that assigns an environment variable; only its name is ever kept. A word with a quote before its `=` carries the tokenizer's mark and does not match (F501). */
const ENVIRONMENT_ASSIGNMENT = /^([A-Za-z_]\w*)=/

/** The one environment setting Codebook applies: it starts the app on the port a `PORT` assignment declares ({@link readDeclaredDevelopmentPort}), so `PORT` is never named as unapplied. */
const APPLIED_ENVIRONMENT_NAME = 'PORT'

/** The `package.json` fields the reader needs; any other field is ignored. */
const packageManifestSchema = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
  packageManager: z.unknown().optional(),
})

/** What reading one script line found: the `next dev` it reaches with the statements and environment names before it, or no `next dev`. */
type LineReading =
  | { runsNextDev: true; statementsBefore: number; environmentNames: string[] }
  | { runsNextDev: false }

/** What one statement is: environment settings only, a `next dev` (directly or through a delegation), or a preparation statement. */
type StatementReading =
  | { kind: 'environment'; names: string[] }
  | { kind: 'next-dev'; statementsBefore: number; environmentNames: string[] }
  | { kind: 'preparation' }

/**
 * Splits a command's environment prefix from its program: leading assignments, then optionally `cross-env` or `env` with more assignments, as the port reader's prefix grammar reads them.
 *
 * Unlike the port reader it keeps every assignment name, `NODE_OPTIONS` included, because only names are reported here and no value is interpreted.
 *
 * @param words - The words of one statement.
 * @param windows - Whether `cmd` runs the statement, where a leading assignment and `env` are commands, not a prefix (F502, D74).
 * @returns The assignment names and the program words after the prefix.
 * @throws {@link UnreadScriptError} For a leading assignment or `env` under `cmd`.
 * @example
 * splitEnvironmentPrefix(['cross-env', 'NODE_OPTIONS=x', 'next', 'dev'], false) // => { names: ['NODE_OPTIONS'], program: ['next', 'dev'] }
 */
function splitEnvironmentPrefix(
  words: readonly string[],
  windows: boolean,
): { names: string[]; program: string[] } {
  const leading = leadingAssignmentNames(words)
  const rest = words.slice(leading.length)
  if (windows && (leading.length > 0 || rest[0] === 'env'))
    throw new UnreadScriptError([], 'cmd')
  // Without a `cross-env` or `env` wrapper the program starts after the leading assignments.
  if (rest[0] !== 'cross-env' && rest[0] !== 'env')
    return { names: leading, program: rest }
  const wrapped = leadingAssignmentNames(rest.slice(1))
  return {
    names: [...leading, ...wrapped],
    program: rest.slice(1 + wrapped.length),
  }
}

/** The names of the assignment words a word list starts with, up to its first other word. @example leadingAssignmentNames(['A=1', 'B=2', 'next']) // => ['A', 'B'] */
function leadingAssignmentNames(words: readonly string[]): string[] {
  const names: string[] = []
  for (const word of words) {
    const name = ENVIRONMENT_ASSIGNMENT.exec(word)?.[1]
    if (name === undefined) break
    names.push(name)
  }
  return names
}

/**
 * Reads `export NAME=value …` as environment names.
 *
 * @throws {@link UnreadScriptError} Under `cmd` and Yarn Berry's portable shell, which have no `export` (D74, D75), and for an `export` of anything but assignments.
 * @example
 * readExportNames(['export', 'NODE_ENV=development'], scope) // => ['NODE_ENV']
 */
function readExportNames(words: readonly string[], scope: LineScope): string[] {
  if (scope.windows) throw new UnreadScriptError([], 'cmd')
  if (scope.yarnBerry) throw new UnreadScriptError([], 'yarn-shell')
  const names = words
    .slice(1)
    .map((word) => ENVIRONMENT_ASSIGNMENT.exec(word)?.[1])
    .filter((name) => name !== undefined)
  if (names.length === 0 || names.length !== words.length - 1)
    throw new UnreadScriptError()
  return names
}

/**
 * Counts a pre script as one skipped statement when the package manager that runs it runs pre scripts, or when its rule is unknown, which the tally remembers for the readiness note.
 * Called by {@link readDelegatedLine} for a `pre<name>` script and by {@link readNextDevPreparation} for `predev`.
 * @param tally - The read's rules and its uncertainty mark.
 * @param run - The rule of the manager that runs the script.
 * @param hasScript - Whether the project has the pre script.
 * @returns `1` when the script counts, else `0`.
 * @example
 * countPreScript(tally, 'skips', true)   // => 0 (pnpm 8, Yarn 2 and later)
 * countPreScript(tally, 'unknown', true) // => 1, and tally.uncertain is now true
 */
function countPreScript(
  tally: PreScriptTally,
  run: PreScriptRun,
  hasScript: boolean,
): number {
  if (!hasScript || run === 'skips') return 0
  // A script that may run is counted rather than hidden, and the note says it may not.
  if (run === 'unknown') tally.uncertain = true
  return 1
}

/**
 * Reads a delegated script (`npm run dev:next`) one level deeper; its `pre<name>` script counts as one more statement before a `next dev` it reaches when the delegating manager runs pre scripts ({@link countPreScript}).
 *
 * @returns What the delegated script runs.
 * @throws {@link UnreadScriptError} When {@link enterDelegation} cannot resolve the delegation or the script leaves the grammar.
 * @example
 * readDelegatedLine('dev:next', 'npm', scope, tally) // => { runsNextDev: true, statementsBefore: 2, environmentNames: [] } for "prisma generate && next dev" with a predev:next script
 */
function readDelegatedLine(
  name: string,
  manager: string,
  scope: LineScope,
  tally: PreScriptTally,
): LineReading {
  const delegation = enterDelegation(name, manager, scope)
  const reading = readLine(delegation.script, delegation.scope, tally)
  if (!reading.runsNextDev) return reading
  const preScript = countPreScript(
    tally,
    tally.rules.byManager.get(manager) ?? 'unknown',
    typeof scope.scripts?.[`pre${name}`] === 'string',
  )
  return { ...reading, statementsBefore: reading.statementsBefore + preScript }
}

/**
 * Reads one statement: environment settings alone, the `next dev` statement, a delegation that reaches `next dev`, or a preparation statement (any other program, `next build` included).
 *
 * @throws {@link UnreadScriptError} For a command runner ({@link COMMAND_RUNNER_PROGRAMS}) and for every form the shared grammar cannot read.
 * @example
 * readStatement(['prisma', 'generate'], scope, tally) // => { kind: 'preparation' }
 * readStatement(['A=1', 'next', 'dev'], scope, tally) // => { kind: 'next-dev', statementsBefore: 0, environmentNames: ['A'] }
 */
function readStatement(
  words: readonly string[],
  scope: LineScope,
  tally: PreScriptTally,
): StatementReading {
  if (words[0] === 'export')
    return { kind: 'environment', names: readExportNames(words, scope) }
  const prefix = splitEnvironmentPrefix(words, scope.windows)
  // Assignments alone set variables of the line; they prepare nothing.
  if (prefix.program.length === 0)
    return { kind: 'environment', names: prefix.names }
  const nextWords = nextArguments(prefix.program, scope)
  if (nextWords)
    return nextWords[0] === 'dev'
      ? {
          kind: 'next-dev',
          statementsBefore: 0,
          environmentNames: prefix.names,
        }
      : { kind: 'preparation' }
  if (COMMAND_RUNNER_PROGRAMS.has(prefix.program[0]!))
    throw new UnreadScriptError()
  const name = delegatedScriptName(prefix.program)
  if (name === undefined) return { kind: 'preparation' }
  const delegated = readDelegatedLine(name, prefix.program[0]!, scope, tally)
  // A delegation that never reaches `next dev` is one preparation statement of this line.
  if (!delegated.runsNextDev) return { kind: 'preparation' }
  return {
    kind: 'next-dev',
    statementsBefore: delegated.statementsBefore,
    environmentNames: [...prefix.names, ...delegated.environmentNames],
  }
}

/**
 * Reads a script line statement by statement up to the first `next dev`, counting the statements before it and collecting the environment names it is given.
 *
 * @throws {@link UnreadScriptError} When the tokenizer refuses the line, a statement leaves the grammar or the shared statement budget runs out (F550).
 * @example
 * readLine('prisma generate && A=1 next dev', scope, tally) // => { runsNextDev: true, statementsBefore: 1, environmentNames: ['A'] }
 */
function readLine(
  line: string,
  scope: LineScope,
  tally: PreScriptTally,
): LineReading {
  const statements = tokenizeDevelopmentScript(
    line,
    scope.windows,
    scope.yarnBerry,
  )
  scope.budget.remaining -= statements.length
  if (scope.budget.remaining < 0) throw new UnreadScriptError([], 'too-long')
  let statementsBefore = 0
  const environmentNames: string[] = []
  // Statements after the first `next dev` never run before it, so the walk ends there.
  for (const words of statements) {
    const statement = readStatement(words, scope, tally)
    if (statement.kind === 'environment')
      environmentNames.push(...statement.names)
    else if (statement.kind === 'preparation') statementsBefore += 1
    else
      return {
        runsNextDev: true,
        statementsBefore: statementsBefore + statement.statementsBefore,
        environmentNames: [...environmentNames, ...statement.environmentNames],
      }
  }
  return { runsNextDev: false }
}

/**
 * Reads what Codebook leaves out of the project's own `dev` script when it starts `next dev --webpack` itself: the statements before `next dev`, the pre scripts the package manager runs before them (`predev`, a delegated script's `pre<name>`), and the environment settings given to `next dev`.
 *
 * Why it exists: Codebook never runs the dev script, so a preparation step (`prisma generate && next dev`) or an environment setting (`NODE_OPTIONS=… next dev`) the project relies on is silently missing from Codebook's run; `codebook_status` names it before a start. Called by {@link readRepositoryAdapterReadiness} and {@link describeNextLaunchFailure}.
 * The script is read as text, never run, with the grammar of {@link readDeclaredDevelopmentPort}: the same tokenizer, launchers, delegations, shells and statement budget. Statements before `next dev` that the port grammar does not read (`prisma generate`) are counted, not refused; `concurrently`, `npm-run-all`, `run-p`, `run-s`, an unresolved delegation, a script that never reaches `next dev` and any form the tokenizer refuses make the reading `unknown`. A pre script counts only when the manager that runs it runs pre scripts, by {@link readPreScriptRules}: the project's manager for `predev`, the delegating program for a `pre<name>`. Environment values are never kept.
 *
 * @param workspace - The workspace root that holds `package.json`.
 * @param platform - The platform whose shell runs the script (`cmd` on `win32`, `sh` elsewhere); tests set it to read the Windows meaning on any host.
 * @returns The preparation and whether a counted pre script may not run:
 * - `{ status: 'none' }` for a plain `next dev`, or no `dev` script
 * - `{ status: 'skipped', statements: n }` when `n` statements (each counted pre script as one) run before `next dev`, with `preScriptUncertain` when a counted pre script's manager or its version is unknown
 * - `{ status: 'unknown' }` when `package.json` or the script could not be read
 * - `envSettings` beside `none` or `skipped` when `next dev` is given environment settings Codebook does not apply, by name only (`PORT` is applied, so never listed)
 * @example
 * await readNextDevPreparation('/repo') // => { preparation: { status: 'skipped', statements: 1 }, preScriptUncertain: false } for "prisma generate && next dev"
 * await readNextDevPreparation('/repo') // => { preparation: { status: 'none' }, preScriptUncertain: false } for a predev script and "next dev" in a pnpm 8 project
 * await readNextDevPreparation('/repo') // => { preparation: { status: 'skipped', statements: 1 }, preScriptUncertain: true } for the same scripts with no packageManager and no lockfile
 */
export async function readNextDevPreparation(
  workspace: string,
  platform: NodeJS.Platform = process.platform,
): Promise<NextDevPreparationReading> {
  const file = await readProjectFile(join(workspace, 'package.json'))
  // An absent, unreadable, oversized or irregular package.json cannot be read.
  if (typeof file !== 'string') return UNKNOWN_READING
  const manifest = (() => {
    try {
      return packageManifestSchema.safeParse(JSON.parse(file))
    } catch {
      return undefined
    }
  })()
  if (!manifest?.success) return UNKNOWN_READING
  const { scripts, packageManager } = manifest.data
  const dev = scripts?.dev
  // Without a dev script there is nothing Codebook leaves out.
  if (typeof dev !== 'string' || dev.trim() === '')
    return { preparation: { status: 'none' }, preScriptUncertain: false }
  const folders = await projectMarkerFolders(workspace)
  const yarnBerry = await isYarnBerryProject(folders, packageManager)
  const bun = await isBunProject(folders, packageManager)
  const win32 = platform === 'win32'
  // A Bun project runs its scripts with Bun Shell on Windows, whatever the script says (D75).
  if (win32 && !yarnBerry && bun) return UNKNOWN_READING
  const tally: PreScriptTally = {
    rules: await readPreScriptRules(folders, packageManager),
    uncertain: false,
  }
  let reading: LineReading
  try {
    reading = readLine(
      dev,
      devScriptScope(scripts, bun, win32, yarnBerry),
      tally,
    )
  } catch (error) {
    if (error instanceof UnreadScriptError) return UNKNOWN_READING
    throw error
  }
  if (!reading.runsNextDev) return UNKNOWN_READING
  // The project's own manager runs `predev` when the learner starts `dev`.
  const statements =
    reading.statementsBefore +
    countPreScript(
      tally,
      tally.rules.project,
      typeof scripts?.predev === 'string',
    )
  // Only settings Codebook really does not apply are listed; PORT decides the port Codebook starts the app on.
  const envSettings = [...new Set(reading.environmentNames)].filter(
    (name) => name !== APPLIED_ENVIRONMENT_NAME,
  )
  const environment = envSettings.length > 0 ? { envSettings } : {}
  return {
    preparation:
      statements > 0
        ? { status: 'skipped', statements, ...environment }
        : { status: 'none', ...environment },
    preScriptUncertain: tally.uncertain,
  }
}
