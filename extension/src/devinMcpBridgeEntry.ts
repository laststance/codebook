import { runDevinMcpBridge } from './devinMcpBridge'

const agentDir = process.argv[2]
if (!agentDir) {
  console.error(
    'Codebook Devin MCP bridge requires the agent folder of this Codebook installation.',
  )
  process.exitCode = 1
} else
  void runDevinMcpBridge(agentDir).catch(() => {
    // Descriptor parse errors may contain credentials, so keep the public recovery message fixed.
    console.error(
      'Codebook Devin MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Devin Desktop window.',
    )
    process.exitCode = 1
  })
