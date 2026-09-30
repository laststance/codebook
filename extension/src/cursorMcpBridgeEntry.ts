import { runCursorMcpBridge } from './cursorMcpBridge'

const descriptorPath = process.argv[2]
if (!descriptorPath)
  throw new Error(
    'Codebook Cursor MCP bridge requires the current private connection descriptor.',
  )
void runCursorMcpBridge(descriptorPath).catch(() => {
  // Descriptor parse errors may contain credentials, so keep the public recovery message fixed.
  console.error(
    'Codebook Cursor MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Cursor window.',
  )
  process.exitCode = 1
})
