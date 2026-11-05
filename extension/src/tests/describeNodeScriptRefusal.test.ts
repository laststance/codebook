import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { describeNodeScriptRefusal } from '../utils/describeNodeScriptRefusal'

/** Runs one shared node-server refusal sentence through {@link describeNodeScriptRefusal}. */
function describe(message: string): StudyError {
  const described = describeNodeScriptRefusal(
    new StudyError('NODE_SERVER_SOURCE_REFUSED', message),
  )
  assert.ok(described instanceof StudyError)
  return described
}

const SENTENCES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'package-root',
    "node-server's packageRoot apps/tool is not a folder inside the opened repository by its real path.",
    "node-script's packageRoot apps/tool is not a folder inside the opened repository by its real path.",
  ],
  [
    'entry',
    "node-server's entry run.ts is not a file inside packageRoot apps/tool by its real path.",
    "node-script's entry run.ts is not a file inside packageRoot apps/tool by its real path.",
  ],
  [
    'stop-file',
    "node-server's stop 2 (a.ts) is not a file inside the opened repository by its real path.",
    "node-script's stop 2 (a.ts) is not a file inside the opened repository by its real path.",
  ],
  [
    'tsx-missing',
    "node-server's TypeScript entry runs through the repository's own tsx, and none is installed for apps/tool (searched node_modules/tsx from apps/tool up to the repository root); install the repository's dependencies.",
    "node-script's TypeScript entry runs through the repository's own tsx, and none is installed for apps/tool (searched node_modules/tsx from apps/tool up to the repository root); install the repository's dependencies.",
  ],
  [
    'outside-package',
    "node-server's tsx for apps/tool (node_modules/tsx) lies outside the opened repository by its real path, as with pnpm's enableGlobalVirtualStore; Codebook loads only a tsx inside the repository.",
    "node-script's tsx for apps/tool (node_modules/tsx) lies outside the opened repository by its real path, as with pnpm's enableGlobalVirtualStore; Codebook loads only a tsx inside the repository.",
  ],
  [
    'tsx-missing',
    'node-server\'s tsx for apps/tool (node_modules/tsx) exports no loader file inside the repository as "." for import; install the repository\'s dependencies again.',
    'node-script\'s tsx for apps/tool (node_modules/tsx) exports no loader file inside the repository as "." for import; install the repository\'s dependencies again.',
  ],
]

// protects=each refusal sentence of the shared node-server resolvers reaches the reason an agent branches on, so a tsx outside the repository is not told as a missing tsx; fails_when=a sentence maps to another reason or the profile word is not renamed; no_claim=that a run raises the sentence
for (const [reason, sentence, expected] of SENTENCES)
  test(`a refusal sentence is told as reason ${reason}: ${sentence.slice(0, 40)}`, () => {
    // Arrange / Act
    const described = describe(sentence)
    // Assert
    assert.equal(described.code, 'NODE_SCRIPT_SOURCE_REFUSED')
    assert.equal(described.details?.reason, reason)
    assert.equal(described.message, expected)
  })

// protects=a sentence the mapping does not know is never guessed as a missing tsx; fails_when=an unknown sentence falls back to tsx-missing; no_claim=which sentences exist
test('an unclassified refusal sentence gets the neutral reason source-refused, not tsx-missing', () => {
  // Arrange / Act
  const described = describe("node-server's something new went wrong.")
  // Assert
  assert.equal(described.details?.reason, 'source-refused')
})

// protects=a declared path that contains node-server is echoed unchanged; fails_when=the whole message is rewritten instead of its profile prefix; no_claim=other messages
test('a declared entry under packages/node-server/ is echoed unchanged in the refusal', () => {
  // Arrange / Act
  const described = describe(
    "node-server's entry packages/node-server/run.mjs is not a file inside packageRoot packages/node-server by its real path.",
  )
  // Assert
  assert.equal(described.details?.reason, 'entry')
  assert.equal(
    described.message,
    "node-script's entry packages/node-server/run.mjs is not a file inside packageRoot packages/node-server by its real path.",
  )
})
