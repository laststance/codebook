import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { test } from 'node:test'

import {
  COMMENT_CHARACTER_LIMIT,
  createDefaultSeams,
  findPrivatePaths,
  postTrialEvidence,
  relativeInside,
} from '../post-trial-evidence.mjs'
import { runCommandLine } from '../utils/commandContract.mjs'
import { openWithoutFollowing } from '../utils/openWithoutFollowing.mjs'

const FAKE_GSTACK_POST = '/opt/fake/gstack-post'
const COMMENT_URL =
  'https://github.com/laststance/codebook/issues/172#issuecomment-1'
const GH_ISSUE_LIST_ARGUMENTS = [
  'issue',
  'list',
  '--label',
  'cycle',
  '--state',
  'open',
  '--json',
  'number,title',
]

/** Creates a temporary repository root holding an `artifacts/` folder; the caller removes it. */
async function makeRepository() {
  const root = await mkdtemp(join(tmpdir(), 'post-evidence-test-'))
  await mkdir(join(root, 'artifacts'))
  return root
}

/**
 * Runs the command against a temporary repository with injected runners, collecting everything it printed.
 * `ghResult` / `postResult` script the two programs; `postedBodies` collects the bytes of the file `gstack-post` was told to read.
 */
async function run(root, argv, options = {}) {
  const {
    ghResult = {
      status: 0,
      stdout: '[{"number":172,"title":"Cycle 0068"}]',
      stderr: '',
    },
    postResult = { status: 0, stdout: `${COMMENT_URL}\n`, stderr: '' },
    environment = { GSTACK_POST: FAKE_GSTACK_POST },
    overrides = {},
  } = options
  const output = []
  const errors = []
  const calls = []
  const postedBodies = []
  const seams = {
    ...createDefaultSeams(),
    repositoryRoot: root,
    environment,
    homeDirectory: join(root, 'home'),
    print: (line) => output.push(line),
    isExecutable: async (path) => path === FAKE_GSTACK_POST,
    runCommand: async (file, args) => {
      calls.push({ file, args })
      if (file === 'gh') return ghResult
      const bodyFileIndex = args.indexOf('--body-file')
      postedBodies.push(await readFile(args[bodyFileIndex + 1]))
      if (postResult instanceof Error) throw postResult
      return postResult
    },
    ...overrides,
  }
  const exitCode = await runCommandLine(
    (progress) => postTrialEvidence(progress, argv, seams),
    { printError: (line) => errors.push(line), environment },
  )
  return { exitCode, output, errors, calls, postedBodies }
}

/** Writes `contents` to `<root>/log.md` and returns its path. */
async function writeLog(root, contents) {
  const path = join(root, 'log.md')
  await writeFile(path, contents)
  return path
}

/** Runs a test body with a fresh repository and always removes it. */
async function withRepository(body) {
  const root = await makeRepository()
  try {
    await body(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const REFUSED_FORMS = [
  [
    '/Users/ryotamurakami/laststance/codebook/artifacts/x.png',
    '/Users/ryotamurakami/laststance/codebook/artifacts/x.png',
  ],
  ['/home/murakami/x', '/home/murakami/x'],
  ['C:\\Users\\murakami\\x', 'C:\\Users\\murakami\\x'],
  ['file:///tmp/x', 'file:///tmp/x'],
  [
    '/Users/ryotamurakami/repository/nextjs-dashboard-other/x',
    '/Users/ryotamurakami/repository/nextjs-dashboard-other/x',
  ],
  ['/Users/lume/qa/../x', '/Users/lume/qa/../x'],
  ['/mnt/c/Users/murakami/x', '/mnt/c/Users/murakami/x'],
  ['/users/ryotamurakami/x', '/users/ryotamurakami/x'],
  ['~/repository/x', '~/repository/x'],
  ['$HOME/x', '$HOME/x'],
  ['%USERPROFILE%\\x', '%USERPROFILE%\\x'],
  ['\\\\wsl$\\Ubuntu\\x', '\\\\wsl$\\Ubuntu\\x'],
  ['${HOME}/x', '${HOME}/x'],
  ['\\\\wsl.localhost\\Ubuntu\\x', '\\\\wsl.localhost\\Ubuntu\\x'],
  ['C:/Users/murakami/x', 'C:/Users/murakami/x'],
  ['/USERS/LUME/x', '/USERS/LUME/x'],
  ['/Users/lumen/x', '/Users/lumen/x'],
  ['|/Users/ryotamurakami/x|', '/Users/ryotamurakami/x|'],
  ['path:/home/murakami/x', '/home/murakami/x'],
]

// protects=each private home-path form is refused with its line number and token and no network call; fails_when=a form passes, the refusal names the whole line, or gh/gstack-post is called; no_claim=forms outside the grammar; gh and gstack-post are fakes
for (const [form, token] of REFUSED_FORMS) {
  test(`refuses ${form} on its line number without any network call`, async () => {
    await withRepository(async (root) => {
      // Arrange
      const logPath = await writeLog(
        root,
        `first line is fine\nsee ${form} here\n`,
      )

      // Act
      const result = await run(root, [logPath])

      // Assert
      assert.equal(result.exitCode, 1)
      assert.equal(
        result.errors[0],
        'E_PRIVATE_PATH: the run log names 1 private path(s)',
      )
      assert.equal(result.errors[1], `line 2: ${token}`)
      assert.equal(
        result.errors.at(-1),
        'Fix: replace it with a repo-relative path or remove it',
      )
      assert.equal(
        result.errors.some(
          (line) => line.includes('see ') || line.includes(' here'),
        ),
        false,
      )
      assert.deepEqual(result.calls, [])
    })
  })
}

const ALLOWED_FORMS = [
  'https://example.com/home/a',
  'artifacts/Users/a',
  '/Users/lume/qa/c68/x',
  '/Users/ryotamurakami/repository/nextjs-dashboard/app/lib/actions.ts',
  'artifacts/c68-n68/manifest.sha256',
]

// protects=public and repo-relative paths still post; fails_when=an allowed form is refused; no_claim=anything outside the five listed forms
for (const form of ALLOWED_FORMS) {
  test(`posts a log that names ${form}`, async () => {
    await withRepository(async (root) => {
      // Arrange
      const logPath = await writeLog(root, `trial read ${form} today\n`)

      // Act
      const result = await run(root, [logPath])

      // Assert
      assert.equal(result.exitCode, 0)
      assert.deepEqual(result.output, [COMMENT_URL])
    })
  })
}

// protects=the matched token list covers several hits and the whole directory form of a public path; fails_when=a public directory by itself is refused or a second hit on a line is missed; no_claim=none beyond protects
test('lists every private token of a line and allows a public directory by itself', () => {
  // Arrange
  const text = 'a /Users/lume b /home/murakami/x c $HOME'

  // Act
  const refused = findPrivatePaths(text)

  // Assert
  assert.deepEqual(refused, [
    { line: 1, token: '/home/murakami/x' },
    { line: 1, token: '$HOME' },
  ])
})

// protects=a private home path chained after a public path in one token is refused; fails_when=the scan judges only the first candidate of a token (PATH-style lists, comma lists, semicolon lists); no_claim=none beyond protects
test('refuses a private path that follows a public path in the same token', () => {
  // Arrange
  const text = [
    'PATH=/Users/lume/a:/Users/ryotamurakami/secret',
    '/Users/lume/a,/home/murakami/b',
    '/Users/lume/a;/Users/bob/b',
  ].join('\n')

  // Act
  const refused = findPrivatePaths(text)

  // Assert
  assert.deepEqual(refused, [
    { line: 1, token: '/Users/ryotamurakami/secret' },
    { line: 2, token: '/home/murakami/b' },
    { line: 3, token: '/Users/bob/b' },
  ])
})

// protects=JSON-escaped Windows and WSL home paths are refused; fails_when=only a single backslash separator is recognized; no_claim=none beyond protects
test('refuses JSON-escaped Windows and WSL home paths', () => {
  // Arrange
  const text = [
    'C:\\\\Users\\\\bob\\\\x',
    '\\\\\\\\wsl$\\\\Ubuntu\\\\home\\\\bob',
    '{"p":"C:\\\\Users\\\\bob"}',
    '\\\\wsl.localhost\\Ubuntu\\home\\bob',
  ].join('\n')

  // Act
  const refused = findPrivatePaths(text)

  // Assert
  assert.deepEqual(refused, [
    { line: 1, token: 'C:\\\\Users\\\\bob\\\\x' },
    { line: 2, token: '\\\\\\\\wsl$\\\\Ubuntu\\\\home\\\\bob' },
    { line: 3, token: 'C:\\\\Users\\\\bob' },
    { line: 4, token: '\\\\wsl.localhost\\Ubuntu\\home\\bob' },
  ])
})

// protects=a dot, dash or underscore before a home path no longer hides it, while URL and relative-folder forms stay allowed; fails_when=`Wrote.../Users/bob/x` passes or `https://example.com/home/a` is refused; no_claim=none beyond protects
test('refuses a home path after a dot, dash or underscore but keeps URL forms allowed', () => {
  // Arrange
  const text = [
    'Wrote.../Users/bob/x',
    'see:../home/x',
    'foo_/Users/x',
    'bar-/home/y',
    'https://example.com/home/a',
    'artifacts/Users/a',
    '/Users/lume/qa/c68/x',
    '/Users/ryotamurakami/repository/nextjs-dashboard/app/lib/actions.ts',
    'artifacts/c68-n68/manifest.sha256',
  ].join('\n')

  // Act
  const refused = findPrivatePaths(text)

  // Assert
  assert.deepEqual(refused, [
    { line: 1, token: '/Users/bob/x' },
    { line: 2, token: '/home/x' },
    { line: 3, token: '/Users/x' },
    { line: 4, token: '/home/y' },
  ])
})

// protects=the scan stays linear on hostile input; fails_when=rescanning a long public token is quadratic or backtracks; no_claim=wall-clock bound is generous, not a benchmark
test('scans a long chain of public paths in linear time', () => {
  // Arrange
  const text = '/Users/lume/a:'.repeat(20000)

  // Act
  const started = Date.now()
  const refused = findPrivatePaths(text)
  const elapsedMilliseconds = Date.now() - started

  // Assert
  assert.deepEqual(refused, [])
  // gstack-timing-ok: the bound is the contract (linear scan); the linear scan takes milliseconds, a quadratic rescan took about 24 s, so 5 s separates them under CI coverage load.
  assert.ok(elapsedMilliseconds < 5000, `took ${elapsedMilliseconds} ms`)
})

// protects=the command refuses a chained private path before any network call; fails_when=E_PRIVATE_PATH is skipped for a token that starts public; no_claim=gstack-post is never reached, nothing fake stands in
test('refuses a run log with a chained private path and lists its line number', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = join(root, 'chain.md')
    await writeFile(
      logPath,
      'ok\nPATH=/Users/lume/a:/Users/ryotamurakami/secret\n',
    )

    // Act
    const result = await run(root, [logPath])

    // Assert
    assert.equal(result.exitCode, 1)
    assert.ok(
      result.errors.includes('line 2: /Users/ryotamurakami/secret'),
      result.errors.join('\n'),
    )
  })
})

// protects=a lone CR line end counts as a line break like an editor, and a bare home marker is refused; fails_when=a log with CR line ends reports line 1 for every hit or `~/` alone passes; no_claim=none beyond protects
test('counts lone CR line ends and refuses a bare ~/', () => {
  // Arrange
  const text = 'one\rtwo ~/\rthree'

  // Act
  const refused = findPrivatePaths(text)

  // Assert
  assert.deepEqual(refused, [{ line: 2, token: '~/' }])
})

// protects=line numbers match an editor for CRLF logs and logs with a byte order mark; fails_when=CRLF counts twice or the BOM shifts the line; no_claim=files with lone CR line ends in an editor
test('names the right line numbers for a CRLF log with a byte order mark', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = join(root, 'crlf.md')
    await writeFile(
      logPath,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('one\r\ntwo\r\n$HOME/x\r\nfour /home/murakami/y\r\n'),
      ]),
    )

    // Act
    const result = await run(root, [logPath])

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors.slice(1, 3), [
      'line 3: $HOME/x',
      'line 4: /home/murakami/y',
    ])
  })
})

// protects=the posted file holds exactly the bytes that were checked, BOM and CRLF included; fails_when=the post re-reads the log or normalizes it; no_claim=gstack-post itself, which is a fake
test('posts a private copy with the exact checked bytes and removes it afterwards', async () => {
  await withRepository(async (root) => {
    // Arrange
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('trial\r\nok\r\n'),
    ])
    const logPath = join(root, 'bytes.md')
    await writeFile(logPath, original)

    // Act
    const result = await run(root, [logPath, '--issue', '172'])

    // Assert
    assert.equal(result.exitCode, 0)
    assert.deepEqual(
      result.calls.map((call) => call.file),
      [FAKE_GSTACK_POST],
    )
    assert.deepEqual(result.calls[0].args.slice(0, 3), [
      'issue-comment',
      '172',
      '--body-file',
    ])
    assert.match(
      result.calls[0].args[3],
      /\.gstack\/tmp\/trial-evidence\.[A-Za-z0-9]{6}\/comment\.md$/,
    )
    assert.deepEqual(result.postedBodies[0], original)
    assert.deepEqual(await readdir(join(root, '.gstack', 'tmp')), [])
    assert.deepEqual(result.output, [COMMENT_URL])
  })
})

// protects=only digits name an Issue; fails_when=a flag-like or empty value reaches gstack-post; no_claim=whether the Issue exists
for (const bad of ['abc', '12a', '--help', '0', '-3', '']) {
  test(`exits 64 with E_USAGE for --issue "${bad}"`, async () => {
    await withRepository(async (root) => {
      // Arrange
      const logPath = await writeLog(root, 'ok\n')

      // Act
      const result = await run(root, [logPath, `--issue=${bad}`])

      // Assert
      assert.equal(result.exitCode, 64)
      assert.equal(
        result.errors[0],
        'E_USAGE: --issue must be digits (an Issue number)',
      )
      assert.equal(
        result.errors.at(-1),
        'Fix: node extension/scripts/post-trial-evidence.mjs --help',
      )
      assert.deepEqual(result.calls, [])
    })
  })
}

// protects=a missing run log path is a usage error; fails_when=the command posts nothing yet exits 0; no_claim=none beyond protects
test('exits 64 with E_USAGE when no run log path is given', async () => {
  await withRepository(async (root) => {
    // Act
    const result = await run(root, [])

    // Assert
    assert.equal(result.exitCode, 64)
    assert.equal(
      result.errors[0],
      'E_USAGE: exactly one run log path is needed',
    )
  })
})

// protects=no open cycle Issue stops the post and says how to choose; fails_when=the post goes to an arbitrary Issue; no_claim=gh is a fake
test('refuses with E_ISSUE_COUNT when no cycle Issue is open', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath], {
      ghResult: { status: 0, stdout: '[]', stderr: '' },
    })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors, [
      'E_ISSUE_COUNT: 0 open Issues are labelled "cycle"; exactly one is needed',
      'Fix: rerun with --issue <n>',
    ])
    assert.deepEqual(result.calls, [
      { file: 'gh', args: GH_ISSUE_LIST_ARGUMENTS },
    ])
  })
})

// protects=two open cycle Issues are listed so the caller can choose; fails_when=the list is missing or the post goes ahead; no_claim=gh is a fake
test('refuses with E_ISSUE_COUNT and lists both open cycle Issues', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath], {
      ghResult: {
        status: 0,
        stdout:
          '[{"number":172,"title":"Cycle 0068: delivery"},{"number":180,"title":"Cycle 0069: next"}]',
        stderr: '',
      },
    })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors, [
      'E_ISSUE_COUNT: 2 open Issues are labelled "cycle"; exactly one is needed',
      '#172 Cycle 0068: delivery',
      '#180 Cycle 0069: next',
      'Fix: rerun with --issue <n>',
    ])
    assert.equal(result.calls.length, 1)
  })
})

// protects=the single open cycle Issue is the default target; fails_when=another number is posted to; no_claim=gh is a fake
test('posts to the single open cycle Issue when --issue is not given', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath])

    // Assert
    assert.equal(result.exitCode, 0)
    assert.deepEqual(result.calls[0], {
      file: 'gh',
      args: GH_ISSUE_LIST_ARGUMENTS,
    })
    assert.deepEqual(result.calls[1].args.slice(0, 2), ['issue-comment', '172'])
  })
})

// protects=a gh failure never leaks a token and writes nothing; fails_when=the GH_TOKEN value is printed; no_claim=gh's real messages
test('reports a gh failure as E_GH with the token value redacted', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath], {
      ghResult: {
        status: 1,
        stdout: '',
        stderr: 'bad credentials ghp_exampletoken123\nmore',
      },
      environment: {
        GSTACK_POST: FAKE_GSTACK_POST,
        GH_TOKEN: 'ghp_exampletoken123',
      },
    })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors, [
      'E_GH: gh issue list failed: bad credentials [redacted]',
      'Fix: gh auth status',
    ])
  })
})

// protects=gstack-post's HIGH refusal exits 10 and removes the copy; fails_when=it collides with this command's exit 1; no_claim=gstack-post's own scanning
test('maps a gstack-post HIGH refusal to exit 10 with a gstack-post prefix', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      postResult: { status: 1, stdout: '', stderr: 'HIGH: private key block' },
    })

    // Assert
    assert.equal(result.exitCode, 10)
    assert.deepEqual(result.errors, [
      'E_POST_HIGH: gstack-post: refused a HIGH finding; nothing was posted',
      'gstack-post: HIGH: private key block',
      'Fix: remove the finding from the run log, then rerun',
    ])
    assert.deepEqual(await readdir(join(root, '.gstack', 'tmp')), [])
  })
})

// protects=a MEDIUM result exits 11, prints the findings and the exact confirm command, keeps the copy, and never confirms itself; fails_when=--confirm is passed by the command or the copy is removed; no_claim=gstack-post's token format beyond TOKEN: <value>
test('maps a gstack-post MEDIUM result to exit 11 and prints the confirm command without confirming', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      postResult: {
        status: 2,
        stdout: 'RULE: email address\nTOKEN: abc123\n',
        stderr: '',
      },
    })

    // Assert
    const copyPath = result.calls[0].args[3]
    assert.equal(result.exitCode, 11)
    assert.equal(
      result.errors[0],
      `E_POST_MEDIUM: gstack-post: MEDIUM findings need confirmation; nothing was posted; the private copy is kept at ${copyPath}`,
    )
    assert.deepEqual(result.errors.slice(1, 4), [
      'gstack-post: RULE: email address',
      'gstack-post: TOKEN: abc123',
      'To accept the findings, run:',
    ])
    assert.equal(
      result.errors.at(-1),
      `Fix: ${FAKE_GSTACK_POST} issue-comment 172 --body-file ${copyPath} --confirm abc123`,
    )
    assert.equal(result.calls[0].args.includes('--confirm'), false)
    assert.deepEqual(await readFile(copyPath), Buffer.from('ok\n'))
  })
})

// protects=a gh failure inside gstack-post exits 12; fails_when=it exits 3 or 0; no_claim=whether the comment reached GitHub
test('maps a gstack-post gh failure to exit 12', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      postResult: { status: 3, stdout: '', stderr: 'HTTP 502' },
    })

    // Assert
    assert.equal(result.exitCode, 12)
    assert.deepEqual(result.errors, [
      'E_POST_GH: gstack-post: gh failed; the comment may not have been posted',
      'gstack-post: HTTP 502',
      'Fix: gh auth status, then rerun',
    ])
  })
})

// protects=an undocumented gstack-post result is an unknown outcome (exit 4); fails_when=it is reported as success or a refusal; no_claim=none beyond protects
test('treats an undocumented gstack-post exit as an unknown outcome', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      postResult: { status: 64, stdout: '', stderr: '' },
    })

    // Assert
    assert.equal(result.exitCode, 4)
    assert.equal(
      result.errors[0],
      'E_POST_UNKNOWN: gstack-post ended with 64; check the Issue before retrying',
    )
  })
})

// protects=a missing gstack-post stops the post without a plain gh fallback; fails_when=gh issue comment is used or a file is written; no_claim=the install hint's accuracy
test('refuses with E_NO_GSTACK_POST and never falls back to plain gh', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      overrides: { isExecutable: async () => false },
    })

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.errors[0],
      'E_NO_GSTACK_POST: gstack-post is not installed (looked at $GSTACK_POST, PATH, ~/.claude and ~/.codex)',
    )
    assert.deepEqual(result.calls, [])
  })
})

// protects=the lookup order is $GSTACK_POST, PATH, the Claude install, the Codex install; fails_when=a later place wins over an earlier one; no_claim=the real file system
test('finds gstack-post in the documented order', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')
    const home = join(root, 'home')
    const claudeInstall = join(
      home,
      '.claude',
      'skills',
      'gstack',
      'bin',
      'gstack-post',
    )
    const codexInstall = join(
      home,
      '.codex',
      'skills',
      'gstack',
      'bin',
      'gstack-post',
    )

    // Act
    const onPath = await run(root, [logPath, '--issue', '172'], {
      environment: { PATH: `/a${':'}/b` },
      overrides: {
        isExecutable: async (path) =>
          path === '/b/gstack-post' || path === claudeInstall,
      },
    })
    const inClaude = await run(root, [logPath, '--issue', '172'], {
      environment: { PATH: '/a' },
      overrides: {
        isExecutable: async (path) =>
          path === claudeInstall || path === codexInstall,
      },
    })
    const inCodex = await run(root, [logPath, '--issue', '172'], {
      environment: {},
      overrides: { isExecutable: async (path) => path === codexInstall },
    })

    // Assert
    assert.equal(onPath.calls[0].file, '/b/gstack-post')
    assert.equal(inClaude.calls[0].file, claudeInstall)
    assert.equal(inCodex.calls[0].file, codexInstall)
  })
})

// protects=a missing, empty or undecodable run log is refused before anything runs; fails_when=an empty comment is posted; no_claim=none beyond protects
test('refuses a missing, an empty and a non-UTF-8 run log', async () => {
  await withRepository(async (root) => {
    // Arrange
    const emptyPath = join(root, 'empty.md')
    await writeFile(emptyPath, '')
    const binaryPath = join(root, 'binary.md')
    await writeFile(binaryPath, Buffer.from([0xff, 0xfe, 0x41]))

    // Act
    const missing = await run(root, [join(root, 'absent.md')])
    const empty = await run(root, [emptyPath])
    const binary = await run(root, [binaryPath])

    // Assert
    assert.equal(
      missing.errors[0],
      `E_LOG_MISSING: the run log cannot be read: ${join(root, 'absent.md')}`,
    )
    assert.equal(
      empty.errors[0],
      `E_LOG_EMPTY: the run log is empty: ${emptyPath}`,
    )
    assert.equal(
      binary.errors[0],
      `E_LOG_ENCODING: the run log is not valid UTF-8: ${binaryPath}`,
    )
    assert.deepEqual(
      [missing.exitCode, empty.exitCode, binary.exitCode],
      [1, 1, 1],
    )
    assert.deepEqual([missing.calls, empty.calls, binary.calls], [[], [], []])
  })
})

/** Creates `artifacts/x` with the given files (name -> contents) and returns its path. */
async function makeEvidence(root, files) {
  const directory = join(root, 'artifacts', 'x')
  await mkdir(directory, { recursive: true })
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(directory, name, '..'), { recursive: true })
    await writeFile(join(directory, name), contents)
  }
  return directory
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

// protects=the manifest equals shasum -a 256 output sorted by relative name with / separators, excludes itself, and its hash is appended to the posted bytes; fails_when=order, separators, self-exclusion or the appended line differ; no_claim=large files, which are hashed as streams but tested small
test('writes a sorted shasum-format manifest, excludes itself and appends its line to the post', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, {
      'b.png': 'bravo',
      'a.png': 'alpha',
      'sub/c.png': 'charlie',
      'manifest.sha256': 'stale manifest',
    })
    const logPath = await writeLog(root, 'trial ok\n')
    const expectedManifest = `${sha256('alpha')}  a.png\n${sha256('bravo')}  b.png\n${sha256('charlie')}  sub/c.png\n`

    // Act
    const result = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/x',
    ])

    // Assert
    assert.equal(result.exitCode, 0)
    assert.equal(
      await readFile(join(directory, 'manifest.sha256'), 'utf8'),
      expectedManifest,
    )
    assert.equal(
      result.postedBodies[0].toString('utf8'),
      `trial ok\nManifest: artifacts/x/manifest.sha256 sha256 ${sha256(expectedManifest)} (3 files)\n`,
    )
    assert.deepEqual(result.output, [
      'wrote artifacts/x/manifest.sha256 (3 files)',
      COMMENT_URL,
    ])
  })
})

// protects=a log without a final newline still gets the manifest line on its own line; fails_when=the line is glued to the last log line; no_claim=none beyond protects
test('puts the manifest line on its own line after a log without a final newline', async () => {
  await withRepository(async (root) => {
    // Arrange
    await makeEvidence(root, { 'a.png': 'alpha' })
    const logPath = await writeLog(root, 'no newline at the end')

    // Act
    const result = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/x',
    ])

    // Assert
    assert.match(
      result.postedBodies[0].toString('utf8'),
      /^no newline at the end\nManifest: artifacts\/x\/manifest\.sha256 sha256 [0-9a-f]{64} \(1 files\)\n$/,
    )
  })
})

// protects=a manifest folder outside artifacts/ is refused with nothing written and no network call; fails_when=a folder outside, the repo's other folders, a .. escape or a symlink escape is hashed; no_claim=other operating systems' path forms
test('refuses a manifest folder outside artifacts/ by real path', async () => {
  await withRepository(async (root) => {
    // Arrange
    const outside = await mkdtemp(join(tmpdir(), 'post-evidence-outside-'))
    try {
      await writeFile(join(outside, 'a.png'), 'alpha')
      await mkdir(join(root, 'extension'))
      await writeFile(join(root, 'extension', 'a.txt'), 'x')
      await symlink(outside, join(root, 'artifacts', 'escape'))
      const logPath = await writeLog(root, 'ok\n')
      const attempts = [
        outside,
        'extension',
        'artifacts/../extension',
        'artifacts/escape',
        'artifacts',
        'artifacts/absent',
      ]

      // Act
      const results = []
      for (const attempt of attempts) {
        results.push(
          await run(root, [logPath, '--issue', '172', '--manifest', attempt]),
        )
      }

      // Assert
      for (const result of results) {
        assert.equal(result.exitCode, 1)
        assert.match(result.errors[0], /^E_MANIFEST_DIR: /)
        assert.deepEqual(result.calls, [])
      }
      assert.deepEqual(await readdir(outside), ['a.png'])
      assert.deepEqual(await readdir(join(root, 'extension')), ['a.txt'])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

// protects=an empty folder, a folder holding only an old manifest and a symlink inside are refused before any write; fails_when=an empty manifest is posted or a link is followed; no_claim=none beyond protects
test('refuses an empty evidence folder and a symbolic link inside it with no file written', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')
    const empty = join(root, 'artifacts', 'empty')
    await mkdir(empty)
    const onlyManifest = join(root, 'artifacts', 'only-manifest')
    await mkdir(onlyManifest)
    await writeFile(join(onlyManifest, 'manifest.sha256'), 'old')
    const linked = await makeEvidence(root, { 'a.png': 'alpha' })
    await writeFile(join(root, 'secret.txt'), 'secret')
    await symlink(join(root, 'secret.txt'), join(linked, 'link.txt'))

    // Act
    const emptyResult = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/empty',
    ])
    const manifestOnly = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/only-manifest',
    ])
    const linkedResult = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/x',
    ])

    // Assert
    assert.match(emptyResult.errors[0], /^E_MANIFEST_EMPTY: /)
    assert.match(manifestOnly.errors[0], /^E_MANIFEST_EMPTY: /)
    assert.equal(
      linkedResult.errors[0],
      'E_MANIFEST_SYMLINK: a symbolic link inside the evidence folder: link.txt',
    )
    assert.deepEqual(
      [emptyResult.calls, manifestOnly.calls, linkedResult.calls],
      [[], [], []],
    )
    assert.deepEqual(await readdir(empty), [])
    assert.equal(
      await readFile(join(onlyManifest, 'manifest.sha256'), 'utf8'),
      'old',
    )
    assert.deepEqual(await readdir(linked), ['a.png', 'link.txt'])
  })
})

// protects=a file replaced by a link after the listing is refused by the no-follow open; fails_when=the link target is hashed; no_claim=Windows, where the open compares the device and inode of a prior lstat instead
test('refuses a file that became a symbolic link between the listing and the open', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, { 'a.png': 'alpha' })
    await writeFile(join(root, 'secret.txt'), 'secret')
    await rm(join(directory, 'a.png'))
    await symlink(join(root, 'secret.txt'), join(directory, 'a.png'))
    const logPath = await writeLog(root, 'ok\n')
    const defaults = createDefaultSeams().fileSystem
    // The listing still sees a regular file, as it would before the swap.
    const lyingFileSystem = {
      ...defaults,
      lstat: async (path) => {
        const status = await defaults.lstat(path)
        return path.endsWith('a.png')
          ? {
              isSymbolicLink: () => false,
              isDirectory: () => false,
              isFile: () => true,
            }
          : status
      },
    }

    // Act
    const result = await run(
      root,
      [logPath, '--issue', '172', '--manifest', 'artifacts/x'],
      {
        overrides: { fileSystem: lyingFileSystem },
      },
    )

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.errors[0],
      'E_MANIFEST_SYMLINK: a symbolic link inside the evidence folder: a.png',
    )
    assert.deepEqual(result.calls, [])
  })
})

// protects=a recording still growing is refused instead of hashed half written; fails_when=a changed file gets a hash; no_claim=a writer that restores size and mtime exactly
test('refuses with E_MANIFEST_CHANGED when a file grows while it is hashed', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, { 'recording.webm': 'frames' })
    const logPath = await writeLog(root, 'ok\n')
    const defaults = createDefaultSeams().fileSystem
    const growingFileSystem = {
      ...defaults,
      openFile: async (path) => {
        const file = await openWithoutFollowing(path)
        let statCalls = 0
        return {
          // The writer appends between the first and the second status.
          stat: async (options) => {
            statCalls += 1
            if (statCalls === 2) await appendFile(path, 'more frames')
            return file.stat(options)
          },
          createReadStream: (options) => file.createReadStream(options),
          close: () => file.close(),
        }
      },
    }

    // Act
    const result = await run(
      root,
      [logPath, '--issue', '172', '--manifest', 'artifacts/x'],
      {
        overrides: { fileSystem: growingFileSystem },
      },
    )

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.errors[0],
      'E_MANIFEST_CHANGED: the file changed while it was hashed: recording.webm',
    )
    assert.deepEqual(result.calls, [])
    assert.deepEqual(await readdir(directory), ['recording.webm'])
  })
})

// protects=the comment limit counts the run log plus the manifest line and refuses before any write; fails_when=an over-limit body reaches gstack-post or a manifest is written; no_claim=GitHub's own counting of astral characters
test('refuses a body over 65,536 characters including the manifest line before any write', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, { 'a.png': 'alpha' })
    const longLog = await writeLog(
      root,
      `${'x'.repeat(COMMENT_CHARACTER_LIMIT - 20)}\n`,
    )
    const overLog = join(root, 'over.md')
    await writeFile(overLog, 'y'.repeat(COMMENT_CHARACTER_LIMIT + 1))

    // Act
    const withManifest = await run(root, [
      longLog,
      '--issue',
      '172',
      '--manifest',
      'artifacts/x',
    ])
    const logAlone = await run(root, [overLog, '--issue', '172'])

    // Assert
    assert.match(
      withManifest.errors[0],
      /^E_BODY_TOO_LONG: the comment is 65\d{3} characters; GitHub's limit is 65536$/,
    )
    assert.equal(
      logAlone.errors[0],
      "E_BODY_TOO_LONG: the comment is 65537 characters; GitHub's limit is 65536",
    )
    assert.deepEqual([withManifest.calls, logAlone.calls], [[], []])
    assert.deepEqual(await readdir(directory), ['a.png'])
  })
})

// protects=names listed in the manifest pass the same path check; fails_when=a file named like a home path is posted; no_claim=none beyond protects
test('refuses a manifest whose listed name looks like a private path', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, { $HOME: 'x' })
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const result = await run(root, [
      logPath,
      '--issue',
      '172',
      '--manifest',
      'artifacts/x',
    ])

    // Assert
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.errors.slice(0, 2), [
      'E_PRIVATE_PATH: the manifest names 1 private path(s)',
      'line 1: $HOME',
    ])
    assert.deepEqual(result.calls, [])
    assert.deepEqual(await readdir(directory), ['$HOME'])
  })
})

// protects=--help documents prerequisites, the exit codes and the error codes; fails_when=a code the command can exit with or print is not listed; no_claim=wording
test('--help lists prerequisites, exit codes and every error code', async () => {
  await withRepository(async (root) => {
    // Act
    const result = await run(root, ['--help'])

    // Assert
    const help = result.output.join('\n')
    assert.equal(result.exitCode, 0)
    for (const expected of [
      'Prerequisites:',
      'gstack-post',
      'Example:',
      '  10  gstack-post refused a HIGH finding',
      '  11  gstack-post found MEDIUM findings',
      '  12  gh failed inside gstack-post',
      '  64  usage error',
      'E_USAGE',
      'E_LOG_MISSING',
      'E_LOG_EMPTY',
      'E_LOG_ENCODING',
      'E_PRIVATE_PATH',
      'E_BODY_TOO_LONG',
      'E_MANIFEST_DIR',
      'E_MANIFEST_SYMLINK',
      'E_MANIFEST_FILE',
      'E_MANIFEST_NAME',
      'E_MANIFEST_EMPTY',
      'E_MANIFEST_CHANGED',
      'E_ISSUE_COUNT',
      'E_GH',
      'E_NO_GSTACK_POST',
      'E_POST_HIGH',
      'E_POST_MEDIUM',
      'E_POST_GH',
      'E_POST_UNKNOWN',
      'E_INTERNAL',
    ]) {
      assert.ok(help.includes(expected), `help lacks ${expected}`)
    }
  })
})

// protects=an unexpected exception before any write exits 2 and after the first write exits 4, both as E_INTERNAL naming the stage; fails_when=a crash after a write reads as safe to retry; no_claim=real gh or gstack-post crashes
test('exits 2 for an exception before a side effect and 4 after one, naming the stage', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')

    // Act
    const beforeWrite = await run(root, [logPath], {
      overrides: {
        runCommand: async () => {
          throw new Error('gh exploded')
        },
      },
    })
    const afterWrite = await run(root, [logPath, '--issue', '172'], {
      postResult: new Error('post exploded'),
    })

    // Assert
    assert.equal(beforeWrite.exitCode, 2)
    assert.equal(beforeWrite.errors[0], 'E_INTERNAL: gh exploded')
    assert.equal(beforeWrite.errors[1], 'Stage: resolve the Issue')
    assert.equal(afterWrite.exitCode, 4)
    assert.equal(afterWrite.errors[0], 'E_INTERNAL: post exploded')
    assert.equal(afterWrite.errors[1], 'Stage: post the comment')
    assert.equal(
      afterWrite.errors.at(-1),
      'Fix: check what changed before retrying; the stage above may have run partly',
    )
    assert.deepEqual(await readdir(join(root, '.gstack', 'tmp')), [])
  })
})

// protects=a refusal's first line is its code and its last line is Fix:; fails_when=any refusal of this command lacks either; no_claim=refusals not listed here
test('every refusal starts with its E_ code and ends with a Fix line', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'see $HOME/x\n')

    // Act
    const result = await run(root, [logPath])

    // Assert
    assert.match(result.errors[0], /^E_PRIVATE_PATH: /)
    assert.match(result.errors.at(-1), /^Fix: /)
  })
})

// protects=a folder on another Windows drive or UNC share is never treated as inside artifacts/; fails_when=an absolute relative() result passes the containment check; no_claim=real Windows file systems (win32 path semantics are injected)
test('relativeInside refuses another drive and a UNC share with win32 paths', () => {
  // Arrange
  const artifacts = 'C:\\repo\\artifacts'

  // Act
  const results = [
    relativeInside(artifacts, 'D:\\evidence\\x', win32),
    relativeInside(artifacts, '\\\\server\\share\\x', win32),
    relativeInside(artifacts, 'C:\\repo\\artifacts\\c68\\x', win32),
  ]

  // Assert
  assert.deepEqual(results, [undefined, undefined, 'c68\\x'])
})

// protects=a file renamed over the path while hashing is refused; fails_when=the old open file's unchanged size and mtime let a stale hash through; no_claim=a replacement that reuses the same inode
test('refuses with E_MANIFEST_CHANGED when another file is renamed over the path during hashing', async () => {
  await withRepository(async (root) => {
    // Arrange
    const directory = await makeEvidence(root, { 'recording.webm': 'frames' })
    const logPath = await writeLog(root, 'ok\n')
    const defaults = createDefaultSeams().fileSystem
    const replacingFileSystem = {
      ...defaults,
      openFile: async (path) => {
        const file = await openWithoutFollowing(path)
        let statCalls = 0
        return {
          stat: async (options) => {
            statCalls += 1
            if (statCalls === 2) {
              // A new file with the same size takes the name.
              await writeFile(`${path}.new`, 'frames')
              await rename(`${path}.new`, path)
            }
            return file.stat(options)
          },
          createReadStream: (options) => file.createReadStream(options),
          close: () => file.close(),
        }
      },
    }

    // Act
    const result = await run(
      root,
      [logPath, '--issue', '172', '--manifest', 'artifacts/x'],
      { overrides: { fileSystem: replacingFileSystem } },
    )

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.errors[0],
      'E_MANIFEST_CHANGED: the file changed while it was hashed: recording.webm',
    )
    assert.deepEqual(await readdir(directory), ['recording.webm'])
  })
})

// protects=the printed confirm command starts with the gstack-post that was found, quoted when needed; fails_when=the bare name gstack-post is printed; no_claim=the shell that runs it
test('prints the confirm command with the located gstack-post path, quoted when it holds a space', async () => {
  await withRepository(async (root) => {
    // Arrange
    const logPath = await writeLog(root, 'ok\n')
    const spaced = '/opt/my tools/gstack-post'

    // Act
    const result = await run(root, [logPath, '--issue', '172'], {
      environment: { GSTACK_POST: spaced },
      overrides: { isExecutable: async (path) => path === spaced },
      postResult: { status: 2, stdout: 'TOKEN: abc123\n', stderr: '' },
    })

    // Assert
    const copyPath = result.calls[0].args[3]
    assert.equal(
      result.errors.at(-1),
      `Fix: '/opt/my tools/gstack-post' issue-comment 172 --body-file ${copyPath} --confirm abc123`,
    )
  })
})
