const vscode = require('vscode');
const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

exports.run = async function () {
  const result = { appName: vscode.env.appName, apiVersion: vscode.version, independentVisualInspection: false, observations: {} };
  const owned = [];
  let provider;
  try {
    const baseline = await vscode.commands.executeCommand('vscode.getEditorLayout');
    result.observations.baseline = baseline;
    const foreign = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'Unrelated unsaved learning notes\n' });
    const foreignEditor = await vscode.window.showTextDocument(foreign, { viewColumn: vscode.ViewColumn.One, preview: false });
    await foreignEditor.edit(edit => edit.insert(new vscode.Position(1, 0), 'Keep this draft.\n'));
    assert.equal(foreign.isDirty, true);
    const expectedForeignText = foreign.getText();
    provider = vscode.workspace.registerTextDocumentContentProvider('codebook-probe', { provideTextDocumentContent: () => 'const capturedCartCount = 0;\n' });
    const app = vscode.window.createWebviewPanel('codebook.probe.app', 'Codebook app probe', vscode.ViewColumn.One, {}); owned.push(app);
    app.webview.html = '<html><body>Owned application placeholder</body></html>';
    const sourceUri = vscode.Uri.parse('codebook-probe:/captured/source.ts');
    const source = await vscode.workspace.openTextDocument(sourceUri);
    await vscode.window.showTextDocument(source, { viewColumn: vscode.ViewColumn.Two, preserveFocus: true, preview: false });
    const context = vscode.window.createWebviewPanel('codebook.probe.context', 'Codebook context probe', vscode.ViewColumn.Three, {}); owned.push(context);
    context.webview.html = '<html><body>Owned explanation placeholder</body></html>';
    const requested = { orientation: 0, groups: [{ groups: [{}, {}] }, {}] };
    await vscode.commands.executeCommand('vscode.setEditorLayout', requested);
    const arranged = await vscode.commands.executeCommand('vscode.getEditorLayout');
    assert.equal(arranged.orientation, 0);
    assert.equal(arranged.groups.length, 2);
    assert.equal(arranged.groups[0].groups.length, 2);
    assert.ok(arranged.groups.every(group => group.size > 200), 'Both columns retain usable API geometry');
    assert.ok(arranged.groups[0].groups.every(group => group.size > 200), 'App and source retain usable API geometry');
    assert.equal(vscode.window.tabGroups.all.length, 3);
    assert.equal(app.viewColumn, 1); assert.equal(context.viewColumn, 3);
    const sourceGroup = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sourceUri.toString()));
    assert.equal(sourceGroup.viewColumn, 2);
    assert.equal(foreign.getText(), expectedForeignText); assert.equal(foreign.isDirty, true);
    result.observations.arranged = arranged;
    result.observations.appColumn = app.viewColumn;
    result.observations.sourceColumn = sourceGroup.viewColumn;
    result.observations.contextColumn = context.viewColumn;
    result.observations.foreignDirtyDocumentPreserved = true;
    assert.equal(source.getText(), 'const capturedCartCount = 0;\n');
    result.observations.capturedSourceProvider = true;
    await vscode.window.showTextDocument(source, { viewColumn: vscode.ViewColumn.Two, preview: false });
    await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
    const movedGroup = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sourceUri.toString()));
    assert.equal(vscode.window.tabGroups.all.length, 2, 'Empty source group collapses after a move');
    assert.equal(movedGroup.viewColumn, context.viewColumn, 'Source moved into the context group despite renumbering');
    assert.notEqual(movedGroup.viewColumn, app.viewColumn, 'Application remains in its own group');
    result.observations.afterMove = { layout: await vscode.commands.executeCommand('vscode.getEditorLayout'), sourceColumn: movedGroup.viewColumn, contextColumn: context.viewColumn, appColumn: app.viewColumn, groupCount: vscode.window.tabGroups.all.length }; 
    const sourceTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sourceUri.toString());
    await vscode.window.tabGroups.close(sourceTabs, true);
    app.dispose(); context.dispose();
    assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === foreign.uri.toString())));
    assert.equal(foreign.isDirty, true); assert.equal(foreign.getText(), expectedForeignText);
    result.observations.ownedClosePreservesForeignDraft = true;
    result.passed = true;
  } catch (error) { result.passed = false; result.error = String(error); }
  finally {
    owned.forEach(panel => panel.dispose()); provider?.dispose();
    await writeFile(join(process.env.CODEBOOK_LAYOUT_PROBE, 'result.json'), JSON.stringify(result, null, 2));
  }
};
