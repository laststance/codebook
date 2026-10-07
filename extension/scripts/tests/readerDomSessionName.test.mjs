import assert from 'node:assert/strict'
import { resolve, sep } from 'node:path'
import { test } from 'node:test'

import { readerDomSessionName } from '../utils/readerDomSessionName.mjs'

// Value: protects=two runs of a Reader DOM check on one machine (two checkouts, or one checkout with two output folders), which the browser CLI tells apart by the session name alone; fails_when=the name stops carrying the output folder, so one run opens or closes the other's browser and ends as a failure for no defect, or the name gains a character the browser CLI replaces in its socket path; why_new=Cycle 0046 row 122: the name held the mode alone and the false failure was seen at two merges; row 240: this test holds on every system, because it states no digest (a resolve on Windows puts the drive before the path, so a digest stated for a POSIX path is another one there); seam=none
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
  /** The name with its folder digest, eight hex characters at its end, written as a placeholder; a name without one stays as it is. */
  const formOf = (name) => name.replace(/-[0-9a-f]{8}$/, '-<digest>')
  const digestOf = (name) => name.slice(name.lastIndexOf('-') + 1)

  // Assert: the form the browser CLI gets, of lower-case letters, digits and hyphens; which names are one, and that the others differ.
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(names).map(([run, name]) => [run, formOf(name)]),
    ),
    {
      firstCheckout: 'cb-bootstrap-verify-<digest>',
      secondCheckout: 'cb-bootstrap-verify-<digest>',
      secondFolder: 'cb-bootstrap-verify-<digest>',
      redRun: 'cb-bootstrap-red-<digest>',
      wikiCheck: 'cb-wiki-reader-verify-<digest>',
      firstCheckoutAgain: 'cb-bootstrap-verify-<digest>',
    },
  )
  assert.equal(names.firstCheckoutAgain, names.firstCheckout)
  assert.equal(digestOf(names.redRun), digestOf(names.firstCheckout))
  assert.equal(
    new Set([
      names.firstCheckout,
      names.secondCheckout,
      names.secondFolder,
      names.redRun,
      names.wikiCheck,
    ]).size,
    5,
  )
})

// Value: protects=the stated form of a session name, digest included, where a developer or the CI job runs the checks; fails_when=the digest is taken from another text than the folder's absolute path, or is cut to another length; why_new=Cycle 0046 row 240: the digests were stated for every system, and on Windows the same folders resolve to paths with a drive; seam=none
test(
  'where paths are separated by a slash, a Reader DOM session name ends in the first eight hex characters of the SHA-256 of the output folder’s path',
  {
    skip:
      sep === '/'
        ? false
        : 'The stated digests are those of POSIX paths; on this system a resolved path begins with a drive.',
  },
  () => {
    // Arrange: absolute POSIX paths, which a resolve leaves as they are.
    const firstCheckout = '/work/codebook/artifacts/reader-dom'
    const secondCheckout = '/work/codebook-review/artifacts/reader-dom'
    const wikiFolder = '/work/codebook/artifacts/wiki-reader-dom'

    // Act
    const names = {
      firstCheckout: readerDomSessionName('bootstrap', 'verify', firstCheckout),
      secondCheckout: readerDomSessionName(
        'bootstrap',
        'verify',
        secondCheckout,
      ),
      redRun: readerDomSessionName('bootstrap', 'red', firstCheckout),
      wikiCheck: readerDomSessionName('wiki-reader', 'verify', wikiFolder),
    }

    // Assert
    assert.deepEqual(names, {
      firstCheckout: 'cb-bootstrap-verify-5ccc52ef',
      secondCheckout: 'cb-bootstrap-verify-d63eb6d4',
      redRun: 'cb-bootstrap-red-5ccc52ef',
      wikiCheck: 'cb-wiki-reader-verify-a99f68a7',
    })
  },
)

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
