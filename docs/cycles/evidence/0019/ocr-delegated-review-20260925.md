# Delegated local source review — 2026-09-25 JST

Status: host-agent review using open-code-review 1.12.9 for deterministic workspace selection and rules. OCR did not call an LLM or provide an independent external review. The two later CodeRabbit requests failed before findings and remain separate in [the CLI review record](local-review-followup-20260925.md).

## Scope and coverage

`ocr delegate preview --format json` selected workspace mode on `codex/cycle-0019-bundled-codebook-skill`. Its final preview identified **56 changed entries: 23 reviewable source entries and 33 default exclusions**. `ocr delegate rule --format json` resolved one system rule group for the 23 TypeScript entries. I inspected each eligible entry's current diff, read the three new utility modules and the changed Study placement/ownership context, and checked the G12 contract and user-state preservation conditions from the project documents. Eligible coverage: **23 reviewed, 0 skipped, 100%**. This percentage excludes OCR's 33 default exclusions; it is not whole-branch review coverage or CodeRabbit completion.

Reviewed entries (all status `modified` except the three labeled `added`):

- [x] `experiments/cycle-0001/src/browserViewport.ts`
- [x] `extension/src/configuredBrowserRun.ts`
- [x] `extension/src/configuredProfile.ts`
- [x] `extension/src/constants.ts`
- [x] `extension/src/cursorSkillDeployment.ts`
- [x] `extension/src/environment.ts`
- [x] `extension/src/extension.ts`
- [x] `extension/src/nativeRunner.ts`
- [x] `extension/src/presentationSchemas.ts`
- [x] `extension/src/protocol.ts`
- [x] `extension/src/resources.ts`
- [x] `extension/src/service.ts`
- [x] `extension/src/studyWorkspace.ts`
- [x] `extension/src/tests/utils/configuredRuntimeHarness.ts`
- [x] `extension/src/tests/utils/configuredServiceHarness.ts`
- [x] `extension/src/ui/studyHtml.ts`
- [x] `extension/src/utils/configuredDomExpression.ts`
- [x] `extension/src/utils/createBundleVerifier.ts`
- [x] `extension/src/utils/extractDevelopmentModule.ts`
- [x] `extension/src/utils/readDevelopmentBundle.ts`
- [x] `extension/src/utils/refreshCursorMcpCatalog.ts` (added)
- [x] `extension/src/utils/resolveExternalNodeExecutable.ts` (added)
- [x] `extension/src/utils/sourceMapMappedPositions.ts` (added)

OCR excluded 20 Markdown entries as `unsupported_ext`: `CHANGELOG.md`, `PROJECT_STATE.md`, `docs/acceptance/FINAL_REVIEW.md`, `docs/cycles/0018-editor-group-scope.md`, `docs/cycles/0019-bundled-codebook-skill.md`, `docs/cycles/evidence/0019/installed-chat-development.md`, `docs/plans/cycle-0019-skill-onboarding.md`, `extension/README.md`, `extension/skills/codebook/SKILL.md`, and eleven new Cycle 0019 evidence files (`breakpoint-mapping-hints`, `chat-open-followup`, `claude-permission-mode`, `isolated-claude-chat-registration`, `isolated-claude-fourth-followup`, `isolated-claude-layout-restart`, `local-review-followup`, `mantine-normal-chat-development`, `real-repository-preflight`, `study-chat-open-focus`, `study-layout-restore`; each under `docs/cycles/evidence/0019/` with its date suffix). These exclusions were not silently counted as reviewed. The current README and state/cycle text were separately reconciled against the new native evidence; no full documentation copy edit is claimed.

OCR excluded 13 test entries as `default_path`: `experiments/cycle-0001/src/tests/browserViewport.test.ts` and `extension/src/tests/` files `configuredAdapter.test.ts`, `configuredBundle.test.ts`, `configuredRuntime.test.ts`, `configuredService.test.ts`, `editorChatOnboarding.test.ts`, `environment.test.ts`, `protocol.test.ts`, `repositoryProtocol.test.ts`, `service.test.ts`, `studyWorkspace.test.ts`, `refreshCursorMcpCatalog.test.ts`, and `resolveExternalNodeExecutable.test.ts`. The focused tests below and complete test suites exercise those files, but their exclusion is not manual review coverage.

The exact OCR preview and grouped rule output are retained locally under ignored `artifacts/cycle-0019/review/ocr-preview-final-20260925.json` and `ocr-rules-20260925.json`. No credentials or private runtime data were included in the tracked report.

## Finding and repair

**High — `extension/src/studyWorkspace.ts`: a replaced opaque editor tab could inherit the original group's ownership when its visible title and flags matched.** The new fallback key used input constructor, label, dirty/preview/pinned flags. Closing and reopening a `Settings` tab with the same name and flags created the same key, even though a newer learner tab had replaced the original. During a pane wrapper change, this let Codebook continue a presentation transfer across changed learner state.

A new behavior test, **“a replacement settings tab with the same title cannot inherit native group ownership,”** failed before repair with `Missing expected rejection`. The group-survival check now accepts an opaque foreign tab only when the original `Tab` object or its exact input object survives, its metadata remains the same, and the predecessor is unique. New same-title input objects cannot inherit the receipt. The new rejection test plus unchanged-settings and changed-title controls all pass. The conservative behavior may require the learner to retry a transfer after an editor rebuilds an opaque input wrapper; it preserves the foreign tab instead of asserting ownership without evidence.

After this repair, `pnpm --dir extension test` passed **918/918**, `pnpm --dir extension test:package` passed **100/100**, and `git diff --check` passed. The suites ran sequentially. These are source tests on the current dirty tree; the earlier installed VSIX `7e75b1df…` does not contain this repair. No native Cursor/VS Code retest or independently completed clean review follows from these checks. The current source cut still needs packaging, same-artifact host tests and delivery.
