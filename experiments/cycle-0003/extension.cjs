const vscode = require('vscode');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { awaitResponse } = require('../cycle-0001/dist/utils/awaitResponse.js');
const { waitUntil } = require('../cycle-0001/dist/utils/waitUntil.js');

// Disposable probe, activated only in the runner's owned workspace; no product commands or server.
exports.activate = async () => {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) return;
  let config;
  try { config = JSON.parse(await readFile(join(workspace, 'probe.json'), 'utf8')); } catch { return; }
  const result = { runId: config.runId, apiVersion: vscode.version, commands: [], observations: [], cleanupVerified: false };
  const options = { ownerAgentId: `codebook-${config.runId}` };
  let browserId;
  const invoke = (command, ...args) => awaitResponse(vscode.commands.executeCommand(command, ...args), command);
  // Preserve method/error boundaries; a command response must never be described as a debugger event.
  const cdp = async (method, params = {}) => {
    const started = performance.now();
    try {
      const response = await invoke('cursor.browserView.sendCDPCommand', method, params, browserId, options);
      result.observations.push({ method, durationMs: performance.now() - started, response: method === 'Page.captureScreenshot' ? { hasImage: Boolean(response?.data) } : response });
      return response;
    } catch (error) { result.observations.push({ method, durationMs: performance.now() - started, error: String(error) }); return undefined; }
  };
  try {
    result.commands = (await vscode.commands.getCommands(true)).filter(command => command.startsWith('cursor.browserView.')).sort();
    const created = await invoke('cursor.browserView.newTab', config.url, { agentId: options.ownerAgentId });
    if (!created?.success || !created.browserId) throw new Error('Native browser creation failed');
    browserId = created.browserId;
    result.browserId = browserId;
    await invoke('cursor.browserView.selectTab', browserId, options);
    await waitUntil(async () => {
      const response = await invoke('cursor.browserView.sendCDPCommand', 'Runtime.evaluate', { expression: 'document.documentElement.dataset.probe', returnByValue: true }, browserId, options);
      return response?.result?.value === config.runId;
    }, 'owned fixture navigation');
    await cdp('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    await cdp('Debugger.enable');
    await cdp('Target.getTargetInfo');
    await cdp('JsDebug.subscribe', { events: ['Debugger.paused'] });
    const frame = await cdp('Page.captureScreenshot', { format: 'png' });
    if (frame?.data) await writeFile(join(config.directory, 'page.png'), Buffer.from(frame.data, 'base64'));
    const automation = vscode.extensions.getExtension('cursor.cursor-browser-automation');
    result.automationExtension = automation && { version: automation.packageJSON.version, isActive: automation.isActive, exportKeys: automation.exports ? Object.keys(automation.exports) : [] };
    result.outcome = 'observed';
    result.limits = ['Command responses only. No DAP session, source-bound pause, general event stream or packaged product is demonstrated.'];
  } catch (error) { result.error = String(error); result.outcome = 'incomplete'; }
  finally {
    try {
      if (browserId) { await cdp('Debugger.disable'); await invoke('cursor.browserView.closeTab', browserId, options); }
      const remaining = await invoke('cursor.browserView.listTabs', options);
      result.cleanupVerified = Array.isArray(remaining?.tabs) && !remaining.tabs.includes(browserId);
    } catch (error) { result.cleanupError = String(error); }
    await writeFile(join(config.directory, 'result.json'), JSON.stringify(result, null, 2));
  }
};
