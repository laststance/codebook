# Codebook host event recorder

A development-only VS Code / Cursor extension. It records the editor host's tab-group events (public APIs only) into one JSONL trace per take, so Codebook's workspace test harness can replay the order the real host used.

It is not part of `extension/`, its build graph or the Codebook VSIX; `extension/scripts/check-package.mjs` refuses a VSIX that contains it.

## Package

From this folder, with the repository's pinned vsce:

```sh
node ../../extension/node_modules/@vscode/vsce/vsce package --no-dependencies
```

## Install

Install the resulting `.vsix` into the QA profiles only (never your daily profile).

## Take procedure

1. Open the target repository as the workspace folder.
2. Run `Codebook Dev: Start Host Event Recording` and type the sequence name (for example `arrange-restore`).
3. Before each step of the sequence, run `Codebook Dev: Mark Host Event Recording` and type the step's label (for example `open-study`, `arrange`). A mark is written as a `mark` event followed by a snapshot, and the replay cuts the take into windows between marks. Perform the step in the editor. A Reload Window is fine: the recorder resumes the open take of that workspace (the mark is kept in the workspace's own state, so another folder never resumes it), ends a last line that a crash cut off (a complete line gets its newline, an incomplete one is removed), writes a `reload` event naming the unrecorded interval, then a fresh snapshot. Sequence names and mark labels may hold letters, digits, `.`, `_`, `-` and space, up to 64 characters.
4. Run `Codebook Dev: Stop Host Event Recording`. It waits for pending layout reads and writes a final `tabGroups` and `editorLayout` snapshot.

## Where takes land

`<workspace folder>/.codebook-host-traces/<sequence>-<host>-<version>-<timestamp>.jsonl`. This folder is private output and a take is never committed as recorded. It is git-ignored only in Codebook itself, so the recorder writes a `.gitignore` containing `*` into the folder when it starts a take (an existing `.gitignore` is never overwritten). A failing write is shown as an error message and the take stays open.

Before a trace enters the repository, run it through `node extension/scripts/sanitizeHostTrace.mjs <take.jsonl> <out.jsonl> --repository <path>`. The script re-applies the sanitizer (file URIs inside the repository become repository-relative paths, a `codebook-source:` document keeps its file name, every other absolute URI is left out, labels of tabs outside the repository and of tabs without a resource of kind `unknown` or `terminal` become their input kind, and each event keeps only the fields its kind defines) and refuses a trace that still holds an absolute path (POSIX, Windows, UNC, `~`, percent-encoded, also as an object key), a home folder or a user name (whole words, any letter case; `lume` always). The committed fixtures are those sanitized copies.

## Trace format

One format, written by `traceFormat.js` and read by the replay parser `extension/src/tests/utils/hostTraceReplay.ts` (the contract). The header names `formatVersion`, `host`, `hostVersion` (the product version from `product.json`, because `vscode.version` is only the VS Code API version, kept as `hostApiVersion`), `os`, `sequence`, `codebookVersion`, `recorderVersion` and `startedAt`. Tab and group events name a group by its index in the tab-group list; a `uri` is a repository-relative string. Every event is followed by a full `tabGroups` snapshot with its `activeGroupIndex`.
