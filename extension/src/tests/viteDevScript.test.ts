import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseViteDevScript } from '../utils/parseViteDevScript'

test('accepts every dev script form the Vite start reproduces and forwards port, mode and config', () => {
  // Arrange
  const accepted = [
    ['vite', {}, undefined, undefined, undefined, undefined],
    ['vite dev', {}, 'dev', undefined, undefined, undefined],
    ['vite serve', {}, 'serve', undefined, undefined, undefined],
    [
      'VITE_CJS_IGNORE_WARNING=true vite dev',
      { VITE_CJS_IGNORE_WARNING: 'true' },
      'dev',
      undefined,
      undefined,
      undefined,
    ],
    ['vite --host --open', {}, undefined, undefined, undefined, undefined],
    [
      'vite --host 0.0.0.0 --open /x',
      {},
      undefined,
      undefined,
      undefined,
      undefined,
    ],
    ['vite --port 3010', {}, undefined, 3010, undefined, undefined],
    ['vite dev --port=3011', {}, 'dev', 3011, undefined, undefined],
    ['vite --mode staging', {}, undefined, undefined, 'staging', undefined],
    ['vite --mode=staging', {}, undefined, undefined, 'staging', undefined],
    [
      'vite --config vite.other.ts',
      {},
      undefined,
      undefined,
      undefined,
      'vite.other.ts',
    ],
    [
      'vite -c vite.other.ts',
      {},
      undefined,
      undefined,
      undefined,
      'vite.other.ts',
    ],
    [
      'vite --config=vite.other.ts',
      {},
      undefined,
      undefined,
      undefined,
      'vite.other.ts',
    ],
    [
      'A=1 B=two vite serve --port 4000',
      { A: '1', B: 'two' },
      'serve',
      4000,
      undefined,
      undefined,
    ],
  ] as const
  // Act
  const readings = accepted.map(([script]) => parseViteDevScript(script))
  // Assert
  for (const [
    index,
    [script, assignments, subcommand, port, mode, configFile],
  ] of accepted.entries())
    assert.deepEqual(
      readings[index],
      {
        accepted: true,
        script: { assignments, subcommand, port, mode, configFile },
      },
      script,
    )
})

test('refuses every other dev script form and names only grammar elements', () => {
  // Arrange
  const refused: [string, string[]][] = [
    ['cross-env A=b vite', ['the command word cross-env']],
    ['npx vite', ['the command word npx']],
    ['pnpm exec vite', ['the command word pnpm']],
    ['vite build', ['a positional argument …']],
    ['vite ./app', ['a positional argument …']],
    ['vite -- --port 1', ['the argument separator --']],
    ['vite && echo hi', ['the operator &&', 'a positional argument …']],
    ['vite ; echo hi', ['the operator ;', 'a positional argument …']],
    ['vite | cat', ['the operator |', 'a positional argument …']],
    [
      'vite > out.log',
      ['a word with shell syntax (>)', 'a positional argument …'],
    ],
    [
      'vite --port $PORT',
      [
        'the option --port without a plain value',
        'a word with shell syntax ($)',
      ],
    ],
    [
      'vite --port `id`',
      [
        'the option --port without a plain value',
        'a word with shell syntax (`)',
      ],
    ],
    [
      'vite --port "3000"',
      [
        'the option --port without a plain value',
        'a word with shell syntax (")',
      ],
    ],
    ['vite --port abc', ['the option --port=…']],
    ['vite --strictPort', ['the option --strictPort']],
    ['vite --force=hunter2hunter2', ['the option --force=…']],
    [
      'vite --config *.ts',
      [
        'the option --config without a plain value',
        'a word with shell syntax (*)',
      ],
    ],
    ['SECRET=a$b vite', ['an assignment value with shell syntax ($)']],
    ['node server.js', ['the command word node']],
    ['webpack serve', ['the command word … (the script must start with vite)']],
    ['', ['an empty command (the script must start with vite)']],
  ]
  // Act
  const readings = refused.map(([script]) => parseViteDevScript(script))
  // Assert
  for (const [index, [script, elements]] of refused.entries())
    assert.deepEqual(
      readings[index],
      { accepted: false, refused: elements },
      script,
    )
})

test('lists every refused element of a script at once without any assignment value or operand', () => {
  // Arrange
  const script =
    'TOKEN=plainsecret1 vite ./hunter2hunter2 --strictPort=plainsecret2 && echo'
  // Act
  const reading = parseViteDevScript(script)
  // Assert
  assert.deepEqual(reading, {
    accepted: false,
    refused: [
      'a positional argument …',
      'the option --strictPort=…',
      'the operator &&',
    ],
  })
  assert.equal(JSON.stringify(reading).includes('plainsecret'), false)
  assert.equal(JSON.stringify(reading).includes('hunter2'), false)
})

// Value: protects=a --config outside the package root is refused so cleanup never leaves the workspace; fails_when=../ or absolute config paths are accepted; why_new=the grammar had no root rule; seam=none; no_claim=symlinked config paths
test('refuses a --config that resolves outside the package root without echoing it', () => {
  // Arrange
  const root = '/repo/app'
  // Act
  const outside = parseViteDevScript(
    'vite --config ../other/vite.config.ts',
    root,
  )
  const absolute = parseViteDevScript('vite --config=/etc/vite.config.ts', root)
  const inside = parseViteDevScript(
    'vite --config config/custom.config.ts',
    root,
  )
  // Assert
  assert.deepEqual(outside, {
    accepted: false,
    refused: ['the option --config outside the package root'],
  })
  assert.deepEqual(absolute, outside)
  assert.equal(inside.accepted, true)
})

// Value: protects=tilde and Windows cmd expansion are refused as shell syntax; fails_when=~/x or %VAR% values are accepted; why_new=the syntax set lacked ~ and %; seam=none; no_claim=other expansions
test('refuses a leading tilde and a percent sign as shell syntax', () => {
  // Arrange
  const scripts = [
    'vite --config ~/x.ts',
    'vite --config=~/x.ts',
    'NAME=~/x vite',
    'vite --mode %MODE%',
  ]
  // Act
  const readings = scripts.map((script) => parseViteDevScript(script))
  // Assert
  assert.deepEqual(readings, [
    {
      accepted: false,
      refused: [
        'the option --config without a plain value',
        'a word with shell syntax (~)',
      ],
    },
    { accepted: false, refused: ['a word with shell syntax (~)'] },
    { accepted: false, refused: ['an assignment value with shell syntax (~)'] },
    {
      accepted: false,
      refused: [
        'the option --mode without a plain value',
        'a word with shell syntax (%)',
      ],
    },
  ])
})
