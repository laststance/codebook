import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

import { COMPILED_DIRECTORIES } from './packageConstants.mjs'

/** Inventories actual emitted inputs, bundled dependency notices and native externals before a VSIX can be staged. @example await inspectBundle(metafile, repository, capturedInputs) */
export async function inspectBundle(metafile, repository, capturedInputs) {
  const outputs = Object.values(metafile.outputs)
  if (outputs.length < 1 || outputs.length > 2)
    throw new Error('Unexpected JavaScript bundle count.')
  const imports = outputs.flatMap((output) => output.imports)
  const externals = [...new Set(imports.map((value) => value.path))].sort()
  if (
    imports.some(
      (value) =>
        !value.external || (value.path !== 'vscode' && !isBuiltin(value.path)),
    )
  )
    throw new Error('Bundle contains an unresolved non-native import.')
  // The standalone Cursor bridge runs in Node, where the extension host's vscode module does not exist.
  for (const [path, output] of Object.entries(metafile.outputs))
    if (
      basename(path) === 'cursorMcpBridge.js' &&
      output.imports.some((value) => !isBuiltin(value.path))
    )
      throw new Error('Cursor MCP bridge contains an editor-only import.')
  const root = await realpath(repository),
    packages = new Map(),
    inputs = [],
    noticeFiles = new Map()
  for (const input of Object.keys(metafile.inputs).sort()) {
    const absolute = await realpath(resolve(root, input)),
      bytes = capturedInputs.get(absolute)
    if (
      !bytes ||
      bytes.length !== metafile.inputs[input].bytes ||
      !bytes.equals(await readFile(absolute))
    )
      throw new Error(`Bundle input changed or was not captured: ${input}`)
    const local = relative(root, absolute).split(sep).join('/')
    // External workspace code must never be mistaken for a shipped third-party dependency.
    if (local.startsWith('../'))
      throw new Error(`Bundle input escapes the extension repository: ${input}`)
    let path = local
    if (local.includes('/node_modules/') || local.startsWith('node_modules/')) {
      let owner = dirname(absolute),
        manifest
      while (true) {
        const candidate = await readFile(
          join(owner, 'package.json'),
          'utf8',
        ).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        manifest = candidate === undefined ? undefined : JSON.parse(candidate)
        if (manifest?.name && manifest?.version) break
        const parent = dirname(owner)
        if (parent === owner)
          throw new Error(`Dependency owner not found: ${input}`)
        owner = parent
      }
      const identity = `${manifest.name}@${manifest.version}`
      if (!packages.has(identity)) {
        const license = manifest.license
        if (typeof license !== 'string' || !license)
          throw new Error(`Dependency license missing: ${identity}`)
        const notices = []
        for (const name of (await readdir(owner))
          .filter((name) =>
            /^(licen[cs]e|copying|notice|third.?party.?notices)([.-]|$)/i.test(
              name,
            ),
          )
          .sort()) {
          const source = join(owner, name)
          if (!(await lstat(source)).isFile())
            throw new Error(
              `Dependency notice is not a regular file: ${identity}/${name}`,
            )
          const content = await readFile(source)
          const file = `notices/${identity.replaceAll('@', '').replaceAll('/', '__')}/${name}`
          if (noticeFiles.has(file))
            throw new Error(`Duplicate notice destination: ${file}`)
          noticeFiles.set(file, content)
          notices.push({
            file,
            sourcePath: name,
            sha256: createHash('sha256').update(content).digest('hex'),
          })
        }
        if (!notices.length)
          throw new Error(`Dependency notice missing: ${identity}`)
        packages.set(identity, {
          name: manifest.name,
          version: manifest.version,
          license,
          notices,
        })
      }
      path = `dependency:${identity}/${relative(owner, absolute).split(sep).join('/')}`
    } else {
      if (
        !COMPILED_DIRECTORIES.some((directory) =>
          local.startsWith(`${directory}/`),
        )
      )
        throw new Error(`Unexpected bundle source: ${input}`)
      // A transitive development import must not enter the single shipped runtime bundle.
      if (
        local
          .split('/')
          .some((part) =>
            ['tests', 'fixtures', 'fixture', 'demo', 'experiments'].includes(
              part,
            ),
          ) ||
        [
          'extension/dist/client.js',
          'extension/dist/nativeRepositoryBootstrap.js',
          'extension/dist/nativeNodeTestBootstrap.js',
        ].includes(local)
      )
        throw new Error(`Development-only bundle source: ${input}`)
    }
    inputs.push({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  const dependencies = [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(
      `${right.name}@${right.version}`,
    ),
  )
  for (const name of ['@modelcontextprotocol/sdk', 'zod', 'ws'])
    if (!dependencies.some((value) => value.name === name))
      throw new Error(`Required bundled dependency missing: ${name}`)
  return { inputs, dependencies, externals, noticeFiles }
}
