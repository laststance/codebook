import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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
async function declaredPortOf(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-port-'))
  try {
    for (const [name, text] of Object.entries(files))
      await writeFile(join(root, name), text)
    return await readDeclaredDevelopmentPort(root)
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
        a: 'pnpm b',
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
      dev: 'pnpm a',
      a: 'pnpm b',
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
