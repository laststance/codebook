# Cursor startup console investigation

Date: 2026-09-21 JST. Scope: C16-QA-005 from [ordinary installed v4](installed-validation-v4.md). Result: **common host errors reproduced without Codebook; Codebook view-descriptor ordering remains inconclusive**. No product code or user settings changed.

The hypothesis was frozen before execution: repeat startup in the same Cursor 3.21.16 / API 1.128.0 application with a new ordinary profile, an empty extension list and a minimal local workspace. TrustedScript, hook parsing and unsigned-in account errors should reproduce independently if they originate in the host. An empty profile has no saved Codebook view to restore, so absence of its descriptor error cannot clear that separate concern.

The native control reproduces TrustedScript assignment blocking, project-hook parsing and unauthenticated transport/account errors with Codebook absent. The inspected screenshot shows the ordinary empty Cursor workspace. Control-only analytics/network retry failures are retained separately; they do not alter the original v4 QA score. The missing `workbench.view.extension.codebook` descriptor message does not occur in this fresh profile.

A read-only inspection of Cursor's installed workbench source identifies the logging condition: sidebar restoration has a saved active view-container ID but its composite registry has no matching descriptor. This does not prove why registration and restoration occur in that order. Codebook's view IDs are unchanged by this branch; both original v4 launches subsequently display working Codebook panes. No demonstrated product failure justifies a speculative repair or console suppression.

The ordinary window exits 0. Four exactly identified owned profile processes reach zero, including explicit retirement of its idle main process. Other editor profiles are untouched. Private evidence is under `artifacts/cycle-0016/cursor-console-probe/`: `expectation.json`, `launch.json`, `exit.json`, `shutdown.json`, empty `installed.txt`, `result.json`, `startup.png` and `startup-console.log` (1,521,562 bytes). Its separate manifest preserves artifact hashes; this later investigation is not part of the earlier 197-file v4 manifest.

Keep C16-QA-005 qualified for the descriptor event. Reopen with an observed functional failure or captured native registry/restoration timing, not another unchanged empty-profile startup. The v4 native workflow and its historical console report remain separate evidence.
