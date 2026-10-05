import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

test("the browser CLI's working folder in the repository root is ignored by Git", () => {
  // Arrange: a file playwright-cli leaves in the folder the Reader DOM check is started from.
  const leftover = '.playwright-cli/page.yml'

  // Act: -v names the file and the rule that decide the path, so a rule of the developer's own Git setup cannot stand in for the repository's.
  const decision = spawnSync('git', ['check-ignore', '-v', leftover], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  const [source, , rule] = decision.stdout.split('\t')[0].split(':')

  // Assert
  assert.equal(decision.status, 0, 'Git does not ignore .playwright-cli/')
  assert.deepEqual(
    { source, rule },
    { source: '.gitignore', rule: '.playwright-cli/' },
  )
})
