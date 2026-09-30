import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Module, createRequire, isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Loads only this build's byte-verified artifact outside the checkout with native imports allowed; never used by the standalone checker. @example await loadBuiltExtension(verifiedEntries) */
export async function loadBuiltExtension(entries) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-installed-load-')),
    nativeRequire = createRequire(import.meta.url)
  try {
    for (const [file, content] of entries) {
      if (!file.startsWith('extension/')) continue
      const destination = join(directory, file.slice('extension/'.length))
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content)
    }
    const filename = join(directory, 'dist/extension.js'),
      loaded = new Module(filename)
    loaded.filename = filename
    loaded.paths = []
    // No fallback can discover node_modules, sibling experiments or development output.
    loaded.require = (name) => {
      if (name === 'vscode') return {}
      if (isBuiltin(name)) return nativeRequire(name)
      throw new Error(`Installed bundle requested external module: ${name}`)
    }
    loaded._compile(await readFile(filename, 'utf8'), filename)
    assert.equal(typeof loaded.exports.activate, 'function')
    assert.equal(typeof loaded.exports.deactivate, 'function')
    return { isolatedModuleLoad: true }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
