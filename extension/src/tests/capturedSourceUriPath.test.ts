import assert from 'node:assert/strict'
import { test } from 'node:test'

import { capturedSourceDeclaredPath } from '../utils/capturedSourceDeclaredPath'
import { capturedSourceUriPath } from '../utils/capturedSourceUriPath'

// Value: protects=each stop of a study opening its own captured-source tab when two of its files share their name and their bytes (the page.tsx of two routes that re-export the same component); fails_when=the captured-source URI holds only the item, the hash and the base name, so both files share one document and one tab; why_new=Cycle 0045 X7-RF1.1; seam=none
test('two files of one study with the same name and the same content get a captured-source document each', () => {
  // Arrange
  const sharedByBothFiles = {
    owner:
      '11111111-1111-4111-8111-111111111111_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    itemId: 'repository/dashboard/login',
    hash: 'ab12',
    fallbackName: 'login.mts',
  }

  // Act
  const firstRoute = capturedSourceUriPath({
    ...sharedByBothFiles,
    declaredPath: 'app/login/page.tsx',
  })
  const secondRoute = capturedSourceUriPath({
    ...sharedByBothFiles,
    declaredPath: 'app/signup/page.tsx',
  })

  // Assert
  assert.equal(
    firstRoute,
    '/11111111-1111-4111-8111-111111111111_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/repository%2Fdashboard%2Flogin/ab12/app/login/Captured-page.tsx',
  )
  assert.equal(
    secondRoute,
    '/11111111-1111-4111-8111-111111111111_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/repository%2Fdashboard%2Flogin/ab12/app/signup/Captured-page.tsx',
  )
})

// Value: protects=the reader recognizing the earlier captures of the file it shows, also in tabs the editor restored after a restart; fails_when=the declared path cannot be read back from a captured-source tab, or a Node test history source or a file at the repository root reads as another file; why_new=Cycle 0045 NF-30 (the one-tab rule compares the declared path of every captured tab); seam=none
test('the declared file of a captured source is read back from its document path, and a Node test history source names none', () => {
  // Arrange
  const nestedFile = capturedSourceUriPath({
    owner: 'study',
    itemId: 'repository/dashboard/login',
    hash: 'ab12',
    declaredPath: 'app/(overview)/[id]/page.tsx',
    fallbackName: 'login.mts',
  })
  const rootFile = capturedSourceUriPath({
    owner: 'study',
    itemId: 'repository/dashboard/login',
    hash: 'ab12',
    declaredPath: 'auth.ts',
    fallbackName: 'login.mts',
  })
  const withoutDeclaredFile = capturedSourceUriPath({
    owner: 'source-derived',
    itemId: 'repository/workspace/overview',
    hash: 'ab12',
    declaredPath: undefined,
    fallbackName: 'overview.mts',
  })

  // Act
  const declaredPaths = [
    nestedFile,
    rootFile,
    withoutDeclaredFile,
    '/node-history/study/3/ab12/Captured-data.ts',
    '/study/repository%2Fdashboard%2Flogin/ab12/notes.txt',
  ].map((uriPath) => capturedSourceDeclaredPath(uriPath))

  // Assert
  assert.equal(
    rootFile,
    '/study/repository%2Fdashboard%2Flogin/ab12/Captured-auth.ts',
  )
  assert.equal(
    withoutDeclaredFile,
    '/source-derived/repository%2Fworkspace%2Foverview/ab12/Captured-overview.mts',
  )
  assert.deepEqual(declaredPaths, [
    'app/(overview)/[id]/page.tsx',
    'auth.ts',
    'overview.mts',
    undefined,
    undefined,
  ])
})
