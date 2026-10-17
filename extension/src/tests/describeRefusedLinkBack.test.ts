import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeRefusedLinkBack } from '../utils/describeRefusedLinkBack'

// Value: protects=the learner whose changed file Codebook could not put back on a file system that refuses hard links; fails_when=the sentence does not name where the file is kept, the path it belongs at, the file system's code or the command to run again; why_new=Cycle 0046 row 243; seam=none
test('the sentence of a refused link back names what changed, the path and the code of the refusal, where the file is kept, and the command to run again', () => {
  // Arrange
  const ownPath = '/home/user/.cursor/mcp.json',
    keptPath = '/private/cursor-mcp-catalog/retired-1.mcp.json'

  // Act
  const sentence = describeRefusedLinkBack(
    'The Cursor MCP config',
    ownPath,
    'ENOTSUP',
    keptPath,
    'Codebook: Remove Managed Cursor Skill',
  )

  // Assert
  assert.equal(
    sentence,
    'The Cursor MCP config changed while Codebook had moved it away, and the file system refused to put it back as /home/user/.cursor/mcp.json (ENOTSUP). The file is kept as /private/cursor-mcp-catalog/retired-1.mcp.json; move it back to /home/user/.cursor/mcp.json, then run Codebook: Remove Managed Cursor Skill again.',
  )
})
