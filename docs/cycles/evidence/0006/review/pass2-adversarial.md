# ADVERSARIAL REVIEW — Cycle 0006, pass 2, reused in-host reviewer

Start token: `2c372c9f-8796-4105-8e99-6e97498019b0`. Base: `origin/main` at `9ce3ddcd04d701633a78ce178329d7d72b1a2f10`. Branch: `feat/cycle-0006-study-workspace`; HEAD: `5c883a1891b75ff47d4ef30f3605b8dddadfee44`, with tracked and nonignored untracked implementation changes. Contract: `docs/cycles/0006-study-workspace.md`.

The full production diff and new production source, including StudyWorkspace, model/library/UI, archive utilities and native harness, were read during the immediately preceding pass-2 lenses in this same agent. The changed StudyWorkspace was then read again for this adversarial pass, including the new arrangement lifetime barrier and relevant runtime/resource callees. The reviewed controller is preserved in `pass2-studyWorkspace.ts.snapshot`, SHA-256 `8e5fd13c0eb21e165f1ff316686e429531ffade78b940c798dfaa933dc73eb76`; line references below refer to this snapshot. The parent resumed subsequent edits after that snapshot was captured. This report does not certify the resulting later tree.

**Coverage limits:** Agent-thread limits required reusing the existing reviewer context. Freshness is unavailable: this is not an independent fresh-context review and cannot count toward final-product acceptance. It is a same-host review, not an outside-provider review. For this pass, tests and fixtures were reviewed in **SUMMARY mode only**, using names and change statistics; no raw test/fixture payloads were read or expanded. Earlier lenses in this reused context had test-source exposure. No editor/native runner, external API, or nested agent was launched. The probes transpile the frozen production controller in memory and substitute narrow editor/library boundaries; they prove the code paths described below, not native VS Code/Cursor UI behavior.

Known pass-2 issues were excluded: the Close/arrange race was repaired before the snapshot; the parent already owns the failed-understanding-intent Retry gap. Prior pass-1 fixes were not relabeled as new findings.

## FIXABLE — P2 — a source-render failure is reported to MCP as a successful reveal

Location: `extension/src/studyWorkspace.ts:107-111`, with failure absorption at `:424`; success propagation in `extension/src/environment.ts:94-95` and `extension/src/service.ts:135-138`.

Confidence: **10/10**.

Trigger: A live matching pause is selected in an open Study workspace. `codebook_reveal` takes the captured-reader path, but opening/showing the selected captured document fails, or its displayed hash check fails. `renderSelection` records the reader error and resolves its returned promise. `presentation.revealSource` therefore returns `true`; the environment records `agent.source-revealed`, and StudyService returns `revealed: true` even though the source was not successfully displayed.

Motivating code:

```ts
// studyWorkspace.ts:107–111
revealSource: async snapshot => {
  if (!this.opened) return false;
  await this.refresh();
  if (this.message().model.observation?.id !== snapshot.id || !this.message().model.matching) throw new StudyError('BUSY', 'Learner is reading another observation. Read the captured source resource or return the reader to the current pause.');
  await this.renderSelection(true, true); return true;
},
// studyWorkspace.ts:424–425
this.rendering = pending.catch(error => { if (revision === this.revision && !this.closing && this.pendingHistory === undefined) this.report('reader', error); });
return this.rendering;
// environment.ts:94–95
if (await presentation?.revealSource(snapshot, source.sourcePath)) {
  check(); run.evidence.record('agent.source-revealed', { snapshotId: snapshot.id, line: snapshot.frame.line, sourceHash: snapshot.source.typescriptHash, capturedReader: true }); return;
}
```

Observed in a bounded probe of the actual frozen `presentation.revealSource` and `renderSelection` implementations. The editor boundary rejected its captured document open, while selection and live-pause identity matched:

```json
{"probe":"MCP presentation reveal after source-render failure","revealed":true,"sourceOpenAttempts":1,"sourceUri":null,"loading":true,"errors":[["reader","Error: Injected host source open failure"]]}
```

This is an API/evidence correctness failure, not merely a reader error label: the UI knows that source acquisition failed while the agent receives an affirmative result and a successful reveal event.

Fix direction: Preserve failure information for explicit reveal callers. After the render attempt, require the requested snapshot and revision to still own a successfully displayed, active captured-source URI with matching bytes; reject if rendering failed, was superseded, or was skipped. Internal background rendering may retain its observed error handling, but the explicit MCP reveal path must not treat its resolved bookkeeping promise as proof of presentation. Add a regression that injects a captured document acquisition failure and verifies a rejected MCP reveal with no `agent.source-revealed` event.

## FIXABLE — P2 — unavailable current source prevents reading intact history after reload

Location: `extension/src/studyWorkspace.ts:260-267`, with restored captured-source provider at `:503-508`.

Confidence: **9/10**.

Trigger: Retained history contains captured source bytes, but the currently installed demo source cannot be read on a fresh editor/extension activation—for example, it is missing or exceeds the reader limit. The first Open or restored `codebook-source` document calls `initialize`. Initialization awaits `readBaselines` before loading progress or archive metadata. That failure rejects the entire initialization, so neither saved history nor its self-contained captured source can be read even though those records do not require current source bytes.

Motivating code:

```ts
// studyWorkspace.ts:260–267
const workspace = await realpath(requireWorkspace()), key = sha256(workspace);
this.library = new LearningLibrary(join(this.context.globalStorageUri.fsPath, 'learning', key), key);
await this.readBaselines();
try { this.progress = await this.library.readProgress(); if (this.progress.selection) this.selection = { ...this.progress.selection, follow: false }; }
catch (error) { this.report('progress', error); }
try { this.catalog = await this.library.list(); const id = this.selection.studyId ?? this.catalog[0]?.id;
  if (id) { this.selectedArchive = await this.library.readStudy(id); this.selection.studyId = id; }
} catch (error) { this.report('archive', error); }
// studyWorkspace.ts:503–508
private async provideSource(uri: vscode.Uri): Promise<string> {
  await this.initialize();
  if (uri.authority !== this.library!.workspaceKey || uri.query || uri.fragment) throw new Error('Captured source belongs to another workspace.');
  const cached = this.documents.get(uri.toString()); if (cached !== undefined) return cached;
  const [studyId, participantText, hash] = uri.path.split('/').filter(Boolean), participant = participantSchema.parse(participantText);
  const source = studyId === 'source-derived' ? this.baselines![participant] : (await this.library!.readStudy(studyIdSchema.parse(studyId))).observations.find(value => value.participant === participant)?.source;
```

Observed in a bounded probe of the actual frozen `provideSource`, `initialize`, and `readBaselines` methods. The current source path was absent, and the substituted library boundary had retained source available. Initialization rejected before any library history/progress read:

```json
{"probe":"cold historical source with unavailable current source","error":"Error: Captured file is unavailable.","historyReads":0,"progressReads":0,"archiveAvailable":true}
```

The probe deliberately does not claim a physical-disk archive or native reload test. It demonstrates the unconditional current-baseline dependency before any archive read. This differs from the repaired warm-reader baseline failure: that path already has baseline objects and can retain historical content, while a fresh owner cannot initialize at all. It conflicts with the cycle's retained-history/reload behavior and the explicit distinction between unavailable current source and historical source.

Fix direction: Separate workspace/library initialization from current-source availability. A failed current baseline should publish unavailable current progress without preventing a validated archived study or captured-source URI from loading. Preserve schema/workspace/hash validation, and never substitute archived bytes as proof of the current baseline. Add a cold-owner/reload regression with valid retained history and a missing current source, verifying the archived document remains readable and current understanding remains unknown.

No additional INVESTIGATE finding is retained. The bounded review stops with these two concrete failures; the parent's subsequent failed-intent fix and other implementation changes need their own validation.

Recommendation: Fix the reveal-success contract and cold-history initialization because a failed source display can be certified to MCP as revealed and intact captured history becomes unreadable when the current source is unavailable.
