import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pagesServerStopRefusal } from '../utils/pagesServerStopRefusal'

/** The fields every Pages stop refusal after the owned server started carries. */
const PAGES_DETAILS_AFTER_READINESS = {
  router: 'pages',
  sideEffects: 'unknown',
}

// Value: protects=the client-component refusal tells an agent that a helper the data function calls can take a server stop once it lives in its own module, so a helper in the page file is not a dead end; fails_when=the message names only the page component, getInitialProps and participant "browser", or the codes and details change; no_claim=that the helper's module is then sealed (the run tests)
test('the client-component refusal says a helper the data function calls can take a server stop in its own module', () => {
  // Arrange
  const refusal = pagesServerStopRefusal({
    kind: 'client-component',
    place: 'src/pages/index.tsx:2',
  })
  // Act
  const { code, message, details } = refusal
  // Assert
  assert.equal(code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    message,
    "Declared stop src/pages/index.tsx:2 is in the entry page's own module, and the page's client compile maps the line: the page component and getInitialProps lines also run in the page's server render and in the browser, and Codebook observes them in the browser. Declare it with participant \"browser\". A getInitialProps line pauses in the browser only after a client navigation (an operation), never at the entry load. For the page's data, declare a server stop in its getServerSideProps or getStaticProps. A helper that the data function calls can take a server stop once it lives in its own module.",
  )
  assert.deepEqual(details, {
    reason: 'client-component',
    stop: 'src/pages/index.tsx:2',
    ...PAGES_DETAILS_AFTER_READINESS,
  })
})

// Value: protects=the server-module-absent refusal says what to do (declare the stop in a module the data function imports statically, or in the data function itself) instead of leaving the static recovery that moves the stop to a browser line; fails_when=the message ends at the "does not establish" sentence, or the code or details change; no_claim=that such a module is sealed (the run tests)
test('the server-module-absent refusal says to declare the stop in a statically imported module or in the data function', () => {
  // Arrange
  const refusal = pagesServerStopRefusal({
    kind: 'server-module-absent',
    place: 'src/theme.ts:1',
    route: '/',
  })
  // Act
  const { code, message, details } = refusal
  // Assert
  assert.equal(code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    message,
    'Codebook could not find the module of src/theme.ts:1 in the server compile of the page / or in the server chunks it loads, so it cannot seal a server stop there before the browser opens. This does not establish that the code never runs in the server (a module loaded later, for example through a dynamic import, is not sealed). Declare the stop in a module that the data function imports statically, or in the data function itself.',
  )
  assert.deepEqual(details, PAGES_DETAILS_AFTER_READINESS)
})

// Value: protects=the browser-module-absent refusal says what to do (a module the data function imports needs no browser check) instead of leaving the static recovery that moves the stop to a browser line; fails_when=the message ends at the "does not establish" sentence, or the code or details change; no_claim=why the browser module could not be sealed
test('the browser-module-absent refusal says a module the data function imports needs no browser check', () => {
  // Arrange
  const refusal = pagesServerStopRefusal({
    kind: 'browser-module-absent',
    place: 'src/pages/index.tsx:5',
  })
  // Act
  const { code, message, details } = refusal
  // Assert
  assert.equal(code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    message,
    "Codebook could not verify the browser code of the page that holds src/pages/index.tsx:5, which it needs to tell a data-function line from a page-component line. This does not establish that the line is in the page's data function. A stop in a module that the data function imports, instead of the page's own file, needs no browser check: declare it there.",
  )
  assert.deepEqual(details, PAGES_DETAILS_AFTER_READINESS)
})

// Value: protects=the not-workspace-source refusal names the kinds of file Codebook does not read for a stop (node_modules, Next's own code, untracked, hidden, sensitive-named, build-output and lockfile paths) and says what to declare instead; fails_when=the message keeps only node_modules, Next and untracked files or gives no instruction, or the code or details change; no_claim=which exact paths the exclusion rule refuses (the exclusion tests)
test('the not-workspace-source refusal names the files Codebook does not read and says what to declare instead', () => {
  // Arrange
  const refusal = pagesServerStopRefusal({
    kind: 'not-workspace-source',
    place: 'node_modules/lib/index.js:3',
  })
  // Act
  const { code, message, details } = refusal
  // Assert
  assert.equal(code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    message,
    "Declared stop node_modules/lib/index.js:3 is in a file Codebook does not read for a stop (a module under node_modules, Next's own code, or an untracked, hidden, sensitive-named, build-output or lockfile path), so it cannot seal a server stop there. Declare the stop in a tracked source file of the project that the data function calls, or in the data function itself. This does not establish that the code never runs in the server.",
  )
  assert.deepEqual(details, PAGES_DETAILS_AFTER_READINESS)
})
