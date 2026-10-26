import { describeWikiGenerateBlock } from './describeWikiGenerateBlock'
import type { WikiUpdateStartBlock } from './findWikiUpdateStartBlock'
import type { WikiUpdateOutput } from './wikiUpdateRun'

/**
 * Words that a folder holds no LLM Wiki, for the notices of Open LLM Wiki in Browser and Update LLM Wiki, which offer Generate LLM Wiki beside it (Cycle 0055, proposed change 3).
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence that names the folder.
 * @example describeMissingWiki('.codebook/wiki') // => 'Codebook found no LLM Wiki in .codebook/wiki.'
 */
export function describeMissingWiki(outputLabel: string): string {
  return `Codebook found no LLM Wiki in ${outputLabel}.`
}

/** Another window's running generation or update, a stopped VS Code watch's reservation or an earlier chat's leftover in the way of a new run: the sentence of the refusal and, where the learner may go on anyway, what the override starts. */
export type WikiRunInTheWay = { reason: string; override?: () => void }

/** What a claim of the run's marker answers ({@link claimWikiUpdateMarker}): the marker is this run's, with its release and its turn into a reservation, or another window holds it. */
export type WikiRunMarkerClaim<Holder> =
  | {
      release: () => Promise<boolean>
      reserve: (watchEndedAtMs: number) => Promise<boolean>
    }
  | { heldBy: Holder }

/**
 * What {@link startWikiGenerate} asks of the editor window, each as a closure of the extension's activation, so the start's order lives here and host tests pass stand-ins (Cycle 0055, `WikiRunDependencies`).
 */
export type WikiGenerateStartDependencies<Holder> = {
  /** The resolved Wiki folder and its label. */
  wikiOutput: WikiUpdateOutput
  /** Refuses a link or a file on the output folder's path in the project before anything there is read or made ({@link assertNoLinkOnWikiPath}). */
  assertPathHeld: () => Promise<void>
  /** The publish token of the folder's manifest ({@link readWikiPublishToken}); `undefined` while it holds none. */
  readPublishToken: () => Promise<string | undefined>
  /** What makes the publisher refuse before it stages anything ({@link findWikiUpdateStartBlock}). */
  findStartBlock: () => Promise<WikiUpdateStartBlock | undefined>
  /** Another run in the way, as the update's start checks find it. */
  findRunInTheWay: () => Promise<WikiRunInTheWay | undefined>
  /** Asks the learner to confirm (Cycle 0055, D2): the answer is `generate`, `change-location`, or `undefined` for a dismissal. */
  confirm: () => Promise<'generate' | 'change-location' | undefined>
  /** Opens the output setting; starts nothing. */
  openLocationSetting: () => Promise<unknown>
  /** Makes the folder that holds the output and its marker, never the output folder itself ({@link placeStorageLock} makes no folder for the marker). */
  makeOutputParent: () => Promise<void>
  /** Readies the agent once the marker is claimed and no Wiki appeared, so a start that is refused or offers the update writes no skill: in Cursor the managed skill ({@link verifyManagedCursorSkill}, {@link deployCursorSkill}), whose conflict throws and releases the marker; nothing in VS Code. */
  prepareAgent: () => Promise<void>
  /** Claims the run's marker for a generation that starts at the given time. */
  claimMarker: (startedAtMs: number) => Promise<WikiRunMarkerClaim<Holder>>
  /** The sentence of a refusal for another window that holds the marker ({@link describeOtherWikiWindow}). */
  describeHolder: (heldBy: Holder) => string
  /** The publication identity of the folder ({@link readWikiPublicationIdentity}). */
  readPublicationIdentity: () => Promise<string | undefined>
  /** Whether the opened folder is inside a Git repository; the request names only the conditions that can hold in it. */
  hasGitRepository: () => Promise<boolean>
  /** Offers the update where a Wiki already stands: `An LLM Wiki already exists in <folder>. Update it instead?` */
  offerUpdate: () => void
  /** Tells the learner why the generation did not start, with the override where there is one. */
  refuse: (reason: string, override?: () => void) => void
  /** The present (epoch milliseconds). */
  now: () => number
}

/** What a generation that may go ahead begins with; its marker is claimed. */
export type WikiGenerateStart = {
  /** The publication identity at the start, `undefined` where no receipt stands; only another one at the end is the generation's publication. */
  publicationAtStart: string | undefined
  releaseMarker: () => Promise<boolean>
  reserveMarker: (watchEndedAtMs: number) => Promise<boolean>
  startedAtMs: number
  hasGitRepository: boolean
}

/**
 * Readies the agent for a claimed generation and reads what it begins with, and releases its marker when a step fails, so a start that throws leaves no marker; called by {@link startWikiGenerate} after the claim.
 * Why: the agent is readied only for a start that goes ahead, so a refused start or the update's offer writes no Cursor skill, and a skill in the learner's way never hides the refusal of another window's run.
 * @param dependencies - The editor window's closures.
 * @param claim - The run's own marker.
 * @param startedAtMs - When the generation started.
 * @returns The start, or `undefined` after the marker was released for a Wiki that appeared between the first look and the claim (the update is offered).
 * @throws What readying the agent or a read threw (a Cursor skill in the way), after the marker was released.
 * @example await beginClaimedGeneration(dependencies, claim, 1_790_000_000_000) // => { publicationAtStart: undefined, … }
 */
async function beginClaimedGeneration<Holder>(
  dependencies: WikiGenerateStartDependencies<Holder>,
  claim: Exclude<WikiRunMarkerClaim<Holder>, { heldBy: Holder }>,
  startedAtMs: number,
): Promise<WikiGenerateStart | undefined> {
  try {
    // A Wiki that appeared between the first look and the claim is updated, never overwritten.
    if ((await dependencies.readPublishToken()) !== undefined) {
      await claim.release().catch(() => false)
      dependencies.offerUpdate()
      return undefined
    }
    await dependencies.prepareAgent()
    return {
      publicationAtStart: await dependencies.readPublicationIdentity(),
      releaseMarker: claim.release,
      reserveMarker: claim.reserve,
      startedAtMs,
      hasGitRepository: await dependencies.hasGitRepository(),
    }
  } catch (error) {
    // A start that throws after its claim leaves no marker behind.
    await claim.release().catch(() => false)
    throw error
  }
}

/**
 * Refuses the generation for what makes the publisher refuse, or for another run in the way, with the refusal's override; called by {@link startWikiGenerate} before the confirmation and again right before the claim.
 * @param dependencies - The editor window's closures.
 * @returns `true` after a refusal was told; `false` when nothing is in the way.
 * @example await refusedForBlockOrRun(dependencies) // => false
 */
async function refusedForBlockOrRun<Holder>(
  dependencies: WikiGenerateStartDependencies<Holder>,
): Promise<boolean> {
  const block = await dependencies.findStartBlock()
  if (block) {
    dependencies.refuse(
      describeWikiGenerateBlock(block, dependencies.wikiOutput.outputLabel),
    )
    return true
  }
  const inTheWay = await dependencies.findRunInTheWay()
  if (inTheWay) dependencies.refuse(inTheWay.reason, inTheWay.override)
  return inTheWay !== undefined
}

/**
 * Makes every check of a first LLM Wiki generation's start in one order, asks the learner, prepares the folder and the agent, and claims the marker, so no agent is asked for a run that cannot succeed and nothing is left behind by a start that did not go ahead.
 *
 * The order: the folder's path in the project; an existing manifest, which is never overwritten and gets the update's offer; what makes the publisher refuse; another window's run, a reservation or an earlier chat's leftover; the confirmation (D2), whose Change location and dismissal start nothing; the folder that holds the output and its marker, which a fresh project lacks (Eng decision 72); the publisher's refusals and other runs once more, which may have come up while the learner read the confirmation; the marker's claim, which another window may have won meanwhile (Eng decision 79); once more the manifest, which may have appeared in between; and last the Cursor skill (Eng decision 73), so only a start that goes ahead writes it. A refused start leaves no marker and no folder of the output.
 * Why: a generation is a run of the update's lifecycle (Cycle 0055, O3), whose start checks it shares; its own steps are an existing Wiki's offer, the confirmation and the folder.
 * Trigger: Codebook: Generate LLM Wiki, from the Command Palette, a no-Wiki notice's button or a failed generation's button.
 *
 * @param dependencies - The editor window's closures ({@link WikiGenerateStartDependencies}).
 * @returns The start with its claimed marker; `undefined` when the start did not go ahead and the learner was told (a refusal, an offer of the update, a dismissed confirmation, Change location).
 * @throws What the path check, the folder, the agent's preparation or the claim threw; the caller tells the learner. No marker is left.
 * @example
 * await startWikiGenerate(dependencies) // => { publicationAtStart: undefined, releaseMarker, reserveMarker, startedAtMs: 1_790_000_000_000, hasGitRepository: true }
 */
export async function startWikiGenerate<Holder>(
  dependencies: WikiGenerateStartDependencies<Holder>,
): Promise<WikiGenerateStart | undefined> {
  await dependencies.assertPathHeld()
  // An existing Wiki is updated, never overwritten.
  if ((await dependencies.readPublishToken()) !== undefined) {
    dependencies.offerUpdate()
    return undefined
  }
  if (await refusedForBlockOrRun(dependencies)) return undefined
  const choice = await dependencies.confirm()
  if (choice === 'change-location') {
    await dependencies.openLocationSetting()
    return undefined
  }
  // A dismissed confirmation starts nothing.
  if (choice !== 'generate') return undefined
  await dependencies.makeOutputParent()
  // The learner may have read the confirmation for minutes: another window may have begun, or left a stopped watch's reservation, which a claim would take over.
  if (await refusedForBlockOrRun(dependencies)) return undefined
  const startedAtMs = dependencies.now()
  const claim = await dependencies.claimMarker(startedAtMs)
  // Another window won the marker between this window's look and its claim: its refusal, never an error.
  if ('heldBy' in claim) {
    dependencies.refuse(dependencies.describeHolder(claim.heldBy))
    return undefined
  }
  return beginClaimedGeneration(dependencies, claim, startedAtMs)
}
