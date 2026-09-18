# Cycle 0006 webview QA — first pass

Scope: actual generated context / moments / historical-app HTML in isolated Chromium. The host message adapter is a deterministic fixture populated with the real native run's archive; host execution and persistence are separately tested in VS Code and Cursor. This is not native editor visual acceptance. No optional animation is implemented.

Driver: GStack headless browse for orientation; Playwright CLI for keyboard and viewport evidence. Aside is unavailable. URL: http://127.0.0.1:62129.

## Findings recorded during exploration

### QA-001 — Checkbox helper and linked items visually run together

Severity: low. Category: visual. On the context page, the understanding helper touches its label and the two source-flow buttons touch each other. Screenshot: screenshots/initial.png. Reproduced at full width and 360 px. The buttons remain individually operable, but the missing separation impairs scanning.

### QA-002 — Sticky runtime controls obscure focused content at 200% zoom

Severity: high. Category: accessibility. At a 360 × 768 context viewport with 200% content scale, the sticky runtime strip is 790 px tall. Focusing the understanding checkbox scrolls it to y=364 while the overlay extends to y=790, covering the focused control. Reproduced twice. Screenshot: screenshots/zoom-focus-obscured.png; geometry: layout-result.txt. Keyboard navigation reaches the control but the learner cannot see it at the required scale.

### QA-003 — Content tabs have no associated tab panels

Severity: medium. Category: accessibility. The accessibility tree exposes three tabs, but no tabpanel or aria-controls target. Arrow keys visibly switch content, yet assistive technology lacks the tab-to-content relationship. Reproduced after reload. Evidence: screenshots/initial.png; DOM accessibility observation: tabs=3, panels=0, aria-controls=null.

## Results

20 behavior checks passed through the real generated HTML and a fixture host-message bridge. Actual execution/persistence is not claimed by these browser checks. No console/page errors. Checked context, moments and exact historical-image pages; states: observed server, current browser with selected server history, unobserved, loading, failed save, unsafe literal interpretation. Five theme/size configurations: 520/360/280 px, dark/light/high contrast and 200% scale. No page horizontal overflow; table field names wrap heavily in the smallest pane. Screenshots inspected. No animation exists; no motion-acceptance claim.

Provisional component health: 95/100. Console100 (15), Visual97 (10), Functional100 (20), UX100 (15), Content100 (5), Accessibility77 (15); Links/Performance untested and excluded. Native composition, actual editor window sizes, real screenreader output, and intended-use feedback remain unverified. No fixes applied during this report-only pass. Top priorities: QA-002, QA-003, QA-001. No additional durable learning outside these recorded defects.

## Implementation verification after report-only audit

The following work occurred after `/qa-only` ended. `/investigate` traced QA-002 to a sticky strip taller than the viewport at 200% scale. The strip now flows with content when it exceeds 35% of the visible height. Repeated original reproduction: checkbox y=364; strip bottom=-2746, position=static; focused checkbox visible in screenshots/zoom-focus-visible.png. QA-001 helper/flow separation and QA-003 tabpanel/roving-tabindex associations were corrected in the same two UI files. Original screenshots remain.

Regression: 22 browser flow checks passed, including accessible Live panel and single selected Tab-sequence entry. All five size/theme configurations retain zero whole-page horizontal overflow; focus is unobscured in each. Compare flow-after.txt and layout-after.txt. Product Node tests 42/42 passed. Component score for the same bounded categories after these fixes: 100/100 provisional; this is not a score for the extension or final product. Native pixel acceptance and actual screenreader use remain unverified.

## Implementation review regression

The subsequent code review found flow-button focus loss while the selected observation loading container was hidden. Navigation now lives outside that container. The current compiled HTML passes **24/24 interaction checks** (`flow-review-after.txt`), including focus before/during/after selection loading. Five layout/theme/zoom cases again show no whole-page horizontal overflow and keep the focused checkbox visible (`layout-review-after.txt`). Compact light/200-percent screenshots were inspected. This remains a simulated host-message bridge over actual HTML, not editor-native visual acceptance.

## Final reader regression

The selected-study terminal outcome/reason and current-source-unavailable labels are now explicit. The generated HTML passes **27/27** browser checks, including retired partial history and unavailable unobserved-source understanding. Layout/theme/200-percent scale checks were repeated after the status addition. The semantic-message ACK race in the driver is documented in `ack-race-report.md`. Node controller tests cover actual failed understanding save/retry and cold history; this browser bridge does not simulate their persistence as native evidence.
