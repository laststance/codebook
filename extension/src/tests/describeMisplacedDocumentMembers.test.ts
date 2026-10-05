import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeMisplacedDocumentMembers } from '../utils/describeMisplacedDocumentMembers'

// Value: protects=a publish refusal naming every misplaced document member and every other unknown key in one answer; fails_when=only the first member is named, or the other unknown keys are dropped; why_new=the protocol tests give one key at a time; seam=none
test('a publish refusal names several misplaced document members together, and keeps naming the other unknown keys of the same call after them', () => {
  // Arrange: the members a published document has, and the unknown keys of three calls.
  const documentMembers = ['title', 'summary', 'nodes', 'edges']
  const unknownKeys = {
    twoMembers: ['edges', 'title'],
    threeMembers: ['edges', 'title', 'nodes'],
    memberAndOneOtherKey: ['edges', 'draft'],
    memberAndTwoOtherKeys: ['draft', 'edges', 'version'],
    noMember: ['draft'],
  }
  // Act
  const refusals = Object.fromEntries(
    Object.entries(unknownKeys).map(([name, keys]) => [
      name,
      describeMisplacedDocumentMembers(keys, documentMembers),
    ]),
  )
  // Assert
  assert.deepEqual(refusals, {
    twoMembers:
      'edges and title are members of the published document, not of the call: give them inside document, as document.edges and document.title.',
    threeMembers:
      'edges, title and nodes are members of the published document, not of the call: give them inside document, as document.edges, document.title and document.nodes.',
    memberAndOneOtherKey:
      'edges is a member of the published document, not of the call: give it inside document, as document.edges. Unrecognized key: "draft"',
    memberAndTwoOtherKeys:
      'edges is a member of the published document, not of the call: give it inside document, as document.edges. Unrecognized keys: "draft", "version"',
    noMember: undefined,
  })
})
