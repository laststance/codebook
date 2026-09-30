import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { workspaceHarness } from './studyWorkspaceHarness';
test('first Study entry from one editor group keeps empty Context separate from the application', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.addForeignDraft(1);
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('cold Wiki entry reserves a second main pane without treating the separate chat part as its destination', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);

    // Assert
    assert.equal(harness.groups.length, 3);
    assert.deepEqual(harness.groups[1]!.tabs, []);
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const boundary of ['layout measurement', 'primary focus response'] as const) for (const interaction of ['selection', 'edit', 'none'] as const) test(interaction === 'none' ? `cold Wiki scope restores prior text focus after unchanged ${boundary}` : `cold Wiki scope preserves a newer primary ${interaction} during ${boundary}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart();
  const primary = harness.focusMutableDraft('primary-notes.txt', 1), original = harness.focusMutableDraft('original-notes.txt', 2);
  const firstRead = boundary === 'primary focus response' ? harness.holdNextPrimaryFocusResponse() : harness.holdNextCommand('vscode.getEditorLayout');
  const opening = harness.reader.arrangeRepository(new AbortController().signal); void opening.catch(() => undefined);
  let releaseMeasured = () => {};
  try {
    await firstRead.started;
    const measured = boundary === 'primary focus response' ? firstRead : harness.holdNextCommand('vscode.getEditorLayout'); releaseMeasured = measured.release;
    if (boundary === 'layout measurement') { firstRead.release(); await measured.started; }
    assert.equal(harness.focusedSource()?.document.uri.toString(), primary.document.uri.toString());

    // Act
    if (interaction === 'selection') primary.editor.selections = [{ anchor: primary.editor.selections[0]!.active.with(27, 0), active: primary.editor.selections[0]!.active.with(27, 0) }];
    if (interaction === 'edit') primary.replaceContent('New learner text.\n');
    measured.release();

    // Assert
    if (interaction === 'none') { await opening; assert.equal(harness.focusedSource()?.document.uri.toString(), original.document.uri.toString()); }
    else {
      await assert.rejects(opening, /primary editor.*changed during scope measurement/i);
      assert.equal(harness.focusedSource()?.document.uri.toString(), primary.document.uri.toString());
      assert.equal(primary.editor.selections[0]!.active.line, interaction === 'selection' ? 27 : 22);
      assert.equal(primary.document.getText(), interaction === 'edit' ? 'New learner text.\n' : 'Original learner draft.\n');
    }
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.equal(harness.runtimes.length, 0);
  } finally { firstRead.release(); releaseMeasured(); await opening.catch(() => undefined); await harness.close(); }
});

for (const interaction of ['selection', 'other focus', 'none'] as const) test(`cold Wiki focus restoration ${interaction === 'none' ? 'keeps the unchanged learner reading position' : `preserves newer ${interaction} before its response arrives`}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart();
  const primary = harness.focusMutableDraft('primary-notes.txt', 1), original = harness.focusMutableDraft('original-notes.txt', 2);
  harness.retainReadingRange(84, 96);
  let restored: Pick<typeof original.editor, 'selections'> | undefined;
  harness.changeAfterNextSourceDisplay(editor => {
    restored = editor;
    // Native display is already applied; learner input can precede the extension-host response and later selection RPC.
    if (interaction === 'selection') { editor.selections = [{ anchor: editor.selections[0]!.active.with(99, 0), active: editor.selections[0]!.active.with(99, 0) }]; original.editor.selections = editor.selections; harness.retainReadingRange(98, 110); }
    if (interaction === 'other focus') primary.focus();
  });
  try {
    // Act
    const opening = harness.reader.arrangeRepository(new AbortController().signal);
    if (interaction === 'none') await opening;
    else await assert.rejects(opening, /focus or selection changed while.*restored/i);

    // Assert
    assert.equal(harness.focusedSource()?.document.uri.toString(), interaction === 'other focus' ? primary.document.uri.toString() : original.document.uri.toString());
    assert.equal(restored?.selections[0]!.active.line, interaction === 'selection' ? 99 : 22);
    assert.equal(harness.isReadingLineVisible(interaction === 'selection' ? 104 : 90), true);
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.equal(original.tab.isDirty, true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('first Study entry reserves all three main panes when a separate chat part already occupies a global column', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.tab.isDirty, true);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a second cold Open Study reports busy without creating Context before the first native reservation completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const held = harness.holdNextCommand('vscode.getEditorLayout'), first = harness.reader.open();
  let second: Promise<unknown> | undefined;
  const refreshProgress = harness.reader['refreshProgress'].bind(harness.reader);
  try {
    await held.started;
    let prepared = () => {};
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    harness.reader['refreshProgress'] = async () => { await refreshProgress(); prepared(); };

    // Act
    second = harness.reader.open().catch(error => error);
    await Promise.race([preparation, second]);
    await new Promise<void>(resolve => setImmediate(resolve));

    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.inspect().sourceUri, undefined);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}] });
    assert.equal(harness.groups.length, 3); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    const duplicate = await second;
    assert.ok(duplicate instanceof Error && 'code' in duplicate); assert.equal(duplicate.code, 'BUSY');
    held.release(); await first;
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await Promise.allSettled([first, second]); harness.reader['refreshProgress'] = refreshProgress; await harness.close(); }
});

test('a duplicate Open Study during initialization reports busy while the first entry remains usable', async () => {
  // Arrange
  const harness = await workspaceHarness(false), initialize = harness.reader['initialize'].bind(harness.reader);
  let release = () => {}, initializeCalls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  harness.reader['initialize'] = async () => { initializeCalls++; await held; await initialize(); };
  const first = harness.reader.open();
  let second: Promise<unknown> | undefined;
  try {
    // Act
    second = harness.reader.open().catch(error => error);
    await new Promise<void>(resolve => setImmediate(resolve));

    // Assert
    assert.equal(initializeCalls, 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    const duplicate = await second;
    assert.ok(duplicate instanceof Error && 'code' in duplicate); assert.equal(duplicate.code, 'BUSY');
    release(); await first;
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await Promise.allSettled([first, second]); harness.reader['initialize'] = initialize; await harness.close(); }
});

test('a failed cold initialization allows the next explicit Open Study to retry', async () => {
  // Arrange
  const harness = await workspaceHarness(false), initialize = harness.reader['initialize'].bind(harness.reader);
  harness.reader['initialize'] = async () => { throw new Error('Learning storage is temporarily unavailable.'); };
  try {
    // Act
    await assert.rejects(harness.reader.open(), /Learning storage is temporarily unavailable/);
    harness.reader['initialize'] = initialize;
    await harness.reader.open();

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['initialize'] = initialize; await harness.close(); }
});

test('background refresh cannot open captured source into Application before cold Study reserves its panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const arrange = harness.reader['arrange'].bind(harness.reader);
  let refreshed = false;
  harness.reader['arrange'] = async (...arguments_: Parameters<typeof arrange>) => {
    // Run the ordinary polling callback after admission but before the initial native reservation.
    if (!refreshed) { refreshed = true; await harness.reader['refresh'](); }
    return arrange(...arguments_);
  };
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual({ ...harness.reader.presentationState().panes }, { appColumn: 1, sourceColumn: 2, contextColumn: 3 });
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['arrange'] = arrange; await harness.close(); }
});

test('first Study cannot confirm a learner source move that covers Application during final arrangement', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const arrange = harness.reader['arrange'].bind(harness.reader);
  harness.reader['arrange'] = async (...arguments_: Parameters<typeof arrange>) => {
    // The source is rendered before the final grid receipt; a learner move must not become successful placement.
    harness.moveSource(1);
    return arrange(...arguments_);
  };
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual({ ...harness.reader.presentationState().panes }, { appColumn: 1, sourceColumn: 1, contextColumn: 3 });
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['arrange'] = arrange; await harness.close(); }
});

test('first Study entry waits for its explanation focus before confirming the final native layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.deferPanelFocus('codebook.studyContext', 1);
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { await harness.close(); }
});

test('first Study entry confirms a visible explanation in the only editor part without a Context focus acknowledgement', async () => {
  // Arrange: another tab keeps native focus even after the Context tab becomes visible.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft();
  harness.onNextPanel('codebook.studyContext', panel => {
    const reveal = panel.reveal.bind(panel);
    panel.reveal = (column, preserveFocus) => { reveal(column, preserveFocus); draft.focus(); };
  });
  try {
    // Act
    await harness.reader.open();
    // Assert: the owned three-pane layout is measured without adopting an unconfirmed focus receipt.
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.notEqual(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

test('first Study entry refuses an unfocused explanation when a second editor part makes scope ambiguous', async () => {
  // Arrange: a separate chat editor part makes tab visibility insufficient to identify the main grid.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  harness.addSeparateEditorPart();
  const draft = harness.focusMutableDraft();
  harness.onNextPanel('codebook.studyContext', panel => {
    const reveal = panel.reveal.bind(panel);
    panel.reveal = (column, preserveFocus) => { reveal(column, preserveFocus); draft.focus(); };
  });
  try {
    // Act / Assert: no layout proof is granted after the requested native focus fails.
    await assert.rejects(harness.reader.open(), /Study explanation native focus/);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

test('first Study entry accepts its application tab registering during the initial native layout read', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.delayPanelRegistration('codebook.scopedBrowser', true);
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const textReceipt of ['retained', 'cleared', 'cleared before registration', 'cleared during layout'] as const) test(`cold Study opens from Wiki when the covered background text receipt is ${textReceipt}`, async () => {
  // Arrange: ordinary VS Code keeps the most recent text editor while Wiki owns another group.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki(), registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = textReceipt === 'cleared during layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab);
    assert.equal(harness.focusedSource(), draft.editor);
    // Act: creation covers that background editor without changing the native Wiki tab.
    if (textReceipt === 'cleared before registration') { held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'early background text clear', 1_000); }
    registerPanel();
    if (textReceipt === 'cleared') { held.release(); await Promise.resolve(); }
    if (layout) { await layout.started; held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'late background text clear', 1_000); layout.release(); }
    await opening;
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.some(group => group.tabs.includes(wiki.nativeTab)), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

for (const clearAt of ['before registration', 'during layout'] as const) for (const departure of ['different webview', 'webview roundtrip', 'different text', 'text roundtrip'] as const) test(`cold Wiki-to-Study layout preserves ${departure} when background text clears ${clearAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const draft = harness.focusMutableDraft(), otherWiki = harness.openWiki(); draft.focus();
  const held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser'), layout = harness.holdNextCommand('vscode.getEditorLayout');
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native pane, group or focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (clearAt === 'before registration') { held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'early background text clear', 1_000); }
    registerPanel(); await layout.started;
    // Act: the clear belongs to background coverage, but the native Wiki tab no longer belongs to this Open.
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'late background text clear', 1_000);
    if (departure.includes('text')) draft.focus();
    else harness.focusExistingWebviewTab(otherWiki.nativeTab);
    if (departure.endsWith('roundtrip')) harness.focusExistingWebviewTab(wiki.nativeTab);
    layout.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, departure === 'different webview' ? otherWiki.nativeTab : wiki.nativeTab);
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout.release(); await opening.catch(() => undefined); await harness.close(); }
});

for (const replaceAt of ['registration', 'layout'] as const) test(`cold Study rejects closing Wiki and opening a lookalike during ${replaceAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = replaceAt === 'layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native pane|Native panes/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'background text clear', 1_000);
    if (layout) { registerPanel(); await layout.started; }
    // Act: identical type/title/content cannot confer the closed tab's focus ownership on a new tab.
    const replacement = harness.replaceActiveWebviewTab(); registerPanel(); layout?.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, replacement);
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), false);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('failed cold application creation releases temporary native listeners and preserves learner panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.focusMutableDraft(), listeners = harness.focusListenerCount();
  harness.failNextPanelCreation('codebook.scopedBrowser');
  try {
    // Act
    await assert.rejects(harness.reader.open(), /Injected native panel creation failure/);
    // Assert
    assert.equal(harness.focusListenerCount(), listeners);
    assert.equal(harness.groups[0]!.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.counts().panels, 0);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(harness.reader.presentationState().state, 'closed');
  } finally { await harness.close(); }
});

test('presentation preserves a replacement Wiki while its prior background source receipt remains visible', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseCapture = () => {}, releaseText = () => {}, changing: Promise<unknown> | undefined;
  try {
    await harness.reader.open();
    const draft = harness.focusMutableDraft('background-notes.txt', 1);
    const held = harness.holdTextFocusClear('codebook.repositoryWiki'); releaseText = held.release;
    harness.openWiki();
    const panel = harness.reader['contextPanel']; assert.ok(panel);
    const originalPost = panel.webview.postMessage.bind(panel.webview), state = harness.reader.presentationState();
    let observed!: () => void;
    const captureStarted = new Promise<void>(resolve => { observed = resolve; });
    panel.webview.postMessage = message => {
      if (message.type !== 'capture-presentation-pose') return originalPost(message);
      releaseCapture = () => { void originalPost(message); }; observed(); return Promise.resolve(true);
    };
    changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE', causeDetail: /Native pane, group or focus changed/ });
    await captureStarted;
    const commandsBeforeDeparture = [...harness.commands];
    // Act: a group wrapper can legitimately refresh after a learner closes the old Wiki and opens a new one.
    const replacement = harness.replaceActiveWebviewTab(); harness.replaceEditorGroup('wrapper', 2);
    releaseCapture(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, replacement);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(harness.commands, commandsBeforeDeparture);
  } finally { releaseCapture(); releaseText(); await changing?.catch(() => undefined); await harness.close(); }
});

for (const refreshAt of ['registration', 'layout'] as const) test(`cold Study accepts a verified Wiki group and tab wrapper refresh during ${refreshAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = refreshAt === 'layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'background text clear', 1_000);
    if (layout) { registerPanel(); await layout.started; }
    // Act: the host reports changed wrappers without closing or opening the underlying Wiki tab.
    wiki.refreshTabWrapper(); harness.replaceEditorGroup('wrapper', 2); registerPanel(); layout?.release(); await opening;
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('cold Wiki-to-Study registration rejects clearing text in a group the new application does not cover', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const draft = harness.focusMutableDraft('third-group-notes.txt', 3), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki(), registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Act: this clear cannot be explained by the requested first-column application.
    registerPanel(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab);
    assert.equal(harness.groups[2]!.activeTab, draft.tab);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const departure of ['different webview', 'webview roundtrip', 'different text', 'text roundtrip'] as const) test(`${departure} during cold Wiki-to-Study registration preserves the newer learner choice`, async () => {
  // Arrange: both webviews already exist, so switching them does not change tab contents or group count.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const otherDraft = harness.focusMutableDraft('other-notes.txt', 2), source = harness.focusMutableDraft();
  const otherWiki = harness.openWiki(); source.focus();
  const held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Act: deliver an actual tab-only event; unchanged background text cannot hide a newer webview choice.
    if (departure.includes('text')) otherDraft.focus();
    else harness.focusExistingWebviewTab(otherWiki.nativeTab);
    if (departure.endsWith('roundtrip')) harness.focusExistingWebviewTab(wiki.nativeTab);
    registerPanel(); await rejected;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(source.document.getText(), 'Original learner draft.\n');
    assert.equal(otherDraft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[1]!.tabs.includes(otherDraft.tab), true);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

test('first Study entry does not resize chat while a new application panel only reports optimistic focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const focus = harness.holdNextCommand('workbench.action.focusFirstEditorGroup');
  chat.focus();
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Assert: provisional wrapper flags must not authorize a layout command against the still-focused chat part.
    assert.equal(harness.commands.includes('workbench.action.focusFirstEditorGroup'), false);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    registerPanel(); await focus.started; focus.release(); await opening;
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { registerPanel(); focus.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('chat focus acquired during application registration prevents first Study from arranging either editor part', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /learner focus changed while the new application registered/);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    chat.focus(); registerPanel(); await rejected;
    // Assert
    assert.equal(chat.focused(), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.commands.includes('workbench.action.focusFirstEditorGroup'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
  } finally { registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const change of ['foreign tab', 'replacement group'] as const) test(`a ${change} during application registration prevents first Study from adopting the changed layout`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (change === 'foreign tab') harness.addForeignDraft(1);
    else harness.resyncEditorGroups('replace');
    registerPanel(); await rejected;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const retirement of ['cancel', 'Close'] as const) test(`${retirement} during application registration cannot reserve panes after the late native tab appears`, async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController();
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open(cancellation.signal);
  const rejected = assert.rejects(opening, retirement === 'cancel' ? /abort/i : /closed/i);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (retirement === 'cancel') cancellation.abort();
    const closing = retirement === 'Close' ? harness.reader.close() : Promise.resolve();
    registerPanel(); await rejected; await closing;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await opening.catch(() => undefined); await harness.close(); }
});

test('an existing three-pane Study can restore its presentation while preserving a separate chat part', async () => {
  // Arrange
  const harness = await workspaceHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart();
  try {
    await harness.reader.open();
    const presentation = harness.reader.presentationState();

    // Act
    const result = await harness.reader.changePresentation({ presentationId: presentation.presentationId, expectedRevision: presentation.presentationControlRevision, mode: 'living-book', action: 'restore' });

    // Assert
    assert.equal(result.mode, 'living-book'); assert.equal(result.layoutConfirmed, true);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('Wiki entry from a retained Study keeps Context focus when the native primary webview emits a late focus event', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  harness.deferPrimaryFocusEcho();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('Wiki entry from focused chat preserves its separate pane when its layout read reports a stale matching main grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart();
  const draft = harness.focusMutableDraft();
  await harness.reader.open(); chat.focus();
  // Fault injection changes only the API report; the separate part still contains exactly one real native group.
  harness.reportSeparatePartLayout({ orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    // Explicit Wiki navigation establishes main focus; foreign chat contents and geometry remain untouched.
    assert.equal(chat.focused(), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a real fourth main pane remains learner-owned even when its tab list is empty and a separate chat part exists', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 220 }, { size: 220 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft(), originalLayout = harness.editorLayout();
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.deepEqual(harness.editorLayout(), originalLayout);
    assert.equal(harness.groups.length, 5); assert.deepEqual(harness.groups[3]!.tabs, []);
    assert.equal(harness.groups[4]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('Existing editor groups were preserved')), true);
  } finally { await harness.close(); }
});

test('cold Wiki entry from the focused chat measures and reserves only the main editor grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  chat.focus();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, retainCurrentFocus(acquire) {
      const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt;
    } });
    // Assert
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.commands.filter(command => command === 'workbench.action.focusFirstEditorGroup').length, 1);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { for (const receipt of receipts) receipt.dispose(); await harness.close(); }
});

for (const primary of ['blank', 'settings'] as const) test(`cold Wiki resolves ${primary} primary focus through its real citation while retaining the draft and chat part`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 1, groups: [{ size: 330 }, { size: 330 }] });
  const original = harness.groups[0]!, opaqueTab = harness.useOpaquePrimary(primary), draft = harness.addForeignDraft(2);
  const chat = harness.addSeparateEditorPart(); chat.focus(); let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => {
      acquisitions++; harness.focusMutableDraft(); return () => { assert.equal(chat.focused(), false); };
    }, retainCurrentFocus() {
      const focused = chat.focused(); let disposed = false;
      return { dispose() { disposed = true; }, assertRetained() { assert.equal(disposed, false); assert.equal(chat.focused(), focused); } };
    } });
    // Assert
    assert.equal(acquisitions, 1); assert.equal(harness.groups[0], original);
    if (opaqueTab) assert.equal(original.tabs.includes(opaqueTab), true);
    assert.equal(harness.groups[1]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('opening Wiki after Study acquires its citation from a Settings-focused main pane without changing chat or drafts', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  const retainedTabs = [...harness.groups[0]!.tabs], settings = harness.useOpaquePrimary('settings');
  harness.groups[0]!.tabs.push(...retainedTabs); chat.focus();
  let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => {
      acquisitions++; harness.focusMutableDraft(); return () => { assert.equal(chat.focused(), false); };
    } });
    // Assert
    assert.equal(acquisitions, 1); assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[0]!.tabs.includes(settings!), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] }); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const primary of ['application', 'text']) test(`a learner tab selected while borrowing ${primary} primary focus prevents a late Wiki arrangement or focus restoration`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  if (primary === 'text') harness.focusMutableDraft('primary.ts');
  harness.movePanel('codebook.studyContext', 3);
  // A manual geometry change invalidates the retained scope proof and requires an observable primary-focus measurement.
  harness.changeEditorLayout({ orientation: 1, groups: [{ size: 200 }, { size: 300 }, { size: 400 }] });
  const original = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
  const held = harness.holdNextCommand('workbench.action.focusFirstEditorGroup');
  const arranging = harness.reader.arrangeRepository(new AbortController().signal), rejected = assert.rejects(arranging, /primary editor selection changed/i);
  try {
    // Act
    await held.started; draft.focus(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[0]!.activeTab, draft.tab); assert.equal(harness.focusedPanel(), undefined);
    assert.deepEqual(harness.editorLayout(), original);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await arranging.catch(() => {}); await harness.close(); }
});

test('a queued Wiki after Study preserves later learner focus before measuring an owned layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft(), chat = harness.addSeparateEditorPart();
  await harness.reader.open(); const original = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
  const held = harness.holdNextCommand('vscode.getEditorLayout');
  const earlier = harness.reader.arrangeRepository(new AbortController().signal), earlierRejected = assert.rejects(earlier, /changed/);
  await held.started; let retained = true, starts = 0;
  const queued = harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() { starts++; if (!retained) throw new Error('Original learner focus changed.'); } });
  const queuedRejected = assert.rejects(queued, /Original learner focus changed/);
  try {
    // Act
    retained = false; chat.focus(); held.release(); await earlierRejected; await queuedRejected;
    // Assert
    assert.equal(starts, 1); assert.equal(chat.focused(), true); assert.deepEqual(harness.editorLayout(), original);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await Promise.allSettled([earlier, queued]); await harness.close(); }
});

test('cold Wiki retains ordinary text focus without invoking the optional cited-source acquisition', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  harness.focusMutableDraft(); const chat = harness.addSeparateEditorPart(); let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => { acquisitions++; return () => {}; } });
    // Assert
    assert.equal(acquisitions, 0); assert.equal(harness.groups.length, 3); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await harness.close(); }
});
