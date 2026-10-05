import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { readerDomSessionName } from '../utils/readerDomSessionName.mjs'

// Value: protects=two runs of a Reader DOM check on one machine (two checkouts, or one checkout with two output folders), which the browser CLI tells apart by the session name alone; fails_when=the name stops carrying the output folder, so one run opens or closes the other's browser and ends as a failure for no defect, or the name gains a character the browser CLI replaces in its socket path; why_new=Cycle 0046 row 122: the name held the mode alone and the false failure was seen at two merges; seam=none
test('two runs of one Reader DOM check with different output folders get different browser sessions, the two checks of one checkout too, and a run into the same folder gets the same one again', () => {
  // Arrange: the output folders of one check in two checkouts, a second folder in the first checkout, and the other check's folder there.
  const firstCheckout = '/work/codebook/artifacts/reader-dom'
  const secondCheckout = '/work/codebook-review/artifacts/reader-dom'
  const secondFolder = '/work/codebook/artifacts/reader-dom-second'
  const wikiFolder = '/work/codebook/artifacts/wiki-reader-dom'

  // Act
  const names = {
    firstCheckout: readerDomSessionName('bootstrap', 'verify', firstCheckout),
    secondCheckout: readerDomSessionName('bootstrap', 'verify', secondCheckout),
    secondFolder: readerDomSessionName('bootstrap', 'verify', secondFolder),
    redRun: readerDomSessionName('bootstrap', 'red', firstCheckout),
    wikiCheck: readerDomSessionName('wiki-reader', 'verify', wikiFolder),
    firstCheckoutAgain: readerDomSessionName(
      'bootstrap',
      'verify',
      firstCheckout,
    ),
  }

  // Assert: the names as the browser CLI gets them, each of lower-case letters, digits and hyphens.
  assert.deepEqual(names, {
    firstCheckout: 'cb-bootstrap-verify-5ccc52ef',
    secondCheckout: 'cb-bootstrap-verify-d63eb6d4',
    secondFolder: 'cb-bootstrap-verify-a1699fdf',
    redRun: 'cb-bootstrap-red-5ccc52ef',
    wikiCheck: 'cb-wiki-reader-verify-a99f68a7',
    firstCheckoutAgain: 'cb-bootstrap-verify-5ccc52ef',
  })
  assert.deepEqual(
    Object.values(names).filter((name) => !/^[a-z0-9-]{1,40}$/.test(name)),
    [],
  )
})

test('a Reader DOM check started with a relative output folder gets the session of that folder’s absolute path, so the same folder named in two ways is one session', () => {
  // Arrange: the folder the CI job and the guide name, as the script receives it and as an absolute path.
  const relativeFolder = 'artifacts/reader-dom'
  const absoluteFolder = resolve('artifacts/reader-dom')

  // Act
  const nameOfRelative = readerDomSessionName(
    'bootstrap',
    'verify',
    relativeFolder,
  )
  const nameOfAbsolute = readerDomSessionName(
    'bootstrap',
    'verify',
    absoluteFolder,
  )
  const nameFromAnotherFolder = readerDomSessionName(
    'bootstrap',
    'verify',
    resolve('..', 'artifacts/reader-dom'),
  )

  // Assert
  assert.equal(nameOfRelative, nameOfAbsolute)
  assert.notEqual(nameOfRelative, nameFromAnotherFolder)
})
