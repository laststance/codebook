import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  API_VERSION,
  NODE_SCRIPT_HISTORY_DIRECTORY,
  NODE_SCRIPT_RUN_TIMEOUT_MS,
} from '../constants'
import { ERROR_RECOVERY } from '../errors'
import {
  nodeScriptConfigSchema,
  type NodeScriptConfiguration,
} from '../nodeScriptConfigSchemas'
import { readResource } from '../resources'
import { nodeServerMachineGaps } from '../utils/nodeServerMachineGaps'

import { createHarness } from './helpers'
import { createEnvironmentWith } from './utils/nodeServerEnvironment'

/** A book selection and a value-inspected stop every accepted configuration shares. */
const BASE_CONFIGURATION = {
  version: 1,
  adapter: 'node-script',
  book: {
    bookId: 'scheduler',
    revision: 1,
    nodeId: 'scheduler',
    anchorIndex: 0,
  },
  source: { path: 'check.mjs', hash: 'c'.repeat(64), line: 3, column: 1 },
  inspections: [{ path: 'result', mode: 'value', required: true }],
} as const

/**
 * Reads a file of the extension package by its path below the extension folder.
 * @param relativePath - Path below the extension folder.
 * @returns The file text.
 * @example await readPackaged('README.md') // => '# codebook …'
 */
async function readPackaged(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '../..', relativePath), 'utf8')
}

/**
 * Reads the served node-script help as an agent does.
 * @returns The parsed help body.
 * @example (await servedHelp()).profile // => 'node-script'
 */
async function servedHelp() {
  const harness = await createHarness()
  try {
    const resource = await readResource(
      harness.service,
      'codebook://help/node-script',
    )
    assert.ok('text' in resource)
    return JSON.parse(resource.text) as {
      samples: Record<string, unknown>
      codes: { code: string; anchor: string; recovery: string }[]
      walkthrough: string[]
      limits: string[]
    }
  } finally {
    await harness.close()
  }
}

/** Replaces every placeholder of a sample with a value of the answer it names, the way an agent fills it. */
function filled(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && value.startsWith('<')) {
    if (key === 'instanceId') return '6f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
    if (key === 'hash') return 'c'.repeat(64)
    if (key === 'revision') return 1
    return 'scheduler'
  }
  if (Array.isArray(value)) return value.map((item) => filled(item, key))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, filled(item, name)]),
    )
  return value
}

// protects=a JavaScript entry with packageRoot absent, "." or below the root, and a TypeScript entry through tsx, are accepted and get their loader; fails_when=a shape the profile promises is refused or the loader default drifts; no_claim=that the entry exists (the start checks real paths)
test('the node-script configuration accepts JavaScript entries at any package root and a tsx TypeScript entry', () => {
  // Arrange
  const javaScript = { ...BASE_CONFIGURATION, entry: 'test-esm.mjs' }
  // Act
  const absent = nodeScriptConfigSchema.parse(javaScript)
  const dot = nodeScriptConfigSchema.parse({ ...javaScript, packageRoot: '.' })
  const nested = nodeScriptConfigSchema.parse({
    ...javaScript,
    packageRoot: 'examples/publish-ci/node',
  })
  const typeScript: NodeScriptConfiguration = nodeScriptConfigSchema.parse({
    ...BASE_CONFIGURATION,
    entry: 'task.ts',
    loader: 'tsx',
  })
  // Assert
  assert.deepEqual(
    [absent.packageRoot, dot.packageRoot, nested.packageRoot],
    ['.', '.', 'examples/publish-ci/node'],
  )
  assert.equal(absent.loader, 'node')
  assert.equal(typeScript.loader, 'tsx')
})

// protects=a TypeScript entry is defaulted to tsx when no loader is declared; fails_when=a TypeScript entry would run through plain node; no_claim=that tsx is installed
test('the node-script configuration runs a TypeScript entry through tsx by default', () => {
  // Arrange / Act
  const parsed = nodeScriptConfigSchema.parse({
    ...BASE_CONFIGURATION,
    entry: 'task.mts',
  })
  // Assert
  assert.equal(parsed.loader, 'tsx')
})

// protects=a script run cannot declare a port, request, environment, node option or argument; fails_when=a field that would let a chat change how the script runs is accepted; no_claim=that the start refuses it the same way (the schema is the boundary)
test('the node-script configuration refuses a port, request, environment, option and argument field', () => {
  // Arrange
  const base = { ...BASE_CONFIGURATION, entry: 'check.mjs' }
  // Act
  const outcomes = [
    { port: 4100 },
    { request: { method: 'GET', path: '/' } },
    { env: { TOKEN: 'x' } },
    { nodeOptions: ['--inspect'] },
    { args: ['--flag'] },
  ].map(
    (extra) => nodeScriptConfigSchema.safeParse({ ...base, ...extra }).success,
  )
  // Assert
  assert.deepEqual(outcomes, [false, false, false, false, false])
})

// protects=a TypeScript entry declared with the node loader and an entry that node would read as an option are refused; fails_when=either is accepted; no_claim=none beyond protects
test('the node-script configuration refuses a TypeScript entry with the node loader and an entry beginning with a dash', () => {
  // Arrange / Act
  const loaderMismatch = nodeScriptConfigSchema.safeParse({
    ...BASE_CONFIGURATION,
    entry: 'task.ts',
    loader: 'node',
  })
  const optionLikeEntry = nodeScriptConfigSchema.safeParse({
    ...BASE_CONFIGURATION,
    entry: '-r.js',
  })
  // Assert
  assert.equal(loaderMismatch.success, false)
  assert.match(
    JSON.stringify(loaderMismatch.error?.issues),
    /for a TypeScript entry/,
  )
  assert.equal(optionLikeEntry.success, false)
  assert.match(
    JSON.stringify(optionLikeEntry.error?.issues),
    /does not begin with/,
  )
})

// protects=a stop that declares only type inspections is refused and the byte limit applies, as for node-server; fails_when=either rule is dropped for scripts; no_claim=the wording
test('the node-script configuration refuses a stop without a required value inspection and an oversized declaration', () => {
  // Arrange
  const typeOnly = {
    ...BASE_CONFIGURATION,
    entry: 'check.mjs',
    inspections: [{ path: 'result', mode: 'type', required: true }],
  }
  const oversized = {
    ...BASE_CONFIGURATION,
    entry: 'check.mjs',
    inspections: [
      { path: 'result', mode: 'value', required: true },
      ...Array.from({ length: 4000 }, (_, index) => ({
        path: `value${index}.field${'x'.repeat(40)}`,
        mode: 'value',
        required: false,
      })),
    ],
  }
  // Act
  const typeOnlyResult = nodeScriptConfigSchema.safeParse(typeOnly)
  const oversizedResult = nodeScriptConfigSchema.safeParse(oversized)
  // Assert
  assert.equal(typeOnlyResult.success, false)
  assert.equal(oversizedResult.success, false)
})

// protects=a script run needs ps and a supported system but no listener tool; fails_when=a machine with ps and no lsof or ss is reported not ready, a missing ps or native Windows is hidden, or the sentences name node-server; no_claim=the real file system
test('the node-script machine check needs ps and a supported system but no listener tool', async () => {
  // Arrange
  const onlyPs = async (path: string) => path === '/bin/ps'
  // Act
  const withPs = await nodeServerMachineGaps({
    profile: 'node-script',
    platform: 'linux',
    isProgramFile: onlyPs,
  })
  const withoutPs = await nodeServerMachineGaps({
    profile: 'node-script',
    platform: 'linux',
    isProgramFile: async () => false,
  })
  const onWindows = await nodeServerMachineGaps({
    profile: 'node-script',
    platform: 'win32',
  })
  // Assert
  assert.deepEqual(withPs, [])
  assert.deepEqual(withoutPs, [
    'node-script needs ps at /bin/ps or /usr/bin/ps to check that the debugged process is the process it started.',
  ])
  assert.deepEqual(onWindows, [
    'node-script needs macOS, Linux or WSL; native Windows is not supported yet.',
  ])
})

// protects=the environment reports profiles['node-script'] ready on a ready machine, names a machine gap, and names a missing Node; fails_when=the profile is missing from the readiness, a gap does not reach it, or a missing Node is hidden; no_claim=the real lsof or ps (the machine check is stubbed here and tested above)
test('the environment reports node-script readiness for a ready machine, a missing ps and a missing Node', async (context) => {
  // Arrange
  const ready = await createEnvironmentWith(context, { gaps: [] })
  const missingPs = await createEnvironmentWith(context, {
    gaps: ['node-script needs ps.'],
  })
  const missingNode = await createEnvironmentWith(context, {
    gaps: [],
    nodeUnavailable: true,
  })
  // Act
  const readyProfile = (await ready.environment.prerequisites()).profiles?.[
    'node-script'
  ]
  const psProfile = (await missingPs.environment.prerequisites()).profiles?.[
    'node-script'
  ]
  const nodeProfile = (await missingNode.environment.prerequisites())
    .profiles?.['node-script']
  // Assert
  assert.deepEqual(
    { ready: readyProfile?.ready, missing: [...(readyProfile?.missing ?? [])] },
    { ready: true, missing: [] },
  )
  assert.deepEqual(
    { ready: psProfile?.ready, missing: [...(psProfile?.missing ?? [])] },
    { ready: false, missing: ['node-script needs ps.'] },
  )
  assert.equal(nodeProfile?.ready, false)
  assert.deepEqual(
    [...(nodeProfile?.missing ?? [])],
    ['codebook.nodeExecutable: configure an executable external Node.js >=24.'],
  )
})

// protects=a root package.json whose packageManager is an object (JSON allows it) or a failing status read leaves node-script ready and every other profile reported; fails_when=prerequisites() throws or node-script turns not ready because of the package manager text; no_claim=that the library route accepts such a repository
test('a hostile packageManager field or a failing status read never fails the readiness report', async (context) => {
  // Arrange
  const hostile = await createEnvironmentWith(context, { gaps: [] })
  await writeFile(
    join(hostile.directory, 'package.json'),
    '{"packageManager":{"toString":null}}',
  )
  const failing = await createEnvironmentWith(context, {
    gaps: [],
    packageManagerStatusFails: true,
  })
  // Act
  const hostileProfile = (await hostile.environment.prerequisites()).profiles?.[
    'node-script'
  ]
  const failingProfile = (await failing.environment.prerequisites()).profiles?.[
    'node-script'
  ]
  // Assert
  assert.equal(hostileProfile?.ready, true)
  assert.deepEqual(hostileProfile?.repositoryPackageManager, {
    found: false,
    reason: 'unsupported',
    packageManager: 'object',
  })
  assert.equal(failingProfile?.ready, true)
  assert.equal(failingProfile?.repositoryPackageManager, undefined)
})

// protects=the three samples of the node-script help are complete configurations that parse with the live schema once their placeholders are replaced; fails_when=a sample stops parsing, or one loses its shape (ES module entry, CommonJS entry with a stop in a required file, package root below the root); no_claim=that the sample lines run in any repository
test('the node-script help samples parse with the live schema once their placeholders are replaced', async () => {
  // Arrange
  const help = await servedHelp()
  // Act
  const outcomes = Object.entries(help.samples).map(([name, sample]) => {
    const start = filled(sample) as {
      profile: string
      configuration: Record<string, unknown>
    }
    const additionalStops = start.configuration['additionalStops']
    return {
      name,
      profile: start.profile,
      success: nodeScriptConfigSchema.safeParse(start.configuration).success,
      entry: start.configuration['entry'],
      packageRoot: start.configuration['packageRoot'],
      additionalStops: Array.isArray(additionalStops)
        ? additionalStops.length
        : 0,
    }
  })
  // Assert
  assert.deepEqual(outcomes, [
    {
      name: 'esModuleEntry',
      profile: 'node-script',
      success: true,
      entry: 'scripts/check.mjs',
      packageRoot: undefined,
      additionalStops: 0,
    },
    {
      name: 'commonJsEntryWithRequiredFileStop',
      profile: 'node-script',
      success: true,
      entry: 'scripts/check.cjs',
      packageRoot: undefined,
      additionalStops: 1,
    },
    {
      name: 'packageRootBelowTheRoot',
      profile: 'node-script',
      success: true,
      entry: 'run.mjs',
      packageRoot: 'examples/tool',
      additionalStops: 0,
    },
  ])
})

// protects=the walkthrough orders status, help, sources, publish, the learner's confirmation, start, the pause loop, stop and save, and the limits state the 60 s running time, the shared deadline and pause hold, 16 captures and package-source-only stops; fails_when=a step moves or leaves, or a limit changes without the help; no_claim=how a chat follows it
test('the node-script help walks from status to save and states its limits', async () => {
  // Arrange
  const help = await servedHelp()
  // Act
  const steps = help.walkthrough.map((step) => step.split(/[:,. ]/)[0])
  // Assert
  assert.equal(NODE_SCRIPT_RUN_TIMEOUT_MS, 60_000)
  assert.deepEqual(steps, [
    'codebook_status',
    'codebook',
    'codebook_sources',
    'codebook_publish_book',
    'Tell',
    'codebook_start',
    'Read',
    'At',
    'codebook_stop',
    'Save',
  ])
  assert.ok(
    help.walkthrough[4]?.includes(
      'the editor asks them to confirm one run, which does whatever the script does',
    ),
  )
  assert.ok(
    help.limits[1]?.startsWith(
      "The script's running time outside pauses is bounded at 60 s; pauses do not count. The shared run deadline is 600 s (pauses count) and a pause longer than 300 s ends the run (PAUSE_HOLD_EXPIRED)",
    ),
  )
  assert.ok(help.limits[2]?.endsWith('and 16 captured pauses per run.'))
  assert.ok(help.limits[0]?.includes('no node_modules'))
})

// protects=the help names the end fields, the precedence rule, the nonzero-exit rule, the script selection rule and the secrets statement; fails_when=an end field, the precedence or the selection rule leaves the help; no_claim=the end the run reports (the run tests)
test('the node-script help states the end fields, their precedence and the script selection rule', async () => {
  // Arrange
  const text = JSON.stringify(await servedHelp())
  // Act / Assert
  for (const phrase of [
    'exitUnknown',
    'captureBudgetExhausted',
    'stopsNotObserved',
    'exit-deadline',
    'A cause Codebook started (a stop, a limit) names the end over the signal it sent.',
    'A nonzero exit is an observed end, not an error',
    'the restricted environment passes no secrets',
    'exactly `node <file>` (or `tsx <file>` through the repository',
    'several commands (`&&`, `;`) cannot run as declared',
  ])
    assert.ok(text.includes(phrase), phrase)
})

// protects=each code of the node-script help has an anchor and the recovery ERROR_RECOVERY holds, and the two new codes end their recovery with their own anchor and name their escalation; fails_when=an anchor or recovery drifts, tsx-missing loses its escalation, or the chat can answer the confirmation; no_claim=that a run raises the codes
test('the node-script help has an anchor and recovery for each code, and the new codes name their escalation', async () => {
  // Arrange
  const help = await servedHelp()
  // Act
  const refused = ERROR_RECOVERY.NODE_SCRIPT_SOURCE_REFUSED
  const notConfirmed = ERROR_RECOVERY.SCRIPT_NOT_CONFIRMED
  // Assert
  assert.deepEqual(
    help.codes.map(({ code, anchor }) => [code, anchor]),
    [
      'NODE_SCRIPT_SOURCE_REFUSED',
      'INVALID_CONFIGURATION',
      'BUSY',
      'SCRIPT_NOT_CONFIRMED',
      'SOURCE_CHANGED',
      'NO_PAUSE',
      'LEARNER_PAUSED',
      'PAUSE_HOLD_EXPIRED',
      'RUNTIME_FAILED',
      'LIBRARY_BUILD_UNSUPPORTED',
      'LIBRARY_BUILD_FAILED',
    ].map((code) => [code, `codebook://help/node-script#${code}`]),
  )
  assert.equal(help.codes[0]?.recovery, refused)
  assert.equal(help.codes[1]?.recovery, ERROR_RECOVERY.INVALID_CONFIGURATION)
  assert.equal(help.codes[2]?.recovery, ERROR_RECOVERY.BUSY)
  assert.equal(help.codes[3]?.recovery, notConfirmed)
  assert.ok(!JSON.stringify(help).includes('loader-mismatch'))
  assert.ok(
    refused.endsWith(
      'See codebook://help/node-script#NODE_SCRIPT_SOURCE_REFUSED.',
    ),
  )
  assert.ok(
    refused.includes(
      "ask the learner to add tsx with the repository's own package manager, or choose a JavaScript entry; the chat never installs it",
    ),
  )
  assert.ok(
    refused.includes(
      "a published package under node_modules is not the checked-out library; put the stops in the package's own source",
    ),
  )
  assert.ok(
    notConfirmed.endsWith(
      'See codebook://help/node-script#SCRIPT_NOT_CONFIRMED.',
    ),
  )
  assert.ok(
    notConfirmed.includes(
      "Nothing was spawned (sideEffects none). Start again with a new key only if the learner asks, at most once more; the learner confirms in the editor's dialog, never the chat.",
    ),
  )
})

// protects=API 1.26 is served with a 1.26 note that names the profile, its readiness, both codes and the Script replay, and the history folder stays separate from node-servers.v1; fails_when=the version, the note or the folder name drifts; no_claim=that an older Codebook ignores the folder
test('API 1.26 is served with a note for the additive node-script profile', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.26 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.44')
  assert.equal(NODE_SCRIPT_HISTORY_DIRECTORY, 'node-scripts.v1')
  for (const phrase of [
    '`node-script` profile',
    "profiles['node-script']",
    'no listener tool',
    '`NODE_SCRIPT_SOURCE_REFUSED`',
    '`SCRIPT_NOT_CONFIRMED`',
    'exit-deadline',
    'Script replay',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// protects=the MCP instructions name node-script, its help, the learner's confirmation, the nonzero-exit rule and the API 1.26 gate with an update instruction for older ones; fails_when=the profile or the gate sentence leaves the instructions; no_claim=how a chat follows them
test('the MCP instructions name node-script, its confirmation and the API 1.26 gate', async () => {
  // Arrange
  const protocol = await readPackaged('src/protocol.ts')
  // Act / Assert
  for (const phrase of [
    'node-script (since API 1.26) uses codebook://help/node-script',
    'after the learner confirms that run in the editor',
    'a nonzero exit is the script failing, an observed end',
    'use it on API 1.26 or later, and on an older API tell the learner to update Codebook',
    "'codebook://help/node-script'",
  ])
    assert.ok(protocol.includes(phrase), phrase)
})

// protects=skill 1.0.78 routes a question about a repository's own Node script to node-script behind the API 1.26 gate, tells the learner about the confirmation and side effects first, treats a nonzero exit as the script failing, stops after two same-code failures and saves a Script replay only on complete coverage; fails_when=one of these sentences or the version leaves the skill, or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.78 routes a Node script question to node-script with its confirmation and save rules', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.97"\n'))
  for (const phrase of [
    '**Script runs (API 1.26).**',
    'uses the `node-script` profile, only when `codebook_status` lists it and reports API 1.26 or later',
    'on an older API tell the learner to update Codebook',
    'follow its script selection rule',
    'the editor will ask them to confirm one run that does whatever the script does',
    'never repeat a secret they show',
    'A nonzero exit is the script failing, not a Codebook error',
    "`Cannot find module` means the package's own install is missing",
    'labeled as observed output',
    'After two starts that fail with the same error `code`, stop starting',
    '**Saving a script run.**',
    'Say a Script replay is saved only when the run resource reads `nodeScript.learningCoverage` `complete` and an empty `nodeScript.captureMissing`',
    'Read `nodeScript.history` and `nodeScript.historyIssue` on the run resource',
    'at `nodeScript.historyUri`',
    'First check that `codebook_status` reports API 1.26 or later (compare the number after the dot as a whole number: 1.30 is later than 1.26)',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.equal(/redux|toolkit/i.test(skill), false)
})

// protects=the README tells a learner that one run of the repository's own script needs their confirmation, pauses in the package's own source, reports its end and saves as a Script replay; fails_when=a sentence for the CHANGELOG entry leaves the README; no_claim=native behavior
test('the README documents the Node script run, its confirmation, its end and its Script replay', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    '## Run a Node script',
    'the editor asks you to confirm one run of the script',
    'it may change files, databases or remote services',
    "At stops the chat declares in the package's own source",
    'A nonzero exit is the script failing, not a Codebook error',
    'saved through `codebook_explain_node_history` as a Script replay',
    'with **MCP API 1.44**',
    '`SCRIPT_NOT_CONFIRMED`',
    "so Cursor's managed skill updates to **1.0.97**",
  ])
    assert.ok(readme.includes(phrase), phrase)
})
