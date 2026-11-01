import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFIGURED_PROFILE } from '../configuredProfile'
import {
  operationsRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
  type OperationsRepositoryConfiguration,
} from '../repositoryConfigSchemas'
import { startSchema } from '../schemas'

/** Supplies the four-operation create-invoice flow of the Issue as a valid version 3 configuration. @example operationsConfiguration().operations.length // 4 */
function operationsConfiguration(): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'create-invoice',
      anchorIndex: 0,
    },
    source: {
      path: 'app/ui/invoices/create-form.tsx',
      hash: 'a'.repeat(64),
      line: 19,
      column: 5,
    },
    participant: 'browser',
    afterOperation: 2,
    entryPath: '/dashboard/invoices/create',
    before: [{ kind: 'visible', selector: 'form' }],
    after: [{ kind: 'visible', selector: 'table' }],
    operations: [
      { kind: 'choose', title: 'Customer', selector: '#customer', value: 'c1' },
      { kind: 'text', title: 'Amount', selector: '#amount', text: '120' },
      { kind: 'click', title: 'Pending', selector: '#pending' },
      {
        kind: 'click',
        title: 'Create Invoice',
        selector: 'button[type=submit]',
      },
    ],
    inspections: [{ path: 'amount', mode: 'value', required: true }],
    additionalStops: [
      {
        participant: 'server',
        source: {
          path: 'app/lib/actions.ts',
          hash: 'b'.repeat(64),
          line: 12,
          column: 3,
        },
        anchorIndex: 1,
        inspections: [{ path: 'customerId', mode: 'value', required: true }],
        afterOperation: 4,
      },
    ],
  }
}

/** Parses a version 3 configuration with one change and answers whether it was accepted and every issue path. @example issuesOf((c) => { c.operations = [] }) */
function issuesOf(change: (configuration: Record<string, unknown>) => void) {
  const input = operationsConfiguration()
  change(input)
  const result = operationsRepositoryConfigSchema.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      )
}

// protects=a version 3 flow of choose, text and two clicks with a client stop and a server stop is a valid start configuration and keeps its operations in declared order; fails_when=the schema drops a kind, reorders operations or loses afterOperation; no_claim=the run accepts it (run tests)
test('a version 3 configuration of four ordered operations with stops declared after operations is accepted', () => {
  // Arrange
  const input = operationsConfiguration()
  // Act
  const parsed: OperationsRepositoryConfiguration =
    operationsRepositoryConfigSchema.parse(input)
  // Assert
  assert.deepEqual(
    parsed.operations.map((operation) => operation.kind),
    ['choose', 'text', 'click', 'click'],
  )
  assert.equal(parsed.afterOperation, 2)
  assert.equal(parsed.additionalStops?.[0]?.afterOperation, 4)
})

// protects=codebook_start admits a version 3 configuration through the public start schema and the retained union; fails_when=version 3 is missing from startSchema or from retainedRepositoryConfigSchema; no_claim=the start is served (service tests)
test('the start schema and the retained configuration union accept version 3', () => {
  // Arrange
  const configuration = operationsConfiguration()
  // Act
  const start = startSchema.safeParse({
    instanceId: '11111111-1111-4111-8111-111111111111',
    profile: 'repository-browser',
    key: 'start-1',
    configuration,
  })
  const retained = retainedRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.equal(start.success, true)
  assert.equal(retained.success, true)
})

// protects=the repository-browser profile entry of codebook_status lists version 3 beside 1 and 2 and offers the repository-operation action with the operation limit; fails_when=configurationVersions stays [1, 2]; no_claim=a client reads it from a live status
test('the repository-browser profile lists configuration version 3, the operation action and eight operations', () => {
  // Arrange, Act
  const { configurationVersions, actions, limits } = CONFIGURED_PROFILE
  // Assert
  assert.deepEqual(configurationVersions, [1, 2, 3])
  assert.deepEqual(
    actions.map((action) => action.id),
    ['repository-click', 'repository-operation'],
  )
  assert.equal(limits.operations, 8)
})

// protects=a run declares at least one and at most eight operations; fails_when=an empty list or a ninth operation is accepted; no_claim=none beyond protects
test('a version 3 configuration needs 1 to 8 operations', () => {
  // Arrange, Act
  const none = issuesOf((configuration) => {
    configuration.operations = []
  })
  const nine = issuesOf((configuration) => {
    configuration.operations = Array.from({ length: 9 }, (_, index) => ({
      kind: 'click',
      title: `Click ${index}`,
      selector: `#b${index}`,
    }))
  })
  // Assert
  assert.equal(none.length > 0, true)
  assert.equal(nine.length > 0, true)
})

// protects=operation titles stay distinct so the run resource and the replay can tell them apart; fails_when=two operations with one title are accepted; no_claim=none beyond protects
test('a version 3 configuration refuses two operations with one title and names the second', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.operations = [
      { kind: 'click', title: 'Save', selector: '#a' },
      { kind: 'click', title: 'Save', selector: '#b' },
    ]
    configuration.afterOperation = 1
    configuration.additionalStops = []
  })
  // Assert
  assert.deepEqual(issues, [
    'operations.1.title: Operation titles must be distinct; "Save" is declared twice.',
  ])
})

// protects=a text operation carries exactly one of its text and the ask-learner secret; fails_when=both, or neither, is accepted, or a secret other than ask-learner; no_claim=the learner is asked (service tests)
test('a text operation declares exactly one of text and secret ask-learner', () => {
  // Arrange, Act
  const both = issuesOf((configuration) => {
    configuration.operations = [
      {
        kind: 'text',
        title: 'Password',
        selector: '#password',
        text: 'x',
        secret: 'ask-learner',
      },
    ]
    configuration.afterOperation = 1
    configuration.additionalStops = []
  })
  const neither = issuesOf((configuration) => {
    configuration.operations = [
      { kind: 'text', title: 'Password', selector: '#password' },
    ]
    configuration.afterOperation = 1
    configuration.additionalStops = []
  })
  const typedSecret = issuesOf((configuration) => {
    configuration.operations = [
      {
        kind: 'text',
        title: 'Password',
        selector: '#password',
        secret: 'hunter2',
      },
    ]
    configuration.afterOperation = 1
    configuration.additionalStops = []
  })
  const askLearner = issuesOf((configuration) => {
    configuration.operations = [
      {
        kind: 'text',
        title: 'Password',
        selector: '#password',
        secret: 'ask-learner',
      },
    ]
    configuration.afterOperation = 1
    configuration.additionalStops = []
  })
  // Assert
  assert.equal(both.length > 0, true)
  assert.equal(neither.length > 0, true)
  assert.equal(typedSecret.length > 0, true)
  assert.deepEqual(askLearner, [])
})

// protects=version 3 keeps the run-level conditions and refuses the prepared inputs and the single action of versions 1 and 2; fails_when=initialInputs or action is accepted, or the run-level before or after is optional; no_claim=none beyond protects
test('a version 3 configuration refuses initialInputs and action and requires run-level before and after', () => {
  // Arrange, Act
  const withInputs = issuesOf((configuration) => {
    configuration.initialInputs = [{ selector: '#a', text: 'x' }]
  })
  const withAction = issuesOf((configuration) => {
    configuration.action = {
      title: 'Click',
      selector: 'button',
      before: [{ kind: 'visible', selector: 'button' }],
      after: [{ kind: 'visible', selector: 'table' }],
    }
  })
  const withoutBefore = issuesOf((configuration) => {
    delete configuration.before
  })
  const withoutAfter = issuesOf((configuration) => {
    delete configuration.after
  })
  // Assert
  assert.equal(withInputs.length > 0, true)
  assert.equal(withAction.length > 0, true)
  assert.equal(withoutBefore.length > 0, true)
  assert.equal(withoutAfter.length > 0, true)
})

// protects=every stop names an existing operation and the stops follow the order of their operations; fails_when=afterOperation 0, one past the operation count, a missing afterOperation or a decreasing order is accepted; no_claim=the run arms stops by it (runtime tests)
test('a stop declares afterOperation within the operation count in non-decreasing order', () => {
  // Arrange, Act
  const zero = issuesOf((configuration) => {
    configuration.afterOperation = 0
  })
  const pastTheEnd = issuesOf((configuration) => {
    configuration.afterOperation = 5
    configuration.additionalStops = []
  })
  const missing = issuesOf((configuration) => {
    delete configuration.afterOperation
  })
  const decreasing = issuesOf((configuration) => {
    configuration.afterOperation = 3
    configuration.additionalStops = [
      {
        participant: 'browser',
        source: {
          path: 'app/ui/invoices/create-form.tsx',
          hash: 'a'.repeat(64),
          line: 30,
          column: 5,
        },
        anchorIndex: 0,
        inspections: [{ path: 'amount', mode: 'value', required: true }],
        afterOperation: 2,
      },
    ]
  })
  const sameOperation = issuesOf((configuration) => {
    configuration.afterOperation = 4
  })
  // Assert
  assert.equal(zero.length > 0, true)
  assert.deepEqual(pastTheEnd, [
    'afterOperation: afterOperation 5 is declared at configuration.afterOperation, but the run declares 4 operations.',
  ])
  assert.equal(missing.length > 0, true)
  assert.deepEqual(decreasing, [
    'additionalStops.0.afterOperation: afterOperation 2 at configuration.additionalStops.0.afterOperation is lower than the 3 of the stop before it; declare the stops in the order of their operations.',
  ])
  assert.deepEqual(sameOperation, [])
})

// protects=a server stop stays refused under the Vite adapter in version 3 as in version 2; fails_when=vite-dev with participant server is accepted; no_claim=none beyond protects
test('a version 3 configuration refuses a server participant under vite-dev', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.adapter = 'vite-dev'
  })
  // Assert
  assert.equal(
    issues.some((issue) => issue.startsWith('additionalStops.0.participant')),
    true,
  )
})

// protects=a flow behind sign-in declares its own sign-in routes and a fresh-profile opt-out; fails_when=signInPaths or session: "fresh" is dropped or refused on a version 3 configuration; no_claim=a run uses them (run tests)
test('a version 3 configuration accepts one to four sign-in paths and session fresh', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.signInPaths = [
      '/login',
      '/en/login',
      '/auth/signin',
      '/sign-in',
    ]
    configuration.session = 'fresh'
  })
  // Assert
  assert.deepEqual(issues, [])
})

// protects=signInPaths holds 1 to 4 same-origin paths without a query; fails_when=an empty list, a fifth path, a query or a protocol-relative path is accepted; no_claim=none beyond protects
test('a version 3 configuration refuses an empty, a fifth, a query and a non-path sign-in path', () => {
  // Arrange
  const refused: Array<[string, unknown, string]> = [
    ['empty list', [], 'signInPaths'],
    ['five paths', ['/a', '/b', '/c', '/d', '/e'], 'signInPaths'],
    ['query', ['/login?next=1'], 'signInPaths.0'],
    ['other origin', ['//evil.test/login'], 'signInPaths.0'],
  ]
  for (const [name, value, path] of refused) {
    // Act
    const issues = issuesOf((configuration) => {
      configuration.signInPaths = value
    })
    // Assert
    assert.ok(
      issues.some((issue) => issue.startsWith(`${path}: `)),
      `${name}: ${issues.join(' | ')}`,
    )
  }
})

// protects=session accepts only "fresh"; fails_when=another value is accepted; no_claim=none beyond protects
test('a version 3 configuration refuses a session other than fresh', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.session = 'saved'
  })
  // Assert
  assert.equal(issues.length, 1)
  assert.ok(issues[0]!.startsWith('session: '))
})

// protects=a repeated sign-in path (after one trailing slash is removed) is named at its second index; fails_when=/login and /login/ are both accepted; no_claim=none beyond protects
test('a version 3 configuration refuses a sign-in path declared twice and names the second', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.signInPaths = ['/login', '/login/']
  })
  // Assert
  assert.deepEqual(issues, [
    'signInPaths.1: Sign-in paths must be distinct; "/login/" is declared twice.',
  ])
})

// protects=the entry page cannot be a sign-in path, or every run would answer SIGN_IN_REQUIRED on its first load; fails_when=an entryPath equal to a sign-in path (with a query or trailing slash) is accepted; no_claim=none beyond protects
test('a version 3 configuration refuses an entry path that is a listed sign-in path', () => {
  // Arrange, Act
  const issues = issuesOf((configuration) => {
    configuration.entryPath = '/login/?next=%2Fdashboard'
    configuration.signInPaths = ['/dashboard', '/login']
  })
  // Assert
  assert.deepEqual(issues, [
    'signInPaths.1: The entry path is a sign-in path: the run would always answer SIGN_IN_REQUIRED. Leave signInPaths out to explain the sign-in page itself.',
  ])
})
