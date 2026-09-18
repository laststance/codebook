# Native layout API investigation

Scope: public editor API behavior in dedicated development-host profiles. No screenshot, product UI or independent native visual acceptance claim.

- Attempt 1: fractional sizes. Both hosts expose the requested three-leaf group tree and preserve the unrelated dirty document. A hard-coded column assertion fails after moving the source: its empty group collapses and context/source renumber to column 2. Cursor sizes are subpixel.
- Attempt 2: omit sizes and track source plus context identity. VS Code passes including owned-tab close; Cursor's implicit half-unit sizes remain subpixel, failing a geometry guard.
- Attempt 3: omit sizes and explicitly run `workbench.action.evenEditorWidths`. Both hosts pass: two positive-width columns, app/source positive heights, native read-only source, moved source joined to context, unrelated dirty draft unchanged after owned closure. Cursor's before-distribution values preserve the failed behavior as evidence.

Implementation consequence: initial/explicit arrangement may set the topology then distribute; content updates must never repeat arrangement. Source URI/tab and panel handles own identity, not view-column numbers. More foreign groups require separate product ownership tests.

Sources: installed workbench command handlers (`vscode.setEditorLayout`, `vscode.getEditorLayout`, `arrangeGroups`) and [official command API](https://code.visualstudio.com/api/references/commands). The installed Cursor grid deserialization differs from VS Code; no upstream bug classification or universal-version claim.

Versions: VS Code 1.138.0; Cursor API 1.128.0. Probe runs completed; owned development editor processes exited. Scripts are one-off API experiments, not shipped extension code. Results contain no profile paths or credentials.
