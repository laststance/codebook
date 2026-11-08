import assert from 'node:assert/strict'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { WebpackLibraryReportReader } from '../utils/webpackLibraryReport'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

/** One compilation line as the preload writes it. */
function compilationLine(hash: string, name = 'static/js/bundle.js'): string {
  return `${JSON.stringify({
    compilationHash: 'c1',
    publicPath: '/',
    assets: [
      { name, sha256: hash, resources: ['/p/node_modules/lib/index.js'] },
    ],
  })}\n`
}

test('a wrapped line marks the configuration as patched', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(Buffer.from('{"wrapped":true}\n'))

  // Assert
  assert.equal(reader.wrapped, true)
  assert.equal(reader.errorCause, undefined)
})

test('an error line gives the cause and leaves the run unwrapped', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(Buffer.from('{"error":"boom"}\n'))

  // Assert
  assert.equal(reader.wrapped, false)
  assert.equal(reader.errorCause, 'boom')
})

test('a trailing line without a newline stays pending until its newline arrives', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  const line = compilationLine(HASH_A)

  // Act
  reader.append(Buffer.from(line.slice(0, 30)))
  const beforeNewline = reader.match(
    'http://h/static/js/bundle.js',
    HASH_A,
  ).kind
  const pendingBytes = reader.pendingBytes
  reader.append(Buffer.from(line.slice(30)))

  // Assert
  assert.equal(beforeNewline, 'not-owned')
  assert.equal(pendingBytes, 30)
  assert.equal(reader.pendingBytes, 0)
  assert.equal(
    reader.match('http://h/static/js/bundle.js', HASH_A).kind,
    'matched',
  )
})

test('a malformed complete line makes the report unreadable', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(Buffer.from('{not json\n'))

  // Assert
  assert.equal(reader.unreadableCause, 'malformed-line')
})

test('a report past the whole bound is unreadable and is not read', () => {
  // Arrange
  const directory = mkdtempSync(join(tmpdir(), 'codebook-rs-report-'))
  const file = join(directory, 'report.jsonl')
  writeFileSync(file, '{"wrapped":true}\n'.repeat(10))
  const reader = new WebpackLibraryReportReader(50)

  // Act
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert
  assert.equal(reader.unreadableCause, 'report-too-large')
  assert.equal(reader.wrapped, false)
})

test('a missing report is unreadable only when it is required', () => {
  // Arrange
  const optional = new WebpackLibraryReportReader()
  const required = new WebpackLibraryReportReader()

  // Act
  optional.refresh('/nonexistent/report.jsonl')
  required.refresh('/nonexistent/report.jsonl', true)

  // Assert
  assert.equal(optional.unreadableCause, undefined)
  assert.equal(required.unreadableCause, 'report-missing')
})

test('refresh reads only the bytes appended since the previous call', () => {
  // Arrange
  const directory = mkdtempSync(join(tmpdir(), 'codebook-rs-report-'))
  const file = join(directory, 'report.jsonl')
  writeFileSync(
    file,
    '{"compilationHash":"c0","publicPath":"/","truncated":true}\n',
  )
  const reader = new WebpackLibraryReportReader()
  reader.refresh(file)

  // Act
  appendFileSync(file, compilationLine(HASH_A))
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert: a full reread would count the truncated line a second time
  assert.equal(reader.truncatedCompilations, 1)
  assert.equal(
    reader.match('http://h/static/js/bundle.js', HASH_A).kind,
    'matched',
  )
})

test('a line past the line bound without a newline makes the report unreadable', () => {
  // Arrange
  const directory = mkdtempSync(join(tmpdir(), 'codebook-rs-report-'))
  const file = join(directory, 'report.jsonl')
  writeFileSync(file, '')
  const reader = new WebpackLibraryReportReader(1000, 20)

  // Act
  appendFileSync(file, 'x'.repeat(30))
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert
  assert.equal(reader.unreadableCause, 'line-too-long')
})

test('a report rewritten shorter than what was read is unreadable', () => {
  // Arrange
  const directory = mkdtempSync(join(tmpdir(), 'codebook-rs-report-'))
  const file = join(directory, 'report.jsonl')
  writeFileSync(file, '{"wrapped":true}\n'.repeat(3))
  const reader = new WebpackLibraryReportReader()
  reader.refresh(file)

  // Act
  writeFileSync(file, '{"wrapped":true}\n')
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert
  assert.equal(reader.unreadableCause, 'report-shrunk')
})

test('a script of a truncated compilation is unmatched but owned', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(
    Buffer.from('{"compilationHash":"c1","publicPath":"/","truncated":true}\n'),
  )

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js', HASH_A)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
  assert.equal(reader.truncatedCompilations, 1)
})

test('a script matches by URL path without query or fragment and by hash', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js?v=2#top', HASH_A)

  // Assert
  assert.deepEqual(verdict, {
    kind: 'matched',
    asset: {
      name: 'static/js/bundle.js',
      sha256: HASH_A,
      publicPath: '/',
      resources: ['/p/node_modules/lib/index.js'],
    },
  })
})

test('a script with the right URL but another hash is unmatched, with no fallback by name', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js', HASH_B)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('a script reported without a hash matches nothing', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js', undefined)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('a rebuild appends a line and the parsed bundle of either compilation still matches', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))
  reader.append(Buffer.from(compilationLine(HASH_B)))
  reader.append(Buffer.from(compilationLine(HASH_B)))

  // Act
  const first = reader.match('http://h/static/js/bundle.js', HASH_A)
  const second = reader.match('http://h/static/js/bundle.js', HASH_B)

  // Assert
  assert.equal(first.kind, 'matched')
  assert.equal(second.kind, 'matched')
})

test('a reportError line is kept apart from errorCause so a later compilation failure does not read as an unapplied patch', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(
    Buffer.from('{"wrapped":true}\n{"reportError":"hash failed"}\n'),
  )

  // Assert
  assert.equal(reader.wrapped, true)
  assert.equal(reader.errorCause, undefined)
  assert.equal(reader.reportErrorCause, 'hash failed')
  assert.equal(reader.unreadableCause, undefined)
})

test('an empty or auto public path never makes a script unmatched-owned', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  const line = (publicPath: string) =>
    `${JSON.stringify({ compilationHash: 'c1', publicPath, assets: [] })}\n`

  // Act
  reader.append(Buffer.from(line('') + line('auto')))

  // Assert
  assert.equal(
    reader.match('http://h/static/js/other.js', HASH_A).kind,
    'not-owned',
  )
})

test('a script whose URL percent-encodes a space matches the asset named with the space', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A, 'static/js/my bundle.js')))

  // Act
  const verdict = reader.match('http://h/static/js/my%20bundle.js', HASH_A)

  // Assert
  assert.equal(verdict.kind, 'matched')
})

test('a script URL with a malformed percent escape matches nothing but stays owned', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/%E0%A4%A.js', HASH_A)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('an inline script reported with the document URL is ignored while a js script under the public path with no asset stays unmatched', () => {
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const inline = reader.match('http://localhost:3000/?x=1', HASH_B)
  const missing = reader.match(
    'http://localhost:3000/static/js/other.js',
    HASH_B,
  )

  // Assert
  assert.equal(inline.kind, 'not-owned')
  assert.equal(missing.kind, 'unmatched-owned')
})

/** A compilation line of the Next preload. */
function nextLine(
  compiler: string,
  outputPath: string,
  assets: { name: string; sha256: string; resources: string[] }[],
  externals: string[] = [],
): string {
  return `${JSON.stringify({
    compilationHash: 'c1',
    compiler,
    outputPath,
    publicPath: '/_next/',
    assets,
    externals,
  })}\n`
}

const serverFolders: string[] = []

after(() => {
  for (const folder of serverFolders)
    rmSync(folder, { recursive: true, force: true })
})

/** A temporary folder holding a real server output file; returns the folder's real path. */
function serverOutputFolder(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'codebook-report-')))
  serverFolders.push(folder)
  mkdirSync(join(folder, 'server/vendor-chunks'), { recursive: true })
  writeFileSync(join(folder, 'server/vendor-chunks/lib.js'), 'x')
  return folder
}

test('wrapped and error lines name their compilers', () => {
  // Value: protects=the reader can tell which compilers were patched and which failed; fails_when=a per-compiler line is folded into one global flag; no_claim=that the preload wrote the lines
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(
    Buffer.from(
      '{"wrapped":true,"compiler":"client","outputPath":"/o/client"}\n{"wrapped":true,"compiler":"server","outputPath":"/o/server"}\n{"error":"boom","compiler":"edge-server"}\n',
    ),
  )

  // Assert
  assert.deepEqual([...reader.wrappedCompilers()].sort(), ['client', 'server'])
  assert.deepEqual([...reader.erroredCompilers()], ['edge-server'])
  assert.equal(reader.errorCause, 'boom')
})

test('a server script matches by real path under the compiler output folder and by hash', () => {
  // Value: protects=a server script is tied to its emitted asset by file path plus SHA-256 and to nothing by script id; fails_when=a wrong hash, a path outside the announced output folder or a page compiler's asset matches a server script; no_claim=js-debug URL spelling
  // Arrange
  const folder = serverOutputFolder()
  const outputPath = join(folder, 'server')
  const reader = new WebpackLibraryReportReader()
  reader.append(
    Buffer.from(
      `{"wrapped":true,"compiler":"server","outputPath":${JSON.stringify(outputPath)}}\n` +
        nextLine('server', outputPath, [
          {
            name: 'vendor-chunks/lib.js',
            sha256: HASH_A,
            resources: ['/p/lib/rsc.js'],
          },
        ]) +
        nextLine('client', join(folder, 'static'), [
          { name: 'vendor-chunks/lib.js', sha256: HASH_B, resources: [] },
        ]),
    ),
  )
  const url = pathToFileURL(join(outputPath, 'vendor-chunks/lib.js')).href

  // Act
  const matched = reader.matchServer(url, HASH_A)
  const wrongHash = reader.matchServer(url, HASH_B)
  const outside = reader.matchServer(
    pathToFileURL(join(folder, 'elsewhere.js')).href,
    HASH_A,
  )
  const nodeInternal = reader.matchServer(
    'node:internal/main/run_main_module',
    undefined,
  )

  // Assert
  assert.equal(matched.kind, 'matched')
  assert.equal(
    matched.kind === 'matched' ? matched.asset.compiler : '',
    'server',
  )
  assert.equal(wrongHash.kind, 'unmatched-owned')
  assert.equal(outside.kind, 'not-owned')
  assert.equal(nodeInternal.kind, 'not-owned')
})

test('a page script matches a client line by path without its query and ignores server lines for ownership', () => {
  // Value: protects=page scripts match under the client public path regardless of ?v=, and a server line's public path owns no page script; fails_when=a query defeats the match or a server compilation's public path makes foreign scripts unmatched-owned; no_claim=the real Next script list
  // Arrange
  const reader = new WebpackLibraryReportReader()
  reader.append(
    Buffer.from(
      nextLine('client', '/o/client', [
        { name: 'static/chunks/main-app.js', sha256: HASH_A, resources: [] },
      ]) +
        nextLine('server', '/o/server', [
          { name: 'app/page.js', sha256: HASH_B, resources: [] },
        ]),
    ),
  )

  // Act
  const withQuery = reader.matchPage(
    'http://localhost:3000/_next/static/chunks/main-app.js?v=17',
    HASH_A,
  )
  const serverNameOnPage = reader.matchPage(
    'http://localhost:3000/_next/app/page.js',
    HASH_B,
  )

  // Assert
  assert.equal(withQuery.kind, 'matched')
  assert.equal(serverNameOnPage.kind, 'unmatched-owned')
})

test('the same hash and name from two compilers stay two entries', () => {
  // Value: protects=an asset of one compiler never replaces the same-named asset of another; fails_when=the rebuild replacement is keyed by name and public path alone; no_claim=script id handling (the route keys scripts by participant and id)
  // Arrange
  const folder = serverOutputFolder()
  const outputPath = join(folder, 'server')
  const reader = new WebpackLibraryReportReader()
  reader.append(
    Buffer.from(
      `{"wrapped":true,"compiler":"server","outputPath":${JSON.stringify(outputPath)}}\n` +
        nextLine('client', '/o/client', [
          { name: 'vendor-chunks/lib.js', sha256: HASH_A, resources: [] },
        ]) +
        nextLine('server', outputPath, [
          {
            name: 'vendor-chunks/lib.js',
            sha256: HASH_A,
            resources: ['/p/lib/rsc.js'],
          },
        ]),
    ),
  )

  // Act
  const page = reader.matchPage(
    'http://localhost:3000/_next/vendor-chunks/lib.js',
    HASH_A,
  )
  const server = reader.matchServer(
    pathToFileURL(join(outputPath, 'vendor-chunks/lib.js')).href,
    HASH_A,
  )

  // Assert
  assert.equal(page.kind === 'matched' ? page.asset.compiler : '', 'client')
  assert.equal(server.kind === 'matched' ? server.asset.compiler : '', 'server')
})

test('externals of the package and edge assets with library resources are exposed', () => {
  // Value: protects=the route can refuse an observation that Node or the edge runtime loads outside; fails_when=externals or edge library assets are dropped while parsing; no_claim=how the route words the refusal
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(
    Buffer.from(
      nextLine('server', '/o/server', [], ['lib', 'lib/sub']) +
        nextLine('edge-server', '/o/edge', [
          { name: 'edge.js', sha256: HASH_A, resources: ['/p/lib/index.js'] },
          { name: 'plain.js', sha256: HASH_B, resources: [] },
        ]),
    ),
  )

  // Assert
  assert.deepEqual(reader.externalsOf(), ['lib', 'lib/sub'])
  assert.deepEqual(
    reader.edgeLibraryAssets().map((asset) => asset.name),
    ['edge.js'],
  )
  assert.deepEqual([...reader.compiledCompilers()].sort(), [
    'edge-server',
    'server',
  ])
})

test('a compiler field of the wrong type makes the line malformed', () => {
  // Value: protects=a torn or foreign line is not trusted; fails_when=a numeric compiler is accepted as a name; no_claim=none beyond protects
  // Arrange
  const reader = new WebpackLibraryReportReader()

  // Act
  reader.append(Buffer.from('{"wrapped":true,"compiler":3}\n'))

  // Assert
  assert.equal(reader.unreadableCause, 'malformed-line')
  assert.equal(reader.wrapped, false)
})
