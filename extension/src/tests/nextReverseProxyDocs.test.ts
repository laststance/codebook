import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REVERSE_PROXY_REFUSAL_REASONS } from '../constants'
import { ERROR_RECOVERY, REVERSE_PROXY_REFUSAL_RECOVERY } from '../errors'
import {
  NEXT_REVERSE_PROXY_CONFIGURATION,
  REPOSITORY_BROWSER_START_HERE,
} from '../nextHelp'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

/** Values from earlier trials and projects that no help, skill or README text may carry. */
const TRIAL_VALUES = [
  'dashboard.codebook.test',
  '8080',
  '3165',
  'nextjs-dashboard',
  'nsx',
  'stocklist',
  '3010',
  '4000',
  'switch-time',
  '4100',
  '4101',
  'setting-link',
]

/** The part of the served help these tests read. */
type ReverseProxyHelp = {
  startHere: string
  nextReverseProxy: {
    summary: string
    whenToDeclare: string
    findingTheOriginAndPort: string
    configuration: { example: unknown; note: string }
    whatCodebookDoes: string
    refusals: {
      anchor: string
      code: string
      reasons: Record<
        string,
        { anchor: string; observed: string; fix: string; recovery: string }
      >
      portTaken: string
    }
    signIn: string
    limits: string[]
  }
}

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help.
 * @example
 * const help = await readHelp(context) // => { startHere: '…', nextReverseProxy: {…} }
 */
async function readHelp(context: TestContext): Promise<ReverseProxyHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}')
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below `extension/`.
 * @returns The file text.
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

/**
 * Cuts the reverse-proxy paragraph out of a packaged document.
 * @param text - The whole document.
 * @param opening - The paragraph's opening words.
 * @returns The paragraph, up to the next blank line.
 * @example
 * paragraphAfter('a\n\nB c\n\nd', 'B') // => 'B c'
 */
function paragraphAfter(text: string, opening: string): string {
  const start = text.indexOf(opening)
  assert.notEqual(start, -1, opening)
  const end = text.indexOf('\n\n', start)
  return text.slice(start, end === -1 ? undefined : end)
}

// Value: protects=a chat reading the start-here sentence is sent to nextReverseProxy for a Next app behind the learner's own proxy; fails_when=the sentence leaves startHere or names another section; no_claim=that the chat follows it
test('startHere sends a Next app behind a local reverse proxy to nextReverseProxy', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act / Assert
  const sentence =
    "For a Next app the learner opens through their own local reverse proxy instead of directly at the dev server's localhost address (API 1.40 or later), read nextReverseProxy."
  assert.ok(help.startHere.includes(sentence))
  assert.ok(REPOSITORY_BROWSER_START_HERE.includes(sentence))
})

// Value: protects=the help section carries the D15 texts a chat relies on (when to declare, how to find the values, what Codebook does) and names a host only, never localhost; fails_when=a text loses its opening words, the localhost clause returns or the section drops a key; no_claim=the wording of later sentences
test('the nextReverseProxy section opens each text with its agreed words and names a host name only', async (context) => {
  // Arrange
  const { nextReverseProxy: section } = await readHelp(context)
  // Act / Assert
  assert.ok(
    section.summary.startsWith(
      'A Next app the learner opens through their own local reverse proxy (nginx, Caddy or Traefik), at a host name such as https://app.example.test, runs with',
    ),
  )
  assert.ok(
    section.whenToDeclare.startsWith(
      'Declare reverseProxy only when the learner opens the app through a reverse proxy',
    ),
  )
  assert.ok(
    section.findingTheOriginAndPort.startsWith(
      'What you find is a candidate, not a fact.',
    ),
  )
  assert.ok(
    section.whatCodebookDoes.startsWith(
      "In order: (1) it resolves the origin's host through this machine's resolver",
    ),
  )
  assert.ok(
    section.whatCodebookDoes.includes(
      "(5) it starts a throwaway browser with the same pin and checks, without any cookie, that it reaches that address and port and trusts the certificate; only then it opens the app's browser pinned the same way and loads the entry there.",
    ),
  )
  assert.ok(
    section.configuration.note.includes(
      'reverseProxy beside library is refused',
    ),
  )
  assert.equal(JSON.stringify(section).includes('https://localhost'), false)
})

// Value: protects=the example a chat copies is accepted by the public start schema and declares the placeholder origin and port at the root of the app; fails_when=the example drifts from the schema, gains a packageRoot or a canonical-origin violation; no_claim=that the placeholder file exists
test('NEXT_REVERSE_PROXY_CONFIGURATION parses with the live start schema and declares the placeholder origin', () => {
  // Arrange
  const example = JSON.parse(JSON.stringify(NEXT_REVERSE_PROXY_CONFIGURATION))
  // Act
  const result = liveRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(result.success, true)
  assert.deepEqual(example.reverseProxy, {
    origin: 'https://app.example.test',
    upstreamPort: 4310,
  })
  assert.equal('packageRoot' in example, false)
  assert.equal(example.version, 3)
  assert.equal(example.adapter, 'next-dev-webpack')
})

// Value: protects=a chat finds a fix for every refusal reason and follows the REVERSE_PROXY_REFUSED anchor to a section; fails_when=a reason has no row, a row lacks its recovery or the recovery drops the code's anchor; no_claim=the message wording, which the refusal builder tests pin
test('the refusal table has one row per reason with its fix and recovery and the error recovery names the anchor', async (context) => {
  // Arrange
  const { nextReverseProxy: section } = await readHelp(context)
  // Act
  const reasons = Object.keys(section.refusals.reasons)
  // Assert
  assert.deepEqual(reasons, [...REVERSE_PROXY_REFUSAL_REASONS])
  assert.equal(reasons.length, 15)
  for (const reason of REVERSE_PROXY_REFUSAL_REASONS) {
    const row = section.refusals.reasons[reason]
    assert.equal(row?.anchor, `codebook://help/repository-browser#${reason}`)
    assert.equal(row?.recovery, REVERSE_PROXY_REFUSAL_RECOVERY[reason])
    assert.ok((row?.fix.length ?? 0) > 0, reason)
    assert.ok((row?.observed.length ?? 0) > 0, reason)
  }
  assert.equal(section.refusals.code, 'REVERSE_PROXY_REFUSED')
  assert.ok(
    ERROR_RECOVERY.REVERSE_PROXY_REFUSED.includes(section.refusals.anchor),
  )
})

// Value: protects=the limits a chat must tell the learner (localhost refused, system proxy or VPN refused, readiness at loopback, cookie scope by host) are in the help; fails_when=one of the agreed limit or sign-in sentences is dropped; no_claim=that Codebook enforces each limit, which the run tests pin
test('the limits and the sign-in text carry the agreed sentences of the reverse proxy contract', async (context) => {
  // Arrange
  const { nextReverseProxy: section } = await readHelp(context)
  const limits = section.limits.join('\n')
  // Act / Assert
  for (const sentence of [
    'A host named localhost or ending in .localhost is refused: the browser resolves those names itself.',
    'A system proxy, a PAC file or a VPN that routes the host elsewhere is refused before any browser of the run opens (browser-address-mismatch)',
    'Codebook asks the development server it started at its loopback address for its own readiness check, so an app that must see its public host name or https to answer at all can be refused there.',
    "Certificates are never bypassed: the operating system and the browser must both trust the proxy's certificate.",
    'basePath and i18n stay refused.',
  ])
    assert.ok(limits.includes(sentence), sentence)
  assert.ok(
    section.signIn.includes(
      "A saved session holds cookies by host name: one set up at localhost does not apply at the declared host, and one set up for the declared host also applies to that host on another port and to a Domain cookie's subdomains.",
    ),
  )
  assert.ok(
    section.refusals.portTaken.includes('two starts per learner request'),
  )
})

// Value: protects=the bundled skill, the README item and the Saved studies sentence tell the learner and the chat the API gate, the format and the no-bypass rule; fails_when=a sentence leaves the skill or README, or the README still names the previous API as current; no_claim=the CHANGELOG entry, which /ship writes
test('the skill and the README carry the reverse proxy paragraph and the format 22 sentence', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const skillParagraph = paragraphAfter(
    skill,
    "**A Next app behind the learner's own local proxy (API 1.40).**",
  )
  const readmeItem = paragraphAfter(
    readme,
    'This applies to a Next app at the repository root and to one below it.',
  )
  // Assert
  for (const phrase of [
    'only when `codebook_status` reports API 1.40 or later',
    'never drop the field to run at localhost',
    'Read `nextReverseProxy` in `codebook://help/repository-browser`',
    'never guess the port',
    'never ask them to turn certificate checks off',
    'at most two starts per learner request in total',
  ])
    assert.ok(skillParagraph.includes(phrase), phrase)
  for (const phrase of [
    'stop your own server on it first',
    'never bypasses it',
    '`REVERSE_PROXY_REFUSED`',
    'does not observe your own backend behind the proxy',
  ])
    assert.ok(readmeItem.includes(phrase), phrase)
  assert.ok(
    readme.includes(
      'A run that declares `reverseProxy` is saved as format 22; Codebook 0.2.103 and older list it as saved by a newer Codebook, so update Codebook to open it.',
    ),
  )
  assert.ok(readme.includes('with **MCP API 1.42** (`codebook_status`'))
  assert.ok(
    readme.includes(
      'The bundled skill declares `reverseProxy` only when `codebook_status` reports API 1.40 or later; with an older Codebook the chat asks you to update it and never drops the field to run at `localhost`. The chat asks you one question unless you stated both the origin and the port yourself, never guesses the port, and never asks you to turn certificate checks off.',
    ),
  )
})

// Value: protects=no trial host, port or project name reaches the help section, the skill paragraph or the README item; fails_when=any trial value or company name appears in those texts; no_claim=other parts of the README, which describe earlier cycles
test('the reverse proxy help, skill paragraph and README item carry no trial value', async (context) => {
  // Arrange
  const { nextReverseProxy: section } = await readHelp(context)
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  const texts = [
    JSON.stringify(section),
    paragraphAfter(
      skill,
      "**A Next app behind the learner's own local proxy (API 1.40).**",
    ),
    paragraphAfter(
      readme,
      'This applies to a Next app at the repository root and to one below it.',
    ),
  ]
  // Act
  const found = texts.flatMap((text) =>
    TRIAL_VALUES.filter((value) => text.includes(value)),
  )
  // Assert
  assert.deepEqual(found, [])
})
