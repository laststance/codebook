import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import {
  canonicalizeReverseProxy,
  liveRepositoryConfigSchema,
  operationsRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
  studyConfigurationSchema,
} from '../repositoryConfigSchemas'
import { reverseProxyDeclarationSchema } from '../reverseProxyDeclarationSchema'
import { parseReverseProxyOrigin } from '../utils/parseReverseProxyOrigin'

const DECLARATION = { origin: 'https://app.example.test', upstreamPort: 4310 }

/**
 * A valid version 3 next-dev-webpack configuration that declares `reverseProxy`; the caller replaces fields.
 * @example configuration({ adapter: 'vite-dev' }).adapter // => 'vite-dev'
 */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'next-dev-webpack',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'sign-in',
      anchorIndex: 0,
    },
    source: {
      path: 'app/page.tsx',
      hash: 'a'.repeat(64),
      line: 56,
      column: 5,
    },
    reverseProxy: DECLARATION,
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#email' }],
    after: [{ kind: 'text', selector: '#status', equals: 'sent' }],
    operations: [{ kind: 'click', title: 'Press', selector: '#press' }],
    inspections: [{ path: 'state', mode: 'value', required: true }],
    ...extra,
  }
}

/** The configuration with `origin` replaced. */
function withOrigin(origin: unknown): Record<string, unknown> {
  return configuration({
    reverseProxy: { ...DECLARATION, origin },
  })
}

/** The issues the live schema gives an input as `path: message` lines, or `accepted`. */
function issuesOf(
  input: unknown,
  schema: z.ZodType = liveRepositoryConfigSchema,
): string {
  const result = schema.safeParse(input)
  return result.success
    ? 'accepted'
    : result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
}

/** The canonical origin the parser answers for an accepted text, or `refused:<item>`. */
function canonicalOriginOf(text: string): string {
  const parsed = parseReverseProxyOrigin(text)
  return parsed.ok ? parsed.origin : `refused:${parsed.item}`
}

// Value: protects=AC1 a version 3 next-dev-webpack configuration with reverseProxy validates and keeps its declared shape; fails_when=the declaration is refused or a default is added; no_claim=that the proxy exists or resolves (the run checks)
test('accepts reverseProxy on a version 3 next-dev-webpack configuration and keeps its shape', () => {
  // Arrange
  const input = configuration()
  // Act
  const parsed = operationsRepositoryConfigSchema.parse(input)
  // Assert
  assert.equal(issuesOf(input), 'accepted')
  assert.deepEqual(parsed.reverseProxy, {
    origin: 'https://app.example.test',
    upstreamPort: 4310,
  })
})

// Value: protects=AC1 D8 item 1 a text that is not a URL is refused with its sentence at reverseProxy.origin; fails_when=it is accepted or worded differently; no_claim=the other origin rules
test('refuses an origin that is not a URL with the not-a-URL sentence', () => {
  // Arrange
  const input = withOrigin('app.example.test')
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'reverseProxy.origin: reverseProxy.origin is not a URL: declare the address the learner types in the browser, such as https://app.example.test.',
  )
})

// Value: protects=AC1 D8 item 1 surrounding white space is refused, not trimmed; fails_when=a padded origin is accepted; no_claim=interior white space
test('refuses an origin with surrounding white space', () => {
  // Arrange
  const input = withOrigin(' https://app.example.test')
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^reverseProxy\.origin: reverseProxy\.origin is not a URL/,
  )
})

// Value: protects=AC1 D8 item 2 a scheme other than http and https is refused; fails_when=ftp is accepted or worded differently; no_claim=the host rules
test('refuses an origin whose scheme is not http or https', () => {
  // Arrange
  const input = withOrigin('ftp://app.example.test')
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'reverseProxy.origin: reverseProxy.origin must start with https:// or http://; other schemes are not an app origin.',
  )
})

// Value: protects=AC1 D8 item 3 a path is refused and the sentence does not echo it; fails_when=a path is accepted, or the value appears in the message; no_claim=entryPath rules
test('refuses an origin that carries a path without echoing it', () => {
  // Arrange
  const input = withOrigin('https://app.example.test/login')
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'reverseProxy.origin: reverseProxy.origin must not carry a path: declare only the scheme and host, and put the page in entryPath.',
  )
})

// Value: protects=AC1 D8 item 4 a query, a fragment and an empty ? or # are refused; fails_when=any of the three spellings is accepted; no_claim=path handling
test('refuses an origin that carries a query or a fragment, even an empty one', () => {
  // Arrange
  const sentence =
    'reverseProxy.origin: reverseProxy.origin must not carry a query or a fragment: declare only the scheme and host.'
  const origins = [
    'https://app.example.test/?a=1',
    'https://app.example.test/#top',
    'https://app.example.test/?',
  ]
  // Act
  const issues = origins.map((origin) => issuesOf(withOrigin(origin)))
  // Assert
  assert.deepEqual(issues, [sentence, sentence, sentence])
})

// Value: protects=AC1 D8 item 5 credentials are refused and never echoed; fails_when=a user name or password is accepted or appears in the message; no_claim=other URL parts
test('refuses an origin that carries credentials without echoing them', () => {
  // Arrange
  const input = withOrigin('https://learner:placeholder@app.example.test')
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'reverseProxy.origin: reverseProxy.origin must not carry a user name or a password; Codebook takes no credentials in a URL.',
  )
})

// Value: protects=AC1 D8 item 6 IPv4, IPv6 and WHATWG-normalized IP spellings are refused; fails_when=an IP literal is accepted; no_claim=DNS resolution
test('refuses an origin that names an IP address in any spelling', () => {
  // Arrange
  const sentence =
    "reverseProxy.origin: reverseProxy.origin must name a host, not an IP address: declare the host name the learner types, the one their hosts entry or local DNS maps to a loopback address. An app opened directly at its dev server's http://localhost:<port> address declares no reverseProxy."
  const origins = ['https://127.0.0.1', 'https://[::1]:8443', 'https://0x7f.1']
  // Act
  const issues = origins.map((origin) => issuesOf(withOrigin(origin)))
  // Assert
  assert.deepEqual(issues, [sentence, sentence, sentence])
})

// Value: protects=AC1 D8 item 7 an upstreamPort outside 1024 to 65535 or not a whole number is refused with its sentence at reverseProxy.upstreamPort; fails_when=a bound moves or the sentence changes; no_claim=that the port is free
test('refuses an upstreamPort outside 1024 to 65535 and accepts both bounds', () => {
  // Arrange
  const sentence =
    "reverseProxy.upstreamPort: reverseProxy.upstreamPort must be a whole number from 1024 to 65535: the port the learner's proxy forwards to. Read it from the proxy's own configuration or ask the learner; never guess it."
  const declare = (upstreamPort: unknown) =>
    issuesOf(
      configuration({ reverseProxy: { ...DECLARATION, upstreamPort } }),
      operationsRepositoryConfigSchema,
    )
  // Act
  const results = [1023, 1024, 65535, 65536, 4310.5].map(declare)
  // Assert
  assert.deepEqual(results, [
    sentence,
    'accepted',
    'accepted',
    sentence,
    sentence,
  ])
})

// Value: protects=AC1 D8 item 8 a declaration without origin is refused with its sentence; fails_when=the field becomes optional or the sentence changes; no_claim=the other missing-field sentences
test('refuses a reverseProxy that has no origin', () => {
  // Arrange
  const input = configuration({ reverseProxy: { upstreamPort: 4310 } })
  // Act
  const issues = issuesOf(input, operationsRepositoryConfigSchema)
  // Assert
  assert.equal(
    issues,
    'reverseProxy.origin: reverseProxy needs origin: the address the learner types in the browser, such as https://app.example.test.',
  )
})

// Value: protects=AC1 D8 item 9 an unknown key inside reverseProxy is refused by the strict shape; fails_when=an extra key is accepted; no_claim=the wording of zod's unknown-key text
test('refuses an unknown key inside reverseProxy', () => {
  // Arrange
  const input = configuration({
    reverseProxy: { ...DECLARATION, scheme: 'https' },
  })
  // Act
  const result = liveRepositoryConfigSchema.safeParse(input)
  // Assert
  assert.equal(result.success, false)
  assert.equal(
    result.error?.issues.some(
      (issue) =>
        issue.code === 'unrecognized_keys' &&
        issue.path.join('.') === 'reverseProxy',
    ),
    true,
  )
})

// Value: protects=AC1 D8 item 10 every adapter but next-dev-webpack refuses reverseProxy with the way-out sentence at reverseProxy; fails_when=Vite, Create React App or Expo accept it, or the issue is an unknown-key issue without the sentence; no_claim=the older-version unknown-key text
test('refuses reverseProxy on a run that is not next-dev-webpack and says where the app opens', () => {
  // Arrange
  const adapters = ['vite-dev', 'react-scripts-dev', 'expo-web-dev']
  // Act
  const issues = adapters.map((adapter) => issuesOf(configuration({ adapter })))
  // Assert
  const sentence =
    "reverseProxy: reverseProxy is accepted on a version 3 next-dev-webpack run only (API 1.40). A Vite, Create React App or Expo run opens the app at the dev server's own localhost address."
  assert.deepEqual(issues, [sentence, sentence, sentence])
})

// Value: protects=AC1 D19 item 11 localhost, a *.localhost host and a trailing-dot spelling are refused; fails_when=any is accepted; no_claim=resolution of other names
test('refuses localhost and every localhost subdomain as the origin host', () => {
  // Arrange
  const sentence =
    'reverseProxy.origin: reverseProxy.origin must not name localhost or a *.localhost host: the browser resolves those itself, so Codebook cannot hold it to the address it checked. Declare the host name your hosts entry or local DNS maps to a loopback address.'
  const origins = [
    'https://localhost:8443',
    'https://app.localhost',
    'https://Localhost.',
  ]
  // Act
  const issues = origins.map((origin) => issuesOf(withOrigin(origin)))
  // Assert
  assert.deepEqual(issues, [sentence, sentence, sentence])
})

// Value: protects=AC1 D19 item 12 reverseProxy beside library is refused with its sentence at reverseProxy; fails_when=both are accepted on one run; no_claim=library rules on their own
test('refuses reverseProxy declared beside library', () => {
  // Arrange
  const input = configuration({
    packageRoot: 'examples/app',
    library: { packageRoot: 'packages/lib' },
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^reverseProxy: reverseProxy and library cannot be declared on one run; declare the library run or the reverse proxy run, not both\./m,
  )
})

// Value: protects=AC1 D19 reverseProxy stays allowed with a nested packageRoot, signInPaths and session fresh; fails_when=one of them is refused; no_claim=the nested app's saved-session limit (the run)
test('accepts reverseProxy beside packageRoot, signInPaths and session fresh', () => {
  // Arrange
  const input = configuration({
    packageRoot: 'examples/app',
    signInPaths: ['/login'],
    session: 'fresh',
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(issues, 'accepted')
})

// Value: protects=AC1 D19(c) spellings of one origin parse to one canonical origin; fails_when=case, a trailing slash, a trailing dot, a default port or punycode is kept as written; no_claim=resolution
test('parses every spelling of an origin to its canonical form', () => {
  // Arrange
  const spellings = [
    'https://App.Example.test/',
    'https://app.example.test:443',
    'https://app.example.test.',
    'http://app.example.test:80',
    'http://app.example.test:9080',
    'https://app.example.test:8443',
    'https://bücher.example.test',
  ]
  // Act
  const origins = spellings.map(canonicalOriginOf)
  // Assert
  assert.deepEqual(origins, [
    'https://app.example.test',
    'https://app.example.test',
    'https://app.example.test',
    'http://app.example.test',
    'http://app.example.test:9080',
    'https://app.example.test:8443',
    'https://xn--bcher-kva.example.test',
  ])
})

// Value: protects=AC1 parseReverseProxyOrigin reports the effective port and scheme the gate reads; fails_when=a default port is reported empty or the scheme is wrong; no_claim=the gate
test('reports the effective port of an origin with and without an explicit port', () => {
  // Arrange
  const texts = [
    'https://app.example.test',
    'http://app.example.test',
    'https://app.example.test:8443',
  ]
  // Act
  const ports = texts.map((text) => {
    const parsed = parseReverseProxyOrigin(text)
    return parsed.ok ? `${parsed.scheme}:${parsed.effectivePort}` : 'refused'
  })
  // Assert
  assert.deepEqual(ports, ['https:443', 'http:80', 'https:8443'])
})

// Value: protects=AC1 two spellings of one origin are one configuration after canonicalizeReverseProxy; fails_when=the origin is left as typed, the object is copied when nothing changes, or other fields change; no_claim=the idempotency key
test('canonicalizeReverseProxy rewrites only the origin and returns an unchanged configuration as is', () => {
  // Arrange
  const typed = configuration({
    reverseProxy: { origin: 'https://App.Example.test/', upstreamPort: 4310 },
  }) as { version: number }
  const canonical = configuration() as { version: number }
  // Act
  const rewritten = canonicalizeReverseProxy(typed)
  const unchanged = canonicalizeReverseProxy(canonical)
  // Assert
  assert.deepEqual(rewritten, canonical)
  assert.equal(unchanged, canonical)
  assert.equal(canonicalizeReverseProxy({ version: 3 }).version, 3)
})

// Value: protects=AC1 a configuration with an origin that does not parse is left as written for the schema to refuse; fails_when=canonicalize throws or rewrites it; no_claim=the refusal sentence
test('canonicalizeReverseProxy leaves an origin that does not parse as written', () => {
  // Arrange
  const input = withOrigin('not a url') as { version: number }
  // Act
  const result = canonicalizeReverseProxy(input)
  // Assert
  assert.equal(result, input)
})

// Value: protects=AC1 the MCP tool input schema and the help resource still build with the reverseProxy member; fails_when=a transform makes z.toJSONSchema throw in input mode or the field is dropped; no_claim=the help text
test('builds the input JSON Schema of the live schema with reverseProxy listed', () => {
  // Arrange
  const options = { io: 'input' } as const
  // Act
  const schema = JSON.stringify(
    z.toJSONSchema(liveRepositoryConfigSchema, options),
  )
  // Assert
  assert.equal(schema.includes('"reverseProxy"'), true)
  assert.equal(schema.includes('"upstreamPort"'), true)
})

// Value: protects=AC1 D7 the three describe texts the chat reads name the host-name rule and the API; fails_when=a text drops the localhost refusal, the API number or the loopback rule; no_claim=the help resource
test('describes the declaration, origin and upstreamPort for the chat', () => {
  // Arrange
  const schema = z.toJSONSchema(reverseProxyDeclarationSchema, { io: 'input' })
  // Act
  const objectText = schema.description
  const originText = schema.properties?.origin
  const portText = schema.properties?.upstreamPort
  // Assert
  assert.match(
    objectText ?? '',
    /^Optional \(API 1\.40, next-dev-webpack, version 3\)\./,
  )
  assert.match(
    JSON.stringify(originText),
    /not localhost or a \*\.localhost host\. The host must be a name this machine resolves only to loopback addresses\./,
  )
  assert.match(
    JSON.stringify(portText),
    /from 1024 to 65535\. Codebook starts next dev on this port, bound to 127\.0\.0\.1/,
  )
})

// Value: protects=AC1 D28 a saved study that declares reverseProxy is read by the format 22 member only; fails_when=the retained schema accepts the key or the study union refuses a canonical declaration; no_claim=the study format number (studyFormat22.test.ts)
test('keeps reverseProxy out of the retained schema and inside the study union', () => {
  // Arrange
  const input = configuration()
  // Act
  const retained = retainedRepositoryConfigSchema.safeParse(input)
  const study = studyConfigurationSchema.safeParse(input)
  // Assert
  assert.equal(retained.success, false)
  assert.equal(study.success, true)
})

// Value: protects=AC1 D28 a stored study whose origin is not canonical is refused by every member; fails_when=the format 22 member accepts a non-canonical origin; no_claim=what the start stores
test('refuses a saved reverseProxy whose origin is not in canonical spelling', () => {
  // Arrange
  const input = withOrigin('https://App.Example.test/')
  // Act
  const study = studyConfigurationSchema.safeParse(input)
  // Assert
  assert.equal(study.success, false)
})
