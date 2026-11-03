import assert from 'node:assert/strict'
import { test } from 'node:test'

import { holdsNextPagesRendererPatterns } from '../utils/holdsNextPagesRendererPatterns'
import { nextPagesDataFunctionCallAt } from '../utils/nextPagesDataFunctionCallAt'

import { pagesRuntimeTextOf } from './utils/pagesRuntimeText'

// Value: protects=AC 20 recognition: the data-function call frame of Next 16's Pages renderer is found by its call text (`getServerSideProps(`, `getStaticProps(`) and by the text of the traced await that wraps it, at the line and column V8 reported in the recorded payloads (16.1.4: 20:438, 20:298, 12:7088, 12:6961) and at the same texts in 16.4.4; other renderer locations (`render`) are no call; fails_when=a pattern drifts from the runtime text, so a call frame is missed and every hit reads as outside the data function, or the `render` frame is taken for a call; no_claim=the whole runtime file (only the vendored fragments of each version are loaded, at their real line and column), Next versions other than 16.1.4 and 16.4.4
test('finds the data-function call by its call text and its traced-await text in the renderer lines of Next 16.1.4 and 16.4.4', () => {
  // Arrange
  const runtime1614 = pagesRuntimeTextOf('16.1.4')
  const runtime1644 = pagesRuntimeTextOf('16.4.4')

  // Act, Assert
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 20, 438), {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 20, 298), {
    dataFunction: 'getServerSideProps',
    form: 'traced-await',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 12, 7088), {
    dataFunction: 'getStaticProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1614, 12, 6961), {
    dataFunction: 'getStaticProps',
    form: 'traced-await',
  })
  assert.equal(nextPagesDataFunctionCallAt(runtime1614, 23, 1110), undefined)
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 20, 350), {
    dataFunction: 'getServerSideProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 20, 210), {
    dataFunction: 'getServerSideProps',
    form: 'traced-await',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 12, 6112), {
    dataFunction: 'getStaticProps',
    form: 'call',
  })
  assert.deepEqual(nextPagesDataFunctionCallAt(runtime1644, 12, 5985), {
    dataFunction: 'getStaticProps',
    form: 'traced-await',
  })
  assert.equal(holdsNextPagesRendererPatterns(runtime1614), true)
  assert.equal(holdsNextPagesRendererPatterns(runtime1644), true)
})

// Value: protects=AC 20 unrecognised runtime: a runtime text that holds neither pattern is reported as unrecognised and finds no call at any location, which makes every hit `no-renderer-frame`; fails_when=a text without the patterns reads as recognised, or a location of it is taken for a call; no_claim=the verdict built on it (the verdict tests pin `no-renderer-frame`), the once-per-run journal line and the Next version in it (the run's)
test('a renderer text that holds neither pattern is unrecognised and finds no call', () => {
  // Arrange
  const changedRuntime =
    'async function renderToHTMLImpl(){const data=await loadData({req});return data}\nfunction render(){return renderToHTMLImpl()}'

  // Act, Assert
  assert.equal(holdsNextPagesRendererPatterns(changedRuntime), false)
  assert.equal(nextPagesDataFunctionCallAt(changedRuntime, 0, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(changedRuntime, 0, 26), undefined)
})

// Value: protects=location lookup bounds: a location past the last line or past the end of its line finds no call and does not throw, and a text with CRLF or Unicode line terminators numbers its lines as V8 does; fails_when=a stale location throws, or a Windows or separator-bearing runtime shifts the lines so a call is missed; no_claim=none beyond protects
test('a location outside the text finds no call and CRLF, CR, LS and PS count as line ends', () => {
  // Arrange
  const call = 'getServerSideProps({req})'
  const separators = [
    '\r\n',
    '\r',
    String.fromCharCode(0x2028),
    String.fromCharCode(0x2029),
  ]

  // Act, Assert
  assert.equal(nextPagesDataFunctionCallAt('', 0, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(call, 5, 0), undefined)
  assert.equal(nextPagesDataFunctionCallAt(call, 0, 500), undefined)
  for (const separator of separators)
    assert.deepEqual(
      nextPagesDataFunctionCallAt(`first${separator}${call}`, 1, 0),
      { dataFunction: 'getServerSideProps', form: 'call' },
      JSON.stringify(separator),
    )
})
