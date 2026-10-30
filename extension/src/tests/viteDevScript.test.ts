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
