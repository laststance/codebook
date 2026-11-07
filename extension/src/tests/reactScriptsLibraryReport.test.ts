import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ReactScriptsReportReader } from '../utils/reactScriptsLibraryReport'

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
  const reader = new ReactScriptsReportReader()

  // Act
  reader.append(Buffer.from('{"wrapped":true}\n'))

  // Assert
  assert.equal(reader.wrapped, true)
  assert.equal(reader.errorCause, undefined)
})

test('an error line gives the cause and leaves the run unwrapped', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()

  // Act
  reader.append(Buffer.from('{"error":"boom"}\n'))

  // Assert
  assert.equal(reader.wrapped, false)
  assert.equal(reader.errorCause, 'boom')
})

test('a trailing line without a newline stays pending until its newline arrives', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
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
  const reader = new ReactScriptsReportReader()

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
  const reader = new ReactScriptsReportReader(50)

  // Act
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert
  assert.equal(reader.unreadableCause, 'report-too-large')
  assert.equal(reader.wrapped, false)
})

test('a missing report is unreadable only when it is required', () => {
  // Arrange
  const optional = new ReactScriptsReportReader()
  const required = new ReactScriptsReportReader()

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
  writeFileSync(file, '{"wrapped":true}\n')
  const reader = new ReactScriptsReportReader()
  reader.refresh(file)

  // Act
  appendFileSync(file, compilationLine(HASH_A))
  reader.refresh(file)
  rmSync(directory, { recursive: true })

  // Assert
  assert.equal(reader.wrapped, true)
  assert.equal(
    reader.match('http://h/static/js/bundle.js', HASH_A).kind,
    'matched',
  )
})

test('a script of a truncated compilation is unmatched but owned', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
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
  const reader = new ReactScriptsReportReader()
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
  const reader = new ReactScriptsReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js', HASH_B)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('a script reported without a hash matches nothing', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/bundle.js', undefined)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('a rebuild appends a line and the parsed bundle of either compilation still matches', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
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
  const reader = new ReactScriptsReportReader()

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
  const reader = new ReactScriptsReportReader()
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
  const reader = new ReactScriptsReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A, 'static/js/my bundle.js')))

  // Act
  const verdict = reader.match('http://h/static/js/my%20bundle.js', HASH_A)

  // Assert
  assert.equal(verdict.kind, 'matched')
})

test('a script URL with a malformed percent escape matches nothing but stays owned', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
  reader.append(Buffer.from(compilationLine(HASH_A)))

  // Act
  const verdict = reader.match('http://h/static/js/%E0%A4%A.js', HASH_A)

  // Assert
  assert.equal(verdict.kind, 'unmatched-owned')
})

test('an inline script reported with the document URL is ignored while a js script under the public path with no asset stays unmatched', () => {
  // Arrange
  const reader = new ReactScriptsReportReader()
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
