import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findNextClientReferenceStub } from '../utils/findNextClientReferenceStub'
import { isNextClientReferenceStub } from '../utils/isNextClientReferenceStub'

const RSC_URL = 'webpack-internal:///(rsc)/./app/ui/search.tsx'

/** Builds a module text with a register call and an inline source map listing the given sources. */
function stubText(sources: string[], sourceUrl?: string): string {
  const map = Buffer.from(JSON.stringify({ sources })).toString('base64')
  return [
    'registerClientReference(function(){},"x","default");',
    `//# sourceMappingURL=data:application/json;base64,${map}`,
    ...(sourceUrl ? [`//# sourceURL=${sourceUrl}`] : []),
  ].join('\n')
}

// Value: protects=a server module that merely mentions registerClientReference is never refused as a client component; fails_when=a map with any non-proxy source, an empty map or a missing register call reads as a stub; why_new=serverRenderBundle checks only the positive real cuts; seam=none; no_claim=a real Next chunk (serverRenderBundle covers the real cuts)
test('only a module whose every map source is the Next proxy file reads as a client reference stub', () => {
  // Arrange
  const proxy = '/abs/app/ui/__nextjs-internal-proxy.mjs'
  // Act
  const stub = isNextClientReferenceStub(stubText([proxy]))
  const mixed = isNextClientReferenceStub(
    stubText([proxy, '/abs/app/ui/search.tsx']),
  )
  const empty = isNextClientReferenceStub(stubText([]))
  const noRegister = isNextClientReferenceStub(
    'export default 1\n//# sourceMappingURL=data:application/json;base64,' +
      Buffer.from(JSON.stringify({ sources: [proxy] })).toString('base64'),
  )
  // Assert
  assert.equal(stub, true)
  assert.equal(mixed, false)
  assert.equal(empty, false)
  assert.equal(noRegister, false)
})

// Value: protects=an unreadable inline map is skipped, not fatal, and a later valid map still decides; fails_when=bad base64 JSON throws out of the seal or ends the search; why_new=no test fed an unreadable inline map; seam=none; no_claim=none beyond protects
test('an unparsable inline source map is skipped and a later proxy map still marks the stub', () => {
  // Arrange
  const garbage = Buffer.from('not json').toString('base64')
  const good = stubText(['/abs/__nextjs-internal-proxy.mjs'])
  const text = `${good.split('\n')[0]}\n//# sourceMappingURL=data:application/json;base64,${garbage}\n${good.split('\n')[1]}`
  // Act
  const result = isNextClientReferenceStub(text)
  // Assert
  assert.equal(result, true)
})

// Value: protects=the stub search matches the module by its LAST sourceURL and never another file's stub; fails_when=a stub of a different file or an earlier sourceURL comment refuses a server stop; why_new=no test placed another file's stub or two sourceURL comments in one chunk; seam=none; no_claim=none beyond protects
test('a client stub is found only under the rsc address of the selected file', () => {
  // Arrange
  const proxy = ['/abs/__nextjs-internal-proxy.mjs']
  const own = stubText(proxy, RSC_URL)
  const other = stubText(proxy, 'webpack-internal:///(rsc)/./app/ui/other.tsx')
  const earlierOnly = `//# sourceURL=${RSC_URL}\n${stubText(proxy, 'webpack-internal:///(rsc)/./app/ui/other.tsx')}`
  // Act
  const found = findNextClientReferenceStub([other, own], RSC_URL)
  const otherFileOnly = findNextClientReferenceStub([other], RSC_URL)
  const earlierComment = findNextClientReferenceStub([earlierOnly], RSC_URL)
  const noModules = findNextClientReferenceStub([], RSC_URL)
  // Assert
  assert.equal(found, true)
  assert.equal(otherFileOnly, false)
  assert.equal(earlierComment, false)
  assert.equal(noModules, false)
})
