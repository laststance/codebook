# Cycle 0016 — Selected-input provenance repair

Date: 2026-09-21 JST. Review source: clean `24e64b1bfe666523b472966559be8aaeea6e4629`. The Claude Code adversarial review identified a P2 mismatch between inputs hashed by `readBuildIdentity` and changes visible to ordinary Git status. Independent isolated reproduction confirms it; no user/global Git configuration was changed.

## Reproduced defect and repair

Tracked `.gitignore`, repository `.git/info/exclude` and a configured excludes file can hide an added source input. `assume-unchanged` and `skip-worktree` can hide both edited bytes and deleted recursive inputs. These files still affect the selected build inputs, but the former helper returned `dirty: false` when status was empty. Stable before/after build snapshots do not prove equality with the named revision.

The helper now resolves one exact HEAD, reads its NUL-delimited tree inventory and compares each actual input's raw Git blob identity with that path. All actual input SHA-256 values remain in provenance, including ignored inputs. Missing/mismatched HEAD paths and deleted selected subtree entries force dirty, alongside the existing whole-repository status and narrow owned-scratch exclusion. It strips inherited Git routing overrides, bounds all Git output/time and supports SHA-1/SHA-256 object formats. Raw-byte comparison is conservative for clean/smudge or line-ending transformations: different materialized bytes are marked dirty.

Seven new behavioral cases fail against the original helper: three exclusion routes and edit/delete under each index flag. The repaired focused suite passes **11/11**, including existing owned-scratch, ambient routing and large-status boundaries. A separate SHA-256 repository regression preserves clean identity for a literal tab/Unicode source path. The full package/asset suite passes **65/65**, zero failures/skips/cancellations; logs remain in `artifacts/cycle-0016/ship-fixes/selected-inputs-*.log`. The subsequent [v8 supplement](installed-validation-v8.md) records fresh clean-commit 680/680 + 65/65 suites, the new archive and both-host installed-state verification.

## Existing artifact and review scope

The general defect does not imply contamination of [installed v7](installed-validation-v7.md). Independent mechanical verification finds **265/265** recorded input paths at exact `24e64b1` with identical raw blob SHA-256. Candidate/build/package metadata agree and the VSIX checksum matches. That exact artifact retains its separate two-host native evidence.

The outside structured report contains six P3 findings; the adversarial report contains one P2 and four P3 findings. The two initially prefix-truncated reports were recovered through their original provider sessions, not presented as fresh reviews. Every claim is classified in the private provider-triage report. The selected-input defect and G08/G09 source-cut precision are addressed. Other claims are documented existing constraints, disproved assertions or unproven hypotheses; optional negative coverage/secondary diagnostics are not asserted as current runtime failures. Current review convergence, formal GitHub approval, CI, merge and final product acceptance remain separate.

The follow-up changes package provenance and documentation, not extension runtime behavior. The v8 supplement compares every shipped runtime/asset byte to v7 and verifies the newly installed build identity, retained saved content and cleanup independently in both hosts. V7 motion is not re-labeled as a newly recorded source cut.
