import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'
import {
  buildReverseProxyIdentityPreloadSource,
  expectedProofOf,
} from '../utils/reverseProxyIdentityPreload'

import { endProcessesAfter } from './utils/endProcessesAfter'
import { removeTestFolder } from './utils/removeTestFolder'

const SECRET =
  '5ec0de5ec0de5ec0de5ec0de5ec0de5ec0de5ec0de5ec0de5ec0de00ff00ff00'
const CHALLENGE = '00112233445566778899aabbccddeeff'
const PROOF_PATH = '/__codebook_proof__/'

/** A stand-in application: counts the requests that reach its handler and reports its port on stdout. */
const APP_SOURCE = `
const http = require('node:http')
let hits = 0
const server = http.createServer((incoming, outgoing) => {
  if (incoming.url === '/hits') return outgoing.end(String(hits))
  hits += 1
  outgoing.end('app answered ' + incoming.method + ' ' + incoming.url)
})
server.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port))
`

type Answer = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** Starts the stand-in application with the preload (and the secret when given) and returns a way to ask it. */
async function startApplication(
  context: TestContext,
  options: { secret: string | undefined },
) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-identity-preload-'))
  context.after(() => removeTestFolder(folder))
  const preloadPath = join(folder, 'identity.cjs')
  const applicationPath = join(folder, 'app.cjs')
  await writeFile(preloadPath, buildReverseProxyIdentityPreloadSource())
  await writeFile(applicationPath, APP_SOURCE)
  const child = spawn(
    process.execPath,
    ['--require', preloadPath, applicationPath],
    {
      env: {
        PATH: process.env.PATH,
        ...(options.secret === undefined
          ? {}
          : { CODEBOOK_PROOF_SECRET: options.secret }),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  endProcessesAfter(context, () => (child.pid === undefined ? [] : [child.pid]))
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const port = await waitUntil(
    () => /PORT (\d+)/.exec(output)?.[1],
    'the stand-in application port',
    20_000,
  )
  /** Sends one request to the application and returns the whole answer. */
  const ask = (path: string, method = 'GET'): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        { host: '127.0.0.1', port: Number(port), path, method, agent: false },
        (incoming) => {
          let body = ''
          incoming.on('data', (chunk: Buffer) => (body += chunk.toString()))
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body,
            }),
          )
        },
      )
      outgoing.on('error', reject)
      outgoing.end()
    })
  return { ask, pid: child.pid }
}

// Value: protects=the proof the prover compares with being the keyed answer the real preload gives; fails_when=the preload and expectedProofOf use different keys, algorithms or encodings; why_new=the proof protocol is new; seam=real Node child with an http server; no_claim=a real Next server answering through the preload (E1 measured it; the native check proves it)
test('the preload answers a proof request with the keyed digest expectedProofOf computes', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: SECRET })

  // Act
  const answer = await ask(`${PROOF_PATH}${CHALLENGE}`)

  // Assert
  assert.equal(answer.status, 200)
  assert.equal(
    answer.body,
    expectedProofOf(
      SECRET,
      CHALLENGE,
      Number(answer.headers['x-codebook-proof-pid']),
    ),
  )
  assert.equal(answer.body.length, 64)
})

// Value: protects=the proof headers the prover and the pid binding read; fails_when=the answer is cacheable, keeps the connection or omits the answering pid; why_new=the proof protocol is new; seam=real Node child; no_claim=the process-group check of the gate
test('the proof answer is uncached, closes the connection and names the answering process', async (context) => {
  // Arrange
  const { ask, pid } = await startApplication(context, { secret: SECRET })

  // Act
  const answer = await ask(`${PROOF_PATH}${CHALLENGE}`)

  // Assert
  assert.equal(answer.headers['cache-control'], 'no-store')
  assert.equal(answer.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(answer.headers.connection, 'close')
  assert.equal(answer.headers['x-codebook-proof-pid'], String(pid))
})

// Value: protects=a party without the secret being unable to forge the proof; fails_when=the answer does not depend on the secret; why_new=the proof protocol is new; seam=real Node child; no_claim=none
test('a different secret gives a different answer to the same challenge', async (context) => {
  // Arrange
  const first = await startApplication(context, { secret: SECRET })
  const second = await startApplication(context, { secret: 'another-secret' })

  // Act
  const firstAnswer = await first.ask(`${PROOF_PATH}${CHALLENGE}`)
  const secondAnswer = await second.ask(`${PROOF_PATH}${CHALLENGE}`)

  // Assert
  assert.notEqual(firstAnswer.body, secondAnswer.body)
  assert.equal(
    secondAnswer.body,
    expectedProofOf('another-secret', CHALLENGE, Number(second.pid)),
  )
})

// Value: protects=the digest covering the answering pid; fails_when=the preload digests the challenge alone so a proxy can swap the pid header; no_claim=the process-group check of the gate
test('the preload digest changes with the pid, so a swapped pid header cannot match', async (context) => {
  // Arrange
  const { ask, pid } = await startApplication(context, { secret: SECRET })

  // Act
  const answer = await ask(`${PROOF_PATH}${CHALLENGE}`)

  // Assert
  assert.equal(answer.body, expectedProofOf(SECRET, CHALLENGE, Number(pid)))
  assert.notEqual(
    answer.body,
    expectedProofOf(SECRET, CHALLENGE, Number(pid) + 1),
  )
})

// Value: protects=a malformed challenge or a query never running the app's not-found code; fails_when=such a request falls through to the application handler or answers 200; why_new=the proof protocol is new; seam=real Node child; no_claim=none
test('a malformed challenge or a query under the proof path answers 404 without reaching the application', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: SECRET })

  // Act
  const tooShort = await ask(`${PROOF_PATH}abc`)
  const upperCase = await ask(`${PROOF_PATH}${CHALLENGE.toUpperCase()}`)
  const withQuery = await ask(`${PROOF_PATH}${CHALLENGE}?x=1`)
  const hits = await ask('/hits')

  // Assert
  assert.deepEqual(
    [tooShort.status, upperCase.status, withQuery.status],
    [404, 404, 404],
  )
  assert.equal(hits.body, '0')
})

// Value: protects=only GET proving the identity and the app never seeing another method on the proof path; fails_when=POST falls through or answers 200; why_new=the proof protocol is new; seam=real Node child; no_claim=none
test('a POST to the proof path answers 405 without reaching the application', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: SECRET })

  // Act
  const answer = await ask(`${PROOF_PATH}${CHALLENGE}`, 'POST')
  const hits = await ask('/hits')

  // Assert
  assert.equal(answer.status, 405)
  assert.equal(hits.body, '0')
})

// Value: protects=the app's own requests being untouched by the preload; fails_when=a URL outside the proof prefix is answered or swallowed by the preload; why_new=the preload patches the server for every request; seam=real Node child; no_claim=none
test('a request outside the proof path still reaches the application handler', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: SECRET })

  // Act
  const answer = await ask('/dashboard')

  // Assert
  assert.equal(answer.status, 200)
  assert.equal(answer.body, 'app answered GET /dashboard')
})

// Value: protects=the preload being inert without the secret variable; fails_when=the proof path is answered, or the server patched, when CODEBOOK_PROOF_SECRET is absent; why_new=the preload is a Node option that may outlive a run; seam=real Node child; no_claim=none
test('without the secret variable the proof path reaches the application like any other', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: undefined })

  // Act
  const answer = await ask(`${PROOF_PATH}${CHALLENGE}`)

  // Assert
  assert.equal(answer.body, `app answered GET ${PROOF_PATH}${CHALLENGE}`)
})

// Value: protects=a proof request never running app code; fails_when=the application handler counts a proof request; why_new=D11 forbids app code on the proof path; seam=real Node child; no_claim=Next route code (the preload is proven with a plain http server)
test('a valid proof request does not reach the application handler', async (context) => {
  // Arrange
  const { ask } = await startApplication(context, { secret: SECRET })
  await ask(`${PROOF_PATH}${CHALLENGE}`)

  // Act
  const hits = await ask('/hits')

  // Assert
  assert.equal(hits.body, '0')
})

// Value: protects=the identity secret staying out of the journal and out of published output while the server still receives it; fails_when=the secret appears in application.acquired, in the output tail or in a chunk-split print; why_new=the launch adds a secret to the environment; seam=launchDevelopmentServer with a stand-in executable; no_claim=a real Next printing it
test('the identity secret is absent from the journal and reads masked in the server output', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-identity-mask-'))
  context.after(() => removeTestFolder(folder))
  const executable = join(folder, 'bin', 'next.js')
  await mkdir(join(folder, 'bin'), { recursive: true })
  const secret = SECRET.slice(0, 64)
  // The stand-in prints the secret it received, once whole and once split over two writes.
  await writeFile(
    executable,
    `const s = process.env.CODEBOOK_PROOF_SECRET
process.stdout.write('received ' + s + ' END1\\n')
process.stdout.write('split ' + s.slice(0, 20))
setTimeout(() => process.stdout.write(s.slice(20) + ' END2\\n'), 200)
setInterval(() => {}, 1000)
`,
  )
  const preloadPath = join(folder, 'identity.cjs')
  await writeFile(preloadPath, buildReverseProxyIdentityPreloadSource())
  const journal: { type: string; detail?: unknown }[] = []

  // Act
  const app = launchDevelopmentServer(
    folder,
    process.execPath,
    (type, detail) => journal.push({ type, detail }),
    false,
    3014,
    undefined,
    undefined,
    executable,
    { identity: { preloadPath, secret } },
  )
  const heldPids = (): number[] => (app.pid === undefined ? [] : [app.pid])
  endProcessesAfter(context, heldPids, { group: true, held: heldPids })
  await waitUntil(
    () => app.outputTail().includes('END2'),
    'the stand-in output',
    20_000,
  )
  const tail = app.outputTail()
  await app.close()

  // Assert
  assert.equal(JSON.stringify(journal).includes(secret), false)
  assert.equal(JSON.stringify(journal).includes(secret.slice(0, 20)), false)
  assert.equal(tail.includes(secret), false)
  assert.equal(tail.includes('received [masked] END1'), true)
  assert.equal(tail.includes('split [masked] END2'), true)
})

// Value: protects=the generated preload text holding no secret and naming the constants the gate and the prover share; fails_when=a secret is baked into the file, or the prefix or variable name drifts from the constants; why_new=the file is written once per run into a temp folder; seam=none; no_claim=the preload's behavior (the real-child tests above)
test('the generated preload text holds the prefix and variable name but no secret', () => {
  // Arrange and Act
  const source = buildReverseProxyIdentityPreloadSource()

  // Assert
  assert.equal(source.includes('"/__codebook_proof__/"'), true)
  assert.equal(source.includes('"CODEBOOK_PROOF_SECRET"'), true)
  assert.equal(source.includes(SECRET), false)
})
