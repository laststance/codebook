import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { startServer } from '../server'

import { createHarness } from './helpers'

/** The README the VSIX packages; tests run from `dist/tests`. */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

// Value: protects=the Cursor setup check in the packaged README naming the tool and resource counts Codebook's MCP server lists, so a learner who sees them under Customize > MCPs knows setup worked; fails_when=the README names counts the server does not list (Cycle 0127 F1: it said 6 resources while Cursor showed the server's 9); why_new=Cycle 0127 F1 (Issue #323); seam=a real MCP SDK client on the service's own endpoint; no_claim=what Cursor's catalog shows (the native check reads it there)
test("the packaged README's Cursor setup step names the tool and resource counts the MCP server lists", async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const endpoint = await startServer(harness.service)
  context.after(() => endpoint.close())
  const client = new Client({
    name: 'readme-setup-counts-test',
    version: '1.0',
  })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())

  // Act
  const tools = (await client.listTools()).tools
  const resources = (await client.listResources()).resources
  const readme = await readPackagedReadme()

  // Assert
  assert.equal(tools.length, 16)
  assert.equal(resources.length, 9)
  assert.ok(
    readme.includes(
      'for the connected Codebook entry with 16 tools and 9 resources before chatting.',
    ),
  )
})
