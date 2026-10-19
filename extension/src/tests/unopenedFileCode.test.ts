import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { describeUnopenedFile } from '../utils/describeUnopenedFile'
import { unopenedFileCode } from '../utils/unopenedFileCode'

/**
 * Lists, for one compiled file of the Cursor setup, the functions in which a given call stands, so a test can pin where files are opened and where the codes of a file that cannot be opened are asked.
 * @param compiledPath - The file under `dist`, relative to it.
 * @param call - The text of the call as the compiler emits it.
 * @returns The names of the enclosing functions, in the order of the file, each once.
 */
async function functionsThatCall(
  compiledPath: string,
  call: string,
): Promise<string[]> {
  const lines = (
    await readFile(resolve(__dirname, '..', compiledPath), 'utf8')
  ).split('\n')
  const names: string[] = []
  let enclosing = 'no function'
  for (const line of lines) {
    // A function of the module begins at the line's start; a call inside it belongs to it.
    const begun = /^(?:async )?function (\w+)\(/.exec(line)?.[1]
    if (begun) enclosing = begun
    // A call that a comment quotes (an example in a docstring) is no call.
    const isComment = /^\s*(?:\*|\/\*|\/\/)/.test(line)
    if (!isComment && line.includes(call) && !names.includes(enclosing))
      names.push(enclosing)
  }
  return names
}

// Value: protects=the one list of codes that mean "this file exists and this user cannot open it at this moment"; fails_when=a code that says nothing of the file (too many open files, a failing disk) gets Codebook's sentence with a step that does not help, a missing file is called unopened, or one of the three codes falls out and reaches the learner as the system's text; why_new=Cycle 0046 row 310: the boundary is stated once, at the owner of the codes; seam=none
test('a failed open counts as a file that cannot be opened at this moment for a missing right and for a program that holds the file, and for nothing else; its sentence names the path, the code, the step and the command', () => {
  // Arrange
  const failureWith = (code: string): Error =>
    Object.assign(new Error(`${code}: refused, open`), { code })

  // Act
  const answers = {
    EACCES: unopenedFileCode(failureWith('EACCES')),
    EPERM: unopenedFileCode(failureWith('EPERM')),
    EBUSY: unopenedFileCode(failureWith('EBUSY')),
    ENOENT: unopenedFileCode(failureWith('ENOENT')),
    ELOOP: unopenedFileCode(failureWith('ELOOP')),
    EMFILE: unopenedFileCode(failureWith('EMFILE')),
    EIO: unopenedFileCode(failureWith('EIO')),
    withoutACode: unopenedFileCode(new Error('interrupted')),
    notAnError: unopenedFileCode('EBUSY'),
  }
  const sentence = describeUnopenedFile(
    'The Cursor MCP config',
    '/home/user/.cursor/mcp.json',
    'EBUSY',
    'Codebook: Remove Managed Cursor Skill',
  )

  // Assert
  assert.deepEqual(
    { answers, sentence },
    {
      answers: {
        EACCES: 'EACCES',
        EPERM: 'EPERM',
        EBUSY: 'EBUSY',
        ENOENT: undefined,
        ELOOP: undefined,
        EMFILE: undefined,
        EIO: undefined,
        withoutACode: undefined,
        notAnError: undefined,
      },
      sentence:
        'The Cursor MCP config could not be opened: /home/user/.cursor/mcp.json (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.',
    },
  )
})

// Value: protects=the rule that closes the Cursor setup's reads: wherever a file of the setup that exists is opened, the three codes have a sentence; fails_when=a new place opens a file of the Cursor setup without asking the owner of the codes, so a held file reaches the learner there as the system's text or is taken for a file that is not Codebook's; why_new=Cycle 0046 row 310: the area closes by a rule, and the rule is pinned where files are opened; seam=none, the compiled files of the Cursor setup as text
test('every place of the Cursor setup that opens a file that exists goes through the owner of the codes of a file that cannot be opened: the skill’s one reader, the catalog’s four opens and the rule of the two names; the two places that create a new file are the only other opens', async () => {
  // Act
  const places = {
    skill: {
      opensAFile: await functionsThatCall(
        'cursorSkillDeployment.js',
        'openWithoutFollowing)(',
      ),
      asksTheOwnerOfTheCodes: await functionsThatCall(
        'cursorSkillDeployment.js',
        'unopenedFileCode)(',
      ),
      createsAFile: await functionsThatCall(
        'cursorSkillDeployment.js',
        'promises_1.open)(',
      ),
    },
    catalog: {
      opensAFile: await functionsThatCall(
        'utils/refreshCursorMcpCatalog.js',
        'openWithoutFollowing)(',
      ),
      wordsAFileThatCouldNotBeOpened: await functionsThatCall(
        'utils/refreshCursorMcpCatalog.js',
        'refusalOfUnopenedFile(error',
      ),
      asksTheOwnerOfTheCodes: await functionsThatCall(
        'utils/refreshCursorMcpCatalog.js',
        'unopenedFileCode)(',
      ),
      createsAFile: await functionsThatCall(
        'utils/refreshCursorMcpCatalog.js',
        'promises_1.open)(',
      ),
    },
    ruleOfTheTwoNames: {
      opensAFile: await functionsThatCall(
        'utils/dropSecondNameOfOneFile.js',
        'openWithoutFollowing)(',
      ),
      asksTheOwnerOfTheCodes: await functionsThatCall(
        'utils/dropSecondNameOfOneFile.js',
        'unopenedFileCode)(',
      ),
    },
  }

  // Assert: the record's and the config's opens word the file through their refusal builders, which hand it on.
  assert.deepEqual(places, {
    skill: {
      opensAFile: ['lookAtSkillFile'],
      asksTheOwnerOfTheCodes: ['lookAtSkillFile'],
      createsAFile: ['writeStagedBytes'],
    },
    catalog: {
      opensAFile: [
        'privateJson',
        'ownedFile',
        'openConfigForRefresh',
        'openConfigForItsTimes',
      ],
      wordsAFileThatCouldNotBeOpened: [
        'refusalOfUnopenedFile',
        'refusalOfRecordOpen',
        'ownedFile',
        'refusalOfConfigOpen',
        'openConfigForItsTimes',
      ],
      asksTheOwnerOfTheCodes: ['refusalOfUnopenedFile'],
      // The staged config is created by its own helper, which a window calls again when another profile's sweep took its file (Cycle 0047 row 198).
      createsAFile: ['stageConfig'],
    },
    ruleOfTheTwoNames: {
      opensAFile: ['openName'],
      asksTheOwnerOfTheCodes: ['openName'],
    },
  })
})
