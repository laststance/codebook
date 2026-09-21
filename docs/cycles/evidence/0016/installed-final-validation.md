# Final delivery package supplement

Observed: 2026-09-21 JST. Result: **bounded supplement passed in both ordinary hosts, with existing console/UX qualifications retained**. The [frozen schedule](installed-final-schedule.md) and [51-file private-artifact manifest](installed-final-manifest.json) define this supplement. It does not replace the complete [v4 workflow](installed-validation-v4.md) with an unperformed new checkout.

## Exact candidate

- Clean source commit: `822b1ca219e88cfd62c57676dd450850d22e88d1`; source fingerprint: `25da6ccf0b597f0fbfa82faf4c72fb81763408e2a028ab44b9ba989930e89c94`; dirty=false.
- Extension 0.2.1 / API 1.5; root release metadata 0.2.1.0.
- VSIX: `artifacts/packages/codebook-0.2.1-installed-final.vsix`; SHA-256 **`5f4555fd94bf366f23de3c58a7ec439b762f36d56c690bfd635b2f7878d5e583`**; 588,334 bytes; 31 archive entries; 3,173,992 unpacked bytes; build 7,298 ms.
- Every runtime/demo/icon archive entry matches v4 exactly. Only `extension/dist/build.json`, `extension/package-manifest.json` and `extension/readme.md` differ. Runtime bundle SHA-256: `adf467c6901db4f439a9abca096afc0c5d06de019c3e682f51f09225212e8af9`.
- Both ordinary CLIs installed and reinstalled these same bytes. All 29 installed extension files match the archive, accounting separately for installer-added manifest metadata. These are private local installation results, not Marketplace publication or a post-merge CI artifact identity.

## Independent host results

| Check | VS Code | Cursor |
| --- | --- | --- |
| Host version / API | 1.138.0 / 1.138.0 | 3.21.16 / 1.128.0 |
| Host commit | `7debcd0e2acdea1c52de81bf9ee1620444407dda` | `8ae78e8eee1e63479c7e0504b664bc0a80c68000` |
| Native renderer recording | 1440×900, 12 fps, 55.250 s | 1280×800, 12 fps, 46.083 s |
| Launch to external discovery | 14.463 s | 13.382 s |
| Host activation log to discovery | 13.355 s | 11.401 s |
| Start Agent Server Enter to discovery | 4.046 s | 0.776 s |
| Saved recording position | 1,048.701708 ms, paused | 1,272.830084 ms, paused |
| New application runs | 0 | 0 |
| Normal window exit / remaining owned processes / descriptors | 0 / 0 / 0 | 0 / 0 / 0 |

Each host starts a fresh ordinary process against its retained v4 profile/workspace. No extension-development/test launch flags, injected product code or in-memory replacement storage are used. A real external SDK client confirms the exact final build, a new server instance and no active application run. Discovery intervals include native UI, tooling and client overhead; they are operational wall times, not isolated activation CPU measurements or evidence of a speed improvement.

The exact unsaved unrelated draft visibly reopens. The saved `installed-checkout-v4` book opens its order-creation article and matching source citations. The finalized recording still contains four observations. Opening and seeking its first observation restores the exact recorded phase PNG, captured source, interpretation, paused time and manually checked understanding (1/4). Selecting Study confirms the shared presentation without executing an application. Native Wiki screenshots and four extracted frames from each video were visually inspected: retained draft, intermediate command/native layout, then application above captured source beside Study with a paused timeline. The samples do not establish a new full motion/UX matrix or OS compositor recording.

Only each owned window was closed. Cursor's normal close confirmation was accepted without changing its settings. After zero window exit, the exact remaining idle application shell was terminated; no owned process or descriptor remains. Saved draft text stays unchanged and the 324-byte unsaved backups retain their original hashes: VS Code `f20536198f3e8d74572dc7b21ae4539c2afb9e5b3db0e100453b0ad09a4dd8dd`, Cursor `05d63bf7d5cd32747797fe95e05be314463cbbb842fe439c52666d9effc557f4`.

## Qualifications and availability

This is not a console-clean claim. VS Code reports two copies of a `url.parse()` deprecation warning; Cursor reports fifteen error-level messages including TrustedScript, hooks, deprecation, unauthenticated account services and Codebook view-descriptor ordering. The earlier [startup control investigation](cursor-console-investigation.md) retains its attribution limits; successful bounded behavior does not resolve the descriptor-ordering concern. Small-pane reading, transient native movement, broader installed repository execution and integrated G01–G11 acceptance remain open.

Private evidence remains in the original checkout under `artifacts/cycle-0016/native/<host>/final-*`, together with `installation-final.json`, the package receipt and the runtime comparison. The manifest records exact hashes and locations without connection credentials. Current source suites separately pass **674/674 product/shared tests** (71.059 s) and **47/47 package tests** (10.718 s), serially, with zero failures/skips/cancellations. Review/CI/merge are separate delivery gates. Final product reviews remain **0/10**.
