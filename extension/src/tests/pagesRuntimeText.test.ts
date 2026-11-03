import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pagesRuntimeTextOf } from './utils/pagesRuntimeText'
import { runtimeTextOfFragments } from './utils/runtimeTextOfFragments'

// Value: protects=the built renderer text of the tests: two fragments of one line that come in descending column order each sit at their own column, so a recorded location finds the fragment vendored there; fails_when=a fragment of a line is appended after a later-column fragment that came first, and a frame's location reads padding or another fragment's text; no_claim=overlapping fragments (an excerpt never vendors two over one column)
test('places two fragments of one line at their own columns when the later column comes first', () => {
  // Arrange
  const fragments = [
    { line: 1, column: 10, text: 'later' },
    { line: 1, column: 2, text: 'early' },
  ]

  // Act
  const text = runtimeTextOfFragments(fragments)

  // Assert
  assert.equal(text, '\n  early   later')
})

// Value: protects=the negative case of the Pages verdict tests: the vendored Next 16.1.4 excerpt lists the component-render fragment (12:6447) after the getStaticProps fragment of the same line (12:6961), and the frame the verdict tests put at 12:6447 reads the component render text `(0,jsx_runtime_namespaceObject.jsx)(AppComp,…`; fails_when=the fragment is appended at the end of line 12, so the frame at 12:6447 reads blank padding and the "outside the data function" tests prove nothing about the renderer text there; no_claim=the 16.4.4 excerpt (its two fragments sit on different lines)
test('the Next 16.1.4 excerpt puts the component render text at line 12 column 6447', () => {
  // Arrange
  const runtime1614 = pagesRuntimeTextOf('16.1.4')

  // Act
  const line12 = runtime1614.split('\n')[12] ?? ''

  // Assert
  assert.equal(
    line12.slice(6447, 6491),
    '(0,jsx_runtime_namespaceObject.jsx)(AppComp,',
  )
  assert.equal(
    line12.slice(6961, 7009),
    'trace(trace_constants.RenderSpan.getStaticProps,',
  )
})
