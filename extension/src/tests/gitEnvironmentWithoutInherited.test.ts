import assert from 'node:assert/strict'
import { test } from 'node:test'

import { gitEnvironmentWithoutInherited } from '../utils/gitEnvironmentWithoutInherited'

// protects=an inherited Git variable is dropped whatever its letter case, as Windows treats environment names case-insensitively; fails_when=git_dir or Git_Work_Tree survives the filter; no_claim=Windows behavior itself
test('drops inherited Git variables written in any letter case', (context) => {
  // Arrange
  const original = { ...process.env }
  context.after(() => {
    for (const name of Object.keys(process.env)) delete process.env[name]
    Object.assign(process.env, original)
  })
  for (const name of Object.keys(process.env)) delete process.env[name]
  process.env.git_dir = '/elsewhere/.git'
  process.env.Git_Work_Tree = '/elsewhere'
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.PATH = '/usr/bin'

  // Act
  const environment = gitEnvironmentWithoutInherited()

  // Assert
  assert.deepEqual(environment, { PATH: '/usr/bin' })
})
