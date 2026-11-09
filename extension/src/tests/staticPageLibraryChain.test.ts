import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { STATIC_PAGE_CDN_FILE_LIMIT_BYTES } from '../constants'
import { ERROR_RECOVERY } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  staticPageLibraryPathAbsentFailureText,
  staticPageLibraryPathAbsentRefusal,
} from '../staticPageRefusals'
import { CdnImportRedirect } from '../utils/cdnImportRedirect'
import { findCdnPackageImports } from '../utils/findCdnPackageImports'
import { followPackedRelativeImports } from '../utils/followPackedRelativeImports'
import { SingleBundleCache } from '../utils/readSingleServedBundle'
import { readStaticPageScriptTexts } from '../utils/readStaticPageScriptTexts'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import { sealStaticPageLibraryStop } from '../utils/sealStaticPageLibraryStop'
import type {
  PackedLibraryFiles,
  ServedPackedFile,
} from '../utils/servePackedLibraryFile'

import { FakePageSession } from './utils/fakePageSession'
import {
  createPackedLibrary,
  LIBRARY_BUILD,
  LIBRARY_MAP,
} from './utils/packedLibraryFixture'
import { createStaticPageRepository } from './utils/staticPageFixture'

const CHUNK_SOURCE = 'export const b = 1\n'

// Value: protects=a library stop on a page whose app.js imports the library from a CDN is not refused library-not-in-build because the CDN address sits in a same-origin script, not in the entry page; fails_when=findCdnPackageImports or the script reader ignores same-origin script files; no_claim=scripts deeper than one level
test('a CDN import of the library written in a same-origin script file is found', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  await writeFile(
    join(repository.pageFolder, 'main.js'),
    'import { double } from "https://unpkg.com/lib@latest/dist/lib.mjs"\n',
  )
  const html =
    '<script src="main.js"></script><script src="https://other.example.test/x.js"></script><script src="//other.example.test/y.js"></script><script src="%E0%A4%A.js"></script><script src="missing.js"></script>'
  // Act
  const texts = await readStaticPageScriptTexts(
    repository.pageFolder,
    'index.html',
    html,
  )
  const imports = findCdnPackageImports(html, 'lib', texts)
  // Assert
  assert.deepEqual(imports, [
    {
      url: 'https://unpkg.com/lib@latest/dist/lib.mjs',
      path: 'dist/lib.mjs',
    },
  ])
  assert.deepEqual(findCdnPackageImports(html, 'lib'), [])
})

/** Writes a two-file packed build: `dist/lib.mjs` imports `./chunk.mjs`, whose map names `src/b.ts`; the checked-out library holds the same `src/b.ts`. */
async function twoFileLibrary(
  context: Parameters<typeof createPackedLibrary>[0],
) {
  const library = await createPackedLibrary(context)
  await writeFile(
    join(library.packedRoot, 'dist', 'lib.mjs'),
    `import './chunk.mjs'\n${LIBRARY_BUILD}`,
  )
  await writeFile(
    join(library.packedRoot, 'dist', 'chunk.mjs'),
    `${CHUNK_SOURCE}//# sourceMappingURL=chunk.mjs.map\n`,
  )
  await writeFile(
    join(library.packedRoot, 'dist', 'chunk.mjs.map'),
    JSON.stringify({
      version: 3,
      file: 'chunk.mjs',
      sources: ['../src/b.ts'],
      sourcesContent: [CHUNK_SOURCE],
      names: [],
      mappings: 'AAAA',
    }),
  )
  await writeFile(join(library.packedRoot, 'src', 'b.ts'), CHUNK_SOURCE)
  await writeFile(join(library.libraryRoot, 'src', 'b.ts'), CHUNK_SOURCE)
  return library
}

// Value: protects=a stop in a code-split chunk of the library (the entry imports ./chunk.mjs) is sealed against the chunk the redirect serves; fails_when=the seal reads only the CDN files the page names and refuses the chunk's source library-not-in-build; no_claim=that js-debug binds the stop
test('a stop in a chunk the packed entry file imports is sealed', async (context) => {
  // Arrange
  const library = await twoFileLibrary(context)
  // Act
  const { bundle } = await sealStaticPageLibraryStop(
    {
      appRoot: library.libraryRoot,
      packageRootRelative: '.',
      packageRelativePath: 'src/b.ts',
      source: {
        path: 'src/b.ts',
        hash: sha256(CHUNK_SOURCE),
        line: 1,
        column: 1,
      },
      citationEndLine: 1,
      ownedOrigin: 'http://127.0.0.1:4310',
      signal: new AbortController().signal,
      cache: new SingleBundleCache(),
    },
    {
      packageName: 'lib',
      examplePackageRoot: 'examples/page',
      packedRoot: library.packedRoot,
      files: library.files,
      imports: [
        {
          url: 'https://unpkg.com/lib@latest/dist/lib.mjs',
          path: 'dist/lib.mjs',
        },
      ],
    },
  )
  // Assert
  assert.equal(bundle.scriptUrl, 'https://unpkg.com/lib@latest/dist/chunk.mjs')
  assert.equal(bundle.sourcePath, join(library.libraryRoot, 'src', 'b.ts'))
})

/** Builds packed files whose every path holds the given import lines. */
function textFiles(texts: Record<string, string>): PackedLibraryFiles {
  return {
    read: async (path) => {
      const text = texts[path]
      return text === undefined
        ? undefined
        : ({
            path,
            contentType: 'text/javascript',
            body: Buffer.from(text),
            text,
          } satisfies ServedPackedFile)
    },
    absenceCause: async () => 'absent',
  }
}

// Value: protects=following relative imports stops at three levels and sixteen files, so a deep or wide chunk graph cannot make the seal read without bound; fails_when=the limits are removed or off by one; no_claim=which chunk a stop lives in
test('relative imports are followed three levels deep and sixteen files wide', async () => {
  // Arrange
  const deep = textFiles({
    'a.mjs': "import './b.mjs'",
    'b.mjs': "import './c.mjs'",
    'c.mjs': "export * from './d.mjs'",
    'd.mjs': "import('./e.mjs')",
    'e.mjs': '',
  })
  const wide = textFiles({
    'a.mjs': Array.from(
      { length: 30 },
      (_, index) => `import './w${index}.mjs'`,
    ).join('\n'),
  })
  const entry = [{ url: 'https://unpkg.com/lib@1/a.mjs', path: 'a.mjs' }]
  // Act
  const deepPaths = (await followPackedRelativeImports(deep, 'lib', entry)).map(
    (file) => file.path,
  )
  const widePaths = await followPackedRelativeImports(wide, 'lib', entry)
  // Assert
  assert.deepEqual(deepPaths, ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs'])
  assert.equal(widePaths.length, 16)
})

// Value: protects=a malformed percent-encoding in a sourceMappingURL serves the script unchanged instead of throwing, and a map source written as file:// is named by its path while webpack:// stays as written; fails_when=decodeURI throws out of read, or a URL source is resolved into a bogus path below the packed folder; no_claim=maps with sourceRoot
test('a malformed sourceMappingURL serves the script and URL sources keep their meaning', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  await writeFile(
    join(library.packedRoot, 'dist', 'bad.mjs'),
    'export const x = 1\n//# sourceMappingURL=%E0%A4%A.map\n',
  )
  await writeFile(
    join(library.packedRoot, 'dist', 'urls.mjs'),
    'export const x = 1\n//# sourceMappingURL=urls.mjs.map\n',
  )
  await writeFile(
    join(library.packedRoot, 'dist', 'urls.mjs.map'),
    JSON.stringify({
      ...JSON.parse(LIBRARY_MAP),
      sources: ['webpack://lib/src/a.ts', 'file:///work/lib/src/b.ts'],
      sourcesContent: ['a', 'b'],
    }),
  )
  // Act
  const bad = await library.files.read('dist/bad.mjs')
  const urls = await library.files.read('dist/urls.mjs')
  // Assert
  assert.equal(
    bad?.text,
    'export const x = 1\n//# sourceMappingURL=%E0%A4%A.map\n',
  )
  assert.equal(bad?.map, undefined)
  assert.deepEqual(urls?.map?.sources, [
    'webpack://lib/src/a.ts',
    '/work/lib/src/b.ts',
  ])
})

// Value: protects=a serving error never leaves a paused CDN request hanging: the request is failed with reason Failed; fails_when=answer lets the error escape without Fetch.failRequest; no_claim=the run's own ending
test('a packed file that fails to serve fails the paused request instead of hanging it', async () => {
  // Arrange
  const session = new FakePageSession()
  const redirect = new CdnImportRedirect({
    cdp: session.cdp,
    packageName: 'lib',
    files: {
      read: async () => {
        throw new Error('boom')
      },
      absenceCause: async () => 'absent',
    },
    record: () => undefined,
    onPathAbsent: () => undefined,
  })
  await redirect.enable()
  // Act
  session.pause('https://unpkg.com/lib@1/dist/lib.mjs', 'r1')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.failRequest'),
  )
  // Assert
  assert.deepEqual(
    session.commands.find((command) => command.method === 'Fetch.failRequest')
      ?.params,
    { requestId: 'r1', errorReason: 'Failed' },
  )
})

// Value: protects=the refusal tells an absent path, a file over the size limit and a directory apart through details.cause while the reason stays library-path-absent, and the cause survives the failure text; fails_when=all three are reported as absent; no_claim=the wording of the recovery
test('an oversized file and a directory are told apart from an absent path', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  await mkdir(join(library.packedRoot, 'dist', 'folder'))
  await writeFile(
    join(library.packedRoot, 'dist', 'big.mjs'),
    Buffer.alloc(STATIC_PAGE_CDN_FILE_LIMIT_BYTES + 1),
  )
  const session = new FakePageSession()
  const causes: string[] = []
  const redirect = new CdnImportRedirect({
    cdp: session.cdp,
    packageName: 'lib',
    files: library.files,
    record: () => undefined,
    onPathAbsent: (path, cause) => causes.push(`${path}:${cause}`),
  })
  await redirect.enable()
  // Act
  session.pause('https://unpkg.com/lib@1/dist/missing.mjs', 'r1')
  session.pause('https://unpkg.com/lib@1/dist/big.mjs', 'r2')
  session.pause('https://unpkg.com/lib@1/dist/folder', 'r3')
  await session.until(
    (commands) =>
      commands.filter((command) => command.method === 'Fetch.failRequest')
        .length === 3,
  )
  const restored = refusalFailureOf(
    staticPageLibraryPathAbsentFailureText({
      path: 'dist/big.mjs',
      library: 'lib',
      packageRoot: 'examples/page',
      cause: 'too-large',
    }),
  )
  // Assert
  assert.deepEqual([...causes].sort(), [
    'dist/big.mjs:too-large',
    'dist/folder:unreadable',
    'dist/missing.mjs:absent',
  ])
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-path-absent',
    cause: 'too-large',
    path: 'dist/big.mjs',
    library: 'lib',
    packageRoot: 'examples/page',
    sideEffects: 'partial',
  })
})

// Value: protects=the generic REPOSITORY_BROWSER_LIBRARY_REFUSED recovery and the builder's recovery both say the owned server and browser were stopped, no stop was sealed and no input was sent; fails_when=one of the two texts drops a fact the other states; no_claim=other wording
test('the generic library refusal text and the path refusal state the same facts', () => {
  // Arrange
  const generic = ERROR_RECOVERY.REPOSITORY_BROWSER_LIBRARY_REFUSED
  // Act
  const specific = staticPageLibraryPathAbsentRefusal({
    path: 'dist/x.mjs',
    library: 'lib',
    packageRoot: 'examples/page',
  }).recoveryOverride
  // Assert
  for (const text of [generic, specific ?? '']) {
    assert.match(text, /owned server and browser were stopped/)
    assert.match(text, /no stop was sealed/)
    assert.match(text, /no input was sent/)
  }
})
