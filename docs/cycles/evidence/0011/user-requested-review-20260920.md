# Owner-requested CodeRabbit and delegated OCR review

Status: reviews completed; findings triaged and targeted fixes verified locally. This supplements the closed, non-converged GStack review; it does not clear native or final-product acceptance.

## Frozen scope and methods

- Cycle 0011 base: `24e7f20`; HEAD: `7f521385620b0628ca2f2ec9824204066e407db5` with uncommitted fixes. Reviewed product inventory: `085d93ad5ad8832428f12ad9ffb912ed544f30794dfb04164f785bdf9c547a36`, 231 files; 384 passing tests. No native application was launched by either review.
- CodeRabbit CLI 0.7.8 ran the actual external provider for the authenticated Laststance repository. Command: `coderabbit review --agent --base-commit 24e7f20 --include-untracked -c artifacts/cycle-0011/user-requested-review/context.md AGENTS.md`. Exit 0 and a `review_completed` receipt report **104 reviewed files and 10 notifications**, grouped below into seven topics. No usage-credit override was passed.
- OCR CLI 1.12.5 selected files and resolved rules deterministically. The host agent and two reused in-host reviewers read the eligible diffs in three bounded batches. No OCR LLM endpoint was invoked; this is not a second external provider. The recorded context was under the skill's input limits.
- OCR range and workspace previews contain **134 entries**, including overlapping paths in different modes. All **90 eligible entries / 71 unique eligible paths** were reviewed, with zero skipped eligible entries. The **44 excluded entries / 33 unique excluded paths** have explicit default-path or unsupported-extension reasons. Eligible coverage is 100%; coverage of all preview entries is 90/134 (67.16%), and unique-path coverage is 71/104 (68.27%). No additional in-scope actionable OCR finding remained after adjudication.
- Complete mode/path/status accounting is in ignored `artifacts/cycle-0011/user-requested-review/ocr-report.json`. Raw previews, resolved rules, batch results, provider JSONL, context and diagnostic probes remain in the same private directory. The provider's reported file list is evidence of its coverage receipt, not proof that every unchanged line was read.

## CodeRabbit adjudication

| Topic | Raw notifications | Result | Evidence and reason |
| --- | --- | --- | --- |
| CR1 compact understand label | 1 | Declined | Restoring the long label contradicts the approved compact control and R14. Complete-citation context remains available through associated help. |
| CR2 custom-source fixture mismatch | 2, 9 | Fixed | ControlledConfiguredRuntime used the default observation despite exposing custom source bytes. Derive the synthetic observation from the declared source. The extended BOM/mixed-EOL test fails before the fix and verifies the live synthetic observation and saved archive afterward. This fixes test fidelity, not a demonstrated native-runtime defect. |
| CR3 non-JSON eval literal parsing | 3, 8 | Qualified limitation | A synthetic valid-JavaScript but non-JSON literal before a selected module causes JSON.parse to reject. The bounded adapter accepts observed JSON-string webpack forms; no supported Next build exhibiting this form was reproduced. The second notification also requires selected/unknown malformed candidates to keep failing. Do not broadly swallow parse failures or claim expanded grammar support without a supported-output reproduction. Parser unchanged; retain the diagnostic for native discovery failures. |
| CR4 Windows process-tree shutdown | 4 | Deferred outside this cycle | Cycle 0011 explicitly validates macOS/local Node/Chrome/Next webpack. Windows process ownership and taskkill behavior require a separately validated platform extension. VS Code and Cursor remain mandatory hosts; neither implies Windows has been verified. |
| CR5 review finding count | 5 | Fixed | Correct the initial R1–R9 explanation to seven critical and two informational findings; the pre-fix score remains zero. |
| CR6 invalid UTF-8 assertion | 6, 10 | Fixed with corrected premise | Fatal TextDecoder throws the native TypeError before the later repository-owned round-trip check. Assert TypeError and ERR_ENCODING_INVALID_ENCODED_DATA instead of engine-message wording; do not claim the later product message occurs for this input. |
| CR7 timeout expected constant | 7 | Declined | AGENTS.md requires literal expected values. Keeping the 1000 ms assertion independent of the implementation detects an accidental budget change. |

The primary agent independently reproduced CR2 and the qualified CR3 grammar limitation. The OCR utility reviewer independently distinguished the fixture limitation and unsupported grammar from an in-scope native product defect. Its original zero-comment result is preserved rather than rewritten as an external finding.

## Targeted verification and limits

The extended existing BOM test now exercises prepare, synthetic click, live captured source, stop and readStudy. Its fixed expected bytes hash to `1859ebb4deb7f0440871f8ddbc3cea090984845ce0cfde0ab648ebb493bf01f2`. Red evidence: `coderabbit-fix-red.log`. An earlier test-authoring union error and the first post-fix use of the synthetic runtime ID instead of the service archive ID are retained in the red build and first full-run logs; both were corrected without relaxing production checks.

Full `pnpm --dir extension test` passes **384 tests, zero failed/skipped/cancelled** after the fixes. Log: `artifacts/cycle-0011/product-tests-coderabbit-v2-20260920.log`. New product inventory: dirty `7f52138`, **231 files**, SHA-256 `608696c3d5e5b32255b0c67ff3dc8dba1c79141e9b373b0c8f210d3587079c76`. A reused in-host reviewer inspected the three amended test/harness files and relevant source/archive checks with no additional finding. This targeted review is separate from the earlier provider snapshot; CodeRabbit has not re-reviewed these amendments.

## Repository review configuration

The owner subsequently requested a repository configuration. Root [.coderabbit.yaml](../../../../.coderabbit.yaml) now specifies Japanese review comments, English code/documentation suggestions, assertive review, incremental non-draft reviews, request-changes workflow, visible coverage details and failure status on review errors. It imports repository authority documents and explicitly maps the active cycle and approved design to relevant code.

Nineteen exclusions cover dependencies, build output, local agent state, private artifacts, browser reports, historical fixture copies, executed-source copies and archived media. Maintained experiment sources, product tests, test fixtures, lockfiles, Markdown evidence and JSON manifests remain eligible. A 24-case path sanity check verifies representative inclusion/exclusion behavior using Node's glob matcher; it does not claim execution of CodeRabbit's remote matcher.

An independent bounded policy review identified two missing-context risks; both were fixed by adding the active-cycle guideline and an explicit fallback for developer-home rules, local tools and private evidence unavailable to hosted reviewers. The root YAML passes `coderabbit config validate .coderabbit.yaml` against the current official schema. `coderabbit config --agent` discovers it as active YAML, hash `787cffe105d676bb47629257d77a0d7b532c6c2822ac54473f61f18834e70f64`. DEVELOPMENT.md records validation and explicit --config usage. This configuration was created after the provider run above; it was not retroactively used for that review and has not been verified in a hosted PR.

The configuration and operational documentation are committed locally as `a5cd28b` (two files only); no push or hosted-PR application is claimed.

At the provider-review cut, actual native execution and video/motion remained pending. Subsequent source amendments and actual-editor results are tracked separately in [native validation](native-validation-20260920.md). Complete layouts, packaged installations and full G01–G11 acceptance remain pending. The final sequential review gate remains **0/10**.


## Bounded v23 follow-up review

The owner-requested replacement channels were rerun for the uncommitted Return/reentry/focus change, against dirty `cabded4`, source inventory `469572e547b7adfe16bbdce4a06394e5010427458aaa8ccd0acaff4eb3bb548a`. CodeRabbit's root YAML validates again against its current CLI schema. `coderabbit review --agent --uncommitted --include-untracked` completes exit0 and reports all12 reviewed files. Three minor findings concern stale cycle handoff, native evidence current-build statement and native manifest. They are independently confirmed and addressed by synchronizing v23, current both-host results, cleanup and exact next action; failed/historical cuts remain preserved. No code finding is reported by this provider run. The updated record text has been manually checked; do not claim a new provider approval of the later documentation commit or hosted-PR application.

OCR `delegate preview --format json` selects6 eligible `(path,status)` entries; `delegate rule --format json` resolves their rules. Driving agent reads every eligible diff/new manifest and relevant context, finds no additional actionable defect, and records6 reviewed/0 skipped/100% eligible coverage. The other6 entries are explicit defaults:4 Markdown unsupported_ext and2 tests default_path. This eligible coverage does not certify those exclusions; CodeRabbit separately included all12. Private `return-layout-v23-ocr-review.json` preserves checklist, rules, hashes and exclusions. OCR itself calls no external LLM.

Implementation is committed as `e74f035` and source-equivalent across all232 validated entries. The full464-test result, independent newly created source reviewer, later independent native-image review and separate actual-editor outcomes remain distinct from provider/OCR review. The updated manifest verifies artifact hashes. This is a bounded follow-up, not another full GStack pass and not one of the ten final-product reviews. No push or hosted review is claimed.
