import assert from 'node:assert/strict'
import { test } from 'node:test'

import { webpackImportPathOf } from '../utils/webpackImportPathOf'

/** The opening of the page module Next 16.3.4's development server compiled for P04's RSC Example (the text that paused natively in C86-2). */
const COMPILED_PAGE = [
  '__webpack_require__.r(__webpack_exports__);',
  '/* harmony import */ var next_image__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/image */ "(rsc)/./node_modules/next/dist/api/image.js");',
  '/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! react */ "(rsc)/./node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react.js");',
  '/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(react__WEBPACK_IMPORTED_MODULE_3__);',
  '/* harmony import */ var react_redux__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! react-redux */ "(rsc)/./node_modules/react-redux/dist/rsc.mjs");',
  'console.log(react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector);',
].join('\n')

/** The opening of the database module the same server compiled for `nextjs-dashboard` (C86-1). */
const COMPILED_DATABASE = [
  '/* harmony import */ var postgres__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! postgres */ "(rsc)/./node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js");',
  '/* harmony import */ var _schema__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./schema */ "(rsc)/./db/schema.ts");',
  'const connectionString = process.env.POSTGRES_URL;',
].join('\n')

// Value: protects=C86-2 (P04's RSC Example): a named import is read through the module object webpack bound it to, keeping the rest of the declared path; fails_when=the source name is evaluated as written and throws ReferenceError, so the RSC stub of useSelector stays unobserved; no_claim=whether the pause holds the module object, which the inspection's probe decides
test('a named import of the stopped page is read through the module object webpack compiled it to', () => {
  // Arrange
  const source =
    "import Image from 'next/image'\nimport { useSelector } from 'react-redux'\nconsole.log(useSelector)"

  // Act
  const rewritten = webpackImportPathOf(
    'useSelector.name',
    source,
    COMPILED_PAGE,
  )

  // Assert
  assert.deepEqual(rewritten, {
    name: 'useSelector',
    compiledPath: 'react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector.name',
  })
})

// Value: protects=an aliased named import reads the export it names, not its local alias; fails_when=`useSelector as select` is read as `.select`, a member the module does not have; no_claim=quoted export names, which take the bracket form
test('an aliased import is read through the export it names', () => {
  // Arrange
  const source = "import { useSelector as select } from 'react-redux'"

  // Act
  const rewritten = webpackImportPathOf('select', source, COMPILED_PAGE)

  // Assert
  assert.deepEqual(rewritten, {
    name: 'select',
    compiledPath: 'react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector',
  })
})

// Value: protects=a namespace import is the module object itself; fails_when=`* as ReactRedux` is read as a member named ReactRedux; no_claim=re-exports, which bind no local name
test('a namespace import is read as the compiled module object itself', () => {
  // Arrange
  const source = "import * as ReactRedux from 'react-redux'"

  // Act
  const rewritten = webpackImportPathOf(
    'ReactRedux.useSelector',
    source,
    COMPILED_PAGE,
  )

  // Assert
  assert.deepEqual(rewritten, {
    name: 'ReactRedux',
    compiledPath: 'react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector',
  })
})

// Value: protects=C86-1 (nextjs-dashboard's database module): the default import of an ES module is read as its `default` member, as webpack compiles `postgres(...)`; fails_when=the default import is read as a member named after the local; no_claim=CommonJS modules, read through webpack's default getter (next test)
test('the default import of an ES module is read as its default member', () => {
  // Arrange
  const source =
    "import postgres from 'postgres'\nconst connectionString = process.env.POSTGRES_URL"

  // Act
  const rewritten = webpackImportPathOf('postgres', source, COMPILED_DATABASE)

  // Assert
  assert.deepEqual(rewritten, {
    name: 'postgres',
    compiledPath: 'postgres__WEBPACK_IMPORTED_MODULE_0__["default"]',
  })
})

// Value: protects=the default import of a CommonJS module (React in the RSC layer) is read through the getter webpack binds for it, as the compiled page does; fails_when=`React.version` is read as `react…__["default"].version`, which a CommonJS module object does not have; no_claim=whether V8 runs the getter under its side-effect check, which the inspection reports
test('the default import of a CommonJS module is read through the default getter webpack binds', () => {
  // Arrange
  const source = "import React from 'react'"

  // Act
  const rewritten = webpackImportPathOf('React.version', source, COMPILED_PAGE)

  // Assert
  assert.deepEqual(rewritten, {
    name: 'React',
    compiledPath: 'react__WEBPACK_IMPORTED_MODULE_3___default().version',
  })
})

// Value: protects=a module-level binding of the stopped module is never rewritten: only imports are renamed by webpack; fails_when=`connectionString` is rewritten to an import's member; no_claim=bindings webpack renames for other reasons
test('a binding the module declares itself is not rewritten', () => {
  // Arrange
  const source =
    "import postgres from 'postgres'\nconst connectionString = process.env.POSTGRES_URL"

  // Act
  const rewritten = webpackImportPathOf(
    'connectionString',
    source,
    COMPILED_DATABASE,
  )

  // Assert
  assert.equal(rewritten, undefined)
})

// Value: protects=a type-only import binds nothing at run time, so it is never rewritten to a module member; fails_when=`import type { Invoice }` sends the inspection to a member that does not exist; no_claim=inline type specifiers, which sourceImportBindings drops the same way
test('a type-only import is not rewritten', () => {
  // Arrange
  const source = "import type { Store } from 'react-redux'"

  // Act
  const rewritten = webpackImportPathOf('Store', source, COMPILED_PAGE)

  // Assert
  assert.equal(rewritten, undefined)
})

// Value: protects=an import whose request the executed text does not import (another layer, a Vite or Turbopack module) is left as declared; fails_when=a guessed variable is evaluated; no_claim=production builds without path comments, which Codebook does not run
test('an import the compiled text does not bind is left as declared', () => {
  // Arrange
  const source = "import { createStore } from 'redux'"

  // Act
  const rewritten = webpackImportPathOf('createStore', source, COMPILED_PAGE)

  // Assert
  assert.equal(rewritten, undefined)
})
