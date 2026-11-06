import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { listMappedSources } from '../utils/listMappedSources'
import { resolveMappedStop } from '../utils/resolveMappedStop'

import { createRepositoryFixture } from './utils/chromeExtensionFixture'

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ANSWER_SOURCE = 'export const answer = 42\n'
const ANSWER_SHA256 =
  '5d2eb782fe3a645dbf5bdf2d765a254438962649c9c892811408cb50e04a5be4'

/** A flat version 3 map text that lists the given sources (relative to the map's folder). */
function mapText(
  sources: string[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: 3,
    sources,
    sourcesContent: sources.map(() => ANSWER_SOURCE),
    mappings: '',
    ...extra,
  })
}

/** An HTML page whose only script is the module chunk `chunks/options.js`. */
const OPTIONS_HTML =
  '<!doctype html><script type="module" src="chunks/options.js"></script>\n'

/** Builds a fixture repository with a `project/` folder and a `build/` folder and returns both roots. */
async function fixture(context: TestContext, files: Record<string, string>) {
  const root = await createRepositoryFixture(context, {
    'project/src/a.ts': ANSWER_SOURCE,
    'project/src/b.ts': ANSWER_SOURCE,
    ...files,
  })
  return { projectRoot: join(root, 'project'), loadRoot: join(root, 'build') }
}

/** Lists what the options page of a fixture build loads. */
async function pageSources(
  context: TestContext,
  files: Record<string, string>,
  mapLimitBytes?: number,
) {
  const roots = await fixture(context, files)
  const mapped = await listMappedSources({
    ...roots,
    extensionId: EXTENSION_ID,
    entry: { kind: 'page', htmlPath: join(roots.loadRoot, 'options.html') },
    mapLimitBytes,
  })
  return { ...roots, mapped }
}

// protects=a page stop in a statically imported chunk's source is accepted with the file's hash and the executed text; fails_when=a source of a loaded chunk is refused, or the hash is not the file's; no_claim=nothing about the editor binding the breakpoint; the build is a hand-written fixture, not WXT output
test('a page stop in a statically imported chunk resolves with the file hash', async (context) => {
  // Arrange
  const { mapped } = await pageSources(context, {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js':
      "import './shared.js'\n//# sourceMappingURL=options.js.map\n",
    'build/chunks/options.js.map': mapText(['../../project/src/b.ts']),
    'build/chunks/shared.js':
      'export const shared = 1\n//# sourceMappingURL=shared.js.map\n',
    'build/chunks/shared.js.map': mapText(['../../project/src/a.ts']),
  })

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })

  // Assert
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.sha256, ANSWER_SHA256)
  assert.equal(result.ok && result.executedText, ANSWER_SOURCE)
  assert.equal(mapped.sources.size, 2)
})

// protects=a source reached only through a dynamic import chunk is refused and the dynamic import is named; fails_when=a lazily loaded chunk's source is accepted or the refusal does not name the form; no_claim=nothing about static imports; the lazy chunk is a hand-written file
test('a source only a dynamic import chunk lists is refused naming the dynamic import', async (context) => {
  // Arrange
  const { mapped } = await pageSources(context, {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js':
      "import('./lazy.js')\n//# sourceMappingURL=options.js.map\n",
    'build/chunks/options.js.map': mapText(['../../project/src/a.ts']),
    'build/chunks/lazy.js':
      'export const lazy = 1\n//# sourceMappingURL=lazy.js.map\n',
    'build/chunks/lazy.js.map': mapText(['../../project/src/b.ts']),
  })

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/b.ts', mapped })

  // Assert
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.cause, 'unfollowed-load')
  assert.match(
    !result.ok ? result.message : '',
    /chunks\/options\.js loads code through a dynamic import, which is not followed/,
  )
})

// protects=a worker map's source resolves for the service-worker context and not for the page; fails_when=contexts share one source list; no_claim=nothing about the manifest's worker path being read; the entry is given directly
test('a worker map source resolves for the service worker and is refused for the page', async (context) => {
  // Arrange
  const files = {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
    'build/chunks/options.js.map': mapText(['../../project/src/a.ts']),
    'build/background.js': '//# sourceMappingURL=background.js.map\n',
    'build/background.js.map': mapText(['../project/src/b.ts']),
  }
  const {
    projectRoot,
    loadRoot,
    mapped: page,
  } = await pageSources(context, files)

  // Act
  const worker = await listMappedSources({
    loadRoot,
    projectRoot,
    extensionId: EXTENSION_ID,
    entry: {
      kind: 'worker',
      scriptPath: join(loadRoot, 'background.js'),
      isModule: true,
    },
  })
  const forWorker = await resolveMappedStop({
    stopPath: 'src/b.ts',
    mapped: worker,
  })
  const forPage = await resolveMappedStop({
    stopPath: 'src/b.ts',
    mapped: page,
  })

  // Assert
  assert.equal(forWorker.ok, true)
  assert.equal(!forPage.ok && forPage.cause, 'not-listed')
  assert.match(
    !forPage.ok ? forPage.message : '',
    /not listed by any source map the page context loads/,
  )
})

// protects=sourceRoot and percent-encoded source names resolve to the project file; fails_when=a source with a space or a sourceRoot without a trailing slash is not found; no_claim=nothing about absolute or file: sources
test('a map with sourceRoot and a URL-encoded source name resolves', async (context) => {
  // Arrange
  const { mapped } = await pageSources(context, {
    'project/src/my file.ts': ANSWER_SOURCE,
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
    'build/chunks/options.js.map': mapText(['my%20file.ts'], {
      sourceRoot: '../../project/src',
    }),
  })

  // Act
  const result = await resolveMappedStop({
    stopPath: 'src/my file.ts',
    mapped,
  })

  // Assert
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.sha256, ANSWER_SHA256)
})

// protects=an embedded data: map is read relative to the chunk's folder; fails_when=a data: map lists nothing or resolves against the wrong folder; no_claim=nothing about percent-encoded (non-base64) data maps
test('a chunk with an embedded data: map resolves its sources', async (context) => {
  // Arrange
  const encoded = Buffer.from(mapText(['../../project/src/a.ts'])).toString(
    'base64',
  )
  const { mapped } = await pageSources(context, {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`,
  })

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })

  // Assert
  assert.equal(result.ok, true)
  assert.equal(
    mapped.sources.get(mapped.projectRoot + '/src/a.ts')?.map,
    'chunks/options.js',
  )
})

// protects=an indexed map lists nothing and the stop it would have held is refused naming the map; fails_when=an indexed map's sections are guessed at or the refusal blames nothing; no_claim=nothing about flat maps
test('an indexed source map lists nothing and is named in the refusal', async (context) => {
  // Arrange
  const { mapped } = await pageSources(context, {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
    'build/chunks/options.js.map': JSON.stringify({
      version: 3,
      sections: [],
    }),
  })

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })

  // Assert
  assert.equal(mapped.sources.size, 0)
  assert.equal(mapped.unlisted[0]?.kind, 'indexed')
  assert.equal(!result.ok && result.cause, 'map-unusable')
  assert.match(
    !result.ok ? result.message : '',
    /the map chunks\/options\.js\.map lists nothing because it is an indexed source map/,
  )
})

// protects=a map over the size limit lists nothing and the refusal gives the reason; fails_when=an oversized map is read or the refusal does not say why; no_claim=the real 32 MiB limit, a small injected limit stands in for it
test('a map over the size limit lists nothing with its reason', async (context) => {
  // Arrange
  const { mapped } = await pageSources(
    context,
    {
      'build/options.html': OPTIONS_HTML,
      'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
      'build/chunks/options.js.map': mapText(['../../project/src/a.ts']),
    },
    16,
  )

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })

  // Assert
  assert.equal(mapped.sources.size, 0)
  assert.equal(mapped.unlisted[0]?.kind, 'too-large')
  assert.match(mapped.unlisted[0]?.reason ?? '', /over the 16 byte limit/)
  assert.equal(!result.ok && result.cause, 'map-unusable')
})

// protects=a source whose map embeds no text, or text that differs from the file, is refused; fails_when=a replay could show code that did not run; no_claim=nothing about line endings or encodings beyond exact text equality
test('a source with missing or differing sourcesContent is refused', async (context) => {
  // Arrange
  const { mapped } = await pageSources(context, {
    'project/src/b.ts': 'export const answer = 43\n',
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
    'build/chunks/options.js.map': JSON.stringify({
      version: 3,
      sources: ['../../project/src/a.ts', '../../project/src/b.ts'],
      sourcesContent: [null, ANSWER_SOURCE],
      mappings: '',
    }),
  })

  // Act
  const missing = await resolveMappedStop({ stopPath: 'src/a.ts', mapped })
  const differing = await resolveMappedStop({ stopPath: 'src/b.ts', mapped })

  // Assert
  assert.equal(!missing.ok && missing.cause, 'sources-content-missing')
  assert.equal(!differing.ok && differing.cause, 'sources-content-differs')
})

// protects=contextSources is the context's project sources, relative to the project, sorted and capped at twenty with the full count; fails_when=the list is unsorted, absolute, uncapped or miscounted; no_claim=nothing about node_modules sources, which are not listed at all
test('a refusal lists the context sources sorted, relative and capped at twenty', async (context) => {
  // Arrange
  const names = Array.from(
    { length: 25 },
    (_, index) => `src/f${String(index).padStart(2, '0')}.ts`,
  )
  const { mapped } = await pageSources(context, {
    'build/options.html': OPTIONS_HTML,
    'build/chunks/options.js': '//# sourceMappingURL=options.js.map\n',
    'build/chunks/options.js.map': mapText(
      [...names].reverse().map((name) => `../../project/${name}`),
    ),
  })

  // Act
  const result = await resolveMappedStop({ stopPath: 'src/missing.ts', mapped })

  // Assert
  assert.equal(!result.ok && result.contextSourceCount, 25)
  assert.deepEqual(!result.ok && result.contextSources, names.slice(0, 20))
  assert.match(
    !result.ok ? result.message : '',
    /The page context lists 25 project sources\.$/,
  )
})
