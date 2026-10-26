import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { WikiFreshness } from '../utils/inspectDeepWikiFreshness'

import {
  exists,
  openProjectWithoutWiki,
  publishGeneratedWiki,
} from './utils/openProjectWithoutWiki'
import { openWikiUpdateWindow } from './utils/wikiUpdateWindow'

const CURRENT: WikiFreshness = {
  status: 'current',
  changedPaths: [],
  addedPaths: [],
}

const GENERATE_COMMAND = 'codebook.generateDeepWiki'

// Value: protects=AC 1 and 14, the first Generate from Codebook's entry in VS Code in a project without `.codebook`; fails_when=Generate starts without the confirmation that names the resolved folder and the chat hand-over, sends no generate request, fails to claim its marker because the folder that holds it is missing (`placeStorageLock` makes no folder), writes no `runKind` into the marker, or makes the output folder itself; no_claim=the chat's own work and its publish (later tests); seam=the stubbed editor
test('Generate LLM Wiki in VS Code confirms the folder and the chat hand-over, then hands a generate request to a new chat and claims a generation marker, in a project without .codebook', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  const marker = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      confirmations: project.confirmations,
      detailStartsWithFolder: project.confirmationDetails[0]?.startsWith(
        `It is written to ${project.outputDirectory}.\n\nCopilot Chat receives the generate request for this project in a new chat;`,
      ),
      detailAsksForApprovals: project.confirmationDetails[0]?.includes(
        'The chat asks you to approve its commands and may ask you to Continue, so keep the Chat view open; it uses your chat plan. Codebook watches for up to 55 minutes.',
      ),
      requestStart: project.chatRequests[0]?.query.slice(0, 200),
      requestNamesTheBound: project.chatRequests[0]?.query.includes(
        'once you publish within 55 minutes',
      ),
      markerRunKind: marker.runKind,
      outputFolderMade: await exists(project.outputDirectory),
    },
    {
      confirmations: [
        `Generate the LLM Wiki of ${basename(project.projectRoot)}?`,
      ],
      detailStartsWithFolder: true,
      detailAsksForApprovals: true,
      requestStart:
        `/codebook Generate the LLM Wiki for this opened repository into ${JSON.stringify(project.outputDirectory)}, following the installed Codebook skill's DeepWiki generation procedure. Inspect the actual source and publish thro`.slice(
          0,
          200,
        ),
      requestNamesTheBound: true,
      markerRunKind: 'generate',
      outputFolderMade: false,
    },
  )
})

// Value: protects=AC 4's success and AC 12, a generation the chat publishes; fails_when=the end needs a current freshness, waits out the bound after the publish, calls the result an update, offers no Open in Browser, leaves the marker, or writes no Output record or one with the folder under the home folder in full; no_claim=the reader's pages (N55); seam=the stubbed editor, a hand-written publication with its receipt
test('a VS Code generation whose chat publishes ends as generated at once, offers Open in Browser, removes its marker and writes one allowlisted Output record', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  project.setFreshness(CURRENT)
  await project.runCommand(GENERATE_COMMAND)

  // Act: the notice comes in the turn the end is recorded; the marker is removed right after it.
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  await waitUntil(
    () => project.notices.length > 0,
    'the generation notice',
    6_000,
  )
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      notices: project.notices,
      actions: project.offeredActions,
      markerLeft: await exists(project.markerPath),
      recordShape: project.outputLines.map((line) =>
        line.replace(/started=\S+ ended=\S+/, 'started=… ended=…'),
      ),
    },
    {
      notices: ['LLM Wiki generated in .codebook/wiki.'],
      actions: [
        {
          message: 'LLM Wiki generated in .codebook/wiki.',
          actions: ['Open in Browser'],
        },
      ],
      markerLeft: false,
      recordShape: [
        `info: LLM Wiki generate ended: host=vscode started=… ended=… end=succeeded summary="published" output=${project.outputDirectory}`,
      ],
    },
  )
})

// Value: protects=Eng decision 75, a learner who edits a file while a generation of up to 55 minutes runs; fails_when=a usable new Wiki that is behind the source ends as a failure, or its notice hides that sources changed and offers no Update; no_claim=which files changed (the reader's freshness label names them); seam=the stubbed freshness answer
test('a generation that publishes while sources change ends as generated, says how many source files changed while it was written and offers Update LLM Wiki first', async (context) => {
  // Arrange: the freshness answer says one indexed source changed.
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  project.setFreshness({
    status: 'changed',
    changedPaths: ['src/a.ts'],
    addedPaths: [],
  })
  await project.runCommand(GENERATE_COMMAND)

  // Act
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  await waitUntil(
    () => project.notices.length > 0,
    'the generation notice',
    6_000,
  )

  // Assert
  assert.deepEqual(project.offeredActions, [
    {
      message:
        'LLM Wiki generated in .codebook/wiki. 1 source file changed while it was written.',
      actions: ['Update LLM Wiki', 'Open in Browser'],
    },
  ])
})

// Value: protects=AC 4, a publication of another checkout in the generation's folder; fails_when=a manifest that names another repository is reported as this project's generated Wiki; no_claim=the attention row (pt2); seam=a hand-written publication
test('a generation whose publication names another checkout fails with the sentence that it does not identify this project and claims nothing', async (context) => {
  // Arrange: the watch reads the foreign manifest as one it cannot read, and its grace for such a manifest is shortened.
  const project = await openProjectWithoutWiki({
    constants: { WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS: 200 },
  })
  context.after(() => project.close())
  project.setFreshness(CURRENT)
  await project.runCommand(GENERATE_COMMAND)

  // Act
  await publishGeneratedWiki(
    project.outputDirectory,
    project.projectRoot,
    '/another/checkout',
  )
  await waitUntil(() => project.errors.length > 0, 'the failure', 6_000)

  // Assert
  assert.equal(
    project.errors[0]?.replace(/at \S+(?: [AP]M)?:/, 'at …:'),
    'LLM Wiki generation failed at …: The LLM Wiki published in .codebook/wiki does not identify this opened project. Set codebook.wikiOutputDirectory to a folder of this project, then press Generate LLM Wiki again.',
  )
})

// Value: protects=AC 3 and O5, a Generate on a folder that holds a Wiki; fails_when=Generate overwrites or regenerates an existing Wiki, asks for the confirmation, claims a marker or sends a request; no_claim=the update the offer starts (update flow tests); seam=a hand-written publication
test('Generate on a folder that already holds an LLM Wiki offers Update instead, without a confirmation, a marker or a chat request', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      offers: project.offeredActions,
      confirmations: project.confirmations,
      chatRequests: project.chatRequests,
      markerLeft: await exists(project.markerPath),
    },
    {
      offers: [
        {
          message:
            'An LLM Wiki already exists in .codebook/wiki. Update it instead?',
          actions: ['Update LLM Wiki'],
        },
      ],
      confirmations: [],
      chatRequests: [],
      markerLeft: false,
    },
  )
})

// Value: protects=AC 3, a Wiki published by the learner's own chat between Generate's first look and its claim; fails_when=Generate goes on over the new Wiki, or leaves its marker behind; no_claim=a publish after the hand-over (a late publication); seam=the held moment after the claim answered
test('a Wiki that appears between the first look and the marker claim releases the marker and offers Update instead of generating over it', async (context) => {
  // Arrange: the moment after the claim answered is held open.
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const claimAnswer = project.hold('claim-answer')

  // Act
  const pressed = project.runCommand(GENERATE_COMMAND)
  await claimAnswer.started
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  claimAnswer.release()
  await pressed

  // Assert
  assert.deepEqual(
    {
      offers: project.offeredActions.map(({ message }) => message),
      chatRequests: project.chatRequests,
      markerLeft: await exists(project.markerPath),
    },
    {
      offers: [
        'An LLM Wiki already exists in .codebook/wiki. Update it instead?',
      ],
      chatRequests: [],
      markerLeft: false,
    },
  )
})

// Value: protects=AC 5b, the learner who dismisses the confirmation; fails_when=a dismissed confirmation makes the folder, claims a marker or sends a request; no_claim=Change location (next test); seam=the stubbed modal
test('a dismissed Generate confirmation starts nothing: no folder, no marker and no chat request', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({ declineConfirmation: true })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      confirmations: project.confirmations.length,
      codebookFolderMade: await exists(join(project.projectRoot, '.codebook')),
      chatRequests: project.chatRequests,
    },
    { confirmations: 1, codebookFolderMade: false, chatRequests: [] },
  )
})

// Value: protects=AC 5b and D2, Change location in the confirmation; fails_when=Change location starts a generation, leaves a marker, or does not open the output setting; no_claim=the setting's editor; seam=the stubbed modal and editor commands
test('Change location in the Generate confirmation opens the output setting and starts nothing', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    answerConfirmation: (_message, choices) =>
      choices.find((choice) => choice === 'Change location'),
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      executedCommands: project.executedCommands,
      markerLeft: await exists(project.markerPath),
      chatRequests: project.chatRequests,
    },
    {
      executedCommands: ['workbench.action.openSettings'],
      markerLeft: false,
      chatRequests: [],
    },
  )
})

// Value: protects=Eng decision 79, another window that claims the marker while this window's learner reads the confirmation; fails_when=the lost claim shows an error, starts a second agent beside the other window's or removes that window's marker; no_claim=the other window's run; seam=a marker of a live process written during the confirmation
test('a second window that claims the marker while the confirmation is open makes Generate refuse with that window’s sentence, never an error, and its marker stays', async (context) => {
  // Arrange: while the learner reads the confirmation, a window of this machine begins a generation of the same Wiki.
  let otherMarkerPath = ''
  const project = await openProjectWithoutWiki({
    answerConfirmation: (_message, choices) => {
      writeFileSync(
        otherMarkerPath,
        JSON.stringify({
          pid: process.pid,
          windowId: 'the-other-window',
          host: 'cursor',
          startedAtMs: Date.now(),
          runKind: 'generate',
        }),
      )
      return choices[0]
    },
  })
  context.after(() => project.close())
  otherMarkerPath = project.markerPath
  await mkdir(join(project.projectRoot, '.codebook'))

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  const marker = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      refusal: project.errors[0]?.replace(/started [^)]+\)/, 'started …)'),
      markerWindow: marker.windowId,
      chatRequests: project.chatRequests,
    },
    {
      refusal:
        'Codebook did not start the LLM Wiki generation: Another editor window is generating this Wiki (Cursor, started …). Wait for it to finish, then press Open LLM Wiki in Browser.',
      markerWindow: 'the-other-window',
      chatRequests: [],
    },
  )
})

// Value: protects=AC 4 and the reservation contract, Stop LLM Wiki Run while the VS Code chat has given no first sign; fails_when=the command cannot stop the opening, the run is reported as generated or failed, the marker is removed although the chat may still publish, or a new Generate starts beside that chat without its override; no_claim=the chat itself, which Codebook does not stop; seam=a chat command that never answers
test('Stop LLM Wiki Run during the chat’s first-sign wait ends the generation as stopped watching, keeps a generation reservation and refuses a new Generate with Generate anyway', async (context) => {
  // Arrange: the chat takes the request and never answers.
  const project = await openProjectWithoutWiki({
    chatReply: () => new Promise<never>(() => {}),
  })
  context.after(() => project.close())
  const pressed = project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.chatRequests.length > 0,
    'the generate request',
    6_000,
  )

  // Act
  await project.runCommand('codebook.cancelWikiRun')
  await pressed
  await waitUntil(
    async () =>
      JSON.parse(await readFile(project.markerPath, 'utf8').catch(() => '{}'))
        .watchEndedAtMs,
    'the reservation',
    6_000,
  )
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  const reservation = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      stopNotice: project.notices[0]?.replace(/at \S+(?: [AP]M)?\./, 'at ….'),
      reservationRunKind: reservation.runKind,
      secondPressOffers: project.offeredActions.at(-1)?.actions,
      secondPressNamesTheGeneration: project.errors
        .at(-1)
        ?.includes('may still be generating this Wiki'),
      chatRequests: project.chatRequests.length,
    },
    {
      stopNotice:
        'Codebook stopped watching the LLM Wiki generation at …. The chat may still publish; Codebook: Open LLM Wiki in Browser opens the Wiki once it does. To stop it, stop the request in the chat.',
      reservationRunKind: 'generate',
      secondPressOffers: ['Generate anyway'],
      secondPressNamesTheGeneration: true,
      chatRequests: 1,
    },
  )
})

// Value: protects=the only way out of a generation's reservation, the Generate anyway button; fails_when=pressing the button starts nothing, starts an update's request instead of a generation's, or leaves the stopped watch's reservation in place so the new chat runs unprotected; why_new=the refusals are tested (above, below) but no test presses the override; no_claim=the wait the refusal names; seam=a chat command that never answers, then a chooseAction that presses the button
test('pressing Generate anyway on the refusal beside a stopped generation watch starts a second generate request and replaces the reservation with a running marker', async (context) => {
  // Arrange: a first generation stops watching its chat, which leaves a reservation; the next refusal's button is pressed.
  let isOverrideChosen = false
  const project = await openProjectWithoutWiki({
    chatReply: () => new Promise<never>(() => {}),
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Generate anyway')
        : undefined,
  })
  context.after(() => project.close())
  const pressed = project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.chatRequests.length > 0,
    'the first generate request',
    6_000,
  )
  await project.runCommand('codebook.cancelWikiRun')
  await pressed
  await waitUntil(
    async () =>
      JSON.parse(await readFile(project.markerPath, 'utf8').catch(() => '{}'))
        .watchEndedAtMs,
    'the reservation',
    6_000,
  )
  isOverrideChosen = true

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.chatRequests.length > 1,
    'the second generate request',
    6_000,
  )

  // Assert
  const marker = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      chatRequests: project.chatRequests.length,
      secondRequestIsGenerate: project.chatRequests[1]?.query.includes(
        'Generate the LLM Wiki',
      ),
      markerRunKind: marker.runKind,
      markerStillReservation: 'watchEndedAtMs' in marker,
    },
    {
      chatRequests: 2,
      secondRequestIsGenerate: true,
      markerRunKind: 'generate',
      markerStillReservation: false,
    },
  )
})

// Value: protects=AC 1 and 14 for Cursor, and Eng decision 73: the first Generate in Cursor without the managed skill; fails_when=the agent runs before the managed skill is readied, an installed skill is redeployed, the agent gets the update's bound or the update's words, or the progress notification names an update; no_claim=the real skill deployment (cursorSkillDeployment tests); seam=the stubbed skill steps and agent
test('Generate LLM Wiki in Cursor readies the missing managed skill, then runs cursor-agent with the generate request and the 55 minute bound, and ends as generated once it published', async (context) => {
  // Arrange: no managed skill is installed, so its check fails and the deployment installs it.
  const agentCalls: Array<{
    prompt: string
    timeoutMs?: number
    runKind?: string
  }> = []
  let outputDirectory = ''
  let projectRoot = ''
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
    },
    cursorAgent: async (_root, prompt, _signal, timeoutMs, runKind) => {
      agentCalls.push({ prompt, timeoutMs, runKind })
      await publishGeneratedWiki(outputDirectory, projectRoot)
      return 'Published.'
    },
  })
  context.after(() => project.close())
  ;({ outputDirectory, projectRoot } = project)
  project.setFreshness(CURRENT)

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      progressTitles: project.progressTitles,
      agentBound: agentCalls[0]?.timeoutMs,
      agentRunKind: agentCalls[0]?.runKind,
      requestIsGenerate: agentCalls[0]?.prompt.startsWith(
        '/codebook Generate the LLM Wiki for this opened repository into',
      ),
      requestAsksForNoReport: agentCalls[0]?.prompt.includes(
        'Then report the chapters you published.',
      ),
      notices: project.notices,
      markerLeft: await exists(project.markerPath),
    },
    {
      skillCalls: ['verify', 'deploy'],
      progressTitles: ['Generating the LLM Wiki in cursor-agent…'],
      agentBound: 3_300_000,
      agentRunKind: 'generate',
      requestIsGenerate: true,
      requestAsksForNoReport: false,
      notices: ['LLM Wiki generated in .codebook/wiki.'],
      markerLeft: false,
    },
  )
})

// Value: protects=Eng decision 73, a learner's own or edited same-name skill in Cursor; fails_when=Generate overwrites that skill, runs the agent anyway or leaves a marker; no_claim=the deployment's own conflict rules (cursorSkillDeployment tests); seam=the stubbed skill steps
test('a Cursor Generate whose managed skill cannot be deployed over a learner’s own skill refuses with the deployment’s sentence, runs no agent and leaves no marker', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      errors: project.errors,
      agentRuns,
      markerLeft: await exists(project.markerPath),
    },
    {
      errors: [
        'Codebook did not start the LLM Wiki generation: A Cursor skill named codebook that Codebook does not own is in the way.',
      ],
      agentRuns: 0,
      markerLeft: false,
    },
  )
})

// Value: protects=AC 4, a Cursor agent that exits cleanly without publishing; fails_when=the end says generated, calls the run an update, offers no Generate button, or leaves the marker; no_claim=the agent's own reply, which is shown nowhere; seam=the stubbed agent
test('a Cursor generation whose agent exits without publishing fails with the sentence that names the folder and offers Generate LLM Wiki', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorAgent: async () => 'I could not finish.',
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      failure: project.offeredActions.map(({ message, actions }) => ({
        message: message.replace(/at \S+(?: [AP]M)?:/, 'at …:'),
        actions,
      })),
      markerLeft: await exists(project.markerPath),
    },
    {
      failure: [
        {
          message:
            'LLM Wiki generation failed at …: Cursor Agent finished without publishing an LLM Wiki in .codebook/wiki. Press Generate LLM Wiki to try again, or ask the editor chat "/codebook Generate the LLM Wiki for this project" to see what it says.',
          actions: ['Generate LLM Wiki'],
        },
      ],
      markerLeft: false,
    },
  )
})

// Value: protects=AC 12 and Eng decision 81, private text an agent or a chat may print; fails_when=the Output record holds the Cursor agent's failure text or a chat's error reply, or names no exit code; no_claim=the notice, which shows the failure sentence to the learner; seam=a seeded fake secret in the agent's failure and in the chat's error reply
test('the Output record of a failed generation names the agent’s exit code and holds no text of the agent or the chat, in Cursor and in VS Code', async (context) => {
  // Arrange: both failures carry a seeded fake secret.
  const cursorProject = await openProjectWithoutWiki({
    cursor: true,
    cursorAgent: async () => {
      throw Object.assign(
        new Error(
          'Cursor Agent stopped with exit code 1 before finishing. token=SEEDED-SECRET-CURSOR',
        ),
        { exitCode: 1, exitSignal: null },
      )
    },
  })
  context.after(() => cursorProject.close())
  const vsCodeProject = await openProjectWithoutWiki({
    chatReply: async () => ({
      errorDetails: { message: 'Quota exceeded for SEEDED-SECRET-CHAT.' },
    }),
  })
  context.after(() => vsCodeProject.close())

  // Act
  await cursorProject.runCommand(GENERATE_COMMAND)
  await vsCodeProject.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => vsCodeProject.outputLines.length > 0,
    'the VS Code record',
    6_000,
  )

  // Assert
  const records = [...cursorProject.outputLines, ...vsCodeProject.outputLines]
  assert.deepEqual(
    {
      cursorExit: cursorProject.outputLines[0]?.includes(' exit=1 '),
      holdsSecret: records.some((line) => line.includes('SEEDED-SECRET')),
      endStates: records.map((line) => /end=(\S+)/.exec(line)?.[1]),
    },
    { cursorExit: true, holdsSecret: false, endStates: ['failed', 'failed'] },
  )
})

// Value: protects=AC 5, the learner who presses Update LLM Wiki or Open LLM Wiki in Browser before any Wiki exists; fails_when=either notice sends the learner to retype a chat request instead of offering Generate LLM Wiki, or the button starts something other than the generation; no_claim=the generation the button starts (other tests); seam=the stubbed notifications
test('both no-Wiki notices, of Update LLM Wiki and of Open LLM Wiki in Browser, offer Generate LLM Wiki, which runs the generate command', async (context) => {
  // Arrange: the learner presses the notices' button.
  const project = await openProjectWithoutWiki({
    chooseAction: (_message, actions) =>
      actions.find((action) => action === 'Generate LLM Wiki'),
  })
  context.after(() => project.close())

  // Act
  await project.runUpdateCommand()
  await project.runCommand('codebook.openDeepWiki')
  await waitUntil(
    () =>
      project.executedCommands.filter((name) => name === GENERATE_COMMAND)
        .length === 2,
    'both presses',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      offers: project.offeredActions,
      executedCommands: project.executedCommands,
    },
    {
      offers: [
        {
          message: 'Codebook found no LLM Wiki in .codebook/wiki.',
          actions: ['Generate LLM Wiki'],
        },
        {
          message: 'Codebook found no LLM Wiki in .codebook/wiki.',
          actions: ['Generate LLM Wiki'],
        },
      ],
      executedCommands: [GENERATE_COMMAND, GENERATE_COMMAND],
    },
  )
})

// Value: protects=D5, a second press while a generation runs; fails_when=the refusal calls the run an update or sends the learner to a browser reader the project does not have yet, or the test reads the refusal after a fixed 200 ms race instead of awaiting its notice (Cycle 0056 task 6); no_claim=the other places of the progress (describeSecondWikiUpdateStart tests); seam=a Cursor agent held open
test('a second Generate while a Cursor generation runs is refused with the sentence that Codebook is already generating, naming the notification', async (context) => {
  // Arrange: the agent works until the test lets it end.
  let endAgent = (): void => {}
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorAgent: () =>
      new Promise<string>((resolveAgent) => {
        endAgent = (): void => resolveAgent('Done.')
      }),
  })
  context.after(() => project.close())
  const first = project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.progressTitles.length > 0,
    'the running generation',
    6_000,
  )

  // Act: the second press joins the run and settles with it, so the refusal is awaited as a notice, never as a fixed wait.
  const second = project.runCommand(GENERATE_COMMAND)
  await waitUntil(() => project.notices.length > 0, 'the refusal notice', 6_000)
  const refusal = project.notices[0]
  endAgent()
  await first
  await second

  // Assert
  assert.equal(
    refusal,
    'Codebook is already generating this project’s LLM Wiki. Its progress is in the notification here.',
  )
})

// Value: protects=Eng decision 73 for both run kinds, an update in Cursor whose managed skill is missing; fails_when=the update asks cursor-agent for the skill's procedure before the skill is readied; no_claim=the deployment itself (cursorSkillDeployment tests); seam=the stubbed skill steps and agent
test('an Update in Cursor readies the missing managed skill before cursor-agent runs, as a generation does', async (context) => {
  // Arrange: a project with a Wiki, a stale freshness answer so the update runs, and no managed skill installed.
  const steps: string[] = []
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        steps.push('verify')
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: async () => {
        steps.push('deploy')
      },
    },
    cursorAgent: async () => {
      steps.push('agent')
      return 'Done.'
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)

  // Act
  await project.runUpdateCommand()

  // Assert
  assert.deepEqual(steps, ['verify', 'deploy', 'agent'])
})

// Value: protects=the review's finding 3, another window's stopped generation that leaves a reservation while this window's learner reads the confirmation; fails_when=the claim takes the reservation over (a claim reads a reservation as no run), so a second chat generates beside the first; no_claim=a reservation that is there before the press (Stop LLM Wiki Run test); seam=a reservation written during the confirmation
test('a reservation another window leaves while the Generate confirmation is open refuses the generation with Generate anyway, and the reservation stays', async (context) => {
  // Arrange: while the learner reads the confirmation, another window's VS Code generation stops watching its chat.
  let otherMarkerPath = ''
  const project = await openProjectWithoutWiki({
    answerConfirmation: (_message, choices) => {
      writeFileSync(
        otherMarkerPath,
        JSON.stringify({
          pid: process.pid,
          windowId: 'the-other-window',
          host: 'vscode',
          startedAtMs: Date.now() - 60_000,
          watchEndedAtMs: Date.now(),
          runKind: 'generate',
        }),
      )
      return choices[0]
    },
  })
  context.after(() => project.close())
  otherMarkerPath = project.markerPath
  await mkdir(join(project.projectRoot, '.codebook'))

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  const marker = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      namesTheOtherChat: project.errors[0]?.includes(
        'The VS Code chat another editor window asked at',
      ),
      offers: project.offeredActions.at(-1)?.actions,
      markerWindow: marker.windowId,
      chatRequests: project.chatRequests,
    },
    {
      namesTheOtherChat: true,
      offers: ['Generate anyway'],
      markerWindow: 'the-other-window',
      chatRequests: [],
    },
  )
})

// Value: protects=a generation whose publisher's receipt names a manifest that cannot be read (local CodeRabbit, pt1); fails_when=the end tells it as a Wiki of another checkout and sends the learner to the output setting instead of the recovery request; no_claim=the recovery itself; seam=a hand-written receipt that names a manifest of broken JSON
test('a generation whose published manifest cannot be read fails with the recovery request, not as another checkout’s Wiki', async (context) => {
  // Arrange: the watch's grace for a manifest it cannot read is shortened.
  const project = await openProjectWithoutWiki({
    constants: { WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS: 200 },
  })
  context.after(() => project.close())
  await project.runCommand(GENERATE_COMMAND)

  // Act: the receipt names a manifest whose bytes are no JSON.
  await mkdir(project.outputDirectory, { recursive: true })
  await writeFile(
    join(project.outputDirectory, 'index.html'),
    '<title>Wiki</title>',
  )
  const manifestText = '{"schemaVersion": 1, "repositoryRoot": '
  await writeFile(
    join(project.outputDirectory, 'codebook-wiki.json'),
    manifestText,
  )
  await writeFile(
    join(project.outputDirectory, 'codebook-publication.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'published',
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
    }),
  )
  await waitUntil(() => project.errors.length > 0, 'the failure', 6_000)

  // Assert
  assert.equal(
    project.errors[0]?.replace(/at \S+(?: [AP]M)?:/, 'at …:'),
    'LLM Wiki generation failed at …: An LLM Wiki was published in .codebook/wiki, but Codebook cannot read its manifest. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project".',
  )
})

// Value: protects=AC 14 and the plan's start failures, a VS Code whose chat cannot be opened (Copilot Chat missing or disabled); fails_when=the generation is told as an update, names no next action, or leaves its marker so the next Generate is refused beside a run that never started; no_claim=the chat's own setup; seam=a chat command that throws
test('a VS Code Generate whose chat cannot be opened fails with the generation’s sentence and leaves no marker', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    chatFails: 'command not found',
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(() => project.errors.length > 0, 'the failed start', 6_000)

  // Assert
  assert.deepEqual(
    {
      errors: project.errors.map((message) =>
        message.replace(/at \S+(?: [AP]M)?:/, 'at …:'),
      ),
      markerLeft: await exists(project.markerPath),
    },
    {
      errors: [
        'LLM Wiki generation failed at …: The editor chat could not be opened (command not found). Install or enable GitHub Copilot Chat, then press Generate LLM Wiki again.',
      ],
      markerLeft: false,
    },
  )
})

// Value: protects=AC 14 and the plan's start failures, a Cursor without the Cursor Agent CLI; fails_when=the sentence that says where Codebook looks for the CLI is lost or called an update, or the marker stays so the next Generate is refused; no_claim=the CLI lookup itself (runCursorWikiUpdate tests); seam=a stubbed agent that fails as the runner does when it finds no CLI
test('a Cursor Generate without the Cursor Agent CLI fails with the sentence that says where Codebook looks for it and leaves no marker', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorAgent: async () => {
      throw new Error(
        'Cursor Agent CLI is not installed: Codebook looks for ~/.local/bin/cursor-agent, then cursor-agent on the editor\'s PATH. Install it and sign in, then retry the Wiki generation, or run "/codebook Generate the LLM Wiki for this project" in Cursor chat.',
      )
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      errors: project.errors.map((message) =>
        message.replace(/at \S+(?: [AP]M)?:/, 'at …:'),
      ),
      markerLeft: await exists(project.markerPath),
    },
    {
      errors: [
        'LLM Wiki generation failed at …: Cursor Agent CLI is not installed: Codebook looks for ~/.local/bin/cursor-agent, then cursor-agent on the editor\'s PATH. Install it and sign in, then retry the Wiki generation, or run "/codebook Generate the LLM Wiki for this project" in Cursor chat.',
      ],
      markerLeft: false,
    },
  )
})

// Value: protects=Eng decision 72, a project whose folder Codebook may not write; fails_when=the generation hands a request to the chat although its marker cannot be claimed, the refusal hides the cause, or a marker or an output folder is left; no_claim=the wording of the system's error; seam=a project folder without write permission (skipped for root, whom permissions do not stop)
test(
  'a Generate in a project folder Codebook may not write refuses with the cause, sends no request and leaves no marker',
  {
    skip: process.getuid?.() === 0,
  },
  async (context) => {
    // Arrange
    const project = await openProjectWithoutWiki()
    context.after(async () => {
      await chmod(project.projectRoot, 0o755)
      await project.close()
    })
    await chmod(project.projectRoot, 0o555)

    // Act
    await project.runCommand(GENERATE_COMMAND).catch(() => undefined)

    // Assert
    assert.deepEqual(
      {
        refusal: project.errors.map((message) =>
          message.replace(project.projectRoot, '<project>'),
        ),
        chatRequests: project.chatRequests.length,
        codebookFolderMade: await exists(
          join(project.projectRoot, '.codebook'),
        ),
      },
      {
        refusal: [
          "Codebook did not start the LLM Wiki generation: EACCES: permission denied, mkdir '<project>/.codebook'",
        ],
        chatRequests: 0,
        codebookFolderMade: false,
      },
    )
  },
)

// Value: protects=AC 5 in Cursor and Eng decision 73, the /ship review of Cycle 0055 pt1 (probe 003): the managed skill is readied only for an update that will run; fails_when=an Update on a folder with no Wiki writes the managed skill, or a learner's own same-name skill refuses it with the skill conflict instead of the no-Wiki notice and its Generate LLM Wiki button; no_claim=the skill's deployment (cursorSkillDeployment tests); seam=stubbed skill steps that would refuse with a learner's own skill
test('an Update in Cursor on a folder with no Wiki says so and offers Generate LLM Wiki without readying the managed skill, also while a learner’s own skill is in the way', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())

  // Act
  await project.runUpdateCommand()

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      offered: project.offeredActions,
    },
    {
      skillCalls: [],
      offered: [
        {
          message: 'Codebook found no LLM Wiki in .codebook/wiki.',
          actions: ['Generate LLM Wiki'],
        },
      ],
    },
  )
})

// Value: protects=Eng decision 73 for an update: a learner's own same-name skill refuses the update once its checks passed; fails_when=the agent runs anyway, or the marker the checks claimed stays, so every window is refused until it expires; no_claim=the conflict's sentence (cursorSkillDeployment tests); seam=stubbed skill steps and agent
test('an Update in Cursor whose managed skill cannot be deployed over a learner’s own skill refuses with the deployment’s sentence, runs no agent and releases the marker', async (context) => {
  // Arrange: a project with a Wiki and a stale freshness answer, so the update's checks pass.
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Done.'
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)

  // Act
  await project.runUpdateCommand().catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      agentRuns,
      markerLeft: await exists(project.markerPath),
      refusal: project.errors,
    },
    {
      skillCalls: ['verify', 'deploy'],
      agentRuns: 0,
      markerLeft: false,
      refusal: [
        'Codebook could not start the Wiki update: A Cursor skill named codebook that Codebook does not own is in the way.',
      ],
    },
  )
})

// Value: protects=the state matrix's generate × window-closing cell (/ship review pass 2, Cycle 0055 pt1): a window that closes while a VS Code generation's start is still claiming its marker; fails_when=the start goes on after the close, sends a generate request into a chat the closing window no longer watches, or leaves its marker for every other window until it expires; no_claim=a window that closes during the watch (the update's tests); seam=the claim's answer held open
test('closing the window while a VS Code generation claims its marker sends no request and leaves no marker once the claim has answered', async (context) => {
  // Arrange: the start's claim on the marker is held open.
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const claim = project.hold('claim-answer')
  const pressed = project.runCommand(GENERATE_COMMAND)
  await claim.started

  // Act: the window closes, then the claim answers.
  await project.closeWindow()
  claim.release()
  await pressed.catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      chatRequests: project.chatRequests.length,
      markerLeft: await exists(project.markerPath),
    },
    { chatRequests: 0, markerLeft: false },
  )
})

// Value: protects=the /ship review pass 2 of Cycle 0055 pt1: a Cursor window that closes while the managed skill is deployed for a start whose marker is claimed; fails_when=the agent starts in the closing window, unattended and never stopped, or the marker stays; no_claim=the deployment itself (cursorSkillDeployment tests); seam=a skill deployment held open, for a generation and for an update
test('closing a Cursor window while the managed skill is deployed for a generation or an update starts no agent and leaves no marker once the deployment has ended', async (context) => {
  // Arrange: in both windows the skill check fails and its deployment is held open; the update's project has a Wiki to update.
  let agentStarts = 0
  const heldDeployments: Array<() => void> = []
  const deploymentsStarted: Array<Promise<void>> = []
  const openCursorWindow = () => {
    let reportStarted = (): void => {}
    deploymentsStarted.push(
      new Promise<void>((resolveStarted) => {
        reportStarted = resolveStarted
      }),
    )
    return openProjectWithoutWiki({
      cursor: true,
      cursorSkill: {
        verify: async () => {
          throw new Error('The managed Cursor skill is missing.')
        },
        deploy: () =>
          new Promise<void>((resolveDeployment) => {
            heldDeployments.push(resolveDeployment)
            reportStarted()
          }),
      },
      cursorAgent: async () => {
        agentStarts += 1
        return 'Done.'
      },
    })
  }
  const generating = await openCursorWindow()
  context.after(() => generating.close())
  const updating = await openCursorWindow()
  context.after(() => updating.close())
  await publishGeneratedWiki(updating.outputDirectory, updating.projectRoot)
  // A closing window ends the skill step, so each press rejects at the close; the handlers stand from the start.
  const generatePressed = generating
    .runCommand(GENERATE_COMMAND)
    .catch(() => undefined)
  const updatePressed = updating.runUpdateCommand().catch(() => undefined)
  await Promise.all(deploymentsStarted)

  // Act: both windows close, then the deployments end.
  await generating.closeWindow()
  await updating.closeWindow()
  for (const endDeployment of heldDeployments) endDeployment()
  await Promise.all([generatePressed, updatePressed])

  // Assert
  assert.deepEqual(
    {
      agentStarts,
      generationMarkerLeft: await exists(generating.markerPath),
      updateMarkerLeft: await exists(updating.markerPath),
    },
    { agentStarts: 0, generationMarkerLeft: false, updateMarkerLeft: false },
  )
})

// Value: protects=AC 4 and O9 for VS Code (/ship review pass 3, Cycle 0055 pt1): a generation whose chat still works when Codebook's 55 minutes pass; fails_when=the watch uses the update's 15 minutes, the end is not timed out, the notice calls it an update or offers a start that would be refused, the record misses the end, or the marker is removed instead of kept as a generation's reservation for the chat that may still publish; no_claim=the chat's later publish (the update's tests); seam=the watch's clock
test('a VS Code generation whose chat has not published when its 55 minutes pass ends as timed out, says the chat may still publish, records the end and keeps a generation reservation', async (context) => {
  // Arrange: the watch's clock is the test's, so its 55 minutes pass at once.
  let nowMs = 0
  const project = await openProjectWithoutWiki({
    watchClock: {
      now: () => nowMs,
      sleep: async (delayMs) => {
        nowMs += delayMs
      },
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.outputLines.length > 0,
    'the end’s record',
    6_000,
  )
  await waitUntil(
    async () =>
      JSON.parse(await readFile(project.markerPath, 'utf8').catch(() => '{}'))
        .watchEndedAtMs,
    'the reservation',
    6_000,
  )

  // Assert
  const marker = JSON.parse(await readFile(project.markerPath, 'utf8'))
  assert.deepEqual(
    {
      errors: project.errors,
      offered: project.offeredActions,
      end: /end=(\S+)/.exec(project.outputLines[0] ?? '')?.[1],
      markerRunKind: marker.runKind,
    },
    {
      errors: [
        'Codebook stopped waiting for the LLM Wiki generation after 55 minutes. The chat may still publish; Codebook: Open LLM Wiki in Browser opens the Wiki once it does. To stop it, stop the request in the chat.',
      ],
      offered: [],
      end: 'timed-out',
      markerRunKind: 'generate',
    },
  )
})

// Value: protects=the /ship review pass 3 of Cycle 0055 pt1: a Generate anyway whose start throws (here a read of the Wiki folder that fails); fails_when=it is told with a lead of its own ("could not start") instead of the refusal's, or it leaves no Output record, so a learner who reports it has nothing to copy; no_claim=the cause of the failing read; seam=a publish-token read that breaks at the press of the button
test('a Generate anyway whose start throws is told and recorded as a refused generation', async (context) => {
  // Arrange: the first generation stops watching, which leaves a reservation; at the refusal's button the folder's read starts to fail.
  const handle: {
    project?: Awaited<ReturnType<typeof openProjectWithoutWiki>>
  } = {}
  handle.project = await openProjectWithoutWiki({
    chatReply: () => new Promise<never>(() => {}),
    chooseAction: (_message, actions) => {
      if (!actions.includes('Generate anyway')) return undefined
      handle.project?.breakPublishTokenRead('EIO: i/o error, read')
      return 'Generate anyway'
    },
  })
  const opened = handle.project
  context.after(() => opened.close())
  const first = opened.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => opened.chatRequests.length > 0,
    'the first generate request',
    6_000,
  )
  await opened.runCommand('codebook.cancelWikiRun')
  await first

  // Act
  await opened.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => opened.errors.length > 1,
    'the thrown start’s notice',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      thrownStart: opened.errors.at(-1),
      recordedEnds: opened.outputLines.map(
        (line) => /end=(\S+)/.exec(line)?.[1],
      ),
    },
    {
      thrownStart:
        'Codebook did not start the LLM Wiki generation: EIO: i/o error, read',
      recordedEnds: ['cancelled', 'failed', 'failed'],
    },
  )
})

// Value: protects=AC 5 and the /ship review pass 3 of Cycle 0055 pt1: Open LLM Wiki in Browser and Update LLM Wiki while a first generation runs; fails_when=either says that no Wiki was found and offers Generate LLM Wiki, which would only be refused, instead of naming the generation under way, in this window or another; no_claim=the other window's start time (describeOtherWikiWindow tests); seam=a chat that never answers in the generating window
test('Open LLM Wiki in Browser and Update LLM Wiki while a first generation runs name that generation instead of offering Generate LLM Wiki, in its window and in another', async (context) => {
  // Arrange: one window generates; its chat works on the request and has not published.
  const generating = await openProjectWithoutWiki()
  context.after(() => generating.close())
  const otherWindow = await openWikiUpdateWindow({
    projectRoot: generating.projectRoot,
    openReader: false,
  })
  context.after(() => otherWindow.close())
  await generating.runCommand(GENERATE_COMMAND)
  await waitUntil(
    async () => exists(generating.markerPath),
    'the generation’s marker',
    6_000,
  )

  // Act
  await generating.runCommand('codebook.openDeepWiki')
  await otherWindow.runCommand('codebook.openDeepWiki')
  await otherWindow.runUpdateCommand()

  // Assert
  assert.deepEqual(
    {
      sameWindow: generating.notices,
      otherWindow: otherWindow.notices.map((notice) =>
        notice.replace(/started [^)]*\)/, 'started …)'),
      ),
      generateOffered: [
        ...generating.offeredActions,
        ...otherWindow.offeredActions,
      ].some(({ actions }) => actions.includes('Generate LLM Wiki')),
    },
    {
      sameWindow: [
        'Codebook is already generating this project’s LLM Wiki. Its progress is in the status bar here.',
      ],
      otherWindow: [
        'Another editor window is generating this Wiki (VS Code, started …). Wait for it to finish, then press Open LLM Wiki in Browser.',
        'Another editor window is generating this Wiki (VS Code, started …). Wait for it to finish, then press Open LLM Wiki in Browser.',
      ],
      generateOffered: false,
    },
  )
})

// Value: protects=the state matrix's generate × link-on-path cell at the window (/ship review pass 3, Cycle 0055 pt1): a cloned repository whose `.codebook` is a link out of the project; fails_when=Generate makes a folder through the link, claims a marker there or asks the chat, instead of refusing before anything; no_claim=the path check's sentence (assertNoLinkOnWikiPath tests); seam=a symbolic link in the test's own project
test('Generate in a project whose .codebook is a link out of it refuses before it asks, makes or claims anything', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const outside = await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-'))
  context.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(project.projectRoot, '.codebook'))

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      refused: project.errors.length === 1,
      confirmations: project.confirmations.length,
      chatRequests: project.chatRequests.length,
      madeOutside: await readdir(outside),
    },
    { refused: true, confirmations: 0, chatRequests: 0, madeOutside: [] },
  )
})

// Value: protects=the /ship review pass 3 of Cycle 0055 pt1: the button of an older notice (Generate's "Update it instead?", and so every override) pressed while another run of this window holds it (a Cursor run lasts its whole bound); fails_when=the press waits for that run and then starts a second run out of nowhere, instead of being told at once that a run is under way; no_claim=a press on the notice of the start that is still unwinding, which waits for it (other tests); seam=a button pressed later, and a Cursor agent held open
test('an older notice’s Update LLM Wiki pressed while another Cursor run of this window works is told at once and starts no second run', async (context) => {
  // Arrange: Generate on a folder with a Wiki offers the update, whose button is pressed later; then Update starts a run whose agent works on.
  let pressOffer: (choice: string | undefined) => void = () => {}
  let agentRuns = 0
  let endAgent: () => void = () => {}
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (message) =>
      message.startsWith('An LLM Wiki already exists')
        ? new Promise<string | undefined>((resolveChoice) => {
            pressOffer = resolveChoice
          })
        : undefined,
    cursorAgent: () => {
      agentRuns += 1
      return new Promise<string>((resolveAgent) => {
        endAgent = (): void => resolveAgent('Done.')
      })
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  await project.runCommand(GENERATE_COMMAND)
  const running = project.runUpdateCommand()
  await waitUntil(() => agentRuns === 1, 'the running update', 6_000)

  // Act: the older offer's button is pressed while the run works.
  pressOffer('Update LLM Wiki')
  await waitUntil(
    () => project.notices.length > 1,
    'the notice of the run under way',
    6_000,
  )
  endAgent()
  await running

  // Assert
  assert.deepEqual(
    { notices: project.notices.slice(1), agentRuns },
    {
      notices: [
        'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
      ],
      agentRuns: 1,
    },
  )
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (Claude adversarial): a generation where Git is missing or does not answer; fails_when=the request asks the agent for the full commit hash of HEAD it cannot get, as if the folder were a repository Git answered for, so the generation fails at its publish up to 55 minutes later; no_claim=the agent's own Git; seam=the freshness look answers that Git could not be asked
test('a generation where Git could not be asked hands a request that asks for a revision only where Git answers', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  project.setFreshness({
    status: 'unknown',
    unknownCause: 'git-missing',
    reason: 'Git is not installed.',
    changedPaths: [],
    addedPaths: [],
  })

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      asksRevisionOnlyWhereGitAnswers: project.chatRequests[0]?.query.includes(
        'Codebook could not ask Git about this folder: record generated.revision only if Git gives you the full commit hash of HEAD',
      ),
      asksHeadOutright: project.chatRequests[0]?.query.includes(
        'generated.revision is the full commit hash of HEAD',
      ),
    },
    { asksRevisionOnlyWhereGitAnswers: true, asksHeadOutright: false },
  )
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (both Codex passes) and E1-F3's root cause: an output folder that exists without a Wiki, which the publisher refuses; fails_when=Generate asks to confirm, starts the chat for a publish that is sure to be refused, or touches the learner's files in the folder; no_claim=the publisher's refusal itself; seam=a folder the test makes with a file of the learner in it
test('Generate on an output folder that exists without a Wiki refuses before it asks, starts nothing and leaves the folder’s files', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  await mkdir(project.outputDirectory, { recursive: true })
  await writeFile(join(project.outputDirectory, 'notes.md'), 'mine')

  // Act
  await project.runCommand(GENERATE_COMMAND)

  // Assert
  assert.deepEqual(
    {
      errors: project.errors,
      confirmations: project.confirmations.length,
      chatRequests: project.chatRequests.length,
      learnerFile: await readFile(
        join(project.outputDirectory, 'notes.md'),
        'utf8',
      ),
      markerLeft: await exists(project.markerPath),
    },
    {
      errors: [
        'Codebook did not start the LLM Wiki generation: The folder .codebook/wiki already exists but holds no LLM Wiki, and the publisher writes a first Wiki only into a folder it makes itself. Move what you keep in it elsewhere and remove the folder, or set codebook.wikiOutputDirectory to a folder that does not exist yet, then press Generate LLM Wiki again.',
      ],
      confirmations: 0,
      chatRequests: 0,
      learnerFile: 'mine',
      markerLeft: false,
    },
  )
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (Claude adversarial): Stop LLM Wiki Run and Open LLM Wiki in Browser while this window's generation is still starting (its claim, its Git look, Cursor's skill); fails_when=Stop says that nothing is running, or Open says that no Wiki was found and offers a second Generate that would join the first in silence; no_claim=a start that runs (other tests); seam=the claim's answer held open
test('Stop LLM Wiki Run and Open LLM Wiki in Browser during a generation’s start say that a run is starting, and offer no second Generate', async (context) => {
  // Arrange: the start's claim on the marker is held open.
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const claim = project.hold('claim-answer')
  const pressed = project.runCommand(GENERATE_COMMAND)
  await claim.started

  // Act
  await project.runCommand('codebook.cancelWikiRun')
  await project.runCommand('codebook.openDeepWiki')
  claim.release()
  await pressed

  // Assert
  const starting =
    'Codebook is starting an LLM Wiki run in this window. Once it runs, its progress shows and Stop LLM Wiki Run stops it.'
  assert.deepEqual(
    {
      notices: project.notices,
      generateOffered: project.offeredActions.some(({ actions }) =>
        actions.includes('Generate LLM Wiki'),
      ),
    },
    { notices: [starting, starting], generateOffered: false },
  )
})

// Value: protects=AC 12 for updates (CodeRabbit, PR #133): every refused update start leaves its Output record, also one a Cursor skill in the way refused after the checks and one whose check threw; fails_when=either refusal is told but leaves Output › Codebook empty, so a learner who reports it has no record to copy; no_claim=the record's fields (wikiRunRecord tests); seam=a learner's own Cursor skill, and a publish-token read that fails
test('an Update refused by a learner’s own Cursor skill, and one whose start check threw, each leave one Output record of a failed update', async (context) => {
  // Arrange: a Cursor window whose managed skill cannot be deployed, and a VS Code window whose publish-token read fails; both projects have a Wiki.
  const cursorProject = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => cursorProject.close())
  await publishGeneratedWiki(
    cursorProject.outputDirectory,
    cursorProject.projectRoot,
  )
  const vsCodeProject = await openProjectWithoutWiki({
    publishTokenReadFails: 'EIO: i/o error, read',
  })
  context.after(() => vsCodeProject.close())

  // Act
  await cursorProject.runUpdateCommand().catch(() => undefined)
  await vsCodeProject.runUpdateCommand().catch(() => undefined)

  // Assert
  assert.deepEqual(
    [cursorProject, vsCodeProject].map((project) =>
      project.outputLines.map((line) =>
        /^info: LLM Wiki (\S+) ended: host=(\S+) .* end=(\S+) /
          .exec(line)
          ?.slice(1),
      ),
    ),
    [[['update', 'cursor', 'failed']], [['update', 'vscode', 'failed']]],
  )
})
