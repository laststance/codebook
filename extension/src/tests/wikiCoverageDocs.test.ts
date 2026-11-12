import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  WIKI_CONTEXT_LINE_LIMIT,
  WIKI_CONTEXT_UNIT_LINE_LIMIT,
} from '../constants'

/**
 * Reads the bundled `SKILL.md`, the skill the extension ships and Cursor's setup copies, so a test can pin a sentence of its Wiki route.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the skill tests of this file.
 *
 * @returns The skill's text.
 *
 * @example
 * ```ts
 * const skill = await readBundledSkill()
 * assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
 * ```
 */
const readBundledSkill = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )

/**
 * Reads the packaged `README.md`, the learner's documentation, so a test can pin the sentence that describes a Wiki rule.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the README tests of this file.
 *
 * @returns The README's text.
 *
 * @example
 * ```ts
 * const readme = await readPackagedReadme()
 * assert.ok(readme.includes('An answer names the repository files it relies on by path'))
 * ```
 */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

// Value: protects=the Wiki route tells the chat AI that every included code file needs a citation or a coverageExceptions entry with its reason, before the renderer refuses it; fails_when=the skill (from 1.0.88) loses the coverage sentence and the chat learns of the rule only from a refusal it may answer by excepting application modules (C113-W1); why_new=skill 1.0.87 never asked for coverage, and a 6-page Wiki citing 32 of 71 sources published; seam=none; no_claim=how thoroughly a chat model explains each file
test('the bundled skill 1.0.101 asks the Wiki generator to cite every included code file or name it as an exception with a reason', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      'Every included code file must be cited by a page `sources` list, a diagram node or edge, or an inline editor source link, or be listed under optional `coverageExceptions`',
    ),
  )
  assert.ok(
    skill.includes('never for an application module a learner would read.'),
  )
})

// Value: protects=the learner's README names the coverage rule the generator enforces; fails_when=the README says nothing about a refused Wiki that leaves code unexplained (C113-W1); why_new=the renderer gained the refusal in Cycle 0113; seam=none; no_claim=the refusal's exact wording
test('the README says the generator refuses a Wiki that leaves an included code file unexplained', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'The generator refuses to publish a Wiki that leaves an included code file unexplained, unless that file is listed as needing no explanation, with the reason.',
    ),
  )
})

// Value: protects=the learner's README names the credential-file refusal the generator enforces and every file shape it refuses, so an owner knows which tracked files a Wiki never indexes; fails_when=the README loses the sentence or one of the shapes the renderer refuses (Cycle 0116 found an agent that indexed the tracked .env.e2e and .env.test of P07 nsx); why_new=the renderer gained the refusal in Cycle 0116 (indexed links and page links from the /ship review), and E3 showed that an update of a Wiki published before it lists the file under excludedPaths; seam=none; no_claim=that the agent never reads such a file while it explores the repository
test('the README says the generator refuses a Wiki that indexes environment files, private keys or password files', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "A source link written in an article counts toward that only when it points to this project's included file with that file's hash and a line within it. The generator also refuses a Wiki whose source index holds a file that can hold credentials, and names them: an environment file (`.env`, a name that starts with `.env.`, `.env-` or `.env_`, such as `.env.test`, a name that ends with `.env`, `.envrc` or `.dev.vars`) or a file in a `.env` folder, a private key, key store or variables file (`.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.p8`, `.ppk`, `.tfvars`), an SSH private key (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, with or without `_sk`) or an `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.htpasswd`, `.git-credentials`, `credentials` or `credentials.json` file, also when an indexed path is a link to one, cited or not. It also refuses a page with an editor source link (a `vscode://` or `cursor://` link to Codebook's source handler) to such a file, however the link spells the path, and also when the path is a symbolic link to one. This is a list of names, not a check of the contents. The editor AI then lists those files under the excluded paths, so the published Wiki never indexes or cites them. A Wiki that an earlier version published with such a file stays readable, and its next update lists the file under the excluded paths before it publishes.",
    ),
  )
})

// Value: protects=the Wiki route tells the chat AI every credential file name the renderer refuses, so it keeps them out of includedSources at the start instead of meeting the refusal; fails_when=the skill (from 1.0.92) loses the sentence or a name the renderer refuses (Cycle 0116: Cursor's agent indexed the tracked .env.e2e and .env.test of P07 nsx); why_new=Cycle 0116 review round (CodeRabbit: the skill named no credential file); seam=none; no_claim=that a chat model follows the sentence, which the native credential check covers
test('the bundled skill 1.0.101 names every credential file the renderer refuses and asks for them under excludedPaths', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      'Never index a file that can hold credentials, whatever it is used for: an environment file (`.env`, `.env.*`, `.env-*`, `.env_*`, `*.env`, `.envrc`, `.dev.vars`) or a file in a `.env` folder, a private key, key store or variables file (`.pem`, `.key`, `.p12`, `.pfx`, `.jks`, `.keystore`, `.p8`, `.ppk`, `.tfvars`), an SSH private key (`id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, with or without `_sk`), or an `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.htpasswd`, `.git-credentials`, `credentials` or `credentials.json` file; list each under `excludedPaths`, because the renderer refuses a Wiki whose `includedSources` holds one.',
    ),
  )
})

// Value: protects=the Wiki route tells the chat AI how to cover a repository of several hundred code files: a chapter per package, an Examples chapter whose pages cite each family's files, a Testing page citing the tests, source lists built by a scratch script, examples and tests kept out of excludedPaths, and work that goes on until the Wiki is published; fails_when=the skill (from 1.0.91) loses the paragraph, and a large repository's Wiki again leaves examples and tests out through excludedPaths (C114-W2) or excepts learner files (C114-W1), or a chat ends its turn with an unpublished candidate (Cycle 0114 E1 run 1); why_new=Cycle 0114 H3 held in Cursor on TanStack/query, 2,498 code files; seam=none; no_claim=that a chat model follows the paragraph, which the native reruns check
test('the bundled skill 1.0.101 tells the Wiki of a large repository to cite its examples and tests in Examples and Testing pages instead of leaving them out', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      '**Large repositories.** When the included code reaches several hundred files (a monorepo of packages, examples and tests), plan the tree from the folder layout before reading files one by one, and cover every kind of code the repository holds:',
    ),
  )
  assert.ok(
    skill.includes(
      'Give each package a chapter of its own, or its own page in a `section` of closely related packages, with child pages for its main modules and flows. Never make one package, adapter or example family the `parent` of its peers (step 5).',
    ),
  )
  assert.ok(
    skill.includes(
      "Give the examples an **Examples** chapter whose child pages each explain one family of examples (one framework, or one feature shown in several) and list every file of that family in the page's `sources`.",
    ),
  )
  assert.ok(
    skill.includes(
      'Give the tests a **Testing** page, or one per package, that explains how the tests are organized and what they check, and lists the test files in its `sources`; as for examples, the list is not explanation.',
    ),
  )
  assert.ok(
    skill.includes(
      'The list covers the files but is not explanation: the article explains what the family shows and how its files use the code they exercise.',
    ),
  )
  assert.ok(
    skill.includes(
      "Build these source lists, and `includedSources` with its hashes, with a script in `.codebook/scratch/` that applies step 1's exclusions, instead of by hand",
    ),
  )
  assert.ok(
    skill.includes(
      "Examples, tests, build scripts and configuration code are code a learner reads: keep them out of `excludedPaths`, which holds only step 1's exclusions (the owner's exclusions and files holding credentials, such as a test fixture with a real key, stay excluded), and out of `coverageExceptions`, which stays limited to code that needs no explanation.",
    ),
  )
  assert.ok(
    skill.includes(
      'Keep working until the Wiki is published. When a refusal names unexplained files, thin chapters or text that does not count, extend the plan, write the explanation it asks for and run the publisher again; do not end your turn with an unpublished candidate',
    ),
  )
})

// Value: protects=the chapter tree a learner navigates: a child page details part of its parent, and peers (packages, adapters, example families) sit side by side in one section; fails_when=the skill (from 1.0.91) loses the parent sentence, and a section's first page again becomes the parent of unrelated peers (C114-W4: Solid, Svelte, Angular, Preact and Lit Query under "Vue Query"); why_new=Cycle 0115 (C114-W4 nominal parents); Cycle 0116 adds the shared library (VS Code's P07 Wiki put the root lib/ utilities under the frontend state page); seam=none; no_claim=that a chat model follows the sentence, which the native tree check covers
test('the bundled skill 1.0.101 gives a page a parent only when it details part of that parent, and keeps peers, a shared library among them, side by side in one section', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      "An optional `parent` names a page in the same section to make a chapter tree: give a page a `parent` only when it details part of that parent's subject (one of its modules, flows, example families or test areas); peers, such as several packages, adapters or example families, or a shared library beside the code that uses it, stay without a `parent` in one `section`, which the reader lists together; the child pages the depth floor asks for are the module, flow, example-family or test-area pages under the page they detail.",
    ),
  )
  assert.ok(
    !skill.includes('a child page in a chapter of closely related packages'),
  )
})

// Value: protects=the chapter tree a learner navigates: each section with child pages opens at a page about its whole unit, and a page about one part never holds the unit's other parts (Cycle 0116 found VS Code's Copilot Chat with GPT-6.1 Terra hanging the input, notification and post components under "common layout and navigation" on P07 nsx, 3 of 22 children); fails_when=the skill (from 1.0.93) loses the whole-unit rule, or (from 1.0.94) the shared library among the peer units, or (from 1.0.95) the check of the tree the publish refusal shows and the --checked-tree digest to publish with, so the agent is never asked to put a unit's parts under it, to keep a shared library beside its users, or to check the tree before publishing; why_new=Cycle 0117 (C116-E1-1; C117-E2-1, where Cursor's agent hung a page mostly about the root lib/ that all three runtimes import under "Frontend application"; C117-E2-2, where Cursor's agent ran the preview three times and still published "Build tooling" holding the infrastructure's CI and hosting pages); seam=none (the packaged skill text); no_claim=that an editor AI follows the rule, which only the native E1 and E2 runs show
test('the bundled skill 1.0.101 puts every part of a unit under the page about the whole unit, keeps peer units and shared libraries side by side, and checks the tree the publish refusal shows before publishing with its digest', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      "When one unit (a single package, app, runtime, folder or suite) is split into pages, the page about the whole unit is the `parent` of its parts: its title covers every page of the unit, so each part reads as a part of that title. A page whose title names only some of the unit (one group of components, one flow, one kind of test) is a part, a peer of the unit's other parts and never their `parent`. A section that lists several peer units (packages, adapters, example families, or a shared library that several units import) needs no page above them; each peer unit applies this rule to its own pages.",
    ),
  )
  assert.ok(
    skill.includes(
      "Its answer's `chapterTree` lists each section's pages as a tree, each with its title and the top-level folders its sources cite.",
    ),
  )
  assert.ok(
    skill.includes(
      'That publish is refused until you check the chapter tree: the refusal shows the tree, the rule of step 5 and a digest. Check every child page against step 5 before anything else. Where a page titled for part of a unit holds another part of that unit, make the page about the whole unit the `parent` of every part, the former holder included; when the unit has no such page, add one and write it like any other page, with its own sources, a diagram and an explanation of how the parts fit together, not a list of its children. Use the folder counts to find a child about code that several units import, such as a shared library, and give it no `parent`: it is a unit of its own beside them. After any change to the pages or their `parent` fields, run the `--render-only` command again, then publish again: a changed tree is refused with its new digest. When every child passes, publish with `--checked-tree <digest>`, the digest the latest refusal named.',
    ),
  )
})

// Value: protects=the learner's README says the skill opens each section with child pages at a page about its whole unit and checks the chapter tree before publishing; fails_when=the README loses that sentence, or the refusal and the --checked-tree digest, while the skill (1.0.101) asks for them; why_new=Cycle 0117 (C116-E1-1; C117-E2-2); seam=none (the packaged README text); no_claim=that an editor AI builds such a tree
test('the README says every part of a unit hangs under the page about the whole unit, a shared library stays a peer, and the publisher refuses to publish until the tree is checked', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "The bundled skill also asks that when one unit, such as a package or an app, is split into pages, the page about the whole unit holds all its parts as children, never a page about one part, while peer units, such as several packages or a shared library that several of them import, stay side by side. The publisher's preview (`--render-only`) answers the chapter tree with the top-level folders each page cites, and the publisher refuses to publish until the editor AI has checked that tree: the refusal shows the tree, the rule and a digest, the editor AI fixes the tree (adding a full page for a missing whole unit) and previews again, then publishes with the digest of the tree it checked (`--checked-tree`), and a tree changed after its check is refused again.",
    ),
  )
})

// Value: protects=the Wiki pages a learner reads explain the repository only: no text about the Wiki's own generation, and no rule of the project the project's files do not hold; fails_when=the skill (from 1.0.96) loses the sentences that keep the editor AI's own instructions, user rules and editor settings out of the articles and ask it to name a repository convention only from a cited file, so a page can again present the agent's rules as the project's (Cycle 0117 run C: Cursor's agent wrote "Prefer DAMP over clever helpers ... the Arrange/Act/Assert comments the workspace rule asks for" on P07 nsx's unit-test page, a rule no file of nsx holds, and a sentence about how the Wiki attached its test sources, leaving that page at 64% explanation), or (from 1.0.98) the sentence that keeps the terms of the agent's own instructions out of the articles (run D: "so those specs stay DAMP" on the end-to-end test page, a style no file of nsx names); why_new=Cycle 0117 (C117-E2-3, hypotheses D and E); seam=none (the packaged skill text); no_claim=that an editor AI follows the rule, which only the native runs show
test('the bundled skill 1.0.101 asks the editor AI to write only about the repository, to name a convention of the repository only from a file the page cites, and to keep the terms of its own instructions out', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      "Write about the repository and nothing else: a sentence about this Wiki, how it was generated or why a page lists its sources explains no code, and your own instructions, user rules and editor settings are not the repository's. Describe a convention of the repository, such as how its tests are named or written, only from a file of the repository that the page cites, and never present general advice as its rule.",
    ),
  )
  assert.ok(
    skill.includes(
      "Their terms are not the repository's either: never describe its code or tests with a term from your own instructions or user rules, such as the name of a testing or naming style, unless a file of the repository uses it.",
    ),
  )
})

// Value: protects=the learner's README says the Wiki writes only about the learner's repository and never shows the AI's own instructions or user rules as the project's rules; fails_when=the README loses that sentence, or the sentence that the skill and the Generate and Update requests keep the terms of the AI's own instructions out, while the skill (1.0.101) and the requests ask for them; why_new=Cycle 0117 (C117-E2-3, hypotheses D and E); seam=none (the packaged README text); no_claim=that a generated Wiki holds no such text
test('the README says the editor AI writes only about the repository and never presents its own rules or their terms as the project rules', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "The bundled skill asks the editor AI to write only about your repository: no sentence about the Wiki itself or how it was made, and a rule or convention of the project, such as how its tests are named, only from a project file the page cites, so the AI's own instructions or user rules never appear as your project's rules. It also asks the editor AI not to describe your code or tests with a term from its own instructions or user rules, such as the name of a testing style, that no file of your project uses, and the requests that **Generate LLM Wiki** and **Update LLM Wiki** send to the editor AI say the same.",
    ),
  )
})

// Value: protects=the learner's README says what the skill asks of a large repository's Wiki (package chapters, an Examples chapter, a Testing page, examples and tests kept in); fails_when=the README loses that sentence while the skill (1.0.101) asks for it, so a learner of a large repository cannot tell why the Wiki has Examples and Testing chapters, or the paragraph still ends with Cycle 0116's known limit about VS Code's chapter tree after Cycle 0117's runs fixed it; why_new=Cycle 0114 skill 1.0.91, Cycle 0116 skill 1.0.92 for the shared library and the known limit its native run left (C116-E1-1), and Cycle 0117 for removing that limit once both hosts passed; seam=none; no_claim=that a generated Wiki has those chapters
test('the README says a large repository gets a chapter per package, an Examples chapter and a Testing page', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "For a repository of several hundred code files, the bundled skill asks for a chapter per package (or its own page among related packages, never a page under another package, and a shared library never under the code that uses it), an **Examples** chapter whose pages each cite one family of examples, and a **Testing** page that cites the tests, and it asks that examples, tests and build code be covered rather than left out, that example and test pages explain what their files show rather than only list them, and that the editor AI stop and report when a refusal needs your agreement. The source-list script it asks for keeps the repository's exclusions: files holding credentials and exclusions you asked for stay out. The bundled skill also asks that when one unit, such as a package or an app, is split into pages, the page about the whole unit holds all its parts as children, never a page about one part, while peer units, such as several packages or a shared library that several of them import, stay side by side. The publisher's preview (`--render-only`) answers the chapter tree with the top-level folders each page cites, and the publisher refuses to publish until the editor AI has checked that tree: the refusal shows the tree, the rule and a digest, the editor AI fixes the tree (adding a full page for a missing whole unit) and previews again, then publishes with the digest of the tree it checked (`--checked-tree`), and a tree changed after its check is refused again.\n",
    ),
  )
})

// Value: protects=the Wiki route tells the chat AI the depth floors the renderer enforces (child pages, pages per file, a diagram on every page, counted explanation per page and per file with CJK counted twice, and what does not count) and the learner's README says the generator refuses a thin Wiki and what counts as explanation; fails_when=the skill or the README loses the depth sentence and a flat 7-page Wiki with one diagram is published (C113-W3), or a Wiki of templates is written because the chat does not know they do not count (C114-W4); why_new=the renderer gained the depth refusal in Cycle 0113 and counted explanation in Cycle 0115; seam=none; no_claim=how deep a chat model's articles really are
test('the skill and the README say a Wiki too thin for its code is refused: no child pages, too few diagrams or too little explanation', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    skill.includes(
      "at least 2 pages with a `parent`, at least one page per 8 explained code files (up to 30 pages), a diagram on every page and about three diagrams per two pages in total (architecture, flow or sequence, each with source-backed nodes and edges), and at least 1,200 characters of explanation on every page and 400 per explained code file in total (the total required stops at 60,000), CJK characters counted twice. Explanation is article text written for this page: a sentence the Wiki uses three or more times, counting sentences that differ only in file names, code names or numbers (a template written for every file), counts only where it is first used, and a list of names or paths (four or more words, most of them identifiers) or a sentence copied from a source the page cites does not count; a refusal names the thinnest pages with what did not count. Write each page's own explanation instead of templates, export lists or copied doc comments. These are floors, not targets: DeepWiki itself typically gives each page several diagrams and 2,500–7,000 characters, so aim above them.",
    ),
  )
  assert.ok(
    readme.includes(
      'Once 12 or more included code files need explanation, it also refuses a Wiki whose chapters are too thin for the code it covers: no child pages, too few pages for its code (one per 8 explained code files, up to 30 pages), a page without a diagram, too few diagrams for its pages, or too little explanation (including a page that is only a stub).',
    ),
  )
  assert.ok(
    readme.includes(
      'Explanation is what a page writes for itself: a sentence used three or more times, counting sentences that differ only in file names, code names or numbers, counts once, and lists of names or paths and text copied from the cited source files do not count; the refusal names the thinnest pages with what did not count.',
    ),
  )
  assert.ok(
    readme.includes(
      "A list of names or paths is a sentence of four or more words, at least 60% of them names, and a copied sentence is one of 40 or more characters that a page's cited source holds word for word. Every page needs at least 1,200 characters of explanation, and the Wiki 400 per explained code file, up to 60,000.",
    ),
  )
})

// Value: protects=the learner's README telling what an answer on the Wiki page shows: files by path, never an internal excerpt id, several lines per file up to the 40-citation limit, one link per distinct file and line; fails_when=the README loses that sentence or its limit and a learner cannot tell what the links under an answer open; why_new=C113 review round (Q&A citations); seam=none; no_claim=that a real answer cites well
test('the README says an answer names files by path, cites at most 40 lines, and its links open each cited line once', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'An answer names the repository files it relies on by path, never by an internal excerpt id such as S1, and may cite several lines of each file, up to 40 citations in all (repeats counted); an answer with more is refused as one without usable source citations. The links under the answer open each cited line in your editor, once per distinct file and line.',
    ),
  )
})

// Value: protects=the learner's README telling how a question on a large Wiki finds its code and how long Cursor may take: the route through the Wiki's own pages and the files each cites (its source list, diagrams and text links), the matching files no page cites, every page kept by its title and best file when a large Wiki's list is too long, the best matches kept first when pages must still be left out, the code identifiers that pick the answering lines before question words, and the 5-minute bound of each cursor-agent request; fails_when=the README loses that sentence, or still says nothing of the two requests and the bound after the Cycle 0119 F1 fix changed both, or of the text links and the ranked cut after the /ship pass 1 fix, or still promises a ranked cut for a question whose words match no file, or that every question in another language reaches its code, or says nothing of the page index, after the hosted review's fix; why_new=Cycle 0119 (H1 E2 step 6, F1; hosted CodeRabbit review of PR #307); seam=none (the packaged README's text); no_claim=that a real model picks the right page or answers within the bound
test('the README says how a question on a large Wiki is routed through its pages and how long each Cursor request may run', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "On a Wiki that cites more than six unchanged source files, a question that names none of them by path is answered in two requests: the editor model first picks up to six source files from the Wiki's own pages (each page's title, the start of its first paragraph and the files it cites in its source list, its diagrams or the source links of its text) and from up to six files that no page cites but whose names or lines match the question's words (a Wiki without such pages offers the files with their first lines instead), and names the code identifiers that mark the answering lines, so a question worded in another language than the code can still reach the code that answers it; then it answers from those lines, and in a long file the lines that hold those identifiers are chosen before lines that only match the question's words. When a large Wiki's pages and files do not all fit in that first request, each page lists fewer of its files, those whose names or lines best match the question's words first (among files that match equally, its code before its examples, tests and documentation), down to one file and then its title with that one file alone, so every page stays offered; only when even that does not fit are pages left out, the pages that cite the best matches kept first and otherwise the first pages in the Wiki's order. In Cursor each of the two `cursor-agent` requests may run for up to 5 minutes before the page reports `Cursor Agent timed out answering the Wiki question. Retry or use editor chat.`",
    ),
  )
})

// Value: protects=the learner's README telling that a Wiki answer reads a long file's matching comments together with the code they describe: a matching line brings the whole function, method or block it documents or opens, with the comment above it, within the unit cap, and the numbers in the sentence follow the product's constants; fails_when=the README is silent on the rule or names another excerpt size or unit cap than WIKI_CONTEXT_LINE_LIMIT and WIKI_CONTEXT_UNIT_LINE_LIMIT; why_new=Cycle 0122 F3 (hypothesis A, criterion 5); seam=none; no_claim=that the excerpt rule finds every function in every formatting style
test('the README says a matching line in a long source file brings the whole function or block it documents or opens', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      `In a source file longer than ${WIKI_CONTEXT_LINE_LIMIT} lines, each matching line first brings the whole function, method or block it documents or opens, with the comment directly above it, when that fits in ${WIKI_CONTEXT_UNIT_LINE_LIMIT} lines, so an answer sees the code a matching comment describes, not the comment alone.`,
    ),
  )
})

/**
 * Reads the bundled `render-wiki.mjs`, the renderer that enforces the depth floors the skill states, so a test can compare its constants with the skill's sentence.
 *
 * Tests run from `dist/tests`, so the path climbs two folders to the extension root. Called by the depth-floor test of this file.
 *
 * @returns The renderer's source text.
 *
 * @example
 * ```ts
 * const renderer = await readRenderer()
 * assert.match(renderer, /const DEPTH_MIN_PAGE_TEXT = 1200;/)
 * ```
 */
const readRenderer = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'render-wiki.mjs'),
    'utf8',
  )

// Value: protects=the skill's depth sentence and the renderer's floors stay the same numbers; fails_when=a depth constant in render-wiki.mjs changes (for example the 1,200-character page floor or the 30-page cap) while the skill still states the old value, so the chat aims at a floor the renderer no longer enforces; why_new=C113 /ship review (core docs-drift note); seam=none (reads the shipped files); no_claim=the renderer's behavior, which renderWikiDepth.test.mjs covers
test('the renderer enforces the same depth floors the bundled skill states', async () => {
  // Arrange
  const renderer = await readRenderer()
  const skill = await readBundledSkill()

  // Act
  const constants = Object.fromEntries(
    [...renderer.matchAll(/^const (DEPTH_[A-Z_]+) = ([\d_.]+);$/gm)].map(
      (match) => [match[1], match[2]],
    ),
  )

  // Assert
  assert.deepEqual(
    {
      DEPTH_MIN_EXPLAINED_FILES: constants.DEPTH_MIN_EXPLAINED_FILES,
      DEPTH_MIN_CHILD_PAGES: constants.DEPTH_MIN_CHILD_PAGES,
      DEPTH_FILES_PER_PAGE: constants.DEPTH_FILES_PER_PAGE,
      DEPTH_MAX_REQUIRED_PAGES: constants.DEPTH_MAX_REQUIRED_PAGES,
      DEPTH_DIAGRAMS_PER_PAGE: constants.DEPTH_DIAGRAMS_PER_PAGE,
      DEPTH_MIN_PAGE_TEXT: constants.DEPTH_MIN_PAGE_TEXT,
      DEPTH_TEXT_PER_FILE: constants.DEPTH_TEXT_PER_FILE,
      DEPTH_MAX_REQUIRED_TEXT: constants.DEPTH_MAX_REQUIRED_TEXT,
      DEPTH_REPEATED_SENTENCE_USES: constants.DEPTH_REPEATED_SENTENCE_USES,
      DEPTH_LIST_MIN_WORDS: constants.DEPTH_LIST_MIN_WORDS,
      DEPTH_LIST_NAME_SHARE: constants.DEPTH_LIST_NAME_SHARE,
      DEPTH_MIN_COPIED_TEXT: constants.DEPTH_MIN_COPIED_TEXT,
    },
    {
      DEPTH_MIN_EXPLAINED_FILES: '12',
      DEPTH_MIN_CHILD_PAGES: '2',
      DEPTH_FILES_PER_PAGE: '8',
      DEPTH_MAX_REQUIRED_PAGES: '30',
      DEPTH_DIAGRAMS_PER_PAGE: '1.5',
      DEPTH_MIN_PAGE_TEXT: '1200',
      DEPTH_TEXT_PER_FILE: '400',
      DEPTH_MAX_REQUIRED_TEXT: '60_000',
      DEPTH_REPEATED_SENTENCE_USES: '3',
      DEPTH_LIST_MIN_WORDS: '4',
      DEPTH_LIST_NAME_SHARE: '0.6',
      DEPTH_MIN_COPIED_TEXT: '40',
    },
  )
  assert.ok(
    skill.includes(
      'a sentence the Wiki uses three or more times, counting sentences that differ only in file names, code names or numbers (a template written for every file), counts only where it is first used, and a list of names or paths (four or more words, most of them identifiers)',
    ),
  )
  assert.ok(
    skill.includes(
      'from 12 explained code files (included code files no exception covers), at least 2 pages with a `parent`, at least one page per 8 explained code files (up to 30 pages)',
    ),
  )
})

// Value: protects=the Wiki route tells the chat AI, before the renderer refuses it, that each package page of a workspace names what the package imports from another workspace package; fails_when=the bundled skill (from 1.0.98) loses the workspace sentence of its article step or stops saying that the renderer refuses a Wiki that leaves it out; why_new=Cycle 0118 (H1 E1 and E2, step 2: neither host's P08 Wiki said what the Expo app and the Hono API take from the shared package); seam=none; no_claim=that the chat AI follows the sentence (the renderer's refusal and the native rerun prove that)
test('the bundled skill 1.0.101 asks each package page of a workspace to name what the package imports from another workspace package', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      "a page whose listed sources lie mostly in one package is that package's page. For each other workspace package that package's code imports, one paragraph of one of its pages names the imported package and a function or schema the code uses from it at runtime, says what for, and cites a file of the package that imports it. Types, constants written in capitals and imports made only by tests or fixtures need no mention, and one precise sentence per imported package is enough, not a list of imports. The renderer refuses a Wiki whose package pages leave that out, naming the package and what it imports.",
    ),
  )
})

// Value: protects=an update corrects every page that states a changed rule, not only the pages that cite the changed file; fails_when=the bundled skill (from 1.0.98) loses the update step's sentence that a page describing changed behavior is affected whether or not it cites the file, or stops naming the overview and architecture pages, or stops asking that the changed lines themselves be cited; why_new=Cycle 0118 (H1 E2 step 7: Cursor's update refreshed the stats page and left the overview saying idle spans are those "longer than" the threshold; H1 E1 step 7: VS Code's corrected statement cited only the first line of segmentsInRange, not the changed comparison); seam=none; no_claim=that the chat AI finds every such statement
test('the bundled skill 1.0.101 asks an update to correct every page that describes a changed rule, the overview included, and to cite the changed lines', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(
    skill.includes(
      "A page is affected when its text describes changed behavior, whether or not it cites the changed file: for each changed rule, search the text of every published page, the overview and architecture pages included, for statements about it (by the changed function and constant names and by the rule's own wording) and correct each one, so no page keeps the old rule.",
    ),
  )
  assert.ok(
    skill.includes(
      'Cite the changed lines themselves beside each corrected statement (the changed line, or a range that holds it), not only the first line of the function that holds them;',
    ),
  )
})

// Value: protects=an update corrects a sentence that says another function or check applies the same rule as the changed code, not only the sentences that name the changed function or quote the rule; fails_when=the bundled skill (from 1.0.101) loses the update step's sentence that a comparison with a changed rule states that rule, even in a paragraph about something else; why_new=Cycle 0121 (H1 run 1, E2 step 7, F1: after dispatch began to accept a symbol type, Cursor's update corrected every explicit string-only statement but kept "isAction is exported so application code can apply the same rule before calling dispatch"); seam=none; no_claim=that the chat AI finds every such comparison
test('the bundled skill 1.0.101 asks an update to correct a sentence that compares another function or check with a changed rule, wherever it sits', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      'A sentence that compares another function, check or type with a changed rule (says it applies the same rule, mirrors it or matches it) states that rule too, even in a paragraph about something else: correct the comparison or remove it when the change makes it untrue.',
    ),
  )
})

// Value: protects=the learner's README says an update also corrects a sentence that compares another function or check with the changed code; fails_when=the README loses that sentence while the skill (1.0.101) asks for it, so a learner cannot tell that such a comparison is kept current; why_new=Cycle 0121 (H1 run 1, F1); seam=none; no_claim=that an update meets the promise (the native update checks do)
test('the README says an update also corrects a sentence that says another function or check applies the same rule as the changed code', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'A sentence that says another function or check applies the same rule as the changed code, mirrors it or matches it counts as describing that behavior, so the update corrects or removes it once the change makes it untrue, even when it sits in a paragraph about something else.',
    ),
  )
})

// Value: protects=an update finds a sentence that words a changed rule differently, by searching pages for single words as well as phrases; fails_when=the bundled skill (from 1.0.101) loses the update step's instruction to search for single words (changed names, the old rule's type name) and to read every sentence a word search finds; why_new=Cycle 0121 (H1 run 2, E2 step 7, F2: after dispatch began to accept a symbol type, Cursor's update ran only phrase searches and kept a sentence that said "string-<code>type</code> checks", which inline code and a hyphen kept from matching); seam=none; no_claim=that an update meets the promise (the native update checks do)
test('the bundled skill 1.0.101 asks an update to search pages for single words of a changed rule as well as phrases and to read every sentence a word search finds', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.101"\n'))
  assert.ok(
    skill.includes(
      "Search for single words as well as phrases: each changed function and constant name, and each word naming what the old rule required (for a rule about a value's type, that type's name on its own). Inline code, links and hyphens split a phrase in a page's HTML, so a phrase search misses sentences. Read every sentence a word search finds, and correct each one that still presents the old requirement as current, however it is worded.",
    ),
  )
  const step7 = skill.slice(skill.indexOf('7. **Update intentionally.**'))
  assert.ok(
    step7.indexOf('Search for single words as well as phrases') <
      step7.indexOf('Cite the changed lines themselves'),
  )
})

// Value: protects=the learner's README says an update also searches every page for each changed name and each word of the old rule on its own; fails_when=the README loses that sentence while the skill (1.0.101) asks for it, so a learner cannot tell that a sentence worded differently from the old rule is still found; why_new=Cycle 0121 (H1 run 2, F2); seam=none; no_claim=that an update meets the promise (the native update checks do)
test('the README says an update also searches pages for each changed name and each word of the old rule on its own, not only whole phrases', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "The update also searches every page for each changed name and for each word of the old rule on its own, not only for whole phrases, because inline code, links and hyphens split a phrase in a page's markup, so a sentence that words the old rule differently is still found and corrected.",
    ),
  )
})

// Value: protects=the learner's README names the workspace rule the generator enforces and the update's promise to fix every page that states a changed rule; fails_when=the README says nothing about the refusal of a workspace Wiki that never says what a package takes from another, about which imports the rule reads (require() calls, awaited import() calls, a component's script elements), or about updates correcting overview pages; why_new=Cycle 0118 (H1 E1 and E2, steps 2 and 7; PR 305's hosted review); seam=none; no_claim=the wording of the refusal itself (the renderer test pins it)
test('the README says a workspace Wiki must say what each package takes from the others and that an update fixes every page that describes a change', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      "the generator also refuses a Wiki in which a package's own pages (pages whose listed sources lie mostly in that package) never say what the package uses from another workspace package it imports, by that package's name or by a relative path into its folder",
    ),
  )
  assert.ok(
    readme.includes(
      'A type-only import, a constant written in capitals, an import made only by tests, mocks or fixtures, and a file the Wiki lists as a coverage exception owe no such sentence, and an import line pasted into a code block does not count.',
    ),
  )
  assert.ok(
    readme.includes(
      'Imports are read from `import` and `export … from` statements, `require()` calls and awaited dynamic `import()` calls; in a Vue or Svelte component, only its `<script>` elements are read.',
    ),
  )
  assert.ok(
    readme.includes(
      'the bundled skill asks the editor AI to correct every page that describes the changed behavior, the overview and architecture pages included, not only the pages that cite the changed file, and to cite the changed lines themselves beside each corrected statement.',
    ),
  )
})
