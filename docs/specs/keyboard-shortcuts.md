# Keyboard shortcuts and discovery

Authority: PRODUCT_GOAL version 9, G07/G11 and D035. This is a required product contract; current keyboard bindings and implementation are not claimed here.

## Every assigned shortcut is visible

- A Codebook action with a shortcut shows its operation name and applicable key combination in the associated UI tooltip. Match the owner's reference: plain operation text followed by a distinct key label.
- Make the tooltip available on pointer hover and keyboard focus. Provide a meaningful accessible name independently of the tooltip; a shortcut alone is not an action label.
- Use the correct editor/browser, platform notation and active feature context. Tooltips, the list and actual behavior must agree. Account for supported rebinding and conflicts; do not present a known stale/default binding as the current one.
- Do not fabricate shortcuts for unassigned actions. Native editor controls keep their host-provided behavior and key labels. The supplied Codex screenshot does not assign Cmd+B or any other Codex binding to Codebook.

## Question-mark shortcut list

Press **?** in a Codebook-owned, non-editing UI context to open **Keyboard shortcuts**. Provide a visible **Keyboard shortcuts** control with a **?** key label and matching tooltip. The generated browser Wiki offers the same discovery pattern independently of runtime/debug MCP.

Use the owner's reference structure: a titled, searchable list with operation names on the left and their key combinations on the right, grouped by relevant feature. Include the help-opening shortcut itself. Only list real assigned actions and identify their applicable context. An empty search clearly says that no shortcuts match and allows the query to be cleared. Generation of a Wiki does not imply that browser-only bindings can invoke arbitrary native editor commands.

The list is a keyboard-accessible dialog. Opening places focus inside it; search/filtering and scrolling work by keyboard; Escape and a clearly labeled close control dismiss it. Closing returns focus to the invoking control/context without changing the replay playhead, reading position or learner state. Repeated **?** must not spawn duplicate dialogs. The exact search/index mechanism is an implementation choice.

## Preserve normal typing and host behavior

The unmodified **?** shortcut applies only when a Codebook UI context is active and the user is not editing text. Do not intercept question marks in chat, Wiki questions/search, source editing, terminals, other text inputs/contenteditable fields or IME composition. No global system binding or replacement native chat/debugger shortcut is authorized.

The visible list control and ordinary host command discovery provide access when text focus makes **?** inappropriate. Respect active context, unavailable actions and existing user key assignments. Supported binding resolution, event routing and host APIs must be established during engineering implementation rather than inferred from this specification.

## Required acceptance

At D034's ordinary expanded desktop-window baseline, verify in both VS Code and Cursor and in the generated browser Wiki:

1. Each assigned Codebook shortcut has a discoverable tooltip containing the operation and correct key combination; hover and keyboard focus both expose the information.
2. **?** from the eligible UI context opens the shortcut list; the visible control does the same. The operation/key entries match actual bindings and available contexts.
3. Search, keyboard navigation, close/Escape and focus return work. Replay time, source/debugger identity and reading context remain unchanged.
4. Typing **?** in editable contexts and during IME input inserts/composes text normally and does not open the list.
5. Check platform notation, supported binding changes/conflicts, disabled states and a no-match search. Do not claim a shortcut works because its label is drawn in a mockup.

Keep ordinary keyboard, focus, theme, contrast and reduced-motion checks. Extremely small windows and extreme zoom are outside required coverage under D034. Record actual interaction and inspect video frames where motion/focus transitions matter.
