import { createInterface } from 'node:readline'
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { StudyClient, connectionSchema } from './client'

const commandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('discover') }),
  z.object({
    operation: z.literal('tool'),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
  z.object({ operation: z.literal('resource'), uri: z.string() }),
  z.object({ operation: z.literal('exit') }),
])

/** Bridges agent-chosen stdin commands to the actual SDK without planning actions or writing supplied values as observations. @example node dist/agentConsole.js /private/connection.json /private/transcript.json */
async function main(): Promise<void> {
  const [descriptorPath, transcriptPath] = process.argv.slice(2)
  if (!descriptorPath || !transcriptPath)
    throw new Error(
      'Usage: agentConsole <private connection file> <transcript file>',
    )
  const descriptor = connectionSchema.parse(
      JSON.parse(await readFile(descriptorPath, 'utf8')),
    ),
    agent = await StudyClient.connect(descriptor)
  const input = createInterface({ input: process.stdin })
  console.log(
    JSON.stringify({
      connected: true,
      instanceId: descriptor.instanceId,
      workspace: descriptor.workspace,
    }),
  )
  try {
    for await (const line of input) {
      try {
        const command = commandSchema.parse(JSON.parse(line))
        if (command.operation === 'exit') break
        const result =
          command.operation === 'discover'
            ? await agent.discover()
            : command.operation === 'tool'
              ? await agent.tool(command.name, command.arguments, z.unknown())
              : await agent.read(command.uri)
        console.log(JSON.stringify({ result }))
      } catch (error) {
        console.log(JSON.stringify({ error: String(error) }))
      }
      await writeFile(transcriptPath, JSON.stringify(agent.transcript, null, 2))
    }
  } finally {
    input.close()
    await agent.close()
    await writeFile(transcriptPath, JSON.stringify(agent.transcript, null, 2))
  }
}
void main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
