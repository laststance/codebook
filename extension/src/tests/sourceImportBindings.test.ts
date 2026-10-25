import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sourceImportBindings } from '../utils/sourceImportBindings'

// Value: protects=which export an imported name of a test stop is read as: a named import reads its own name, an alias the original export, a default import `default`, a namespace import names no one export (`*`), and type-only imports bind nothing; fails_when=an alias maps to its local name (so another module's export of that name is read, Cycle 0052 task 70), or a type-only import is taken for a runtime binding; why_new=pt3 /ship Step 11 (Claude adversarial, Codex adversarial and structured review): the inspector matched exports by the local name; seam=none (a pure function of the source text); no_claim=dynamic import() and require(), which bind no name at the import declaration
test('an imported name of a stopped source reads the export its import declaration names', () => {
  // Arrange
  const source = [
    "import db, { invoices as invoiceTable, type Invoice } from '@/db'",
    "import * as schema from '@/db/schema'",
    "import type { Customer } from './definitions'",
    "import { revalidatePath } from 'next/cache'",
    "import './setup'",
  ].join('\n')

  // Act
  const bindings = sourceImportBindings(source)

  // Assert
  assert.deepEqual(
    [...bindings],
    [
      ['db', 'default'],
      ['invoiceTable', 'invoices'],
      ['schema', '*'],
      ['revalidatePath', 'revalidatePath'],
    ],
  )
})

// Value: protects=an import declaration written over several lines, with comments and a trailing comma, as formatters write long imports: each of its names is read as its export; fails_when=the clause is read on one line only, so the names of a multi-line import (nextjs-dashboard's actions.test.ts imports authenticate, createInvoice, … this way) bind nothing and their facts read unavailable; why_new=pt3 /ship Step 11 (task 70): the parser is new; seam=none; no_claim=imports inside template strings
test('a multi-line import declaration with comments binds each of its names', () => {
  // Arrange
  const source = [
    'import {',
    '  authenticate, // signs in, then redirects',
    '  /* the action under test */ createInvoice,',
    "  'quoted-export' as quoted,",
    '} from "./actions"',
  ].join('\n')

  // Act
  const bindings = sourceImportBindings(source)

  // Assert
  assert.deepEqual(
    [...bindings],
    [
      ['authenticate', 'authenticate'],
      ['createInvoice', 'createInvoice'],
      ['quoted', 'quoted-export'],
    ],
  )
})

// Value: protects=only real import declarations bind names: an import written in a line comment, a block comment, a template literal (a test's source fixture) or a quoted string binds nothing, so no module binding is read for a name the file never imports; fails_when=the declaration pattern runs over comments and strings, so `// import { fake } from './not-loaded'` binds `fake` and another module's export of that name is saved as the fact (Cycle 0052 task 87); why_new=hosted CodeRabbit review of 779c8adf (outside-diff, sourceImportBindings.ts:9-30); seam=none (a pure function of the source text); no_claim=regular expression literals that hold a quote, which the masking does not parse
test('an import written in a comment or a string binds no name', () => {
  // Arrange
  const source = [
    "// import { fake } from './not-loaded'",
    "/* import { blocked } from './old'",
    "   import { stillBlocked } from './old' */",
    "import { db } from '@/db' // the real one, 'quoted' and // nested",
    'const fixture = `',
    "import { fromFixture } from './fixture'",
    '`',
    'const line = "import { fromString } from \'./string\'"',
  ].join('\n')

  // Act
  const bindings = sourceImportBindings(source)

  // Assert
  assert.deepEqual([...bindings], [['db', 'db']])
})
