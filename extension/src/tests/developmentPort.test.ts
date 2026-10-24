import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { StudyError } from '../errors'
import {
  assertDevelopmentPortFree,
  type ConnectLoopback,
} from '../utils/assertDevelopmentPortFree'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  ownedDevelopmentPortState,
  releaseOwnedDevelopmentPort,
} from '../utils/ownedDevelopmentPorts'
import { readDeclaredDevelopmentPort } from '../utils/readDeclaredDevelopmentPort'

/** Makes a project folder with the given files, runs the check and removes the folder. */
async function declaredPortOf(
  files: Record<string, string>,
  platform: NodeJS.Platform = 'linux',
) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-port-'))
  try {
    for (const [name, text] of Object.entries(files))
      await writeFile(join(root, name), text)
    return await readDeclaredDevelopmentPort(root, platform)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Makes a folder tree from relative file paths (a path ending in `/` makes an empty folder), reads the port of the folder `opened` inside it and removes the tree. */
async function declaredPortOfTree(
  files: Record<string, string>,
  opened: string,
  platform: NodeJS.Platform = 'linux',
) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-port-tree-'))
  try {
    for (const [name, text] of Object.entries(files)) {
      if (name.endsWith('/')) {
        await mkdir(join(root, name), { recursive: true })
        continue
      }
      await mkdir(dirname(join(root, name)), { recursive: true })
      await writeFile(join(root, name), text)
    }
    return await readDeclaredDevelopmentPort(join(root, opened), platform)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const devScript = (script: string): string =>
  JSON.stringify({ scripts: { dev: script } })

const UNREAD_NOTE =
  "Next's default port, taken because the dev script has a form Codebook does not read"

/** What `applicationPortSource` says when the dev script has a form the reader does not read (D72). */
const UNREAD_SOURCE = (segment: string): string =>
  `${UNREAD_NOTE}: "${segment}"`

/** A package.json with the given scripts. */
const packageScripts = (scripts: Record<string, string>): string =>
  JSON.stringify({ scripts })

// Value: protects=the app starts on the port the dev script declares, in each flag form of the grammar (D72), the last -p/--port winning; fails_when=a form is ignored or misread and the app moves to another port than the one AUTH_URL names; why_new=F411 (N50) started every run on an ephemeral port, F452 the last flag, D72 the grammar; seam=temporary project folders; no_claim=that Next accepts every form itself
for (const [script, port] of [
  ['next dev --turbo -p 3165', 3165],
  ['next dev --port 4100', 4100],
  ['next dev --port=4300', 4300],
  ['next dev -p4400 --turbo', 4400],
  ['next dev -p "4413"', 4413],
  ['next dev -p 4140 -p 4141', 4141],
  ['next dev --port 4142 -p4143', 4143],
  ['next dev -p 4144 --port=4145 --turbopack', 4145],
  ['next dev -H 0.0.0.0 --webpack -p 4146', 4146],
  [
    'next dev --experimental-https --experimental-https-key ./k.pem --experimental-https-cert=./c.pem -p 4147',
    4147,
  ],
] as const)
  test(`the dev script "${script}" declares port ${port}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port,
      source: 'the dev script in package.json',
    })
  })

// Value: protects=the port is the one the project's own `next dev` would use, through each launcher, prefix, separator, delegation and concurrently form of the grammar (D72 rule 1; F421, F430, F451); fails_when=a form of the grammar is misread and the app starts on another port than the project's AUTH_URL names; why_new=D72 replaces the deny-list reader; seam=temporary project folders; no_claim=Next honoring PORT itself
for (const [name, scripts, expected] of [
  [
    'an env prefix',
    { dev: 'PORT=4401 next dev' },
    { port: 4401, assignment: true },
  ],
  [
    'cross-env',
    { dev: 'cross-env NODE_ENV=x PORT=4402 next dev --turbo' },
    { port: 4402, assignment: true },
  ],
  [
    'env with assignments',
    { dev: 'env A=1 PORT=4403 next dev' },
    { port: 4403, assignment: true },
  ],
  [
    'an export before the chain',
    { dev: 'export PORT=4404 && next dev' },
    { port: 4404, assignment: true },
  ],
  [
    'a semicolon after an export',
    { dev: 'export PORT=4405; next dev' },
    { port: 4405, assignment: true },
  ],
  [
    'the last export',
    { dev: 'export PORT=4406; export PORT=4407; next dev' },
    { port: 4407, assignment: true },
  ],
  [
    'a flag over the prefix',
    { dev: 'PORT=4408 next dev -p 4409' },
    { port: 4409, assignment: false },
  ],
  [
    'a harmless variable beside the command',
    { dev: 'NODE_ENV=development next dev -p 4410' },
    { port: 4410, assignment: false },
  ],
  ['npx', { dev: 'npx next dev --port 4415' }, { port: 4415 }],
  ['bunx', { dev: 'bunx next dev -p 4114' }, { port: 4114 }],
  ['pnpm exec', { dev: 'pnpm exec next dev -p 4416' }, { port: 4416 }],
  ['yarn next', { dev: 'yarn next dev -p 4112' }, { port: 4112 }],
  [
    'a node_modules/.bin path',
    { dev: './node_modules/.bin/next dev -p 4104' },
    { port: 4104 },
  ],
  [
    'two statements before next dev',
    { dev: 'A=1 && B=2; next dev -p 4419' },
    { port: 4419 },
  ],
  [
    'concurrently with one next dev',
    { dev: 'concurrently "next dev -p 4414" "A=1 && B=2"' },
    { port: 4414 },
  ],
  [
    'concurrently around a delegation',
    {
      dev: "concurrently 'npm run web' 'A=1 && B=2'",
      web: 'next dev -p 4117',
    },
    { port: 4117, delegate: 'web' },
  ],
  [
    'npm run',
    { dev: 'npm run web', web: 'next dev -p 4406' },
    { port: 4406, delegate: 'web' },
  ],
  [
    'npm run-script',
    { dev: 'npm run-script web', web: 'next dev -p 4418' },
    { port: 4418, delegate: 'web' },
  ],
  [
    'pnpm run',
    { dev: 'pnpm run web', web: 'next dev -p 4407' },
    { port: 4407, delegate: 'web' },
  ],
  [
    'pnpm name',
    { dev: 'pnpm web', web: 'PORT=4408 next dev' },
    { port: 4408, delegate: 'web', assignment: true },
  ],
  [
    'yarn name',
    { dev: 'yarn web', web: 'next dev --port=4409' },
    { port: 4409, delegate: 'web' },
  ],
  [
    'yarn run',
    { dev: 'yarn run web', web: 'next dev -p 4121' },
    { port: 4121, delegate: 'web' },
  ],
  [
    'bun run',
    { dev: 'bun run web', web: 'next dev -p 4422' },
    { port: 4422, delegate: 'web' },
  ],
  [
    'an assignment before a delegation',
    { dev: 'PORT=4423 pnpm web', web: 'next dev' },
    { port: 4423, delegate: 'web', assignment: true },
  ],
  [
    'an export before a delegation',
    { dev: 'export PORT=4424 && npm run web', web: 'next dev' },
    { port: 4424, delegate: 'web', assignment: true },
  ],
  [
    'cross-env before a delegation',
    { dev: 'cross-env PORT=4425 npm run web', web: 'next dev' },
    { port: 4425, delegate: 'web', assignment: true },
  ],
  [
    'a delegated script that assigns its own',
    { dev: 'PORT=4426 pnpm web', web: 'PORT=4427 next dev' },
    { port: 4427, delegate: 'web', assignment: true },
  ],
  [
    'a delegation through two scripts',
    { dev: 'npm run a', a: 'npm run b', b: 'next dev -p 4119' },
    { port: 4119, delegate: 'b' },
  ],
  [
    'a script name that contains next',
    { dev: 'npm run dev:next', 'dev:next': 'next dev -p 4428' },
    { port: 4428, delegate: 'dev:next' },
  ],
] as const)
  test(`the dev script declares its port through ${name}`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }
    const where =
      'delegate' in expected
        ? `the "${expected.delegate}" script that the dev script runs in package.json`
        : 'the dev script in package.json'

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port: expected.port,
      source:
        'assignment' in expected && expected.assignment
          ? `a PORT assignment in ${where}`
          : where,
    })
  })

const BUN_ENV_NOTE =
  "Next's default port, taken because Bun loads .env files into the dev script's environment and a PORT there can decide the port when no -p/--port flag is given"

// Value: protects=a `next dev` without a port flag that Bun runs (through `bun run <script>`, or in a repository with a Bun lockfile) being unread with a note naming Bun's .env loading, so the reader never reports 3000 for an app that starts on a .env PORT (F499); fails_when=the reader reports Next's default 3000 with the plain source, or the unread note does not name Bun's .env loading; why_new=F499 (CodeRabbit CLI major of the review of 673b2923..7fc7c8fb: Bun loads .env files into a script's environment before next starts); seam=temporary project folders with and without a Bun lockfile; no_claim=that Bun's .env loading is observed here (the file content is never read)
for (const [name, files, segment] of [
  [
    'bun run delegating to next dev',
    { 'package.json': packageScripts({ dev: 'bun run web', web: 'next dev' }) },
    'next dev',
  ],
  [
    'bun run through another delegation',
    {
      'package.json': packageScripts({
        dev: 'bun run a',
        a: 'pnpm run b',
        b: 'next dev --turbo',
      }),
    },
    'next dev --turbo',
  ],
  [
    'next dev in a repository with bun.lock',
    { 'package.json': devScript('next dev'), 'bun.lock': '' },
    'next dev',
  ],
  [
    'next dev in a repository with bun.lockb',
    { 'package.json': devScript('next dev --webpack'), 'bun.lockb': '' },
    'next dev --webpack',
  ],
  [
    'a delegation to next dev in a repository with bun.lock',
    {
      'package.json': packageScripts({ dev: 'npm run web', web: 'next dev' }),
      'bun.lock': '',
    },
    'next dev',
  ],
] as const)
  test(`${name} without a port flag is unread and names Bun's .env loading`, async () => {
    // Arrange: the files above

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source: `${BUN_ENV_NOTE}: "${segment}"`,
    })
  })

// Value: protects=a port the script itself declares (a -p/--port flag, or a PORT assigned in the script) still being read when Bun runs it, and a Bun-free project's plain next dev still taking 3000 without a note (F499); fails_when=the Bun rule makes a declared port unread, or marks a project without Bun; why_new=F499; seam=temporary project folders with and without a Bun lockfile; no_claim=that Bun's .env loading is observed here
for (const [name, files, expected] of [
  [
    'bun run with a port flag',
    {
      'package.json': packageScripts({
        dev: 'bun run web',
        web: 'next dev -p 4611',
      }),
    },
    {
      port: 4611,
      source: 'the "web" script that the dev script runs in package.json',
    },
  ],
  [
    'bun.lock with a long port flag',
    { 'package.json': devScript('next dev --port=4612'), 'bun.lock': '' },
    { port: 4612, source: 'the dev script in package.json' },
  ],
  [
    'bun.lockb with a short port flag',
    { 'package.json': devScript('next dev -p4613'), 'bun.lockb': '' },
    { port: 4613, source: 'the dev script in package.json' },
  ],
  [
    'bun run with a PORT assigned before it',
    {
      'package.json': packageScripts({
        dev: 'PORT=4614 bun run web',
        web: 'next dev',
      }),
    },
    {
      port: 4614,
      source:
        'a PORT assignment in the "web" script that the dev script runs in package.json',
    },
  ],
  [
    'a plain next dev with no lockfile',
    { 'package.json': devScript('next dev') },
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a delegation without bun and without a lockfile',
    {
      'package.json': packageScripts({ dev: 'pnpm web', web: 'next dev' }),
      'pnpm-lock.yaml': '',
    },
    { port: 3000, source: "Next's default port" },
  ],
] as const)
  test(`${name} is read as declared`, async () => {
    // Arrange: the files above

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, expected)
  })

const CMD_NOTE =
  "Next's default port, taken because npm runs the dev script with cmd on Windows, where this form (single quotes, a PORT= or NAME= prefix, export, env, ;, a PORT variable written in another case, or a program written as a path with /) does not mean what it means in sh"

// Value: protects=on Windows, where npm, pnpm and yarn run the script with cmd, the forms whose meaning differs from sh (single quotes, PORT=/NAME= prefixes, export, env, `;`) are unread with a note naming cmd, in the script and in a script it delegates to (F502, D74); fails_when=the reader asserts a port that cmd would never pass to next, or the note does not name cmd; why_new=F502 (OCR low, to verify on Windows, of the review of 673b2923..7fc7c8fb); seam=temporary project folders with the platform set to win32, so the Windows rows run on any host; no_claim=what a real cmd does (not run here)
for (const [name, scripts, segment] of [
  ['a PORT prefix', { dev: 'PORT=4801 next dev' }, 'PORT=… next dev'],
  [
    'a NAME prefix',
    { dev: 'NODE_ENV=x next dev -p 4802' },
    'NODE_ENV=… next dev -p …',
  ],
  ['an export', { dev: 'export PORT=4803 && next dev' }, 'export PORT=…'],
  ['an env prefix', { dev: 'env PORT=4804 next dev' }, 'env PORT=… next dev'],
  ['a semicolon', { dev: 'next dev -p 4805; next dev' }, 'next dev -p …'],
  ['a single-quoted value', { dev: "next dev -p '4806'" }, 'next dev -p'],
  [
    'a prefix in a delegated script',
    { dev: 'npm run web', web: 'PORT=4807 next dev' },
    'PORT=… next dev',
  ],
] as const)
  test(`on Windows ${name} is unread and the note names cmd`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files, 'win32')

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source: `${CMD_NOTE}: "${segment}"`,
    })
  })

// Value: protects=the forms whose cmd meaning is the same as sh (next dev with literal flags, cross-env, delegations, a double-quoted concurrently) still being read on Windows, and the same scripts that cmd would misread still being read on macOS and Linux (F502, D74); fails_when=the Windows rule unreads a form that means the same under cmd, or leaks into sh; why_new=F502; seam=temporary project folders with the platform set to win32 and linux; no_claim=what a real cmd does (not run here)
for (const [name, scripts, platform, expected] of [
  ['a port flag', { dev: 'next dev -p 4811' }, 'win32', 4811],
  [
    'cross-env',
    { dev: 'cross-env NODE_ENV=x PORT=4812 next dev' },
    'win32',
    4812,
  ],
  [
    'a delegation',
    { dev: 'npm run web', web: 'next dev --port=4813' },
    'win32',
    4813,
  ],
  [
    'cross-env before a delegation',
    { dev: 'cross-env PORT=4814 npm run web', web: 'next dev' },
    'win32',
    4814,
  ],
  [
    'a double-quoted concurrently',
    { dev: 'concurrently "next dev -p 4815"' },
    'win32',
    4815,
  ],
  ['a PORT prefix on macOS', { dev: 'PORT=4816 next dev' }, 'darwin', 4816],
  [
    'an export and a semicolon on Linux',
    { dev: 'export PORT=4817; next dev' },
    'linux',
    4817,
  ],
  [
    'a single-quoted value on macOS',
    { dev: "next dev -p '4818'" },
    'darwin',
    4818,
  ],
] as const)
  test(`${name} on ${platform} is read as port ${expected}`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files, platform)

    // Assert
    assert.equal(declared.port, expected)
    assert.ok(!declared.source.includes('cmd'), declared.source)
  })

// Value: protects=a script name that the package manager's own command shadows (pnpm info, yarn workspaces, pnpm install) is no delegation, while pnpm run <name> still is, and yarn next with a script named next is no launcher (F500, F506); fails_when=the reader follows a script a builtin shadows and reports its port; why_new=F500 (pnpm 12.14 runs the builtin); seam=temporary project folders; no_claim=the package manager itself
for (const [name, scripts] of [
  ['pnpm info', { dev: 'pnpm info', info: 'next dev -p 4821' }],
  ['pnpm env', { dev: 'pnpm env', env: 'next dev -p 4822' }],
  ['pnpm audit', { dev: 'pnpm audit', audit: 'next dev -p 4823' }],
  ['pnpm outdated', { dev: 'pnpm outdated', outdated: 'next dev -p 4824' }],
  ['pnpm root', { dev: 'pnpm root', root: 'next dev -p 4825' }],
  ['pnpm version', { dev: 'pnpm version', version: 'next dev -p 4826' }],
  ['yarn info', { dev: 'yarn info', info: 'next dev -p 4827' }],
  [
    'yarn workspaces',
    { dev: 'yarn workspaces', workspaces: 'next dev -p 4828' },
  ],
  ['pnpm install', { dev: 'pnpm install', install: 'next dev -p 4829' }],
  [
    'yarn next with a script named next',
    { dev: 'yarn next dev -p 4830', next: 'echo' },
  ],
] as const)
  test(`${name} with a script of that name is unread and takes Next's default 3000`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, 3000)
    assert.ok(declared.source.startsWith(`${UNREAD_NOTE}: "`), declared.source)
  })

const BUN_SHELL_NOTE =
  "Next's default port, taken because on Windows Bun runs scripts with its own shell, or with cmd when run.shell is set to system in bunfig.toml, so the form can mean different things"

// Value: protects=a name that pnpm or yarn can run as its own command in some version (rebuild since pnpm 11) staying unread, and a Windows `bun run` of a PORT= prefix staying unread, because the same text means different things by version or Bun setting (D75, F508, F509); fails_when=the reader follows pnpm rebuild or bun run on Windows and asserts a port the project's command may not use; why_new=F508 and F509 (CodeRabbit CLI minor x2), regression guards that pass on the previous head; seam=temporary project folders, platform win32 for Bun; no_claim=the installed pnpm version or Bun configuration
for (const [name, scripts, platform, segment, note] of [
  [
    'pnpm rebuild with a script named rebuild',
    { dev: 'pnpm rebuild', rebuild: 'next dev -p 4000' },
    'linux',
    'pnpm rebuild',
    UNREAD_NOTE,
  ],
  [
    'bun run of a PORT prefix on Windows',
    { dev: 'bun run serve', serve: 'PORT=4000 next dev' },
    'win32',
    'bun run serve',
    BUN_SHELL_NOTE,
  ],
] as const)
  test(`${name} is unread and takes Next's default 3000`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files, platform)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: `${note}: "${segment}"` })
  })

// Value: protects=pnpm <name> and yarn <name> without run being followed only for dev, start, serve, web, app, client, frontend and a name with a colon, and every package-manager command or alias (deploy, t, ci, access) staying unread even when the project has a script of that name (D76, F510); fails_when=the reader follows a name that pnpm 12 or yarn runs as a builtin and reports the port of a script nothing runs; why_new=F510 (OCR medium: about 60 pnpm 12 builtins were missing from the deny-list); seam=temporary project folders; no_claim=the installed package managers (the real-shell table runs the followed names)
for (const [name, scripts, segment] of [
  [
    'pnpm deploy',
    { dev: 'pnpm deploy', deploy: 'next dev -p 5000' },
    'pnpm deploy',
  ],
  ['pnpm t', { dev: 'pnpm t', t: 'next dev -p 5001' }, 'pnpm t'],
  ['pnpm ci', { dev: 'pnpm ci', ci: 'next dev -p 5002' }, 'pnpm ci'],
  [
    'yarn access',
    { dev: 'yarn access', access: 'next dev -p 5003' },
    'yarn access',
  ],
  ['pnpm docs', { dev: 'pnpm docs', docs: 'next dev -p 5004' }, 'pnpm docs'],
  [
    'yarn stage',
    { dev: 'yarn stage', stage: 'next dev -p 5005' },
    'yarn stage',
  ],
  ['a script that is missing', { dev: 'pnpm web' }, 'pnpm …'],
] as const)
  test(`${name} is unread and takes Next's default 3000`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source: UNREAD_SOURCE(segment),
    })
  })

// Value: protects=the names pnpm and yarn run as scripts (dev, start, serve, web, app, client, frontend, a colon name) being read without run, and pnpm run / yarn run being read for a package-manager command's name (D76, F510); fails_when=the allow-list loses a name or run stops following builtin names; why_new=F510; seam=temporary project folders; no_claim=the installed package managers (checked with pnpm 12.14.0 and yarn 1.22.22 in the task ledger)
for (const [name, scripts, port] of [
  ['pnpm start', { dev: 'pnpm start', start: 'next dev -p 5011' }, 5011],
  ['pnpm serve', { dev: 'pnpm serve', serve: 'next dev -p 5012' }, 5012],
  ['pnpm web', { dev: 'pnpm web', web: 'next dev -p 5013' }, 5013],
  ['pnpm app', { dev: 'pnpm app', app: 'next dev -p 5014' }, 5014],
  ['pnpm client', { dev: 'pnpm client', client: 'next dev -p 5015' }, 5015],
  [
    'pnpm frontend',
    { dev: 'pnpm frontend', frontend: 'next dev -p 5016' },
    5016,
  ],
  [
    'pnpm with a colon name',
    { dev: 'pnpm dev:web', 'dev:web': 'next dev -p 5017' },
    5017,
  ],
  [
    'yarn with a colon name',
    { dev: 'yarn build:dev', 'build:dev': 'next dev -p 5018' },
    5018,
  ],
  ['yarn app', { dev: 'yarn app', app: 'next dev -p 5019' }, 5019],
  [
    'pnpm run deploy',
    { dev: 'pnpm run deploy', deploy: 'next dev -p 5020' },
    5020,
  ],
  [
    'yarn run access',
    { dev: 'yarn run access', access: 'next dev -p 5021' },
    5021,
  ],
] as const)
  test(`${name} reads the script of that name`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, port)
  })

// Value: protects=an empty or blank dev script saying that it is empty and never quoting an empty text (F511); fails_when=the source quotes "" or does not say the script is empty; why_new=F511 (OCR low, against F503); seam=temporary project folders; no_claim=other empty statements (quoted by the statement before them)
for (const [name, script] of [
  ['an empty string', ''],
  ['blanks', '   '],
  ['a tab and a line break', '\t\n'],
] as const)
  test(`a dev script of ${name} says the dev script is empty`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source:
        "Next's default port, taken because the dev script in package.json is empty",
    })
  })

// Value: protects=on Windows, where environment names ignore case, an assignment of port in another case being unread with the cmd note, and being an ordinary variable on Linux (F512); fails_when=cross-env port=4000 next dev reads Next's default 3000 with no note on Windows; why_new=F512 (OCR low, D74); seam=temporary project folders with the platform set; no_claim=what a real cmd or cross-env does
for (const [name, script, platform, source] of [
  [
    'a lower-case port after cross-env',
    'cross-env port=4000 next dev',
    'win32',
    `${CMD_NOTE}: "cross-env port=… next dev"`,
  ],
  [
    'a mixed-case Port after PORT',
    'cross-env PORT=4001 Port=4002 next dev',
    'win32',
    `${CMD_NOTE}: "cross-env PORT=… Port=… next dev"`,
  ],
  [
    'a lower-case port on Linux',
    'cross-env port=4000 next dev',
    'linux',
    "Next's default port",
  ],
] as const)
  test(`${name} on ${platform} reads Next's default 3000 with source ${source}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files, platform)

    // Assert
    assert.deepEqual(declared, { port: 3000, source })
  })

// Value: protects=on Windows only bare next and the npx-style launchers being read, and a program written as a path with / being unread with the cmd note, while macOS and Linux still read the path (F513); fails_when=the reader asserts a port for a path cmd cannot run; why_new=F513 (OCR low); seam=temporary project folders with the platform set; no_claim=what a real cmd does
for (const [name, script, platform, expected] of [
  [
    'a node_modules path',
    'node_modules/.bin/next dev -p 4000',
    'win32',
    { port: 3000, source: `${CMD_NOTE}: "next dev -p …"` },
  ],
  [
    'a ./node_modules path',
    './node_modules/.bin/next dev -p 4000',
    'win32',
    { port: 3000, source: `${CMD_NOTE}: "next dev -p …"` },
  ],
  [
    'bare next',
    'next dev -p 4861',
    'win32',
    { port: 4861, source: 'the dev script in package.json' },
  ],
  [
    'npx next',
    'npx next dev -p 4862',
    'win32',
    { port: 4862, source: 'the dev script in package.json' },
  ],
  [
    'a node_modules path on Linux',
    'node_modules/.bin/next dev -p 4863',
    'linux',
    { port: 4863, source: 'the dev script in package.json' },
  ],
] as const)
  test(`${name} on ${platform} gives port ${expected.port}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files, platform)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a Bun project being found by a lockfile in a folder above the opened one up to the Git root and by packageManager bun@, a lockfile beyond the Git root not counting, and a Bun project on Windows being unread with the Bun shell note (D75, F514); fails_when=a monorepo with bun.lock at its root or a bun@ packageManager reads a plain next dev without the Bun note, or Windows gives the cmd note for Bun; why_new=F514 (OCR low, F499's fix); seam=temporary folder trees with a .git folder, platform set; no_claim=Bun itself
for (const [name, files, opened, platform, expected] of [
  [
    'a bun.lock at the Git root above the opened folder',
    {
      '.git/': '',
      'bun.lock': '',
      'apps/web/package.json': devScript('next dev'),
    },
    'apps/web',
    'linux',
    { port: 3000, source: `${BUN_ENV_NOTE}: "next dev"` },
  ],
  [
    'a bun.lockb in a folder between the opened one and the Git root',
    {
      '.git/': '',
      'apps/bun.lockb': '',
      'apps/web/package.json': devScript('next dev'),
    },
    'apps/web',
    'linux',
    { port: 3000, source: `${BUN_ENV_NOTE}: "next dev"` },
  ],
  [
    'a bun.lock above the Git root',
    {
      'bun.lock': '',
      'repo/.git/': '',
      'repo/package.json': devScript('next dev'),
    },
    'repo',
    'linux',
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a Git file instead of a folder as the Git root',
    {
      'bun.lock': '',
      'repo/.git': 'gitdir: ../elsewhere',
      'repo/web/package.json': devScript('next dev'),
    },
    'repo/web',
    'linux',
    { port: 3000, source: "Next's default port" },
  ],
  [
    'packageManager bun@ with no lockfile',
    {
      'package.json': JSON.stringify({
        packageManager: 'bun@1.2.0',
        scripts: { dev: 'next dev' },
      }),
    },
    '.',
    'linux',
    { port: 3000, source: `${BUN_ENV_NOTE}: "next dev"` },
  ],
  [
    'packageManager pnpm@ with no lockfile',
    {
      'package.json': JSON.stringify({
        packageManager: 'pnpm@9.0.0',
        scripts: { dev: 'next dev' },
      }),
    },
    '.',
    'linux',
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a Bun project on Windows with a plain script',
    {
      'bun.lock': '',
      'package.json': devScript('next dev -p 4871'),
    },
    '.',
    'win32',
    { port: 3000, source: `${BUN_SHELL_NOTE}: "next dev -p …"` },
  ],
  [
    'packageManager bun@ on Windows',
    {
      'package.json': JSON.stringify({
        packageManager: 'bun@1.2.0',
        scripts: { dev: 'cross-env PORT=4872 next dev' },
      }),
    },
    '.',
    'win32',
    { port: 3000, source: `${BUN_SHELL_NOTE}: "cross-env PORT=… next dev"` },
  ],
] as const)
  test(`${name} gives port ${expected.port} with source ${expected.source}`, async () => {
    // Arrange: the tree above

    // Act
    const declared = await declaredPortOfTree(files, opened, platform)

    // Assert
    assert.deepEqual(declared, expected)
  })

const YARN_SHELL_NOTE =
  "Next's default port, taken because Yarn 2 and later runs scripts in its own portable shell, which reads this form differently from sh, so it can mean different things"

/** A folder path `depth` levels below the tree root, as `d1/d2/...`. */
const nestedFolder = (depth: number): string =>
  Array.from({ length: depth }, (_, i) => `d${i + 1}`).join('/')

// Value: protects=a Yarn Berry project (Yarn 2+, found by packageManager or a .yarnrc.yml in the opened folder or the Git root) reading `export PORT=N` as unread with a note naming Yarn's portable shell, while the forms Berry runs (PORT=N prefix, env, ;) stay read and Yarn 1 still reads export (D75, F515); fails_when=a Berry project's `export PORT=4000 && next dev` reports 4000 though `yarn dev` fails with "command not found: export", or a form Berry runs becomes unread; why_new=F515 (OCR low; confirmed with corepack yarn 4.5.0: command not found: export); seam=temporary folder trees; no_claim=Yarn itself
for (const [name, files, opened, expected] of [
  [
    'export in a project with packageManager yarn@4',
    {
      'package.json': JSON.stringify({
        packageManager: 'yarn@4.5.0',
        scripts: { dev: 'export PORT=4000 && next dev' },
      }),
    },
    '.',
    { port: 3000, source: `${YARN_SHELL_NOTE}: "export PORT=…"` },
  ],
  [
    'export in a project with packageManager yarn@2',
    {
      'package.json': JSON.stringify({
        packageManager: 'yarn@2.4.3',
        scripts: { dev: 'export PORT=4001 && next dev' },
      }),
    },
    '.',
    { port: 3000, source: `${YARN_SHELL_NOTE}: "export PORT=…"` },
  ],
  [
    'export in a project with a .yarnrc.yml in the opened folder',
    {
      '.yarnrc.yml': 'nodeLinker: node-modules',
      'package.json': devScript('export PORT=4002 && next dev'),
    },
    '.',
    { port: 3000, source: `${YARN_SHELL_NOTE}: "export PORT=…"` },
  ],
  [
    'export in a project with a .yarnrc.yml at the Git root above',
    {
      '.git/': '',
      '.yarnrc.yml': 'nodeLinker: node-modules',
      'apps/web/package.json': devScript('export PORT=4003 && next dev'),
    },
    'apps/web',
    { port: 3000, source: `${YARN_SHELL_NOTE}: "export PORT=…"` },
  ],
  [
    'export in a project with packageManager yarn@1',
    {
      'package.json': JSON.stringify({
        packageManager: 'yarn@1.22.22',
        scripts: { dev: 'export PORT=4004 && next dev' },
      }),
    },
    '.',
    {
      port: 4004,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'export in a project with a .yarnrc.yml above the Git root',
    {
      '.yarnrc.yml': 'nodeLinker: node-modules',
      'repo/.git/': '',
      'repo/package.json': devScript('export PORT=4005 && next dev'),
    },
    'repo',
    {
      port: 4005,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'a PORT prefix in a Yarn Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('PORT=4006 next dev'),
    },
    '.',
    {
      port: 4006,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'env with a PORT assignment in a Yarn Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('env PORT=4007 next dev'),
    },
    '.',
    {
      port: 4007,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'a semicolon and a quoted flag value in a Yarn Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('NODE_ENV=development; next dev -p "4008"'),
    },
    '.',
    { port: 4008, source: 'the dev script in package.json' },
  ],
] as const)
  test(`${name} gives port ${expected.port}`, async () => {
    // Arrange: the tree above

    // Act
    const declared = await declaredPortOfTree(files, opened)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a Yarn Berry project reading a `;;` and a `;` followed by blanks at the end of the line as unread with the Yarn-shell note, since Yarn 4's shell fails on both with a syntax error while `sh` reads them, and a single trailing `;` or a mid-line `; ` still being read (F519); fails_when=`next dev -p 4013 ; ` reports 4013 in a Berry project though `yarn dev` fails to parse, or the single trailing `;` and the `; ` between statements become unread, or a Yarn 1 project stops reading the trailing `; `; why_new=F519 (OCR low; confirmed with corepack yarn 4.9.2: `echo hi; ` and `echo hi;;` fail, `echo hi;` and `echo a ; echo b` run); seam=temporary folder trees; no_claim=Yarn itself
for (const [name, files, expected] of [
  [
    'a trailing semicolon followed by a blank in a Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('next dev -p 4013 ; '),
    },
    { port: 3000, source: `${YARN_SHELL_NOTE}: "next dev -p …"` },
  ],
  [
    'a trailing semicolon followed by two blanks in a Berry project (packageManager)',
    {
      'package.json': JSON.stringify({
        packageManager: 'yarn@4.9.2',
        scripts: { dev: 'next dev -p 4014;  ' },
      }),
    },
    { port: 3000, source: `${YARN_SHELL_NOTE}: "next dev -p …"` },
  ],
  [
    'a double semicolon in a Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('NODE_ENV=development;; next dev -p 4015'),
    },
    { port: 3000, source: `${YARN_SHELL_NOTE}: "NODE_ENV=…"` },
  ],
  [
    'a trailing semicolon followed by a blank in a script a Berry project delegates to',
    {
      '.yarnrc.yml': '',
      'package.json': packageScripts({
        dev: 'yarn run web',
        web: 'next dev -p 4016; ',
      }),
    },
    { port: 3000, source: `${YARN_SHELL_NOTE}: "next dev -p …"` },
  ],
  [
    'a single trailing semicolon with no blank after it in a Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('next dev -p 4017;'),
    },
    { port: 4017, source: 'the dev script in package.json' },
  ],
  [
    'a semicolon between two statements in a Berry project',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('NODE_ENV=development ; next dev -p 4018'),
    },
    { port: 4018, source: 'the dev script in package.json' },
  ],
  [
    'a trailing semicolon followed by a blank in a Yarn 1 project',
    {
      '.yarnrc.yml': '',
      'package.json': JSON.stringify({
        packageManager: 'yarn@1.22.22',
        scripts: { dev: 'next dev -p 4019 ; ' },
      }),
    },
    { port: 4019, source: 'the dev script in package.json' },
  ],
] as const)
  test(`${name} gives port ${expected.port}`, async () => {
    // Arrange: the tree above

    // Act
    const declared = await declaredPortOfTree(files, '.')

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a Yarn Berry project on win32 being read with Yarn's portable shell (the forms Berry runs are read as on macOS and Linux, `export` is unread with the Yarn note) and never with the cmd rules, and a packageManager of yarn@1 or another manager winning over a stray .yarnrc.yml (F520); fails_when=a Berry project on Windows gets the cmd note for `PORT=4000 next dev`, a Yarn 1 project with a stray .yarnrc.yml gets the Yarn-shell note, or a Bun project with a stray .yarnrc.yml escapes the Bun-shell note on Windows; why_new=F520 (OCR low; Berry's shell is portable and runs on Windows too); seam=temporary folder trees with the platform injected; no_claim=a real Windows host or Yarn on it
for (const [name, files, platform, expected] of [
  [
    'a PORT prefix in a Berry project on Windows',
    { '.yarnrc.yml': '', 'package.json': devScript('PORT=4020 next dev') },
    'win32',
    {
      port: 4020,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'a single-quoted flag value in a Berry project on Windows',
    { '.yarnrc.yml': '', 'package.json': devScript("next dev -p '4021'") },
    'win32',
    { port: 4021, source: 'the dev script in package.json' },
  ],
  [
    'a semicolon in a Berry project on Windows',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('NODE_ENV=development; next dev -p 4022'),
    },
    'win32',
    { port: 4022, source: 'the dev script in package.json' },
  ],
  [
    'env with a PORT assignment in a Berry project on Windows',
    { '.yarnrc.yml': '', 'package.json': devScript('env PORT=4023 next dev') },
    'win32',
    {
      port: 4023,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'export in a Berry project on Windows',
    {
      '.yarnrc.yml': '',
      'package.json': devScript('export PORT=4024 && next dev'),
    },
    'win32',
    { port: 3000, source: `${YARN_SHELL_NOTE}: "export PORT=…"` },
  ],
  [
    'a PORT prefix with packageManager yarn@1 and a stray .yarnrc.yml on Windows',
    {
      '.yarnrc.yml': '',
      'package.json': JSON.stringify({
        packageManager: 'yarn@1.22.22',
        scripts: { dev: 'PORT=4025 next dev' },
      }),
    },
    'win32',
    { port: 3000, source: `${CMD_NOTE}: "PORT=… next dev"` },
  ],
  [
    'export with packageManager yarn@1 and a stray .yarnrc.yml on macOS and Linux',
    {
      '.yarnrc.yml': '',
      'package.json': JSON.stringify({
        packageManager: 'yarn@1.22.22',
        scripts: { dev: 'export PORT=4026 && next dev' },
      }),
    },
    'linux',
    {
      port: 4026,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'a Bun packageManager with a stray .yarnrc.yml on Windows',
    {
      '.yarnrc.yml': '',
      'package.json': JSON.stringify({
        packageManager: 'bun@1.2.0',
        scripts: { dev: 'next dev -p 4027' },
      }),
    },
    'win32',
    { port: 3000, source: `${BUN_SHELL_NOTE}: "next dev -p …"` },
  ],
] as const)
  test(`${name} gives port ${expected.port}`, async () => {
    // Arrange: the tree above

    // Act
    const declared = await declaredPortOfTree(files, '.', platform)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=the node_modules/.bin/next path being read after bare next and `pnpm exec` only, and unread after npx and bunx, which take a package name (F516); fails_when=`npx node_modules/.bin/next dev -p 4000` reads 4000 though npx fails with ENOTDIR; why_new=F516 (OCR low, pre-existing; npx and bunx confirmed to fail on the path); seam=temporary project folders; no_claim=npx or bunx themselves
for (const [name, script, expected] of [
  [
    'npx with a node_modules path',
    'npx node_modules/.bin/next dev -p 4000',
    { port: 3000, source: UNREAD_SOURCE('npx next dev -p …') },
  ],
  [
    'bunx with a node_modules path',
    'bunx node_modules/.bin/next dev -p 4000',
    { port: 3000, source: UNREAD_SOURCE('bunx next dev -p …') },
  ],
  [
    'pnpm exec with a node_modules path',
    'pnpm exec node_modules/.bin/next dev -p 4009',
    { port: 4009, source: 'the dev script in package.json' },
  ],
  [
    'a bare node_modules path',
    'node_modules/.bin/next dev -p 4010',
    { port: 4010, source: 'the dev script in package.json' },
  ],
  [
    'npx with bare next',
    'npx next dev -p 4011',
    { port: 4011, source: 'the dev script in package.json' },
  ],
] as const)
  test(`${name} gives port ${expected.port}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=the Bun lockfile search climbing at most 16 folders (the opened one included) to find the Git root, a Git root one folder beyond not counting, and an ancestor bun.lock being ignored when no .git is in range (F514, F518); fails_when=the bound is raised or lowered by one, or a bun.lock above an opened folder with no Git root is honored; why_new=F518 (OCR low, test gap), F521 (the old no-.git cases climbed above the temp folder, so a TMPDIR inside a repository failed them); seam=temporary folder trees 15, 16 and 20 levels deep, every one under a tree root that holds its own .git, so the climb never leaves the tree and the bound, not the host, decides (F521); no_claim=Bun itself
for (const [name, files, opened, expected] of [
  [
    'a Git root exactly 16 folders up (the opened folder is the first)',
    {
      '.git/': '',
      'bun.lock': '',
      [`${nestedFolder(15)}/package.json`]: devScript('next dev'),
    },
    nestedFolder(15),
    { port: 3000, source: `${BUN_ENV_NOTE}: "next dev"` },
  ],
  [
    'a Git root one folder beyond the bound',
    {
      '.git/': '',
      'bun.lock': '',
      [`${nestedFolder(16)}/package.json`]: devScript('next dev'),
    },
    nestedFolder(16),
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a bun.lock 10 folders above the opened folder with the Git root beyond the bound',
    {
      '.git/': '',
      [`${nestedFolder(10)}/bun.lock`]: '',
      [`${nestedFolder(20)}/package.json`]: devScript('next dev'),
    },
    nestedFolder(20),
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a bun.lock in the opened folder with the Git root beyond the bound',
    {
      '.git/': '',
      [`${nestedFolder(20)}/bun.lock`]: '',
      [`${nestedFolder(20)}/package.json`]: devScript('next dev'),
    },
    nestedFolder(20),
    { port: 3000, source: `${BUN_ENV_NOTE}: "next dev"` },
  ],
] as const)
  test(`${name} gives source ${expected.source}`, async () => {
    // Arrange: the tree above. Every tree holds its own .git at its root and the opened folder is nested 15 to 20 folders below it, so the 16-folder climb stays inside the tree and no ancestor of the temp folder (a TMPDIR inside a repository, say) is ever read (F521).

    // Act
    const declared = await declaredPortOfTree(files, opened)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a root given as a relative path still finding the Git root and the Bun lockfile above the current directory, since the climb works on the resolved folder (F517); fails_when=a relative root `web` climbs only to `.` and reads a Bun monorepo's plain next dev without the Bun note; why_new=F517 (OCR low: the reader's root must be absolute or resolved); seam=temporary folder tree with the current directory moved into it for the call and restored; no_claim=how callers build the root
test('a relative root finds the Bun lockfile at the Git root above the current directory', async () => {
  // Arrange
  const tree = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-port-relative-')),
  )
  const originalCwd = process.cwd()
  try {
    await mkdir(join(tree, '.git'))
    await writeFile(join(tree, 'bun.lock'), '')
    await mkdir(join(tree, 'apps', 'web'), { recursive: true })
    await writeFile(
      join(tree, 'apps', 'web', 'package.json'),
      devScript('next dev'),
    )
    process.chdir(join(tree, 'apps'))

    // Act
    const declared = await readDeclaredDevelopmentPort('web', 'linux')

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source: `${BUN_ENV_NOTE}: "next dev"`,
    })
  } finally {
    process.chdir(originalCwd)
    await rm(tree, { recursive: true, force: true })
  }
})

// Value: protects=pnpm run <name> and yarn run <name> still reading a script whose name a builtin shadows (F500); fails_when=the builtin list also unreads the explicit run form; why_new=F500; seam=temporary project folders; no_claim=the package manager itself
for (const [name, scripts, port] of [
  ['pnpm run info', { dev: 'pnpm run info', info: 'next dev -p 4831' }, 4831],
  ['yarn run info', { dev: 'yarn run info', info: 'next dev -p 4832' }, 4832],
] as const)
  test(`${name} reads the script of that name`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, port)
  })

// Value: protects=a word with a quote before its `=` (or an unsafe or extra assignment) being no assignment, as sh runs it as a command (F501, F506); fails_when=the quoted word is read as PORT=4000 or an unsafe assignment name in another case is read past; why_new=F501 and F506 (surviving mutants: the /i of the unsafe names, the export length check, the backslash in the character list); seam=temporary project folders; no_claim=what sh does (the real-sh table checks it)
for (const [name, scripts] of [
  ['a fully quoted assignment', { dev: '"PORT=4841" next dev' }],
  ['a quoted assignment name', { dev: '"PORT"=4842 next dev' }],
  ['a single-quoted assignment', { dev: "'PORT=4843' next dev" }],
  [
    'a quoted assignment after cross-env',
    { dev: 'cross-env "PORT=4844" next dev' },
  ],
  ['a mixed-case unsafe name', { dev: 'Path=/x next dev -p 4845' }],
  [
    'an upper-case npm_config name',
    { dev: 'NPM_CONFIG_PORT=1 next dev -p 4846' },
  ],
  [
    'an export of two variables',
    { dev: 'export PORT=4847 NODE_OPTIONS=x && next dev' },
  ],
  [
    'a backslash inside a script name',
    { dev: 'npm run web\\x', 'web\\x': 'next dev -p 4848' },
  ],
] as const)
  test(`${name} is unread and takes Next's default 3000`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, 3000)
    assert.ok(declared.source.startsWith(`${UNREAD_NOTE}: "`), declared.source)
  })

// Value: protects=a quoted assignment VALUE staying an assignment (PORT="4849" next dev), and one trailing `;` being allowed (F501, F503); fails_when=the quote rule unreads a quoted value, or a trailing semicolon unreads the script; why_new=F501 and F503; seam=temporary project folders; no_claim=what sh does
for (const [name, script, port] of [
  ['a double-quoted value', 'PORT="4849" next dev', 4849],
  ['a single-quoted value', "PORT='4850' next dev", 4850],
  ['a trailing semicolon', 'next dev -p 4851;', 4851],
  ['a trailing semicolon after a prefix', 'PORT=4852 next dev;', 4852],
  ['a trailing semicolon after a blank', 'next dev -p 4853; ', 4853],
] as const)
  test(`${name} reads port ${port}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, port)
  })

// Value: protects=an empty statement being unread and never quoted as an empty text: the previous statement's structure, or the whole script's words, is quoted (F503); fails_when=the note quotes ""; why_new=F503 (OCR low, usability); seam=temporary project folders; no_claim=what sh does
for (const [name, script, segment] of [
  ['a doubled semicolon', 'next dev -p 4861;;', 'next dev -p …'],
  ['a trailing &&', 'next dev -p 4862 &&', 'next dev -p …'],
  ['an && then a semicolon', 'next dev -p 4863 && ;', 'next dev -p …'],
  ['a leading semicolon', '; next dev -p 4864', '… next dev -p …'],
] as const)
  test(`${name} is unread and the note quotes ${segment}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port: 3000,
      source: `${UNREAD_NOTE}: "${segment}"`,
    })
  })

// Value: protects=a `next dev` with no port anywhere is read, so the run takes Next's default 3000 with no unread note (D72); fails_when=a plain next dev or a PORT-free chain is reported as unread; why_new=D72 grammar; seam=temporary project folders; no_claim=that 3000 is free
for (const [name, script] of [
  ['a plain next dev', 'next dev'],
  ['next dev with only flags that take no port', 'next dev --turbo'],
  ['variables that do not name the port', 'NODE_ENV=x next dev'],
] as const)
  test(`${name} reports Next's default with no unread note`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
  })

// Value: protects=a PORT in the project's env files no longer moves the port (Next reads PORT from the command line and the process environment before it loads .env files); fails_when=an env file's PORT is used again; why_new=D67/F431; seam=temporary project folders; no_claim=Next's own env loading
test('a PORT in the env files does not move the port', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({ dev: 'next dev' }),
    '.env': 'PORT=4451\n',
    '.env.local': 'PORT=4452\n',
    '.env.development.local': 'export PORT=4453\n',
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
})

// Value: protects=a project with no dev script declares no port and starts on Next's default; fails_when=a missing dev script is reported as an unread form; why_new=reader rewrite (D72); seam=temporary project folders; no_claim=that the project can start
test('a project without a dev script starts on Next default 3000', async () => {
  // Arrange
  const files = { 'package.json': packageScripts({ build: 'next build' }) }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
})

/** Every form the review rounds found (tasks F421, F430, F451, F461 to F465, F469 to F472, F478 to F481, F487 to F492, F497) with the scripts it needs, outside the grammar: the reader asserts no port and says so. */
const UNREAD_FORMS: ReadonlyArray<readonly [string, Record<string, string>]> = [
  // F421, F430
  ['next build before next dev', { dev: 'next build -p 4431 && next dev' }],
  [
    'a delegated helper that builds',
    { dev: 'pnpm gen && next dev', gen: 'next build -p 4432' },
  ],
  ['a program that is not next', { dev: 'node server.js -p 4433' }],
  [
    'a delegation three levels deep',
    {
      dev: 'npm run a',
      a: 'npm run b',
      b: 'npm run c',
      c: 'next dev -p 4434',
    },
  ],
  ['a backgrounding &', { dev: 'node api.js -p 5000 & next dev -p 4419' }],
  [
    'a backgrounded assignment',
    { dev: 'PORT=5000 node api.js & next dev -p 4420' },
  ],
  ['a shell default as an assignment', { dev: 'PORT=${PORT:-4421} next dev' }],
  [
    'a delegation with arguments',
    { dev: 'pnpm web -- -p 4410', web: 'next dev' },
  ],
  ['mkdir before next dev', { dev: 'mkdir -p 5 && next dev -p 4500' }],
  // F451
  ['cmd /c', { dev: 'cmd /c "set PORT=4101&& next dev"' }],
  [
    'cmd.exe with its own flags',
    { dev: 'cmd.exe /d /s /c "next dev -p 4102"' },
  ],
  ['a next.cmd launcher', { dev: 'next.cmd dev -p 4103' }],
  [
    'a Windows path to next.cmd',
    { dev: 'node_modules\\.bin\\next.cmd dev -p 4104' },
  ],
  ['cross-env-shell', { dev: 'cross-env-shell "PORT=4105 next dev"' }],
  ['sh -c', { dev: "sh -c 'next dev -p 4106'" }],
  ['bash -c', { dev: 'bash -c "PORT=4107 next dev"' }],
  ['dotenv', { dev: 'dotenv -e .env -- next dev -p 4108' }],
  ['dotenvx run', { dev: 'dotenvx run -- next dev -p 4122' }],
  ['env -u with an assignment', { dev: 'env -u X PORT=4109 next dev' }],
  [
    'node with its own flags',
    { dev: 'node --inspect node_modules/.bin/next dev -p 4110' },
  ],
  [
    'node with a preload',
    {
      dev: 'node --require ./setup.js node_modules/next/dist/bin/next dev -p 4111',
    },
  ],
  ['pnpm next', { dev: 'pnpm next dev -p 4113' }],
  ['npm exec --', { dev: 'npm exec -- next dev -p 4123' }],
  ['bun naming a script', { dev: 'bun web', web: 'next dev -p 4116' }],
  [
    'concurrently npm:<script>',
    { dev: 'concurrently npm:dev:web', 'dev:web': 'next dev -p 4117' },
  ],
  [
    'a concurrently wildcard',
    { dev: 'concurrently npm:dev:*', 'dev:web': 'next dev -p 4118' },
  ],
  [
    'concurrently with a program outside the grammar',
    { dev: 'concurrently "tsc -w" "next dev -p 4124"' },
  ],
  [
    'concurrently with two next dev commands',
    { dev: 'concurrently "next dev -p 4125" "next dev -p 4126"' },
  ],
  ['a shell default in the port flag', { dev: 'next dev -p ${PORT:-4120}' }],
  [
    'a quoted shell default in the port flag',
    { dev: 'next dev --port "${PORT:-4121}"' },
  ],
  ['a subshell', { dev: '(cd app && next dev -p 4000)' }],
  [
    'a subshell followed by the real command',
    { dev: '(echo starting) && next dev -p 4130' },
  ],
  ['an unknown wrapper', { dev: 'turbo-run next dev -p 4000' }],
  ['a port flag with a variable', { dev: 'next dev -p $APP_PORT' }],
  ['a PORT assignment with a variable', { dev: 'PORT=$APP_PORT next dev' }],
  ['a delegation cycle', { dev: 'npm run dev' }],
  // F461, F462
  ['an upper-case SET', { dev: 'SET PORT=4501&& next dev' }],
  ['a mixed-case Set', { dev: 'Set PORT=4502 && next dev' }],
  ['setx', { dev: 'setx PORT 4504 && next dev' }],
  ['dotenv -v PORT', { dev: 'dotenv -v PORT=4511 -- next dev' }],
  ['dotenvx --env PORT', { dev: 'dotenvx run --env PORT=4513 -- next dev' }],
  // F450, F465, F472: comments and escapes
  ['a comment after the command', { dev: 'next dev # -p 4000' }],
  ['a comment after the port', { dev: 'next dev -p 4150 # -p 5000' }],
  ['a hash inside a word', { dev: 'next dev -p 4154#x' }],
  ['a quoted hash', { dev: 'next dev -p 4152 "#" -p 4153' }],
  ['an escaped semicolon', { dev: 'next dev -p 4521 \\; next dev -p 5521' }],
  [
    'an escaped quote inside double quotes',
    { dev: 'node -e "x \\" ; y" && next dev -p 4522' },
  ],
  ['a hash in cmd /c text', { dev: 'cmd /c "next dev # -p 4523"' }],
  ['an escaped backslash', { dev: 'a\\\\ b; next dev -p 4524' }],
  // F463, F470, F471: ${PORT:-N}, resolved and unresolved assignments
  [
    'an earlier export with a shell default',
    { dev: 'export PORT=5001; next dev -p ${PORT:-4001}' },
  ],
  [
    'a single-quoted sh -c with a shell default',
    { dev: "PORT=5003 sh -c 'next dev -p ${PORT:-4003}'" },
  ],
  [
    'a delegated script with a shell default',
    { dev: 'PORT=5004 pnpm web', web: 'next dev -p ${PORT:-4004}' },
  ],
  [
    'a shell default in cmd /c text',
    { dev: 'cmd /c "next dev -p ${PORT:-4000}"' },
  ],
  [
    'an export of a variable',
    { dev: 'export PORT=$APP_PORT; next dev -p ${PORT:-4009}' },
  ],
  [
    'a known assignment then an unresolved one',
    { dev: 'PORT=4000 PORT=$APP_PORT next dev' },
  ],
  [
    'an unresolved assignment then a known one',
    { dev: 'PORT=$APP_PORT PORT=4000 next dev' },
  ],
  [
    'an unset after an export',
    { dev: 'export PORT=4000; unset PORT; next dev' },
  ],
  ['an empty export', { dev: 'export PORT=4000; export PORT=; next dev' }],
  [
    'an unset inside a nested sh -c',
    { dev: 'PORT=4000 sh -c "unset PORT; next dev"' },
  ],
  ['a bare shell variable', { dev: 'PORT=5000; next dev' }],
  [
    'a bare shell variable exported later',
    { dev: 'PORT=5000; export PORT; next dev' },
  ],
  [
    'a bare assignment to a PORT that is already exported',
    { dev: 'export PORT=3300; PORT=5000; next dev' },
  ],
  [
    'PORT assigned after export on one line',
    { dev: 'PORT=4028 export PORT; next dev' },
  ],
  // F478 to F481: statements that change PORT
  ['unset -v', { dev: 'export PORT=4000; unset -v PORT; next dev' }],
  ['unset of two names', { dev: 'export PORT=4000; unset X PORT; next dev' }],
  ['export -n', { dev: 'export PORT=4000; export -n PORT; next dev' }],
  ['export of an extra name', { dev: 'export X PORT=4000; next dev' }],
  ['declare -x', { dev: 'declare -x PORT=4000; next dev' }],
  ['typeset -x', { dev: 'typeset -x PORT=4000; next dev' }],
  ['command export', { dev: 'command export PORT=4000; next dev' }],
  ['builtin export', { dev: 'builtin export PORT=4000; next dev' }],
  ['a piped export', { dev: 'export PORT=4000 | next dev' }],
  ['an export in a group', { dev: '{ export PORT=4000; }; next dev' }],
  ['an export in a subshell', { dev: '( export PORT=4000 ); next dev' }],
  ['an export after &&', { dev: 'true && export PORT=4000; next dev' }],
  ['an export after ||', { dev: 'false || export PORT=4000; next dev' }],
  ['env -i', { dev: 'export PORT=4000; env -i next dev' }],
  ['env -', { dev: 'export PORT=4000; env - next dev' }],
  [
    'env --ignore-environment',
    { dev: 'export PORT=4000; env --ignore-environment next dev' },
  ],
  ['env -u PORT', { dev: 'export PORT=4000; env -u PORT next dev' }],
  ['env --unset=PORT', { dev: 'export PORT=4000; env --unset=PORT next dev' }],
  ['an export of two assignments', { dev: 'export A=1 PORT=4000; next dev' }],
  [
    'an unmodeled set before an export',
    { dev: 'set -e; export PORT=4000; next dev' },
  ],
  // F487: compound commands
  [
    'an if that exports PORT',
    { dev: 'if true; then export PORT=4000; fi; next dev' },
  ],
  [
    'a while that exports PORT',
    { dev: 'while :; do export PORT=4000; break; done; next dev' },
  ],
  ['a negated export', { dev: '! export PORT=4000; next dev' }],
  ['a timed export', { dev: 'time export PORT=4000; next dev' }],
  // F488: expansions that set PORT
  [
    'a ${PORT:=N} expansion',
    { dev: ': "${PORT:=4000}"; export PORT; next dev' },
  ],
  [
    'an arithmetic assignment',
    { dev: ': $((PORT=4000)); export PORT; next dev' },
  ],
  // F489: scripts that never run next dev
  ['turbo run', { dev: 'turbo run dev' }],
  ['pnpm --filter', { dev: 'pnpm --filter web dev' }],
  ['yarn workspace', { dev: 'yarn workspace web dev' }],
  ['nx', { dev: 'nx dev web' }],
  ['node server.js', { dev: 'node server.js' }],
  ['vite', { dev: 'vite' }],
  ['a delegation to a script that is missing', { dev: 'npm run nothere' }],
  ['only assignments', { dev: 'A=1' }],
  // F490: arguments to a delegated script
  [
    'flags given to a delegated script',
    { dev: 'npm run other -p 5000', other: 'next dev -p 4444' },
  ],
  // F491
  ['npx -c', { dev: 'npx -c "next dev -p 4000"' }],
  ['env -S', { dev: "env -S 'PORT=4000 next dev'" }],
  ['node -r', { dev: 'node -r ./preload.js node_modules/.bin/next dev' }],
  [
    'NODE_OPTIONS with a preload',
    { dev: 'NODE_OPTIONS=--require=./setup.js next dev' },
  ],
  ['a PATH override', { dev: 'PATH=./bin next dev -p 4000' }],
  ['a variable as the program', { dev: '$NEXT dev' }],
  ['a port with an escaped zero', { dev: 'next dev -p 40\\00' }],
  ['a heredoc', { dev: 'next dev -p 4000 <<EOF' }],
  ['a single-quoted shell default', { dev: "next dev -p '${PORT:-4000}'" }],
  ['an escaped shell default', { dev: 'next dev -p \\${PORT:-4000}' }],
  ['a line break', { dev: 'export PORT=4000\nnext dev' }],
  ['a continued line', { dev: 'next dev \\\n -p 4000' }],
  ['a pipe', { dev: 'next dev -p 4000 | tee log' }],
  ['||', { dev: 'next dev -p 4000 || true' }],
  ['a redirection', { dev: 'next dev -p 4000 > log' }],
  ['a command substitution', { dev: 'next dev -p $(echo 4000)' }],
  ['a backtick', { dev: 'next dev -p `echo 4000`' }],
  ['a glob', { dev: 'next dev -p 40*' }],
  ['a port of zero', { dev: 'next dev -p 0' }],
  ['a port above the range', { dev: 'next dev -p 70000' }],
  ['-p=N', { dev: 'next dev -p=4200' }],
  ['a missing flag value', { dev: 'next dev -p' }],
  ['a positional directory', { dev: 'next dev ./app -p 4000' }],
  ['a flag outside the list', { dev: 'next dev --inspect -p 4000' }],
  ['an unterminated quote', { dev: 'next dev -p "4000' }],
  ['an empty statement', { dev: 'next dev -p 4000 &&' }],
  // F497
  [
    'an export that a failed && skips',
    { dev: 'false && export PORT=4000 && true; next dev' },
  ],
]

// Value: protects=every form the review rounds found is outside the grammar, so the reader asserts no port for it and says Next's default 3000 was taken because of a form it does not read, never a wrong port (D72 rule 3; F421 to F497); fails_when=one of the forms reads a port again or falls back to 3000 with no note; why_new=D72 replaces the deny-list of D71 that three rounds could not complete; seam=temporary project folders; no_claim=what the shell does with the form (the real-shell test below checks the grammar's own forms)
for (const [name, scripts] of UNREAD_FORMS)
  test(`${name} is unread and takes Next's default 3000 with the unread note`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, 3000)
    assert.ok(declared.source.startsWith(`${UNREAD_NOTE}: "`), declared.source)
  })

// Value: protects=the quoted segment of an unread script shows the structure D72 rule 2 allows: grammar words by base name, listed flag names, assignment names in an assignment position, script names; fails_when=a value, an operand, a path or a first program word is shown; why_new=D72 rule 2 (F481, F492, F496); seam=temporary project folders; no_claim=that a listed name holds no secret
for (const [name, scripts, segment] of [
  [
    'a subshell',
    { dev: '(cd app && next dev -p 4000)' },
    '… … … next dev -p …',
  ],
  [
    'an unknown wrapper',
    { dev: 'turbo-run next dev -p 4000' },
    '… next dev -p …',
  ],
  [
    'a port flag with a variable',
    { dev: 'next dev -p $APP_PORT' },
    'next dev -p …',
  ],
  [
    'a PORT assignment with a variable',
    { dev: 'PORT=$APP_PORT next dev' },
    'PORT=… next dev',
  ],
  [
    'a secret assignment before an unknown wrapper',
    { dev: 'API_KEY=secret123 turbo-run next dev' },
    'API_KEY=… … next dev',
  ],
  [
    'a delegation with arguments',
    { dev: 'npm run web --silent -- -p 4000', web: 'next dev' },
    'npm run web --silent -- -p …',
  ],
  ['a delegation to a missing script', { dev: 'npm run nothere' }, 'npm run …'],
  [
    'a terminal control sequence',
    { dev: 'turbo-run \u001b[31m next dev -p 4000' },
    '… … next dev -p …',
  ],
] as const)
  test(`${name} is quoted by structure only in the port source`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: UNREAD_SOURCE(segment) })
  })

// Value: protects=no value reaches applicationPortSource (the run resource and MCP): not one found in F464, F469, F481, F492 and F496 (flag values, =values, attached -pSECRET, header lines, Bearer and Basic tokens, user:pass@host, multi-line words, path-like operands, a program path, long flag names that carry a value, base64 padding with = or ==); fails_when=any secret below appears in the source; why_new=D72 rule 2 replaces the masking by name; seam=temporary project folders; no_claim=that a listed program, flag or script name holds no secret
for (const [name, script, secret] of [
  ['a value after a token flag', 'turbo-run --token abc123 next dev', 'abc123'],
  [
    'an api-key value joined with =',
    'turbo-run --api-key=abc123 next dev',
    'abc123',
  ],
  [
    'a passphrase flag value',
    'turbo-run --passphrase abc123 next dev',
    'abc123',
  ],
  ['a signature flag value', 'turbo-run --signature abc123 next dev', 'abc123'],
  ['an sso flag value', 'turbo-run --sso abc123 next dev', 'abc123'],
  [
    'a value attached to a short flag',
    'turbo-run -pSECRET123 next dev',
    'SECRET123',
  ],
  [
    'a Bearer token as its own word',
    'turbo-run Bearer abc123 next dev',
    'abc123',
  ],
  [
    'a Basic token after an Authorization header word',
    'turbo-run Authorization: Basic abc123 next dev',
    'abc123',
  ],
  [
    'user and password in a URL without a scheme',
    'turbo-run ada:pw123@example.com next dev',
    'pw123',
  ],
  [
    'URL credentials',
    'turbo-run https://ada:pw123@example.com/x next dev',
    'pw123',
  ],
  [
    'a -H header value',
    'turbo-run -H "Authorization: Basic abc123" next dev',
    'abc123',
  ],
  [
    'a header value attached to -H',
    'turbo-run -HX-Api-Key:abc123 next dev',
    'abc123',
  ],
  ['a -u user and password', 'turbo-run -u ada:pw123 next dev', 'pw123'],
  ['a --data-raw body', 'turbo-run --data-raw body123 next dev', 'body123'],
  [
    'an assignment name with a dash and a dot',
    'my-key.x=abc123 turbo-run next dev',
    'my-key',
  ],
  ['a secret assignment value', 'API_KEY=abc123 turbo-run next dev', 'abc123'],
  [
    'a multi-line quoted word',
    'turbo-run "first line\nAuthorization: Basic abc123\nlast line" next dev',
    'abc123',
  ],
  ['a host and port word', 'turbo-run localhost:3000 next dev', 'localhost'],
  [
    'the home directory in an operand',
    `turbo-run ${homedir()}/.nvm/bin/tool next dev`,
    homedir(),
  ],
  [
    'the home directory in the program',
    `${homedir()}/bin/turbo-run next dev`,
    homedir(),
  ],
  ['a path-like operand ending in dev', 'hunter2/dev next dev', 'hunter2'],
  [
    'a customer folder before next',
    '/opt/customer-acme/next dev -p $X',
    'customer-acme',
  ],
  ['a key file folder before next', '~/.ssh/id_rsa/next dev', 'id_rsa'],
  [
    'a long flag name that carries a value',
    'turbo-run --api-key-sk_live_abc123 next dev',
    'sk_live_abc123',
  ],
  [
    'a key after the end of options',
    'turbo-run -- --AKIAIOSFODNN7EXAMPLE next dev',
    'AKIAIOSFODNN7EXAMPLE',
  ],
  ['a first program word', 'secret-tool-9 next dev', 'secret-tool-9'],
  ['base64 padding with ==', 'turbo-run dXNlcjpwdw== next dev', 'dXNlcjpwdw'],
  [
    'base64 padding after a short flag',
    'turbo-run -pSGVsbG8= next dev',
    'SGVsbG8',
  ],
  [
    'base64 padding with = as an operand',
    'turbo-run abc123= next dev',
    'abc123',
  ],
  [
    'an assignment after the program',
    'turbo-run SECRETNAME=abc next dev',
    'SECRETNAME',
  ],
] as const)
  test(`${name} is not quoted in the port source`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, 3000)
    assert.ok(declared.source.startsWith(UNREAD_NOTE))
    assert.equal(declared.source.includes(secret), false)
  })

// Value: protects=the two base64 forms F496 found are shown as nothing but `…`; fails_when=`dXNlcjpwdw==` is shown as `dXNlcjpwdw=…` or `-pSGVsbG8=` as `-pSGVsbG8=…`; why_new=F496 (CodeRabbit CLI of c9664ea3..673b2923); seam=temporary project folders; no_claim=other encodings
for (const [name, script, segment] of [
  [
    'an operand ending in ==',
    'turbo-run dXNlcjpwdw== next dev',
    '… … next dev',
  ],
  [
    'a short flag with a value ending in =',
    'turbo-run -pSGVsbG8= next dev',
    '… -p… next dev',
  ],
  [
    'an assignment with an empty value',
    'API_KEY= turbo-run next dev',
    '… … next dev',
  ],
  [
    'an assignment whose value is only =',
    'API_KEY== turbo-run next dev',
    '… … next dev',
  ],
] as const)
  test(`${name} is shown as an ellipsis`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: UNREAD_SOURCE(segment) })
  })

// Value: protects=a package.json script name that reaches the run resource has no control character and is cut (F492); fails_when=a name with a line break or an escape sequence, or a very long name, is quoted raw; why_new=F492 (confirmed: a script name reached applicationPortSource raw); seam=temporary project folders; no_claim=that the reader can follow a name with control characters (it cannot: such a name is no word of the grammar)
test('a long script name is cut in the port source', async () => {
  // Arrange
  const name = `web${'x'.repeat(100)}`
  const files = {
    'package.json': packageScripts({
      dev: `npm run ${name}`,
      [name]: 'next dev -p 4001',
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, {
    port: 4001,
    source: `the "web${'x'.repeat(37)}…" script that the dev script runs in package.json`,
  })
})

test('a script name with a line break and an escape sequence is never followed or quoted', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: 'npm run web',
      'web\n\u001b[31m': 'next dev -p 4002',
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: UNREAD_SOURCE('npm run …') })
  assert.equal(declared.source.includes('\u001b'), false)
  assert.equal(declared.source.includes('\n'), false)
})

// Value: protects=a delegation chain exactly at the nesting limit is read and one step further is unread (F458); fails_when=the limit is off by one; why_new=CodeRabbit CLI trivial of the review of 944a4d25..6bc9eab2; seam=temporary project folders; no_claim=other depths
test('a delegation chain of exactly the nesting limit is read', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: 'pnpm run a',
      a: 'pnpm run b',
      b: 'PORT=4132 next dev',
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, {
    port: 4132,
    source:
      'a PORT assignment in the "b" script that the dev script runs in package.json',
  })
})

test('a long unread segment is cut to 120 characters in the port source', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: `turbo-run next dev ${Array.from({ length: 40 }, () => '--port').join(' ')}`,
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  const quoted = declared.source.slice(declared.source.indexOf('"') + 1, -1)
  assert.equal(Array.from(quoted).length, 120)
  assert.ok(quoted.endsWith('… [cut]'))
})

// Value: protects=a very long word in the dev script is read in linear time (F486); fails_when=a scan that retries at every position makes the reader quadratic on the extension host; why_new=F486; seam=temporary project folders and the clock; no_claim=the absolute time on a slow machine (the bound is generous)
test('a dev script word of 100000 characters is read in well under a second', async () => {
  // Arrange
  const files = {
    'package.json': devScript(`turbo-run ${'a'.repeat(100_000)} next dev`),
  }
  const started = Date.now()

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, {
    port: 3000,
    source: UNREAD_SOURCE('… … next dev'),
  })
  assert.ok(Date.now() - started < 1000)
})

/** A `next` that prints the port it would start on (the last `-p N`, `-pN`, `--port N` or `--port=N`, else `PORT`, else 3000). */
const FAKE_NEXT = `#!/bin/sh
port="\${PORT:-3000}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p|--port) port="$2"; shift ;;
    --port=*) port="\${1#--port=}" ;;
    -p[0-9]*) port="\${1#-p}" ;;
  esac
  shift
done
echo "$port"
`

/** Runs a dev script in the real `/bin/sh` with the fake `next` first on the path and a `PATH`-only environment; `undefined` when the shell prints no port. */
async function portOfRealShell(
  script: string,
  folder: string,
): Promise<number | undefined> {
  const run = promisify(execFile)
  const result = await run('/bin/sh', ['-c', script], {
    env: { PATH: `${folder}:/usr/bin:/bin` },
    timeout: 10_000,
  }).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }))
  const last = String(result.stdout).trim().split('\n').pop() ?? ''
  return /^\d+$/.test(last) ? Number(last) : undefined
}

// Value: protects=for the grammar's own forms the reader's port is the port a real /bin/sh starts a next that reads -p N, -pN, --port N and --port=N on, and a form outside the grammar never asserts a port (D72 rule 3; F478 to F481, F487 to F491, F497); fails_when=the reader asserts a port the shell does not start; why_new=D72 allow-list, checked against a real shell (the 300-script review of c9664ea3..673b2923 found the deny-list wrong); seam=temporary project folders and a real /bin/sh with a fake next, skipped on Windows; no_claim=forms outside the grammar (the shell value is then not compared) and the real Next
for (const [name, script, unread] of [
  ['-p N', 'next dev -p 4601', false],
  ['-pN', 'next dev -p4602', false],
  ['--port N', 'next dev --port 4603', false],
  ['--port=N', 'next dev --port=4604', false],
  ['the last flag', 'next dev -p 4605 --port=4606 -p4607', false],
  ['an exported port', 'export PORT=4608 && next dev', false],
  ['an exported port and a flag', 'export PORT=4609; next dev -p 4610', false],
  ['an assignment prefix', 'PORT=4611 next dev', false],
  ['env with an assignment', 'env PORT=4612 next dev', false],
  ['the last assignment of a prefix', 'PORT=4613 PORT=4614 next dev', false],
  ['the last export', 'export PORT=4615; export PORT=4616; next dev', false],
  ['a plain next dev', 'next dev', false],
  ['a harmless variable', 'A=1 && next dev -p 4617', false],
  ['a bare shell variable', 'PORT=4618; next dev', true],
  [
    'a bare assignment to an exported port',
    'export PORT=3300; PORT=4619; next dev',
    true,
  ],
  [
    'an export that a failed && skips',
    'false && export PORT=4000 && true; next dev',
    true,
  ],
  ['an export after ||', 'false || export PORT=4000; next dev', true],
  ['a backgrounded assignment', 'PORT=4000 & next dev -p 4620', true],
  ['a piped export', 'export PORT=4000 | next dev', true],
  ['an export in a group', '{ export PORT=4000; }; next dev', true],
  ['an if that exports', 'if true; then export PORT=4000; fi; next dev', true],
  ['a negated export', '! export PORT=4000; next dev', true],
  ['a timed export', 'time export PORT=4000; next dev', true],
  [
    'an expansion that sets PORT',
    ': "${PORT:=4000}"; export PORT; next dev',
    true,
  ],
  ['an arithmetic assignment', ': $((PORT=4000)); export PORT; next dev', true],
  ['env -i', 'export PORT=4000; env -i next dev', true],
  ['env -u PORT', 'export PORT=4000; env -u PORT next dev', true],
  ['an unset', 'export PORT=4000; unset PORT; next dev', true],
  ['an unset -v', 'export PORT=4000; unset -v PORT; next dev', true],
  ['declare -x', 'declare -x PORT=4000; next dev', true],
  ['command export', 'command export PORT=4000; next dev', true],
  ['a shell default', 'next dev -p ${PORT:-4621}', true],
  ['a single-quoted sh -c', "PORT=4622 sh -c 'next dev'", true],
  ['a heredoc', 'next dev -p 4623 <<EOF\nEOF', true],
  // F505, F501, F503
  ['an export before a lone &', 'export PORT=4000 & next dev', true],
  ['a fully quoted assignment', '"PORT=4000" next dev', true],
  ['a quoted assignment name', '"PORT"=4000 next dev', true],
  ['a double-quoted assignment value', 'PORT="4624" next dev', false],
  ['a single-quoted assignment value', "PORT='4625' next dev", false],
  ['a trailing semicolon', 'next dev -p 4626;', false],
] as const)
  test(`${name} never reports a port the real shell would not start`, async (context) => {
    // Arrange
    if (process.platform === 'win32') return context.skip('needs /bin/sh')
    const folder = await mkdtemp(join(tmpdir(), 'codebook-shell-'))
    try {
      await writeFile(join(folder, 'next'), FAKE_NEXT)
      await chmod(join(folder, 'next'), 0o755)

      // Act
      const declared = await declaredPortOf({
        'package.json': devScript(script),
      })
      const shellRan = await portOfRealShell(script, folder)

      // Assert
      assert.equal(declared.source.includes('Codebook does not read'), unread)
      if (unread) assert.equal(declared.port, 3000)
      else assert.equal(declared.port, shellRan)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

/** A fake package manager or launcher for the real-shell test: a Node program, installed under every name it plays, that does what the real one does for the forms of the grammar (runs a `package.json` script with `/bin/sh`, runs the command it is given, sets `cross-env` assignments, runs each `concurrently` argument) and prints nothing else. For `pnpm <name>` and `yarn <name>` it runs the script of that name when there is one, as the real tools do for the names the reader follows (dev, start, serve, web, app, client, frontend, a name with a colon; verified with pnpm 12.14.0 and yarn 1.22.22, F510); it models no builtin, since the reader follows no other name. */
const FAKE_LAUNCHER = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { basename } = require('node:path')
const name = basename(process.argv[1])
const args = process.argv.slice(2)
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {}
const sh = (text) => spawnSync('/bin/sh', ['-c', text], { stdio: 'inherit' })
const run = (command, rest) => spawnSync(command, rest, { stdio: 'inherit' })
const runScript = (script) => {
  if (typeof scripts[script] !== 'string') process.exit(1)
  sh(scripts[script])
}
if (name === 'npm' || name === 'bun') {
  if (args[0] === 'run' || args[0] === 'run-script') runScript(args[1])
} else if (name === 'pnpm' || name === 'yarn') {
  if (args[0] === 'run') runScript(args[1])
  else if (name === 'pnpm' && args[0] === 'exec') run(args[1], args.slice(2))
  else if (typeof scripts[args[0]] === 'string') runScript(args[0])
  else if (name === 'yarn') run(args[0], args.slice(1))
} else if (name === 'npx' || name === 'bunx') {
  run(args[0], args.slice(1))
} else if (name === 'cross-env') {
  const env = { ...process.env }
  let index = 0
  for (; /^\\w+=/.test(args[index] ?? ''); index += 1) {
    const [key, ...value] = args[index].split('=')
    env[key] = value.join('=')
  }
  spawnSync(args[index], args.slice(index + 1), { stdio: 'inherit', env })
} else if (name === 'concurrently') {
  for (const arg of args) sh(arg)
}
`

/** Runs a dev script in the real `/bin/sh` inside a project folder, with the fake `next` and the fake launchers first on a `PATH`-only environment; `undefined` when the shell prints no port. */
async function portOfRealShellInProject(
  script: string,
  tools: string,
  project: string,
): Promise<number | undefined> {
  const run = promisify(execFile)
  const result = await run('/bin/sh', ['-c', script], {
    cwd: project,
    env: { PATH: `${tools}:/usr/bin:/bin` },
    timeout: 10_000,
  }).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }))
  const last = String(result.stdout).trim().split('\n').pop() ?? ''
  return /^\d+$/.test(last) ? Number(last) : undefined
}

// Value: protects=for delegations (npm, pnpm, yarn, bun reading the package.json), cross-env, concurrently, the npx, bunx, pnpm exec and yarn launchers and quoting, the reader's port is the port a real /bin/sh starts, and the plain pnpm and yarn names reach the port (D72 rule 3; F507, F500, F510); fails_when=the reader asserts a port the shell does not start, or reads a script nothing runs; why_new=F507 (OCR low, test gap: the agreement test covered only bare next, env and PORT prefixes); seam=temporary folders, a real /bin/sh and fake launchers that run the package.json scripts, a PATH-only environment, skipped on Windows; no_claim=the real npm, pnpm, yarn, bun, cross-env and concurrently
for (const [name, scripts, expected] of [
  ['npm run', { dev: 'npm run web', web: 'next dev -p 4701' }, 4701],
  [
    'npm run-script',
    { dev: 'npm run-script web', web: 'next dev -p 4702' },
    4702,
  ],
  ['pnpm <name>', { dev: 'pnpm web', web: 'next dev -p 4703' }, 4703],
  ['pnpm run', { dev: 'pnpm run web', web: 'next dev --port=4704' }, 4704],
  ['yarn <name>', { dev: 'yarn web', web: 'next dev -p4705' }, 4705],
  ['yarn run', { dev: 'yarn run web', web: 'next dev -p 4706' }, 4706],
  ['bun run', { dev: 'bun run web', web: 'next dev -p 4707' }, 4707],
  [
    'a PORT assignment before a delegation',
    { dev: 'PORT=4708 npm run web', web: 'next dev' },
    4708,
  ],
  [
    'a flag inside a delegated script that follows a PORT',
    { dev: 'PORT=4709 npm run web', web: 'next dev -p 4710' },
    4710,
  ],
  [
    'a delegation through two scripts',
    { dev: 'npm run a', a: 'pnpm run b', b: 'next dev -p 4711' },
    4711,
  ],
  ['cross-env', { dev: 'cross-env PORT=4712 next dev' }, 4712],
  [
    'cross-env with two assignments',
    { dev: 'cross-env NODE_ENV=x PORT=4713 next dev --turbo' },
    4713,
  ],
  [
    'cross-env before a delegation',
    { dev: 'cross-env PORT=4714 npm run web', web: 'next dev' },
    4714,
  ],
  ['concurrently', { dev: 'concurrently "next dev -p 4715"' }, 4715],
  [
    'concurrently with an assignment inside',
    { dev: 'concurrently "PORT=4716 next dev"' },
    4716,
  ],
  ['npx', { dev: 'npx next dev -p 4717' }, 4717],
  ['bunx', { dev: 'bunx next dev --port 4718' }, 4718],
  ['pnpm exec', { dev: 'pnpm exec next dev -p 4719' }, 4719],
  ['yarn next', { dev: 'yarn next dev -p 4720' }, 4720],
  ['a double-quoted flag value', { dev: 'next dev -p "4721"' }, 4721],
  ['a single-quoted flag value', { dev: "next dev --port '4722'" }, 4722],
  ['a quoted assignment value', { dev: 'PORT="4723" next dev' }, 4723],
  [
    'pnpm with a colon name',
    { dev: 'pnpm dev:web', 'dev:web': 'next dev -p 4728' },
    4728,
  ],
  [
    'yarn with a colon name',
    { dev: 'yarn dev:web', 'dev:web': 'next dev -p 4729' },
    4729,
  ],
  ['pnpm start', { dev: 'pnpm start', start: 'next dev -p 4730' }, 4730],
  ['yarn serve', { dev: 'yarn serve', serve: 'next dev -p 4731' }, 4731],
  [
    'pnpm run naming the shadowed script',
    { dev: 'pnpm run info', info: 'next dev -p 4726' },
    4726,
  ],
  ['a fully quoted assignment', { dev: '"PORT=4727" next dev' }, undefined],
] as const)
  test(`${name} reaches the port the reader declares through a real shell`, async (context) => {
    // Arrange
    if (process.platform === 'win32') return context.skip('needs /bin/sh')
    const tools = await mkdtemp(join(tmpdir(), 'codebook-tools-'))
    const project = await mkdtemp(join(tmpdir(), 'codebook-project-'))
    try {
      await writeFile(join(tools, 'next'), FAKE_NEXT)
      await chmod(join(tools, 'next'), 0o755)
      for (const launcher of [
        'npm',
        'pnpm',
        'yarn',
        'bun',
        'npx',
        'bunx',
        'cross-env',
        'concurrently',
      ]) {
        await writeFile(join(tools, launcher), FAKE_LAUNCHER)
        await chmod(join(tools, launcher), 0o755)
      }
      await writeFile(join(project, 'package.json'), packageScripts(scripts))

      // Act
      const declared = await readDeclaredDevelopmentPort(project, 'linux')
      const shellRan = await portOfRealShellInProject(
        scripts.dev,
        tools,
        project,
      )

      // Assert
      assert.equal(shellRan, expected)
      assert.equal(declared.port, expected ?? 3000)
      assert.equal(
        declared.source.includes('Codebook does not read'),
        expected === undefined,
      )
    } finally {
      await rm(tools, { recursive: true, force: true })
      await rm(project, { recursive: true, force: true })
    }
  })

/** Starts a real listener on an OS-chosen port; `undefined` when the host lacks that address family. */
async function listenOn(host: string, port = 0) {
  const server = createServer()
  const failure = await new Promise<NodeJS.ErrnoException | undefined>(
    (resolve) => {
      server.once('error', resolve)
      server.listen({ host, port }, () => resolve(undefined))
    },
  )
  if (failure) return undefined
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// Value: protects=a busy project port refuses the start whichever loopback address the learner's own dev server listens on (D63, F411: a `::` or `::1` listener does not block a bind to 127.0.0.1); fails_when=the check passes while the port is in use, or the message omits the port, the origin reason or the recovery; why_new=the bind-only check missed `next dev -p 3165`'s wildcard listener; seam=real loopback listeners on OS-chosen ports; no_claim=the learner's actual dev server
for (const host of ['127.0.0.1', '::1', '::']) {
  test(`a dev server listening on ${host} refuses the start and names the port, the origin reason and the recovery`, async (context) => {
    // Arrange
    const occupant = await listenOn(host)
    if (!occupant) return context.skip(`${host} is not available on this host`)
    try {
      // Act
      const refusal = await assertDevelopmentPortFree({
        port: occupant.port,
        source: 'the dev script in package.json',
      }).then(
        () => undefined,
        (error: unknown) => error,
      )

      // Assert
      assert.ok(refusal instanceof StudyError)
      assert.equal(refusal.code, 'PREREQUISITE_MISSING')
      assert.equal(
        refusal.message,
        `Port ${occupant.port} is in use on this machine, and the project declares it (the dev script in package.json): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to stop the process that listens on port ${occupant.port} (often their own dev server), then start again.`,
      )
    } finally {
      await occupant.close()
    }
  })
}

test('a free project port passes the start check', async () => {
  // Arrange
  const probe = createServer()
  await new Promise<void>((resolve) =>
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve),
  )
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  const { port } = address
  await new Promise((resolve) => probe.close(resolve))

  // Act
  const outcome = await assertDevelopmentPortFree({ port, source: 'test' })

  // Assert
  assert.equal(outcome, undefined)
})

/** A connect that never answers: it only reports the idle timeout, as a loopback connect does while Windows retries its SYN. */
const silentConnect: ConnectLoopback = () => {
  const socket = new EventEmitter() as unknown as Socket
  Object.assign(socket, {
    setTimeout: () => {
      setImmediate(() => socket.emit('timeout'))
      return socket
    },
    destroy: () => socket,
  })
  return socket
}

/** Returns a port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) =>
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve),
  )
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolve) => probe.close(resolve))
  return address.port
}

// Value: protects=a free port is not refused as in use when the loopback connect only times out (F414: Windows reports a refused loopback connect after 1 to 2 s); fails_when=a timed-out connect counts as a listener; why_new=OCR M1; seam=an injected connect that never answers plus the real bind probe on a free OS-chosen port; no_claim=a Windows run
test('a free port passes the start check when the loopback connect only times out', async () => {
  // Arrange
  const port = await freePort()

  // Act
  const outcome = await assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: silentConnect },
  )

  // Assert
  assert.equal(outcome, undefined)
})

// Value: protects=a timed-out connect does not hide a port that the bind probe finds taken; fails_when=the timeout makes a busy port look free; why_new=F414 fix relies on the bind probe; seam=injected silent connect plus a real listener on 127.0.0.1; no_claim=wildcard listeners (the connect tests above)
test('a port held on 127.0.0.1 is still refused when the loopback connect only times out', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  try {
    // Act
    const refusal = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { connect: silentConnect },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.match(refusal.message, /^Port \d+ is in use on this machine/)
  } finally {
    await occupant.close()
  }
})

// Value: protects=a port the system does not let Codebook listen on is refused as not permitted, not as in use (F422); fails_when=EACCES is worded as another process's listener or passes; why_new=OCR L3; seam=an injected bind that fails with EACCES; no_claim=a real privileged port (platform-dependent)
test('a port the system refuses to let Codebook listen on is refused as not permitted', async () => {
  // Arrange
  const port = await freePort()
  const bind = async () =>
    Object.assign(new Error('listen EACCES'), { code: 'EACCES' })

  // Act
  const refusal = await assertDevelopmentPortFree(
    { port, source: 'the dev script in package.json' },
    { connect: silentConnect, bind },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.equal(
    refusal.message,
    `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it, as for a port below 1024 without administrator rights or a port range the system reserves), and the project declares it (the dev script in package.json): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to declare a port from 1024 up for the project (the -p/--port of next dev or a PORT= in the dev script), or to allow listening on port ${port}, then start again.`,
  )
})

// Value: protects=a port that Codebook's own stopping run releases within the wait does not fail the next start (F422); fails_when=the check refuses at once or blames the learner; why_new=OCR L3; seam=a real listener closed after 150 ms and the recorded owned port; no_claim=the real process-group exit
test('a port that Codebook own stopping run releases within the wait passes the start check', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  const claim = claimOwnedDevelopmentPort(occupant.port)
  beginReleaseOfOwnedDevelopmentPort(claim)
  setTimeout(() => void occupant.close(), 150)
  try {
    // Act
    const outcome = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { releaseWaitMs: 3000 },
    )

    // Assert
    assert.equal(outcome, undefined)
  } finally {
    releaseOwnedDevelopmentPort(claim)
  }
})

// Value: protects=a port that Codebook's own run keeps holding is named as that run's, never as the learner's dev server (F422); fails_when=the refusal tells the learner to stop their own dev server; why_new=OCR L3; seam=a real listener plus the recorded owned port; no_claim=the real run
for (const [state, wording] of [
  ['running', 'that is still running'],
  ['stopping', 'that has not finished stopping'],
] as const)
  test(`a port held by Codebook own ${state} run is refused naming that run`, async () => {
    // Arrange
    const occupant = await listenOn('127.0.0.1')
    assert.ok(occupant)
    const claim = claimOwnedDevelopmentPort(occupant.port)
    if (state === 'stopping') beginReleaseOfOwnedDevelopmentPort(claim)
    try {
      // Act
      const refusal = await assertDevelopmentPortFree(
        { port: occupant.port, source: 'test' },
        { releaseWaitMs: 200 },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )

      // Assert
      assert.ok(refusal instanceof StudyError)
      assert.equal(
        refusal.message,
        `Port ${occupant.port} is still held by an earlier Codebook repository-browser run ${wording}, and the project declares it (test): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Stop that run (codebook_stop) and wait for it to finish stopping, then start again.`,
      )
    } finally {
      releaseOwnedDevelopmentPort(claim)
      await occupant.close()
    }
  })

/** A connect that fails at once with the given system error code, as a sandbox or firewall does (EPERM) or a stack that gives up (ETIMEDOUT). */
function failingConnect(code: string): ConnectLoopback {
  return () => {
    const socket = new EventEmitter() as unknown as Socket
    Object.assign(socket, {
      setTimeout: () => {
        setImmediate(() =>
          socket.emit('error', Object.assign(new Error(code), { code })),
        )
        return socket
      },
      destroy: () => socket,
    })
    return socket
  }
}

// Value: protects=an unexpected connect error leaves the decision to the bind probe instead of aborting the start with a raw error (F432); fails_when=EPERM, ETIMEDOUT or ECONNRESET rejects a free port, or hides a port the bind refuses; why_new=OCR L4; seam=an injected failing connect plus the real bind probe; no_claim=a sandbox that forbids loopback connects
for (const code of ['EPERM', 'ETIMEDOUT', 'ECONNRESET']) {
  test(`a free port passes the start check when the loopback connect fails with ${code}`, async () => {
    // Arrange
    const port = await freePort()

    // Act
    const outcome = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { connect: failingConnect(code) },
    )

    // Assert
    assert.equal(outcome, undefined)
  })
}

test('a port held on 127.0.0.1 is still refused when the loopback connect fails with EPERM', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  try {
    // Act
    const refusal = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { connect: failingConnect('EPERM') },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.match(refusal.message, /^Port \d+ is in use on this machine/)
  } finally {
    await occupant.close()
  }
})

// Value: protects=a start waits for another run's release even when the port already looks free, so its listener never meets the old run's endpoint check (F429); fails_when=the free-port early return skips the wait; why_new=OCR M1 of the review of e638c1b..7139a69e; seam=two claims of the registry and a free OS-chosen port; no_claim=the real process-group exit
test('a free port is not passed while another run is still releasing it', async () => {
  // Arrange
  const port = await freePort()
  const earlierRun = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(earlierRun)
  let released = false
  setTimeout(() => {
    released = true
    releaseOwnedDevelopmentPort(earlierRun)
  }, 150)

  // Act
  await assertDevelopmentPortFree(
    { port, source: 'test' },
    { releaseWaitMs: 3000 },
  )

  // Assert
  assert.equal(released, true)
})

// Value: protects=a claim that never releases does not block a free port for ever (F429 bound); fails_when=the wait throws or exceeds its bound when the port is free; why_new=a failed close leaves its claim stopping; seam=a stuck claim and a free port; no_claim=the claim's later retry
test('a free port passes after the wait when the earlier run never reports its release', async () => {
  // Arrange
  const port = await freePort()
  const stuck = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(stuck)

  try {
    // Act
    const outcome = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { releaseWaitMs: 200 },
    )

    // Assert
    assert.equal(outcome, undefined)
  } finally {
    releaseOwnedDevelopmentPort(stuck)
  }
})

// Value: protects=one run's release deletes only its own claim (F429); fails_when=run A's release removes run B's running claim and the next refusal blames the learner; why_new=OCR M1; seam=the registry with two claims on one port; no_claim=the launcher's wiring
test("releasing one run's claim keeps the other run's claim on the same port", () => {
  // Arrange
  const runA = claimOwnedDevelopmentPort(54001)
  const runB = claimOwnedDevelopmentPort(54001)

  // Act
  releaseOwnedDevelopmentPort(runA)

  // Assert
  assert.equal(ownedDevelopmentPortState(54001), 'running')
  releaseOwnedDevelopmentPort(runB)
  assert.equal(ownedDevelopmentPortState(54001), undefined)
})

// Value: protects=a cancelled run does not wait out the release bound (F432); fails_when=the abort is ignored or swallowed and the cancel takes the full wait; why_new=OCR L5; seam=a stuck claim and an abort after 50 ms; no_claim=the run's own cancellation path
test('cancelling during the wait for a stopping run ends the start check at once', async () => {
  // Arrange
  const port = await freePort()
  const stuck = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(stuck)
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('Run cancelled')), 50)
  const startedAt = performance.now()

  try {
    // Act
    const failure = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { releaseWaitMs: 5000, signal: controller.signal },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.equal(String(failure), 'Error: Run cancelled')
    assert.ok(performance.now() - startedAt < 2000)
  } finally {
    releaseOwnedDevelopmentPort(stuck)
  }
})

// Value: protects=a start is refused while another run has claimed the port but its server has not bound yet, even when this start's probe reads the port free (F449); fails_when=two parallel starts both pass and launch on one port; why_new=OCR medium of the review of 944a4d25..6bc9eab2; seam=two parallel checks on one free OS-chosen port, run B's bind probe held until run A has claimed; no_claim=the real launch
test('a parallel start is refused once the other run claimed the port, although the probe reads it free', async () => {
  // Arrange
  const port = await freePort()
  let runAClaim: ReturnType<typeof claimOwnedDevelopmentPort> | undefined
  let openGate: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const bindForB = async () => {
    await gate
    return undefined
  }
  const runB = assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: silentConnect, bind: bindForB },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  try {
    // Act
    await assertDevelopmentPortFree(
      { port, source: 'test' },
      { connect: silentConnect },
    )
    runAClaim = claimOwnedDevelopmentPort(port)
    openGate()
    const refusal = await runB

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(
      refusal.message,
      `Port ${port} is still held by an earlier Codebook repository-browser run that is still running, and the project declares it (test): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Stop that run (codebook_stop) and wait for it to finish stopping, then start again.`,
    )
  } finally {
    if (runAClaim) releaseOwnedDevelopmentPort(runAClaim)
  }
})

// Value: protects=a cancel during the probe's own connect ends the start check at once instead of after the pending connect (F456); fails_when=the abort is honored only after the connect times out and the check goes on; why_new=OCR low of the review of 944a4d25..6bc9eab2; seam=an injected connect that answers only after 400 ms and an abort after 30 ms; no_claim=a real network connect
test('cancelling while the probe waits for a connect ends the start check at once', async () => {
  // Arrange
  const port = await freePort()
  const controller = new AbortController()
  let connects = 0
  let destroyed = false
  const slowConnect: ConnectLoopback = () => {
    connects += 1
    const socket = new EventEmitter() as unknown as Socket
    const timer = setTimeout(() => socket.emit('timeout'), 400)
    Object.assign(socket, {
      setTimeout: () => socket,
      destroy: () => {
        destroyed = true
        clearTimeout(timer)
        return socket
      },
    })
    return socket
  }
  setTimeout(() => controller.abort(new Error('Run cancelled')), 30)

  // Act
  const failure = await assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: slowConnect, signal: controller.signal },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(String(failure), 'Error: Run cancelled')
  assert.equal(connects, 1)
  assert.equal(destroyed, true)
})
