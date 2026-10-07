import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build as bundle, version as esbuildVersion } from 'esbuild'

import { assertStableCheckout } from './assertStableCheckout.mjs'
import { cleanPackageOutputs } from './cleanPackageOutputs.mjs'
import { inspectBundle } from './inspectBundle.mjs'
import { loadBuiltExtension } from './loadBuiltExtension.mjs'
import { PACKAGE_MANIFEST_PATH } from './packageConstants.mjs'
import { readBuildIdentity } from './readBuildIdentity.mjs'
import { readVsixBytes } from './readVsixBytes.mjs'
import { readVsixEntries } from './readVsixEntries.mjs'
import { resolvePackageDestination } from './resolvePackageDestination.mjs'
import { runPackageCommand } from './runPackageCommand.mjs'
import {
  REQUIRED_PACKAGE_FILES,
  verifyPackageContent,
} from './verifyPackageContent.mjs'
import { withPackageOutput } from './withPackageOutput.mjs'

/** Clean-builds and validates one self-contained private VSIX before replacing the requested output. @example await buildPackage(repository, '/tmp/codebook.vsix') */
export async function buildPackage(
  repository,
  output,
  runCommand = runPackageCommand,
) {
  // Reject unsupported process ownership before Git, output preparation or destructive compiler cleanup.
  if (process.platform === 'win32')
    throw new Error(
      'Package builds require POSIX process-group cleanup; Windows builds are unsupported.',
    )
  const started = performance.now(),
    extensionRoot = join(repository, 'extension')
  // Fail unavailable package-manager startup before deleting any compiler output; retain the executable's actual version.
  const { stdout: pnpmVersion } = await runCommand(
    'pnpm',
    ['--version'],
    extensionRoot,
  )
  const destination = await resolvePackageDestination(repository, output),
    before = await readBuildIdentity(repository)
  return withPackageOutput(
    destination,
    async ({ directory, candidate, stage }) => {
      // Source snapshot -> clean compilation -> closed stage -> real archive -> isolated load -> atomic publication.
      await cleanPackageOutputs(repository)
      // Corepack selects the package manager from cwd before pnpm processes --dir.
      await runCommand('pnpm', ['build'], extensionRoot)
      await assertStableCheckout(repository, before, directory, 'compilation')
      const compiled = await import(
        pathToFileURL(join(extensionRoot, 'dist/constants.js')).href
      )
      const developmentManifest = JSON.parse(
        await readFile(join(extensionRoot, 'package.json'), 'utf8'),
      )
      assert.equal(
        compiled.EXTENSION_VERSION,
        developmentManifest.version,
        'Runtime and package versions differ.',
      )
      const build = JSON.parse(
        await readFile(join(extensionRoot, 'dist/build.json'), 'utf8'),
      )
      assert.deepEqual(
        build,
        {
          ...before,
          extensionVersion: compiled.EXTENSION_VERSION,
          apiVersion: compiled.API_VERSION,
        },
        'Compiled metadata does not match package inputs.',
      )
      const capturedInputs = new Map()
      const result = await bundle({
        absWorkingDir: repository,
        entryPoints: {
          extension: 'extension/dist/extension.js',
          cursorMcpBridge: 'extension/dist/cursorMcpBridgeEntry.js',
        },
        outdir: join(stage, 'dist'),
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'cjs',
        external: ['vscode'],
        metafile: true,
        write: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'capture-bundle-inputs',
            setup(builder) {
              builder.onLoad(
                { filter: /\.(?:[cm]?js|json)$/, namespace: 'file' },
                async ({ path }) => {
                  const canonical = await realpath(path),
                    contents = await readFile(canonical)
                  capturedInputs.set(canonical, contents)
                  return {
                    contents,
                    loader: path.endsWith('.json') ? 'json' : 'js',
                  }
                },
              )
            },
          },
        ],
        define: {
          'process.env.WS_NO_BUFFER_UTIL': '"1"',
          'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
        },
      })
      assert.equal(
        result.warnings.length,
        0,
        `Bundler warnings: ${JSON.stringify(result.warnings)}`,
      )
      const inventory = await inspectBundle(
          result.metafile,
          repository,
          capturedInputs,
        ),
        files = new Map()
      const installedManifest = { ...developmentManifest }
      for (const key of [
        'scripts',
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'packageManager',
      ])
        delete installedManifest[key]
      files.set(
        'package.json',
        Buffer.from(`${JSON.stringify(installedManifest, null, 2)}\n`),
      )
      for (const name of ['extension', 'cursorMcpBridge']) {
        const output = result.outputFiles.find(
          (file) => file.path === join(stage, 'dist', `${name}.js`),
        )
        if (!output) throw new Error(`Missing bundled entry: ${name}`)
        files.set(`dist/${name}.js`, Buffer.from(output.contents))
      }
      files.set(
        'THIRD_PARTY_NOTICES.md',
        Buffer.from(
          `# Bundled dependency notices\n\n${inventory.dependencies.map((dependency) => `- ${dependency.name}@${dependency.version} (${dependency.license}): ${dependency.notices.map((notice) => `[${notice.sourcePath}](${notice.file})`).join(', ')}`).join('\n')}\n\nThe MCP SDK includes the patch identified in dist/build.json. Codebook remains private software; dependency licenses apply to their respective code.\n`,
        ),
      )
      for (const file of REQUIRED_PACKAGE_FILES.filter(
        (file) => !files.has(file),
      )) {
        const source = join(
          extensionRoot,
          file === 'readme.md' ? 'README.md' : file,
        )
        if (!(await lstat(source)).isFile())
          throw new Error(`Package source must be a regular file: ${file}`)
        files.set(file, await readFile(source))
      }
      for (const [file, content] of inventory.noticeFiles)
        files.set(file, content)
      const requireTool = createRequire(import.meta.url),
        vsceManifestPath = requireTool.resolve('@vscode/vsce/package.json')
      // Describe resolved tool packages rather than package.json requirements; source cleanliness is a separate assertion.
      const vsceManifest = JSON.parse(await readFile(vsceManifestPath, 'utf8'))
      const typescriptManifest = JSON.parse(
        await readFile(requireTool.resolve('typescript/package.json'), 'utf8'),
      )
      const manifest = {
        schemaVersion: 1,
        extension: {
          name: installedManifest.name,
          publisher: installedManifest.publisher,
          version: installedManifest.version,
          apiVersion: compiled.API_VERSION,
        },
        build,
        tools: {
          node: process.versions.node,
          pnpm: pnpmVersion.trim(),
          esbuild: esbuildVersion,
          vsce: vsceManifest.version,
          typescript: typescriptManifest.version,
        },
        inputs: inventory.inputs,
        dependencies: inventory.dependencies,
        externals: inventory.externals,
        files: Object.fromEntries(
          [...files]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([file, content]) => [
              file,
              {
                bytes: content.length,
                sha256: createHash('sha256').update(content).digest('hex'),
              },
            ]),
        ),
      }
      files.set(
        PACKAGE_MANIFEST_PATH,
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      )
      for (const [file, content] of files) {
        const path = join(stage, file)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
      }
      await runCommand(
        process.execPath,
        ['--check', join(stage, 'dist/cursorMcpBridge.js')],
        repository,
      )
      await runCommand(
        process.execPath,
        ['--check', join(stage, 'skills/codebook/publish-wiki.mjs')],
        repository,
      )
      // A syntax-valid bridge can still exit without entering its bundled CLI; require the fixed recovery path.
      let bridgeStartupFailure
      try {
        await runCommand(
          process.execPath,
          [
            join(stage, 'dist/cursorMcpBridge.js'),
            join(stage, 'missing.connection.json'),
          ],
          repository,
        )
      } catch (error) {
        bridgeStartupFailure = error
      }
      assert.equal(
        bridgeStartupFailure?.code,
        1,
        'Bundled Cursor MCP bridge did not reject an unavailable connection descriptor.',
      )
      assert.equal(
        bridgeStartupFailure.stderr.trim(),
        'Codebook Cursor MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Cursor window.',
      )
      const vsce = join(dirname(vsceManifestPath), 'vsce')
      await runCommand(
        process.execPath,
        [
          vsce,
          'package',
          '--out',
          candidate,
          '--no-dependencies',
          '--skip-license',
          '--no-rewrite-relative-links',
          '--no-gitHubIssueLinking',
          '--no-gitLabIssueLinking',
        ],
        stage,
      )
      const archiveBytes = await readVsixBytes(candidate)
      const entries = await readVsixEntries(archiveBytes),
        checked = await verifyPackageContent(entries, files)
      const loaded = await loadBuiltExtension(entries)
      await assertStableCheckout(repository, before, directory, 'packaging')
      return {
        output: destination,
        sha256: createHash('sha256').update(archiveBytes).digest('hex'),
        bytes: archiveBytes.length,
        ...checked,
        ...loaded,
        dependencies: inventory.dependencies.map(
          (value) => `${value.name}@${value.version}`,
        ),
        durationMs: Math.round(performance.now() - started),
      }
    },
  )
}
