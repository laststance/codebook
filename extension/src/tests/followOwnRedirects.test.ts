import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { followOwnRedirects } from '../utils/followOwnRedirects'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'

import { endProcessesAfter } from './utils/endProcessesAfter'
import { removeTestFolder } from './utils/removeTestFolder'

const OWN = 'http://127.0.0.1:4310'
const DECLARED = 'https://app.example.test'

/** Builds a `send` stand-in that answers each URL from a table and records every URL it was asked. */
function answers(table: Record<string, Response>) {
  const asked: string[] = []
  const send = async (url: string): Promise<Response> => {
    asked.push(url)
    const answer = table[url]
    if (!answer) throw new Error(`unexpected request to ${url}`)
    return answer
  }
  return { asked, send }
}

const redirect = (status: number, location: string) =>
  new Response(null, { status, headers: { location } })

// Value: protects=a readiness request that never leaves the dev server's loopback address; fails_when=the walk asks the declared host or any other origin; why_new=the global fetch would resolve the public host outside the pin; seam=stand-in send; no_claim=a real network
test('a redirect to the declared origin ends the walk as an answer without asking that origin', async () => {
  // Arrange
  const { asked, send } = answers({
    [`${OWN}/`]: redirect(308, `${DECLARED}/en`),
  })

  // Act
  const response = await followOwnRedirects(`${OWN}/`, DECLARED, send)

  // Assert
  assert.equal(response.status, 200)
  assert.deepEqual(asked, [`${OWN}/`])
})

/** Asks the system for a free loopback port, then frees it for the stand-in server to take. @example await freePort() // => 51234 */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  if (address === null || typeof address === 'string')
    throw new Error('No free port')
  return address.port
}

// Value: protects=a root that redirects inside the dev server still being read to its end; fails_when=same-origin redirects are not followed; why_new=redirects are followed by hand now; seam=stand-in send; no_claim=none
test('redirects on the dev server own origin are followed to the final answer', async () => {
  // Arrange
  const { asked, send } = answers({
    [`${OWN}/`]: redirect(307, '/en'),
    [`${OWN}/en`]: new Response('page', { status: 200 }),
  })

  // Act
  const response = await followOwnRedirects(`${OWN}/`, DECLARED, send)

  // Assert
  assert.equal(response.status, 200)
  assert.deepEqual(asked, [`${OWN}/`, `${OWN}/en`])
})

// Value: protects=a redirect to a foreign origin failing the root instead of being asked; fails_when=the walk follows or hides a redirect to another origin; why_new=only the dev server origin and the declared origin are trusted; seam=stand-in send; no_claim=none
test('a redirect to another origin is returned as the failed answer and never asked', async () => {
  // Arrange
  const { asked, send } = answers({
    [`${OWN}/`]: redirect(302, 'https://elsewhere.example.test/'),
  })

  // Act
  const response = await followOwnRedirects(`${OWN}/`, DECLARED, send)

  // Assert
  assert.equal(response.status, 302)
  assert.deepEqual(asked, [`${OWN}/`])
})

// Value: protects=a redirect loop ending at the hop limit; fails_when=the walk never stops; why_new=redirects are followed by hand now; seam=stand-in send; no_claim=none
test('a redirect loop on the dev server origin stops after five hops with the redirect answer', async () => {
  // Arrange
  const { asked, send } = answers({ [`${OWN}/`]: redirect(307, '/') })

  // Act
  const response = await followOwnRedirects(`${OWN}/`, DECLARED, send)

  // Assert
  assert.equal(response.status, 307)
  assert.equal(asked.length, 6)
})

// Value: protects=a root that redirects to the public host being ready instead of failing or being resolved outside the pin; fails_when=ready follows the redirect with the global fetch or reads the 3xx as a failed root; why_new=D24 rootAnswer follows redirects by hand for a declared origin; seam=launchDevelopmentServer with a stand-in executable; no_claim=a real Next; the declared origin in readyEntry's redirect rules is covered by lane F's entry-response cases
test('ready accepts a root that redirects to the declared origin as an answer', async (context) => {
  // Arrange
  const port = await freePort()
  const folder = await mkdtemp(join(tmpdir(), 'codebook-declared-root-'))
  context.after(() => removeTestFolder(folder))
  const executable = join(folder, 'bin', 'next.js')
  await mkdir(join(folder, 'bin'), { recursive: true })
  await writeFile(
    executable,
    `const http = require('node:http')
http.createServer((request, response) => {
  response.writeHead(308, { location: 'https://app.example.test/' })
  response.end()
}).listen(${port}, '127.0.0.1', () => console.log('http://127.0.0.1:${port}'))
`,
  )
  const app = launchDevelopmentServer(
    folder,
    process.execPath,
    () => undefined,
    false,
    port,
    undefined,
    undefined,
    executable,
  )
  const heldPids = (): number[] => (app.pid === undefined ? [] : [app.pid])
  endProcessesAfter(context, heldPids, { group: true, held: heldPids })

  // Act
  const origin = await app.ready(
    new AbortController().signal,
    '/',
    undefined,
    DECLARED,
  )
  await app.close()

  // Assert
  assert.equal(origin, `http://127.0.0.1:${port}`)
})
