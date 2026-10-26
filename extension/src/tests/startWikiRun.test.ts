import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeMissingWiki,
  startWikiGenerate,
  type WikiGenerateStartDependencies,
} from '../utils/startWikiRun'

/** Stand-ins for every step of a generation's start that let it go ahead, each recording that it ran into `steps`; a test replaces the steps it is about. */
function standIns(
  steps: string[],
  replaced: Partial<WikiGenerateStartDependencies<string>> = {},
): WikiGenerateStartDependencies<string> {
  return {
    wikiOutput: {
      outputDirectory: '/repo/.codebook/wiki',
      outputLabel: '.codebook/wiki',
    },
    assertPathHeld: async (): Promise<void> => {
      steps.push('path')
    },
    readPublishToken: async () => {
      steps.push('token')
      return undefined
    },
    findStartBlock: async () => {
      steps.push('block')
      return undefined
    },
    findRunInTheWay: async () => {
      steps.push('in-the-way')
      return undefined
    },
    confirm: async () => {
      steps.push('confirm')
      return 'generate'
    },
    openLocationSetting: async (): Promise<void> => {
      steps.push('setting')
    },
    makeOutputParent: async (): Promise<void> => {
      steps.push('parent')
    },
    prepareAgent: async (): Promise<void> => {
      steps.push('agent')
    },
    claimMarker: async () => {
      steps.push('claim')
      return {
        release: async () => {
          steps.push('release')
          return true
        },
        reserve: async () => true,
      }
    },
    describeHolder: (holder) => `held by ${holder}`,
    readPublicationIdentity: async () => {
      steps.push('publication')
      return undefined
    },
    hasGitRepository: async () => {
      steps.push('git')
      return true
    },
    hasOutputFolderWithoutWiki: async () => {
      steps.push('folder')
      return false
    },
    offerUpdate: (): void => {
      steps.push('offer-update')
    },
    refuse: (reason): void => {
      steps.push(`refuse: ${reason}`)
    },
    now: () => 1_790_000_000_000,
    ...replaced,
  }
}

// Value: protects=Eng decisions 72, 73 and 79 and D2, the order of a generation's start; fails_when=anything is made or claimed before the learner confirmed, the folder is made after the claim (the claim fails with ENOENT), the agent is readied before the claim and the last look for a Wiki (a refused start or the update's offer would write a Cursor skill, and a skill in the way would hide the refusal; /ship review, Cycle 0055 pt1), a slow read (the Git look) runs while the marker is claimed for no run yet (/ship review pass 3), the path is not checked once more after the confirmation (Step 11: a link put on it while the confirmation stood open), an existing output folder is not looked for, or the manifest is not looked at once more after the claim; no_claim=what each step does (host tests); seam=stand-ins
test('a generation’s start checks the folder, the existing Wiki, the publisher’s blocks and other runs before it asks, then checks the path again, makes the folder, reads the publication and Git before it claims the marker, looks for a Wiki once more and only then readies the agent', async () => {
  // Arrange
  const steps: string[] = []

  // Act
  const start = await startWikiGenerate(standIns(steps))

  // Assert
  assert.deepEqual(
    { steps, startedAtMs: start?.startedAtMs, hasGit: start?.hasGitRepository },
    {
      steps: [
        'path',
        'token',
        'block',
        'folder',
        'in-the-way',
        'confirm',
        'path',
        'parent',
        'publication',
        'git',
        'block',
        'folder',
        'in-the-way',
        'claim',
        'token',
        'agent',
      ],
      startedAtMs: 1_790_000_000_000,
      hasGit: true,
    },
  )
})

// Value: protects=Eng decision 73 and the /ship review of Cycle 0055 pt1: the agent is readied only for a start that goes ahead; fails_when=a refusal after the confirmation or the update's offer after the claim readies the agent, which in Cursor writes the managed skill for a start that runs nothing and lets a skill in the way hide the refusal; no_claim=the skill's deployment (cursorSkillDeployment tests); seam=stand-ins
test('a generation refused after the confirmation, or whose Wiki appeared before the claim was checked, readies no agent', async () => {
  // Arrange: another window began while the confirmation was open; in the other start a Wiki appeared right before the claim.
  const refusedSteps: string[] = []
  let looks = 0
  const refused = standIns(refusedSteps, {
    findRunInTheWay: async () => {
      looks += 1
      return looks === 1
        ? undefined
        : { reason: 'Another editor window is generating this Wiki.' }
    },
  })
  const offeredSteps: string[] = []
  let tokenReads = 0
  const offered = standIns(offeredSteps, {
    readPublishToken: async () => {
      tokenReads += 1
      return tokenReads === 1 ? undefined : 'b@8'
    },
  })

  // Act
  const refusedStart = await startWikiGenerate(refused)
  const offeredStart = await startWikiGenerate(offered)

  // Assert
  assert.deepEqual(
    {
      refusedStart,
      refusedReadiedAgent: refusedSteps.includes('agent'),
      refusal: refusedSteps.at(-1),
      offeredStart,
      offeredReadiedAgent: offeredSteps.includes('agent'),
      offeredLastSteps: offeredSteps.slice(-2),
    },
    {
      refusedStart: undefined,
      refusedReadiedAgent: false,
      refusal: 'refuse: Another editor window is generating this Wiki.',
      offeredStart: undefined,
      offeredReadiedAgent: false,
      offeredLastSteps: ['release', 'offer-update'],
    },
  )
})

// Value: protects=Eng decision 73, a Cursor skill in the learner's way; fails_when=the conflict leaves the claimed marker, so every window is refused for 55 minutes, or the conflict is swallowed and the agent runs; no_claim=the conflict's sentence (cursorSkillDeployment tests); seam=stand-ins
test('an agent that cannot be readied after the claim releases the marker and passes its refusal on', async () => {
  // Arrange
  const steps: string[] = []
  const dependencies = standIns(steps, {
    prepareAgent: async () => {
      throw new Error(
        'A Cursor skill named codebook that Codebook does not own is in the way.',
      )
    },
  })

  // Act
  const failure = await startWikiGenerate(dependencies).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )

  // Assert
  assert.deepEqual(
    { failure, lastSteps: steps.slice(-2) },
    {
      failure:
        'A Cursor skill named codebook that Codebook does not own is in the way.',
      lastSteps: ['token', 'release'],
    },
  )
})

// Value: protects=AC 14 and the /ship review pass 3 of Cycle 0055 pt1, a start whose read fails (the Git look); fails_when=the failure is swallowed, or the read runs after the claim, so a slow or failing read keeps a marker that stands for no run; no_claim=the caller's notice; seam=stand-ins
test('a read that throws before the claim passes the failure on and claims no marker', async () => {
  // Arrange
  const steps: string[] = []
  const dependencies = standIns(steps, {
    hasGitRepository: async () => {
      throw new Error('Git could not be asked.')
    },
  })

  // Act
  const failure = await startWikiGenerate(dependencies).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )

  // Assert
  assert.deepEqual(
    { failure, claimed: steps.includes('claim') },
    { failure: 'Git could not be asked.', claimed: false },
  )
})

// Value: protects=the state matrix's generate × link-on-path cell (/ship review pass 3, Cycle 0055 pt1): a link or a file on the Wiki folder's path in the project; fails_when=anything is read, asked, made or claimed before the path check refused it, so a cloned repository's link sends the generation outside the project; no_claim=what the path check finds (assertNoLinkOnWikiPath tests); seam=stand-ins
test('a link on the Wiki folder’s path refuses the generation before anything is read, asked, made or claimed', async () => {
  // Arrange
  const steps: string[] = []
  const dependencies = standIns(steps, {
    assertPathHeld: async () => {
      throw new Error('The Wiki folder .codebook/wiki is a link.')
    },
  })

  // Act
  const failure = await startWikiGenerate(dependencies).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )

  // Assert
  assert.deepEqual(
    { failure, steps },
    { failure: 'The Wiki folder .codebook/wiki is a link.', steps: [] },
  )
})

// Value: protects=the publisher's own refusals before a generation, worded for a generation; fails_when=a held publish lock starts an agent that cannot publish, or the refusal names an update; no_claim=the other causes' words (describeWikiGenerateBlock tests); seam=stand-ins
test('a publish lock in the way refuses the generation before the confirmation with the generation’s sentence', async () => {
  // Arrange
  const steps: string[] = []
  const dependencies = standIns(steps, {
    findStartBlock: async () => ({
      cause: 'held-publish-lock',
      paths: ['wiki.publish-lock.json'],
    }),
  })

  // Act
  const start = await startWikiGenerate(dependencies)

  // Assert
  assert.deepEqual(
    { start, lastStep: steps.at(-1), asked: steps.includes('confirm') },
    {
      start: undefined,
      lastStep:
        'refuse: A publish of the LLM Wiki in .codebook/wiki may still be running or was stopped (wiki.publish-lock.json). Once it ends, press Generate LLM Wiki again; if it was stopped, ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project" once its process exits.',
      asked: false,
    },
  )
})

// Value: protects=the earlier chat's leftover in the way of a generation; fails_when=the refusal loses its override or is shown after the confirmation; no_claim=which leftover (findUnacknowledgedWikiLeftover tests); seam=stand-ins
test('another run in the way refuses the generation with its sentence and hands its override to the refusal', async () => {
  // Arrange
  const steps: string[] = []
  let overrides = 0
  const dependencies = standIns(steps, {
    findRunInTheWay: async () => ({
      reason:
        'The VS Code chat this window asked may still be generating this Wiki.',
      override: (): void => {
        overrides += 1
      },
    }),
    refuse: (reason, override) => {
      steps.push(`refuse: ${reason}`)
      override?.()
    },
  })

  // Act
  await startWikiGenerate(dependencies)

  // Assert
  assert.deepEqual(
    { lastStep: steps.at(-1), overrides, asked: steps.includes('confirm') },
    {
      lastStep:
        'refuse: The VS Code chat this window asked may still be generating this Wiki.',
      overrides: 1,
      asked: false,
    },
  )
})

// Value: protects=AC 5, the sentence both no-Wiki notices show beside Generate LLM Wiki; fails_when=it sends the learner to retype a chat request or names no folder; no_claim=the button (host tests); seam=none
test('the no-Wiki sentence names the folder and nothing else', () => {
  // Act
  const sentence = describeMissingWiki('docs/wiki')

  // Assert
  assert.equal(sentence, 'Codebook found no LLM Wiki in docs/wiki.')
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (both Codex passes) and E1-F3's root cause: an output folder that exists without a Wiki, which the publisher refuses (`publish-wiki.mjs` inspectOutput); fails_when=the learner is asked to confirm, or an agent starts, for a publish that is sure to be refused, or a folder that appears while the confirmation stands open is claimed anyway; no_claim=the publisher's own refusal; seam=stand-ins
test('an output folder that exists without a Wiki refuses the generation before the confirmation, and before the claim when it appeared while the confirmation stood open', async () => {
  // Arrange: in one start the folder is there from the first look; in the other it appears after the confirmation.
  const presentSteps: string[] = []
  const present = standIns(presentSteps, {
    hasOutputFolderWithoutWiki: async () => true,
  })
  const appearingSteps: string[] = []
  let folderLooks = 0
  const appearing = standIns(appearingSteps, {
    hasOutputFolderWithoutWiki: async () => {
      folderLooks += 1
      return folderLooks > 1
    },
  })

  // Act
  const presentStart = await startWikiGenerate(present)
  const appearingStart = await startWikiGenerate(appearing)

  // Assert
  const refusal =
    'refuse: The folder .codebook/wiki already exists but holds no LLM Wiki, and the publisher writes a first Wiki only into a folder it makes itself. Move what you keep in it elsewhere and remove the folder, or set codebook.wikiOutputDirectory to a folder that does not exist yet, then press Generate LLM Wiki again.'
  assert.deepEqual(
    {
      presentStart,
      presentSteps,
      appearingStart,
      appearingClaimed: appearingSteps.includes('claim'),
      appearingRefusal: appearingSteps.at(-1),
    },
    {
      presentStart: undefined,
      presentSteps: ['path', 'token', 'block', refusal],
      appearingStart: undefined,
      appearingClaimed: false,
      appearingRefusal: refusal,
    },
  )
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (Codex adversarial): a link put on the Wiki folder's path while the confirmation stood open; fails_when=the folder that holds the output is made through it, outside the project, before the path is checked again; no_claim=what the path check finds (assertNoLinkOnWikiPath tests); seam=a path check that refuses on its second call
test('a link put on the path while the confirmation stood open refuses the generation before any folder is made', async () => {
  // Arrange
  const steps: string[] = []
  let pathChecks = 0
  const dependencies = standIns(steps, {
    assertPathHeld: async () => {
      pathChecks += 1
      if (pathChecks > 1)
        throw new Error('The Wiki folder .codebook/wiki is a link.')
    },
  })

  // Act
  const failure = await startWikiGenerate(dependencies).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )

  // Assert
  assert.deepEqual(
    { failure, madeFolder: steps.includes('parent') },
    { failure: 'The Wiki folder .codebook/wiki is a link.', madeFolder: false },
  )
})
