import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWikiUpdateSign } from '../utils/isWikiUpdateSign'

const PLACES = {
  outputDirectory: '/repo/.codebook/wiki',
  skillDirectory: '/extensions/codebook/skills/codebook',
}

// Value: protects=the signs by which Codebook sees that the chat works on an update; fails_when=the manifest, a page of a prepared folder or the bundled skill is no longer recognised when the chat opens it, so a working chat is stopped at the bound; why_new=Cycle 0046 row 146; seam=none
test('the Wiki’s manifest, a file of a folder prepared beside the Wiki and the bundled skill are documents of an update', () => {
  // Act
  const signs = [
    '/repo/.codebook/wiki/codebook-wiki.json',
    '/repo/.codebook/wiki.stage-3f6c/pages/overview.html',
    '/extensions/codebook/skills/codebook/SKILL.md',
  ].map((path) => isWikiUpdateSign({ kind: 'document', path }, PLACES))

  // Assert
  assert.deepEqual(signs, [true, true, true])
})

// Value: protects=the bound of the first sign while the learner works; fails_when=a source file, a file beside the Wiki whose name only starts like its folder, or a file of another extension counts as the chat's work; why_new=Cycle 0046 row 146; seam=none
test('a source file, a file whose name only starts like the Wiki’s folder and a file of another skill are no documents of an update', () => {
  // Act
  const signs = [
    '/repo/src/a.ts',
    '/repo/.codebook/wiki-notes.md',
    '/extensions/codebook/skills/codebook-other/SKILL.md',
  ].map((path) => isWikiUpdateSign({ kind: 'document', path }, PLACES))

  // Assert
  assert.deepEqual(signs, [false, false, false])
})

// Value: protects=the same bound for commands; fails_when=any command the learner runs counts, or the publisher's command no longer does; why_new=Cycle 0046 row 146; seam=none
test('a command line that names the publisher’s script or the Wiki’s folder is a step of an update, and the learner’s own commands are not', () => {
  // Act
  const signs = [
    'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project . --output .codebook/wiki',
    'ls -la /repo/.codebook/wiki',
    'pnpm test',
    'git status',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, false, false])
})

// Value: protects=the learner who runs a command of their own in the half minute the chat has not answered yet; fails_when=a command that names a folder beside the Wiki whose name only starts like it, or that mentions the publisher's script in its text or as a file it reads, counts as the chat's work, so Codebook skips the withdrawal of the unanswered request, watches for up to 15 minutes, reserves the Wiki, and refuses later updates although none runs; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); seam=none
test('a command that names a folder beside the Wiki’s folder, or mentions the publisher’s script only in quoted text, in another argument or as a name without its folder, is no step of an update', () => {
  // Act
  const signs = [
    'ls /repo/.codebook/wiki-backup',
    'echo "run publish-wiki.mjs --output /repo/.codebook/wiki later"',
    "git commit -m 'publish-wiki.mjs: fix /repo/.codebook/wiki'",
    'grep -n publish-wiki.mjs notes.md',
    'node scripts/check.mjs /extensions/codebook/skills/codebook/publish-wiki.mjs.bak',
    'node publish-wiki.mjs --output /repo/.codebook/wiki-backup',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [false, false, false, false, false, false])
})

// Value: protects=the first sign of an update in the chat's terminal, however the chat quotes the publisher's path; fails_when=reading the command by its argument boundaries loses the bundled publisher as the script Node.js runs when its path is quoted or follows a change of folder, so a working chat whose output is written relative to the project is stopped at the bound; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); repeat maintainability review MT10: the rule of the bundled publisher has a test of its own; seam=none
test('a command that runs the bundled publisher as the script of Node.js is a step of an update, quoted or unquoted and after a change of folder, also with an output written relative to the project', () => {
  // Act
  const signs = [
    'node /extensions/codebook/skills/codebook/publish-wiki.mjs --prepare --project /repo --output /repo/.codebook/wiki',
    'node "/extensions/codebook/skills/codebook/publish-wiki.mjs" --project "/repo" --output "/repo/.codebook/wiki"',
    "cd /repo && node '/extensions/codebook/skills/codebook/publish-wiki.mjs' --recover --project . --output .codebook/wiki",
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, true])
})

// Value: protects=the learner who checks, evaluates or asks Node.js about the bundled publisher in the half minute the chat has not answered yet; fails_when=an option of Node.js that runs no script (`-c`/`--check`, `-e`/`--eval`, `-p`/`--print`, `-h`/`--help`, `-v`/`--version`, also with `=` or in a cluster of short options) is skipped like any other, so the publisher's path after it counts as the chat's work, Codebook keeps the unanswered request, watches for up to 15 minutes and reserves the Wiki although no update runs; why_new=Cycle 0046 /ship Codex review CX19; seam=none
test('Node.js that checks, evaluates or prints code, or shows its help or its version, runs no publisher, so its command is no step of an update, while the publisher run by Node.js still is', () => {
  // Act
  const publisher = '/extensions/codebook/skills/codebook/publish-wiki.mjs'
  const signs = [
    `node --check ${publisher}`,
    `node -c ${publisher}`,
    `node -e "1" ${publisher} --output /repo/.codebook/wiki`,
    `node --eval=1 ${publisher}`,
    `node -p ${publisher}`,
    `node --print=1 ${publisher}`,
    `node -pe 1 ${publisher}`,
    `node --help ${publisher}`,
    `node -h ${publisher}`,
    `node --version ${publisher}`,
    `node -v ${publisher}`,
    `node --no-warnings ${publisher} --prepare --project /repo --output /repo/.codebook/wiki`,
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  ])
})

// Value: protects=the first sign of an update whose chat writes the publisher's path from the home folder, or changes into a folder before it runs the publisher or names the Wiki's folder; fails_when=`~`, `$HOME` or `${HOME}` at the start of an argument is read as text, or a `cd <folder>` before `&&` or `;` is not followed, so a relative script or `--output .codebook/wiki` resolves against nothing, no sign comes, and the request is taken back at 30 s while the chat works; why_new=Cycle 0046 /ship adversarial review AD19; seam=none
test('the publisher written from the home folder with ~, $HOME or ${HOME}, or run after cd into its folder, and the Wiki’s folder written relative to the folder of a cd before it, are steps of an update', () => {
  // Arrange: the skill of an editor installed in the learner's home folder.
  const home = '/home/learner'
  const skill = '.vscode/extensions/laststance.codebook-1.0.43/skills/codebook'
  const places = {
    outputDirectory: '/repo/.codebook/wiki',
    skillDirectory: `${home}/${skill}`,
  }

  // Act
  const signs = [
    `node ~/${skill}/publish-wiki.mjs --prepare --project /repo`,
    `node $HOME/${skill}/publish-wiki.mjs --prepare --project /repo`,
    `node "$HOME/${skill}/publish-wiki.mjs" --prepare --project /repo`,
    `node \${HOME}/${skill}/publish-wiki.mjs --prepare --project /repo`,
    `node "\${HOME}/${skill}/publish-wiki.mjs" --prepare --project /repo`,
    `cd ~/${skill} && node publish-wiki.mjs --prepare --project /repo`,
    `cd ${home}/${skill}; node ./publish-wiki.mjs --recover --project /repo`,
    'cd /repo && node ./scripts/check.mjs --output .codebook/wiki',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, places, 'linux', home),
  )

  // Assert
  assert.deepEqual(signs, [true, true, true, true, true, true, true, true])
})

// Value: protects=the first sign of an update whose chat loads a module or an environment file before the publisher (`node -r ./hook.js <publisher>`, `--import tsx`, `-C development`, `--env-file .env`); fails_when=an option of Node.js that takes the next word as its value is read without it, so the value is taken for the script and the publisher's run gives no sign, or `node --require fs --check <publisher>` reads `fs` as the script and misses the check; why_new=Cycle 0046 /ship third review W9 (Codex R3A6, CodeRabbit CR5, security); seam=none
test('the publisher run by Node.js after an option that takes the next word as its value is a step of an update, and after --require fs and --check it is not', () => {
  // Act
  const publisher = '/extensions/codebook/skills/codebook/publish-wiki.mjs'
  const signs = [
    `node -r ./hook.js ${publisher} --prepare --project /repo`,
    `node --import tsx ${publisher} --prepare --project /repo`,
    `node --loader ./loader.mjs ${publisher} --prepare --project /repo`,
    `node -C development ${publisher} --prepare --project /repo`,
    `node --env-file .env ${publisher} --prepare --project /repo`,
    `node --require=fs ${publisher} --prepare --project /repo`,
    `node --require fs --check ${publisher}`,
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES),
  )

  // Assert
  assert.deepEqual(signs, [true, true, true, true, true, true, false])
})

// Value: protects=the learner whose command changes the folder in a way the sign cannot follow, or follows with an option; fails_when=`cd` alone, `pushd /x` and `popd` keep the folder of the cd before them, so a relative publisher counts as the chat's although it runs elsewhere, or `cd -P <skill>` and `cd -L <skill>` are not read, so the chat's run gives no sign; why_new=Cycle 0046 /ship third review W9 (CodeRabbit CR5); seam=none
test('a cd alone, a pushd elsewhere or a popd makes the folder unknown, while cd -P, cd -L and pushd into the skill folder are read', () => {
  // Arrange
  const skill = PLACES.skillDirectory

  // Act
  const signs = [
    `cd ${skill} && cd && node publish-wiki.mjs --prepare`,
    `cd ${skill} && pushd /tmp && node publish-wiki.mjs --prepare`,
    `cd ${skill} && popd && node publish-wiki.mjs --prepare`,
    `cd /tmp && cd -P ${skill} && node publish-wiki.mjs --prepare`,
    `cd -L ${skill} && node publish-wiki.mjs --prepare`,
    `pushd ${skill} && node publish-wiki.mjs --prepare`,
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES, 'linux'),
  )

  // Assert
  assert.deepEqual(signs, [false, false, false, true, true, true])
})

// Value: protects=the first sign of an update whose chat writes its commands on separate lines, and the learner who leaves a comment that names the Wiki's folder; fails_when=a line break is read as white space, so `cd <skill>` and `node publish-wiki.mjs` on the next line are one command and give no sign, or a check on the first line hides the publisher on the second, or an unquoted `#` comment is read as words, so `echo done # ls <wiki>` counts as the chat's work; why_new=Cycle 0046 /ship third review W19 (OCR); seam=none
test('a line break ends a command as a ; does, and on POSIX an unquoted word that starts with # comments out the rest of its line, while a # inside a word or in quotes is text', () => {
  // Act
  const signs = [
    `cd ${PLACES.skillDirectory}\nnode publish-wiki.mjs --prepare`,
    `node -e "1"\nnode ${PLACES.skillDirectory}/publish-wiki.mjs --prepare`,
    'echo done # ls /repo/.codebook/wiki',
    'echo done # a note\nls /repo/.codebook/wiki',
    "echo '# not a comment' && ls /repo/.codebook/wiki",
    'echo a#b /repo/.codebook/wiki',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES, 'linux'),
  )

  // Assert
  assert.deepEqual(signs, [true, true, false, true, true, true])
})

// Value: protects=the first sign of an update whose chat starts its commands with a comment that holds a quote, such as an apostrophe; fails_when=the words of the whole line are split before the comment is judged, so the quote in the comment is read as quoting up to the next quote of a later line, that span is dropped with the comment, and the publisher on the next line gives no sign; why_new=Cycle 0046 second ship, CodeRabbit CR2-2; seam=none
test('on POSIX a quote inside a comment quotes nothing: the command on the next line is still read, also when it quotes the publisher', () => {
  // Act
  const signs = [
    `# don't publish yet\ncd /repo && node '${PLACES.skillDirectory}/publish-wiki.mjs' --prepare`,
    `# the "draft\nnode "${PLACES.skillDirectory}/publish-wiki.mjs" --prepare`,
    "# it's a note\nls '/repo/.codebook/wiki'",
    "echo done # it's not ls '/repo/.codebook/wiki'",
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES, 'linux'),
  )

  // Assert
  assert.deepEqual(signs, [true, true, true, false])
})

// Value: protects=the learner who runs a command of their own that names the publisher in a way no shell reads as its path; fails_when=a home folder in single quotes or in a longer variable's name, a `~` in double quotes, or a `cd` whose next command does not run in its folder (after `||` or `|`) is read as the path, so the learner's command counts as the chat's work; why_new=Cycle 0046 /ship adversarial review AD19 (the forms a shell keeps as text); third testing review TT22: the case of a longer name names a skill folder its misreading would match; seam=none
test('a home folder in single quotes or in a longer name, a ~ in double quotes, a cd that the next command does not follow, and Node.js that checks the publisher are no steps of an update', () => {
  // Arrange: the skill lies in the home folder of another learner, `/home/learner2`, so `$HOME2` read as `$HOME` and a 2 would name it.
  const home = '/home/learner'
  const skill = '.vscode/extensions/laststance.codebook-1.0.43/skills/codebook'
  const places = {
    outputDirectory: '/repo/.codebook/wiki',
    skillDirectory: `${home}/${skill}`,
  }
  const otherPlaces = {
    outputDirectory: '/repo/.codebook/wiki',
    skillDirectory: `${home}2/skills/codebook`,
  }

  // Act
  const longerName = isWikiUpdateSign(
    {
      kind: 'command',
      commandLine: 'node $HOME2/skills/codebook/publish-wiki.mjs --prepare',
    },
    otherPlaces,
    'linux',
    home,
  )
  const signs = [
    `node '$HOME/${skill}/publish-wiki.mjs' --prepare`,
    `node "~/${skill}/publish-wiki.mjs" --prepare`,
    `cd ~/${skill} || node publish-wiki.mjs --prepare`,
    `cd ~/${skill} | node publish-wiki.mjs --prepare`,
    `cd ~/${skill} && node --check publish-wiki.mjs`,
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, places, 'linux', home),
  )

  // Assert
  assert.deepEqual(
    { longerName, signs },
    {
      longerName: false,
      signs: [false, false, false, false, false],
    },
  )
})

// Value: protects=the first sign of an update whose chat lists or makes the Wiki's folder with a common program whose short options hold one of the letters of Node's options that run no script; fails_when=the check of runsNoScript is no longer limited to Node.js, so `ls -lh <wiki>` or `mkdir -p <wiki>` gives no sign; why_new=Cycle 0046 /ship third testing review TT19 (CX19's Node check had no test); seam=none
test('ls -lh and mkdir -p of the Wiki’s folder are steps of an update, as their short options are no options of Node.js', () => {
  // Act
  const signs = [
    'ls -lh /repo/.codebook/wiki',
    'mkdir -p /repo/.codebook/wiki',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES, 'linux'),
  )

  // Assert
  assert.deepEqual(signs, [true, true])
})

// Value: protects=the first sign of an update on Windows, a target system, whose chat changes into the skill's folder or the project before it runs the publisher; fails_when=the folders of a cd and the words after it are resolved by POSIX rules on win32, so `cd C:\…\skills\codebook && node publish-wiki.mjs` or a relative `--output .codebook\wiki` after `cd C:\repo` gives no sign; why_new=Cycle 0046 /ship third testing review TT20 (AD19's cd had no test on Windows); seam=none
test('on Windows a cd into the skill’s folder before node publish-wiki.mjs, and a relative --output after a cd into the project, are steps of an update', () => {
  // Arrange
  const places = {
    outputDirectory: 'C:\\repo\\.codebook\\wiki',
    skillDirectory: 'C:\\ext\\skills\\codebook',
  }

  // Act
  const signs = [
    'cd C:\\ext\\skills\\codebook && node publish-wiki.mjs --prepare',
    'cd C:\\repo && node C:\\tools\\check.mjs --output .codebook\\wiki',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, places, 'win32'),
  )

  // Assert
  assert.deepEqual(signs, [true, true])
})

// Value: protects=the sign of an update that follows a chain of cd commands, and the learner whose cd the sign cannot follow; fails_when=a relative cd from a known folder leaves the folder unknown, so a chain into the skill's folder gives no sign, or a cd with two folders, or one followed by `&` (which runs the next command in the old folder), is followed as if it changed the folder; why_new=Cycle 0046 /ship third testing review TT21; seam=none
test('a relative cd from a known folder is followed, while a cd with two folders or one before & is not', () => {
  // Arrange
  const skill = PLACES.skillDirectory

  // Act
  const signs = [
    'cd /extensions/codebook && cd skills/codebook && node publish-wiki.mjs --prepare',
    `cd ${skill} /tmp && node publish-wiki.mjs --prepare`,
    `cd ${skill} & node publish-wiki.mjs --prepare`,
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, PLACES, 'linux'),
  )

  // Assert
  assert.deepEqual(signs, [true, false, false])
})

// Value: protects=the first sign of an update whose chat changes into the home folder with a bare `~`; fails_when=`~` is read as the home folder only before a slash, so `cd ~ && node <relative skill path>/publish-wiki.mjs` gives no sign; why_new=Cycle 0046 /ship third testing review TT22; seam=none
test('a cd into the home folder written as a bare ~ is followed to the skill’s folder below it', () => {
  // Arrange
  const home = '/home/learner'
  const skill = '.vscode/extensions/laststance.codebook-1.0.43/skills/codebook'
  const places = {
    outputDirectory: '/repo/.codebook/wiki',
    skillDirectory: `${home}/${skill}`,
  }

  // Act
  const sign = isWikiUpdateSign(
    {
      kind: 'command',
      commandLine: `cd ~ && node ${skill}/publish-wiki.mjs --prepare`,
    },
    places,
    'linux',
    home,
  )

  // Assert
  assert.equal(sign, true)
})

// Value: protects=the first sign of an update whose command names the Wiki's folder itself as an argument, whatever program runs it; fails_when=reading the command by its argument boundaries no longer takes an argument with a trailing slash for the Wiki's folder, so a working chat is stopped at the bound; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); repeat maintainability review MT10: the rule of the Wiki's folder as an argument has a test of its own; seam=none
test('a command whose argument is exactly the Wiki’s folder is a step of an update whatever program it runs, also with a trailing slash', () => {
  // Act
  const sign = isWikiUpdateSign(
    {
      kind: 'command',
      commandLine:
        'node --no-warnings ./publish.mjs --output /repo/.codebook/wiki/',
    },
    PLACES,
  )

  // Assert
  assert.equal(sign, true)
})

// Value: protects=the same reading of a command on Windows, where a path's backslash is no escape and the drive letter may be spelled in either case; fails_when=the backslashes of a path are read as escapes, so the publisher's command is not recognised, or a folder beside the Wiki counts; why_new=Cycle 0046 /ship hosted Codex review CX4 (P2); seam=the platform, which the test names
test('on Windows the publisher’s command with quoted backslash paths is a step of an update, and a folder beside the Wiki’s folder is not', () => {
  // Arrange
  const places = {
    outputDirectory: 'C:\\Repo\\.codebook\\wiki',
    skillDirectory:
      'C:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook',
  }

  // Act
  const signs = [
    '& "C:\\Program Files\\nodejs\\node.exe" "c:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook\\publish-wiki.mjs" --prepare --project C:\\Repo --output C:\\Repo\\.codebook\\wiki',
    'dir C:\\Repo\\.codebook\\wiki-backup',
  ].map((commandLine) =>
    isWikiUpdateSign({ kind: 'command', commandLine }, places, 'win32'),
  )

  // Assert
  assert.deepEqual(signs, [true, false])
})

// Value: protects=the first sign of an update on Windows, where the editor reports a document's path with a lower-case drive letter; fails_when=the paths are compared letter by letter, so the manifest the chat opens is not recognised and a working chat is stopped at the bound; why_new=Cycle 0046 row 146 (found while the signs were tied to the Wiki's folder); seam=the platform, which the test names
test('on Windows the Wiki’s manifest is recognised although the editor spells the drive letter in lower case, and a file beside the folder is still none', () => {
  // Arrange
  const places = {
    outputDirectory: 'C:\\Repo\\.codebook\\wiki',
    skillDirectory:
      'C:\\Users\\dev\\.vscode\\extensions\\codebook\\skills\\codebook',
  }

  // Act
  const manifest = isWikiUpdateSign(
    { kind: 'document', path: 'c:\\Repo\\.codebook\\wiki\\codebook-wiki.json' },
    places,
    'win32',
  )
  const neighbour = isWikiUpdateSign(
    { kind: 'document', path: 'c:\\Repo\\.codebook\\wiki-notes.md' },
    places,
    'win32',
  )

  // Assert
  assert.equal(manifest, true)
  assert.equal(neighbour, false)
})
