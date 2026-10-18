import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Module, createRequire, isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** How long the packaged Wiki page worker may take for its small check page: the reader's own deadline, as a slow runner may start the worker slowly. */
const PACKAGED_PAGE_WORKER_DEADLINE_MS = 10_000

/** Loads only this build's byte-verified artifact outside the checkout with native imports allowed, the extension's bundle and the Wiki page worker, which it runs on one page; never used by the standalone checker. @example await loadBuiltExtension(verifiedEntries) */
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
    /** Compiles one bundled file of the extracted package with a require that finds only the editor and Node's own modules. */
    const loadIsolated = async (file) => {
      const filename = join(directory, file),
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
      return loaded.exports
    }
    const extension = await loadIsolated('dist/extension.js')
    assert.equal(typeof extension.activate, 'function')
    assert.equal(typeof extension.deactivate, 'function')
    // The Wiki reader's page worker: its module starts a worker thread on the extracted dist/wikiPageWorker.js, which prepares one page with a refused and a Codebook address.
    const pageWorker = await loadIsolated('dist/wikiPageWorker.js')
    assert.deepEqual(
      await pageWorker.servedWikiPageOffThread(
        '<body><a href="vscode://file/x">x</a><a href="vscode://laststance.codebook/source?root=%2Fr&amp;path=a.ts">s</a></body>',
        {
          editorScheme: 'cursor',
          clientAddress: '/w/t/codebook-qa.js',
          publication: undefined,
        },
        {
          deadlineMs: PACKAGED_PAGE_WORKER_DEADLINE_MS,
          signal: new AbortController().signal,
        },
      ),
      {
        state: 'served',
        html: '<body><a data-codebook-unlinked="vscode://file/x">x</a><a href="cursor://laststance.codebook/source?root=%2Fr&amp;path=a.ts">s</a><script src="/w/t/codebook-qa.js"></script></body>',
      },
      'The packaged Wiki page worker did not prepare a page outside the checkout.',
    )
    return { isolatedModuleLoad: true, isolatedWikiPageWorker: true }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
