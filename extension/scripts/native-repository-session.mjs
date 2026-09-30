import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { openSync, closeSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readHostInstallation } from '../dist/runtimeSupport/utils/readHostInstallation.js'
import { selectHost } from '../dist/runtimeSupport/utils/selectHost.js'
import { createNativeProfile } from '../dist/utils/createNativeProfile.js'

// Launches only an isolated native test profile; the driving agent supplies every authored article through public MCP.
if (!process.env.CODEBOOK_WORKSPACE?.trim())
  throw new Error(
    'Set CODEBOOK_WORKSPACE to the external repository to validate.',
  )
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  workspace = resolve(process.env.CODEBOOK_WORKSPACE)
const hostId = selectHost(process.env.CODEBOOK_HOST),
  installation = await readHostInstallation(hostId)
const previousPath = process.argv[2],
  previous = previousPath
    ? JSON.parse(await readFile(previousPath, 'utf8'))
    : undefined
if (
  previous &&
  (previous.host.id !== hostId || previous.workspace !== workspace)
)
  throw new Error('Reload identity differs from the original native session.')
const directory = join(
  packageRoot,
  '../artifacts/native-repository',
  hostId,
  `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`,
)
const profile = previous?.profile ?? (await createNativeProfile()),
  prefix = previous ? 'reload' : 'live'
await mkdir(directory, { recursive: true, mode: 0o700 })
await mkdir(join(profile, 'User'), { recursive: true, mode: 0o700 })
if (!previous)
  await writeFile(
    join(profile, 'User/settings.json'),
    JSON.stringify(
      {
        'security.workspace.trust.enabled': false,
        'workbench.startupEditor': 'none',
        'debug.openDebug': 'neverOpen',
        'workbench.enableExperiments': false,
        'workbench.editor.restoreViewState': true,
        'codebook.nodeExecutable': process.execPath,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
await writeFile(
  join(directory, 'repository-command.json'),
  JSON.stringify({ sequence: 0, action: 'inspect' }),
  { mode: 0o600 },
)
const editorCdp = process.env.CODEBOOK_EDITOR_CDP === '1'
// Optional loopback debugging targets only this isolated QA profile, never the learner's regular editor.
const arguments_ = [
  '--new-window',
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  ...(hostId === 'cursor' ? ['--skip-onboarding'] : []),
  ...(editorCdp
    ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0']
    : []),
  '--user-data-dir',
  profile,
  '--extensions-dir',
  join(directory, 'extensions'),
  '--extensionDevelopmentPath',
  packageRoot,
  '--extensionTestsPath',
  join(packageRoot, 'dist/nativeRepositoryBootstrap.js'),
  workspace,
]
const output = openSync(join(directory, `${prefix}.log`), 'w', 0o600)
let child
try {
  child = spawn(installation.binaryPath, arguments_, {
    env: {
      ...process.env,
      VSCODE_CLI: '1',
      CODEBOOK_REPOSITORY_SUITE: directory,
      CODEBOOK_REPOSITORY_RELOAD: previous ? '1' : '0',
    },
    stdio: ['ignore', output, output],
  })
} finally {
  closeSync(output)
}
// Observe an early editor failure before metadata I/O yields; retain rejection until the final await.
const exited = new Promise((resolveExit, reject) => {
  child.once('exit', resolveExit)
  child.once('error', reject)
})
void exited.catch(() => undefined)
try {
  const build = JSON.parse(
    await readFile(join(packageRoot, 'dist/build.json'), 'utf8'),
  )
  const manifest = {
    host: installation.host,
    cliVersion: installation.cliVersion,
    workspace,
    profile,
    previousLaunch: previousPath ? resolve(previousPath) : undefined,
    executable: installation.binaryPath,
    arguments: arguments_,
    pid: child.pid,
    editorCdp,
    build,
    sourceAuthor: 'driving agent through public MCP',
    nativeVisualInspection: 'pending',
  }
  await writeFile(
    join(directory, `${prefix}-launch.json`),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  )
} catch (error) {
  // Metadata failure must drain only this newly acquired QA editor before the launcher rejects.
  const NATIVE_SHUTDOWN_GRACE_MS = 5_000
  child.kill('SIGTERM')
  const escalation = setTimeout(
    () => child.kill('SIGKILL'),
    NATIVE_SHUTDOWN_GRACE_MS,
  )
  try {
    await exited.catch(() => undefined)
  } finally {
    clearTimeout(escalation)
  }
  throw error
}
console.log(
  JSON.stringify({
    directory,
    profile,
    pid: child.pid,
    host: installation.host,
    bootstrap: join(directory, `${prefix}-0.json`),
  }),
)
const code = await exited
console.log(JSON.stringify({ directory, exitCode: code }))
process.exitCode = code ?? 1
