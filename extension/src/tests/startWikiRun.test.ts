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

// Value: protects=Eng decisions 72, 73 and 79 and D2, the order of a generation's start; fails_when=anything is made or claimed before the learner confirmed, the folder is made after the claim (the claim fails with ENOENT), the agent is readied after the claim (a conflict would leave a marker), or the manifest is not looked at once more after the claim; no_claim=what each step does (host tests); seam=stand-ins
test('a generation’s start checks the folder, the existing Wiki, the publisher’s blocks and other runs before it asks, then makes the folder and readies the agent before it claims the marker, and looks for a Wiki once more after the claim', async () => {
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
        'in-the-way',
        'confirm',
        'parent',
        'agent',
        'block',
        'in-the-way',
        'claim',
        'token',
        'publication',
        'git',
      ],
      startedAtMs: 1_790_000_000_000,
      hasGit: true,
    },
  )
})

// Value: protects=AC 14, a start that throws after its claim (a read that fails); fails_when=the marker stays and every window is refused until it expires; no_claim=the caller's notice; seam=stand-ins
test('a read that throws after the claim releases the marker and passes the failure on', async () => {
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
    { failure, released: steps.includes('release') },
    { failure: 'Git could not be asked.', released: true },
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
