# Cycle 0029 product specification image prompts

Status: current version 8 candidate; the owner approved the replay hierarchy in D032, not the entire generated visual. No image is runtime evidence.

Generated with the built-in image-generation tool on 2026-09-26. The GStack design binary was unavailable. Six sequential iterations develop one direction, not four selectable product themes. Prior images remain in local GStack review artifacts; only the current corrected version 8 candidate is committed. Actual dimensions/hash are in the companion visual specification.

## 1. Initial version 7 generation — superseded

```text
Use case: ui-mockup
Asset type: One final-product specification candidate board for the Codebook IDE extension, for an implementation design review. This is ONE coherent product design, showing THREE DISTINCT functional screens at different times, not three alternative styles or modes. Create a polished, precise, readable, high-fidelity desktop UI design board. Portrait canvas, ideally 2160 x 3840, three large landscape screenshots stacked vertically with generous narrow margins. Use sharp text and realistic VS Code native chrome and flat editorial layout. No decorative marketing art.

Top heading: "Codebook"
Subtitle: "Explain code. Save the learning. Explore the project."
Small top-right label: "Product specification • Candidate"
Three section headings exactly: "Live explanation", "Learning replay", "Independent LLM Wiki".
Each is a separate large framed screenshot, with a short caption below. Use a single restrained dark neutral Codebook design vocabulary throughout, native blue controls, clear white text, warm yellow ONLY for actual debugger pause highlighting. No theme selector, no 01/02/03 mode names, no neon, gradients, glass, pill grids or excessive cards. The embedded real application may have its own white page.

SCREEN A — Live explanation, actual VS Code window for "nextjs-dashboard".
Show native vertical Activity Bar on the far left, including an outlined book icon for Codebook. Standard native Run and Debug sidebar, not a Codebook values card: headings "VARIABLES", "WATCH", "CALL STACK", "BREAKPOINTS". Native Variables contains illustrative "amount: 120", "amountInCents: 12000", "status: 'pending'". Selected stack is "createInvoice".
Main editor region: actual application browser above actual TypeScript source. The browser URL is localhost:3000/dashboard/invoices/create. App is a straightforward dashboard called "Acme" with simple nav Home, Invoices, Customers. Content title "Create Invoice", fields "Choose customer", "Choose an amount", "Set the invoice status", radio Pending/Paid, and blue "Create Invoice" button. Use fictional neutral "Example customer", amount 120.00. No cart, tote, products, checkout or fake ecommerce project.
Below the application, native source editor tab "actions.ts", breadcrumb "app > lib > actions.ts > createInvoice". Realistic source fragment:
const { customerId, amount, status } = validatedFields.data
const amountInCents = amount * 100
const date = new Date().toISOString().split('T')[0]
try {
  await db.insert(invoices).values({
    customerId,
    amount: amountInCents,
    status,
    date,
  })
}
Highlight the "await db.insert..." line with a genuine native paused line treatment and gutter marker. Include the ordinary debug continue/step toolbar.
Right side is STANDARD NATIVE EDITOR CHAT, clearly headed "Chat", not a Codebook explanation panel. User bubble: "/codebook Explain what happens when I create an invoice."
AI answer in readable short paragraphs: "The form has reached createInvoice." "Validation has passed. The amount is converted to cents." "Execution is paused before the database insert. Continue to follow the redirect."
Use native chat input at bottom. A small Codebook recording status near the chat/footer reads "Recording explanation" with an unobtrusive "Save learning replay" action. No second custom Variables/Values table anywhere. Caption below screenshot: "Use the editor's chat, source and debugger. Save the explained session as learning."

SCREEN B — Dedicated learning replay screen in VS Code, a different moment with NO LIVE DEBUGGER, NO CHAT and NO LIVE APPLICATION WINDOW surrounding it.
Codebook book Activity Bar icon selected. Codebook left sidebar includes "Learning", list item "Creating an invoice", and separate "LLM Wiki" entry with small actions "Open Wiki" and "Update LLM Wiki". This is functional navigation, never a mode/theme switcher.
Main editor tab "Creating an invoice • Replay". Title "Creating an invoice"; secondary label "Saved learning · nextjs-dashboard"; small status "Recorded session".
Clearly prioritized content:
- "Summary" with concise prose: "The form validates input, converts the amount to cents, writes an invoice, and returns to the invoice list."
- "Sequence" with a TRUE UML-LIKE SEQUENCE DIAGRAM, not horizontal flowchart cards. Four vertical lifelines headed "Invoice form", "createInvoice", "PostgreSQL", "Invoice list"; horizontal directional messages label "Submit", "Validate", "Insert invoice", "Return to list". Highlight the currently selected message subtly blue. Solid vs dashed message distinction with small legend "Recorded evidence / Source-derived". No invented checkout arrows.
- A selected recorded moment region combines a recorded application frame thumbnail and a concise saved explanation with clickable source link "app/lib/actions.ts · createInvoice". Make clear it is a recorded frame, not a running browser.
- Timeline with Play icon, elapsed/total time and distinct stop markers; example "00:42 / 02:18". Small optional explicit learner checkbox "I understand this step", unchecked.
Do not display a custom runtime values grid, live debugger controls, a chat composer or Wiki page in this replay screen. Caption: "Replay the explanation with its summary, sequence, source and recording."

SCREEN C — Independent DeepWiki WEBSITE in a regular WEB BROWSER, outside IDE chrome. It is not a debugging pane or a saved lesson.
Browser address "localhost / nextjs-dashboard / wiki". Site masthead "nextjs-dashboard Wiki", compact "Generated from source" label. Left documentation navigation: Overview, Architecture, Authentication, Invoices, Data layer. Article titled "Invoice creation", breadcrumb "Invoices / Creating an invoice". Main reading column has introduction, processing explanation, a small source-derived sequence diagram, and "Source references" with a blue source link "app/lib/actions.ts" and clear action "Open in VS Code". Optional host switch label "Editor: VS Code" as a small ordinary select. Right rail is "On this page": Overview, Input validation, Database write, Source references.
A calm status strip reads "Source changed · Update available", with a clear "Update LLM Wiki" button. A small settings area or footer indicates "Output: project folder" and "Change location". These are candidate affordances, not a live runtime. This Wiki needs no debugger, application browser, saved replay, lesson progress or original chat.
Caption: "Generate and update a standalone Wiki. Open source links in your editor."

At the bottom of the board, one restrained sentence: "Live explanation → saved learning. Wiki generation is independent."
Tiny footer: "Design concept • Illustrative states, not runtime evidence • Same feature contract in VS Code and Cursor"
Ensure the board shows actual usable screens with enough source, chat, sequence arrows and navigation legible to serve as an implementation reference. Avoid making all features exist in one simultaneous IDE layout. One design family, no alternate visual variants. All text in English.
```

## 2. Initial factual correction — superseded

```text
Edit this existing Codebook product specification candidate board. Preserve its overall three distinct functional screens, host-native editor style, layout quality, typography, and all core functionality. This is one product direction, not three themes or selectable layouts. Make these factual corrections carefully in BOTH sequence diagrams and the saved recording illustration:

1. Correct control flow: use FOUR participants labeled "Invoice form", "createInvoice", "PostgreSQL", "Invoice list". Draw a Submit message from Invoice form to createInvoice; a Validate self-message on createInvoice; Insert invoice from createInvoice to PostgreSQL; a short dashed Result arrow from PostgreSQL BACK to createInvoice; then Redirect from createInvoice to Invoice list. Absolutely NO arrow from PostgreSQL to Invoice list. The createInvoice server action owns the redirect. In the saved learning sequence, highlight the Insert invoice message.
2. The selected recorded moment is PAUSED BEFORE the insert. In the replay explanation pane use exact short wording: "Before database insert" as heading, then "Validation has passed. The amount is converted to cents. Execution is paused before the insert." Avoid saying this selected frame proves the invoice has already been written. The overall lesson summary can explain the complete source flow separately.
3. All invoice amount examples must match: live form amount "120.00", native debugger amount 120 and amountInCents 12000, recorded thumbnail amount "120.00". No 130.00 or other amount. Use "Example customer" only.
4. The Wiki output section should say "Output: project folder" and "Change location". Remove the invented literal "./.codebook/wiki" directory path. The exact folder name has not been decided.
5. Make source code readable and match this source-derived example snippet exactly with line numbers omitted rather than invented:
const amountInCents = amount * 100
await db.insert(invoices).values({
  customerId,
  amount: amountInCents,
  status,
  date,
})
Highlight the await line for the before-insert pause.
6. Preserve standard editor Chat, native debugger Variables/Watch/Call Stack on the live screen; no new Codebook variables panels. Preserve independent full-page browser Wiki and its source links, Update LLM Wiki control, navigation and source-changed status. Preserve separate saved-learning editor tab and explicit "I understand this step" action.
7. Keep the board title "Codebook" and "Product specification • Candidate". Keep footer clearly stating "Design concept • Illustrative states, not runtime evidence • Same feature contract in VS Code and Cursor". All UI English. No marketing hero, no gradient decorations, no extra variants.

The purpose is an implementable specification illustration with accurate causal arrows, not proof of an actual live run. High-resolution portrait board, carefully legible labels.
```

## 3. Owner-approved replay hierarchy, version 8

D032 requires synchronized recorded application, historical executed source and native debugger values/stack; the live chat position becomes the learning summary. The prior document-like replay was rejected.

```text
Update this Codebook product-specification board to reflect the owner's corrected learning replay requirement. This is ONE coherent product with three distinct feature screens; not selectable themes. Keep the overall high-quality portrait board and the top Live explanation and bottom Independent LLM Wiki concepts. The most important correction is REPLACE THE ENTIRE MIDDLE LEARNING REPLAY SCREEN:

The learning replay UI must inherit the top live explanation screen's arrangement. Left: the editor's STANDARD Run and Debug sidebar showing recorded Variables, Watch and Call Stack, not a custom Codebook values panel. Center upper: large recorded application frame showing the Create Invoice form. Center lower: the corresponding historical native source editor, file actions.ts, exact executing await line highlighted. Right: where the standard Chat pane was in the live screen, display a Codebook-owned pane titled "Learning summary". This is recorded summary/explanation content, not a live chat composer. The replay must visibly prioritize watching the application together with source AND historical debugger values. DO NOT show the previously generated broad document/article replay screen. No giant sequence diagram replacing application/source. No narrow thumbnail standing in for the application.

Middle screen labels and content:
- Screen heading above: "Learning replay · Time-travel debugging"
- Native debug session dropdown at left: "Replay: Creating an invoice"
- Historical Variables: amount 120; amountInCents 12000; status 'pending'. Call Stack includes createInvoice. Label recorded state clearly.
- Main tab header: "Creating an invoice · Replay"
- Application recorded frame: "Recorded application · 00:42". Form values must all be 120.00, Example customer, Pending.
- Historical source header: "actions.ts · Recorded source". Exact simplified code:
const amountInCents = amount * 100
await db.insert(invoices).values({
  customerId,
  amount: amountInCents,
  status,
  date,
})
Highlight the await line. Omit tiny invented line numbers when practical.
- A conspicuous shared replay toolbar spans the middle screen bottom: previous step, play/pause, next step, scrubber, "00:42 / 02:18", status "Recorded state · Before database insert". Include a "Jump back" control or obvious backward-step icon. This single timeline synchronizes video, historical executed source, debugger variables and call stack. Never imply this re-runs the app or sends another purchase request.
- Right Learning summary pane: "Creating an invoice" title, brief overall summary "Validate input, convert the amount to cents, insert the invoice, then redirect." Then a small readable true sequence diagram with Invoice form, createInvoice and Database lifelines; Submit from form to action, Insert from action to database, dashed Result back to action, Redirect from action back to form. Below: selected moment heading "Before database insert"; concise explanation "Validation passed. The amount is converted to cents. Execution is paused before the insert." Then source link actions.ts and unchecked "I understand this step".
- Replace caption under middle screenshot with "Replay the application, executed source and native debugger state together. Revisit any recorded step."

Top live screen minor boundary correction: move "Recording explanation" and "Save learning replay" OUT OF the native Chat composer/panel and into the editor-wide bottom status/toolbar, clearly owned by Codebook. Preserve the native Chat conversation with app + source + native debugger. Do not invent custom chat widgets.

Bottom independent Wiki remains a normal separate browser-readable full-project website, with navigation, source-derived explanations, Update LLM Wiki, Source changed, Output: project folder / Change location and Open in VS Code. Preserve corrected sequence causality: database result returns to createInvoice, which redirects. No dependency on replay, recorded data, debugging or app runtime.

Update board title label from "Product specification • Candidate" to "Product specification v8 • Candidate". Keep "Codebook" and concise top tagline. Footer main message: "Live explanation → synchronized learning replay. Wiki generation is independent." Small footer: "Design concept • Illustrative states, not runtime evidence • VS Code and Cursor". All UI English. Flat native desktop details, calm hierarchy, no decorative gradients, no extra theme variants. Aim for large legible high-resolution output and distinctly accurate middle screen geometry.
```

## 4. Sequence causality correction

The third image still drew the compact summary's redirect line from the database. This edit makes redirect a self-call on createInvoice. It preserves the selected hierarchy and does not approve any pending control placement.

```text
Make one precise factual correction to this existing Codebook v8 product specification board. Preserve the entire design, all three feature screens, every layout, all labels and amounts, especially the synchronized middle replay with native debugger, video, source and summary. ONLY change the small sequence diagram inside the middle Learning summary pane. It has three lifelines: Invoice form (left), createInvoice (middle), Database (right). Keep Submit from Invoice form to createInvoice, Insert invoice from createInvoice to Database, and the dashed Result returning from Database to createInvoice. DELETE the existing long horizontal Redirect arrow below these messages. Replace it with a small self-call loop attached ONLY to the createInvoice middle lifeline, labeled Redirect. The database must not originate any Redirect line. No Redirect line may touch or begin at the Database lifeline. The createInvoice action owns redirect. Keep the Wiki diagram's currently correct createInvoice-to-Invoice-list Redirect arrow unchanged. All other pixels/content/composition should stay as close as possible to the source. High-resolution portrait output, English UI, candidate concept, not runtime proof.
```


## 5. Reproduce DeepWiki itself

D033 records the owner's exact DeepWiki reproduction requirement. The inspected official repository-reader screenshot was supplied as a visual reference alongside the prior board.

```text
Edit the portrait Codebook product-specification board shown in the recent images. The other recent image is an actual landscape screenshot of DeepWiki (microsoft/vscode): use it as the visual reference for the BOTTOM Wiki screen only. Preserve the TOP live explanation and MIDDLE synchronized time-travel replay EXACTLY in composition and meaning: native debug left, application and source center, live Chat or recorded Learning summary right, bottom recording/save or shared replay controls. Preserve sample 120.00 and corrected sequence causality.

The owner explicitly says the LLM Wiki MUST REPRODUCE DEEPWIKI ITSELF. This is not generic wiki inspiration. Revise the bottom third to closely reproduce the actual DeepWiki repository reading experience from the landscape reference, adapted to a locally generated nextjs-dashboard Wiki:
- Heading above the third screenshot: "LLM Wiki — Reproduce DeepWiki"
- An actual normal browser frame, local Wiki address, light near-white reading surface.
- Inside header: "DeepWiki" followed by "nextjs-dashboard". A small "Local · Codebook" label communicates the local generated product.
- Narrow left column with "Last indexed · source revision" and an indented hierarchy of text chapter links, matching the reference's restrained rows, not colorful icons/cards: Overview; Repository structure; Architecture; Authentication; Invoices; Creating an invoice (selected); Data layer.
- Center column is a substantial technical article, heading "Creating an invoice", a collapsible "Relevant source files" row, readable source-derived paragraphs, a small architecture/sequence illustration and inline source citation chips such as "app/lib/actions.ts". Do not copy the reference's VS Code prose. Use the source-derived invoice example already in the board.
- Right column "On this page" with section anchors. Above it place a compact "Source changed" status with the APPROVED "Update LLM Wiki" button; this button initiates update in the bound editor while normal Wiki reading remains independent. Include a compact "Open in VS Code" source action and "Output: project folder · Change location" without dominating the reading experience.
- Near the bottom of the Wiki article area, use DeepWiki's recognizable wide anchored question composer, like the reference. It must visibly say "Ask about nextjs-dashboard..." with a send arrow and a short small label "Source-grounded answers". This represents functioning repository Q&A, not a decorative search field. Keep source citations/navigation still visible.
- Match DeepWiki's restrained three-column reader hierarchy, spacing, typography and near-white neutral surfaces. Do NOT reimagine it as a marketing dashboard, feature cards, custom colorful wiki, or lesson replay.
- Caption immediately under the browser: "Reproduce DeepWiki: project chapters, diagrams, source citations and repository Q&A."
- Footer main message: "Live explanation → synchronized learning replay. DeepWiki is independent."
- Small footer remains "Design concept · Illustrative states, not runtime evidence · VS Code and Cursor".
- Board title remains Codebook and "Product specification v8 · Candidate". English UI, high-resolution portrait, calm native details. Exactly ONE specification board with three functionally separate screens, never three theme variants.

Important: keep the middle replay summary's Redirect as a self-call on createInvoice, never a database-originated redirect. Preserve bottom native capture/save outside chat. This edit primarily changes the Wiki screen to demonstrate the explicit DeepWiki reproduction requirement.
```

## 6. Skill-first ownership and diagram correction

The owner clarified that the editor AI's generation skill is the primary Wiki implementation. This iteration replaces hosted-Devin promotional actions with agent-generated local identity and corrects the Wiki sample's source relationships. Normal source links open the user's editor. Populated-state imagery does not settle remaining incomplete-data or accessibility decisions.

```text
Make final factual corrections to this exact Codebook product specification candidate board. Preserve top live and middle time-travel replay screenshots, their geometry, app/source/debugger synchronization, correct middle self-call Redirect, and bottom capture/save outside chat. Preserve the DeepWiki-like chapter/article/outline/question-composer layout of the BOTTOM screenshot. It is a local DeepWiki generated by the editor agent's skill, with source citations opening the user's editor.

Only make these changes in the bottom DeepWiki section:
1. Remove the header promotion "Index your code with Devin", the Devin brand action and the Share button. They would incorrectly imply that this locally generated Codebook Wiki is indexed/published through the hosted Devin service. Replace those header actions with the small neutral label "Generated by your editor agent". Keep "DeepWiki", "nextjs-dashboard" and "Local · Codebook" identity, and the theme icon.
2. The bottom Wiki sequence diagram currently has incorrect return/redirect arrows. Replace that small figure with a simple correct ARCHITECTURE / FLOW diagram under heading "Flow overview": three clearly readable rectangular nodes "Invoice form" → "createInvoice" → "PostgreSQL". A separate small return arrow from PostgreSQL goes BACK to createInvoice, labeled "Result". Under createInvoice, a short downward arrow leads to a fourth node "Invoice list", labeled "Redirect". Only createInvoice owns the redirect; the database never points to Invoice list. Keep this figure modest so paragraphs/source citations and Q&A remain substantial. The Learning summary diagram in the middle screen remains a SEQUENCE diagram exactly as it currently is.
3. Keep the approved browser "Update LLM Wiki" next to Source changed, "Open in VS Code", and project-folder output/change-location controls.
4. Caption below the bottom browser must read: "Reproduce DeepWiki. Generated by the editor agent's skill, with source links to your editor."
5. Keep "LLM Wiki — Reproduce DeepWiki" as the bottom section heading and a working-Q&A visual "Ask about nextjs-dashboard..." in the browser. No decorative nonfunctional dashboard widgets.
6. Match the reference DeepWiki reading palette: background #F8F7F6, text #333333, restrained Geist-style sans typography. Existing top and middle native dark editor themes stay as they are.

Exactly one portrait product-spec board, candidate label v8, all UI English. All source/app/state content remains illustrative and the footer must keep that statement. Make no new theme variants or layout changes beyond the above factual boundary fixes.
```
