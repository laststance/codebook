# Cycle 0028 — 0.2.8 package checkpoint

Date: 2026-09-26. Development validation only; no D029 Stage 1/2 credit.

- Source: clean `b11b25dad83bf00e05047e83fd6ec516054e4885`.
- Extension: 0.2.8; bundled skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- VSIX: `artifacts/packages/codebook-0.2.8.vsix`, SHA-256 `dd665a3deacdb8660b8c887eb0897ea2fb956164bc0a5c7f601feeae3910e110`, 918148 bytes. The package checker accepted its source identity, isolated module load and 35 entries.
- Extension tests: 966/966 passed. Package regression tests: 101/101 passed. Compiled Chromium bootstrap checks: 13/13 passed with delayed simulated host snapshots.

The bootstrap checks cover safe initial paint and rendering, not the new narrow Live disclosure transition. Installed narrow-viewport, learner reopening, keyboard and motion evidence remain pending in VS Code and Cursor. No native result or acceptance row is claimed.
