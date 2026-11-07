import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { buildLibraryHookSource } from '../utils/libraryHookScript'

import {
  CASE_IMPORTS,
  CASE_PACKAGE_NAME,
  CASE_PEERS,
  LIBRARY_RESOLUTION_CASES,
} from './utils/libraryResolutionCases'

/** Writes a file, creating its folder. */
function writeAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** Writes a tiny ES package named `name` under `<root>/node_modules`, with the subpaths the cases import. */
function writePackage(root: string, name: string): void {
  const folder = join(root, 'node_modules', name)
  writeAt(
    join(folder, 'package.json'),
    JSON.stringify({
      name,
      type: 'module',
      exports: {
        '.': './index.mjs',
        './sub': './index.mjs',
        './jsx-runtime': './index.mjs',
      },
    }),
  )
  writeAt(join(folder, 'index.mjs'), 'export default 1\n')
}

/** The probe both importers run: it imports each case specifier and prints, per specifier, the kinds of hook event the import produced. */
const PROBE = `
import { readFileSync } from 'node:fs'
const cases = JSON.parse(process.env.CASES)
const lines = () => { try { return readFileSync(process.env.OBS, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const kinds = []
for (const specifier of cases) {
  const before = lines().length
  try { await import(specifier) } catch {}
  kinds.push(lines().slice(before).map((e) => e.event).filter((e) => e === 'resolve' || e === 'peer' || e === 'dependency'))
}
console.log(JSON.stringify(kinds))
`

// protects=the Node hook routes every row of the shared resolution table the way the Vite plugin must (package, subpath, peer, dependency, # import, outside import, relative, absolute, built-in); fails_when=the two runtimes disagree on a row, which would serve different copies in a node-script run and a Vite run; no_claim=bundler resolution, require() (libraryPackageResolution.test.ts covers it)
test('the Node hook routes every case of the shared resolution table as the table expects', () => {
  // Arrange
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codebook-hook-cases-')))
  try {
    const privateFolder = join(root, 'private')
    const packedRoot = join(privateFolder, 'node_modules', CASE_PACKAGE_NAME)
    const exampleRoot = join(root, 'example')
    const libraryRoot = join(root, 'library')
    writeAt(
      join(packedRoot, 'package.json'),
      JSON.stringify({
        name: CASE_PACKAGE_NAME,
        type: 'module',
        exports: { '.': './index.mjs', './sub': './index.mjs' },
        imports: CASE_IMPORTS,
        peerDependencies: Object.fromEntries(
          CASE_PEERS.map((peer) => [peer, '*']),
        ),
      }),
    )
    writeAt(join(packedRoot, 'index.mjs'), 'export default 1\n')
    writeAt(join(packedRoot, 'local.mjs'), 'export default 1\n')
    writeAt(join(exampleRoot, 'package.json'), '{"type":"module"}')
    writeAt(join(exampleRoot, 'rel.mjs'), 'export default 1\n')
    writeAt(join(libraryRoot, 'package.json'), '{"type":"module"}')
    // Peers live beside the Example, other dependencies beside the library; `both` exists in each world.
    for (const name of ['react', 'both', 'lodash-es']) {
      writePackage(exampleRoot, name)
      writePackage(libraryRoot, name)
    }
    const observationFile = join(privateFolder, 'observation.jsonl')
    writeAt(observationFile, '')
    const hookFile = join(privateFolder, 'hook.mjs')
    writeAt(
      hookFile,
      buildLibraryHookSource({
        packageName: CASE_PACKAGE_NAME,
        packedRoot,
        privateFolder,
        exampleRoot,
        libraryRoot,
        peers: CASE_PEERS,
        observationFile,
        observationLimitBytes: 1_000_000,
      }),
    )
    writeAt(join(packedRoot, 'probe.mjs'), PROBE)
    writeAt(join(exampleRoot, 'probe.mjs'), PROBE)
    const run = (importerInsidePacked: boolean): string[][] => {
      const probeFolder = importerInsidePacked ? packedRoot : exampleRoot
      const specifiers = LIBRARY_RESOLUTION_CASES.map((testCase) =>
        testCase.specifier.replace('{packedRoot}', packedRoot),
      )
      const output = execFileSync(
        process.execPath,
        ['--import', hookFile, join(probeFolder, 'probe.mjs')],
        {
          cwd: probeFolder,
          encoding: 'utf8',
          env: {
            ...process.env,
            CASES: JSON.stringify(specifiers),
            OBS: observationFile,
          },
        },
      )
      return JSON.parse(output.trim().split('\n').pop() ?? '[]')
    }
    // Act
    const insideKinds = run(true)
    const outsideKinds = run(false)
    const actual = LIBRARY_RESOLUTION_CASES.map((testCase, index) => {
      const events =
        (testCase.importerInsidePacked ? insideKinds : outsideKinds)[index] ??
        []
      const kind = events[0]
      return `${testCase.name}: ${kind === undefined ? 'untouched' : kind === 'resolve' ? 'library' : kind}`
    })
    // Assert
    assert.deepEqual(
      actual,
      LIBRARY_RESOLUTION_CASES.map(
        (testCase) => `${testCase.name}: ${testCase.expected}`,
      ),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
