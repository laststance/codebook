import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { isRunAsScript } from '../utils/isRunAsScript.mjs'
import { plainOutputEnvironment } from '../utils/plainOutputEnvironment.mjs'

const HELPER_URL = new URL('../utils/isRunAsScript.mjs', import.meta.url).href
/** What every probe prints: the helper's answer for the probe's own URL, on one line. */
const PROBE_BODY = `import { isRunAsScript } from ${JSON.stringify(HELPER_URL)}
console.log(JSON.stringify({ runAsScript: isRunAsScript(import.meta.url) }))
`

/** Creates a temporary folder (removed by the test context) that holds `probe.mjs`, a module that prints the helper's answer for itself. @example const { directory, probePath } = await createProbe(context) */
async function createProbe(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-is-run-as-script-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const probePath = join(directory, 'probe.mjs')
  await writeFile(probePath, PROBE_BODY)
  return { directory, probePath }
}

/** Starts Node with the given arguments (and standard input, in `directory`) and answers its exit code and both streams. @example runNode([probePath]) // => { code: 0, stdout: '{"runAsScript":true}\n', stderr: '' } */
function runNode(nodeArguments, { input, directory } = {}) {
  const result = spawnSync(process.execPath, nodeArguments, {
    encoding: 'utf8',
    timeout: 30_000,
    input,
    cwd: directory,
    env: plainOutputEnvironment(process.env),
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr }
}

// Value: protects=every script that both exports functions for tests and runs as a program (the watchdog, and the closing-keyword hook once it uses the helper): started by `node script.mjs` it must be detected, or the script prints nothing and exits 0; fails_when=the helper answers false for a module that Node started from a file; why_new=Issue #96 review (isRunAsScript was copied into two scripts); seam=a probe module written to a temporary folder and started as a process; no_claim=a Node older than the repository's 24
test('a module that Node starts as the program is detected', async (context) => {
  // Arrange
  const { probePath } = await createProbe(context)

  // Act
  const result = runNode([probePath])

  // Assert
  assert.deepEqual(result, {
    code: 0,
    stdout: '{"runAsScript":true}\n',
    stderr: '',
  })
})

// Value: protects=a script started through a symbolic link, as every path under /tmp is on macOS (/tmp is a link to /private/tmp, where worktrees live): by a link to the file, and by a path that runs through a link to a folder above it; fails_when=the path on the command line is compared as it is with the module's real path, so the program is not detected and the script prints nothing; why_new=Issue #96 review (the reason for the real-path comparison, and for not using import.meta.main); seam=a probe module started as a process through a link to the file and through a link to its folder; no_claim=a link that points nowhere
test('a module that Node starts through a symbolic link to it, or to a folder above it, is detected', async (context) => {
  // Arrange
  const { directory, probePath } = await createProbe(context)
  const linkToFile = join(directory, 'link-to-probe.mjs')
  await symlink(probePath, linkToFile)
  const linkToFolder = join(directory, 'link-to-folder')
  await symlink(directory, linkToFolder)

  // Act
  const throughFileLink = runNode([linkToFile])
  const throughFolderLink = runNode([join(linkToFolder, 'probe.mjs')])

  // Assert
  assert.deepEqual(
    { throughFileLink, throughFolderLink },
    {
      throughFileLink: {
        code: 0,
        stdout: '{"runAsScript":true}\n',
        stderr: '',
      },
      throughFolderLink: {
        code: 0,
        stdout: '{"runAsScript":true}\n',
        stderr: '',
      },
    },
  )
})

// Value: protects=a script started with Node's --preserve-symlinks-main, where the module's own URL keeps the link instead of the real path: the command line's path and the URL then agree only after a real-path lookup of both; fails_when=the module's URL is compared as it is, so the program is not detected and the script prints nothing; why_new=Issue #96 review (the helper resolves both sides, which the sibling's copy did not); seam=a probe module started as a process through a link to the file, with the two flags that keep links; no_claim=other Node flags
test('a module whose own URL still runs through a symbolic link, as with --preserve-symlinks-main, is detected', async (context) => {
  // Arrange
  const { directory, probePath } = await createProbe(context)
  const linkToFile = join(directory, 'link-to-probe.mjs')
  await symlink(probePath, linkToFile)

  // Act
  const result = runNode([
    '--preserve-symlinks-main',
    '--preserve-symlinks',
    linkToFile,
  ])

  // Assert
  assert.deepEqual(result, {
    code: 0,
    stdout: '{"runAsScript":true}\n',
    stderr: '',
  })
})

// Value: protects=the tests of every such script, which import it and must get its functions and no output: a module that another script imports is not the program, however its own code asks; fails_when=the helper answers true for an imported module, so importing the script runs its work (the real script would print a report into the test run); why_new=Issue #96 review; seam=an importer module started as a process that imports the probe module; no_claim=a module that is imported by a program that was itself started through a link
test('a module that another script imports is not detected as the program', async (context) => {
  // Arrange
  const { directory } = await createProbe(context)
  const importerPath = join(directory, 'importer.mjs')
  await writeFile(importerPath, "import './probe.mjs'\n")

  // Act
  const result = runNode([importerPath])

  // Assert
  assert.deepEqual(result, {
    code: 0,
    stdout: '{"runAsScript":false}\n',
    stderr: '',
  })
})

// Value: protects=the answer for a module that exists but is not the program, in the test's own process; fails_when=any URL of an existing file is taken for the program; why_new=Issue #96 review (keeps this test's import of the helper used, so that the pre-gate's import graph selects it for a change to the helper); seam=the helper imported by this test, asked about its own file, which this test only imports; no_claim=the real start-up cases, which the process tests above and below show
test('a module that the running program only imports is not detected, even though its file exists', () => {
  // Arrange: this test file is the program here; the helper is a module that it only imports.
  const importedModuleUrl = HELPER_URL

  // Act
  const detected = isRunAsScript(importedModuleUrl)

  // Assert
  assert.equal(detected, false)
})

// Value: protects=a program that is no file, code from the command line (`node -e`) or from standard input (`node -`): the helper answers false and does not throw; fails_when=the missing or unreadable entry path ends the program with an error instead of the answer false; why_new=Issue #96 review (the two defensive branches of the helper); seam=a module-typed program given to Node through -e and through standard input, in an empty folder; no_claim=a file that is named `-`
test('a program that is no file, code from the command line or from standard input, detects no script', async (context) => {
  // Arrange: standard input runs in an empty folder, so that no file named `-` can stand in for the program.
  const { directory } = await createProbe(context)
  await mkdir(join(directory, 'empty'))

  // Act
  const fromCommandLine = runNode(['--input-type=module', '-e', PROBE_BODY])
  const fromStandardInput = runNode(['--input-type=module', '-'], {
    input: PROBE_BODY,
    directory: join(directory, 'empty'),
  })

  // Assert
  assert.deepEqual(
    { fromCommandLine, fromStandardInput },
    {
      fromCommandLine: {
        code: 0,
        stdout: '{"runAsScript":false}\n',
        stderr: '',
      },
      fromStandardInput: {
        code: 0,
        stdout: '{"runAsScript":false}\n',
        stderr: '',
      },
    },
  )
})
