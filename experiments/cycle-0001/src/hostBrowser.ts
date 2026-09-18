import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { ACTIVE_TIMEOUT_MS, CAPTURE_TIMEOUT_MS, INTERFERENCE_DELAY_MS, type Scenario } from './constants';
import { awaitResponse } from './utils/awaitResponse';
import { waitUntil } from './utils/waitUntil';
import { selectPageTarget } from './utils/selectPageTarget';
import type { selectHost } from './utils/selectHost';
import { CursorCdpBridge } from './cursorCdpBridge';

export interface HostConfiguration {
  id: ReturnType<typeof selectHost>;
  productVersion: string;
  apiVersion: string;
  commit: string;
  endpointPath?: string;
}
interface CursorCommandResult { success: boolean; browserId?: string; error?: string }
interface CursorTabs { tabs: string[] }
type RecordEvent = (type: string, detail?: unknown) => unknown;

/** Owns host-specific browser acquisition/reveal/cleanup for {@link ExperimentRun}; correctness stays in the shared coordinator. @example await browser.launch(configuration, signal) */
export class HostBrowser {
  private tab?: vscode.Tab;
  private readonly cursorIds = new Set<string>();
  private readonly ownerOptions: { ownerAgentId: string };
  private bridge?: CursorCdpBridge;

  constructor(private readonly host: HostConfiguration, private readonly runId: string, private readonly url: string, private readonly record: RecordEvent, private readonly scenario: Scenario) {
    this.ownerOptions = { ownerAgentId: `codebook-${runId}` };
  }

  /** Starts a real debugger using the selected host route, invoked once during run preparation. @example await browser.launch({ name: 'codebook run', type: 'editor-browser', request: 'launch' }, signal) */
  async launch(configuration: vscode.DebugConfiguration, signal: AbortSignal): Promise<void> {
    let debugConfiguration = configuration;
    if (this.host.id === 'cursor') {
      const commands = await awaitResponse(vscode.commands.getCommands(true), 'Cursor browser capabilities', signal);
      const required = ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(operation => `cursor.browserView.${operation}`);
      if (this.scenario === 'missing-capability') { required.push('codebook.deliberately-missing-browser'); this.record('fault.capability-missing'); }
      for (const command of required) if (!commands.includes(command)) throw new Error(`Missing Cursor browser capability: ${command}`);
      if (this.scenario === 'missing-endpoint') this.record('fault.endpoint-missing');
      if (!this.host.endpointPath || this.scenario === 'missing-endpoint') throw new Error('Cursor debugging endpoint descriptor is missing');
      const endpoint: unknown = JSON.parse(await readFile(this.host.endpointPath, 'utf8'));
      if (!endpoint || typeof endpoint !== 'object' || !('port' in endpoint) || typeof endpoint.port !== 'number' || !Number.isInteger(endpoint.port) || endpoint.port <= 0) throw new Error('Invalid Cursor debugging endpoint descriptor');
      const origin = `http://127.0.0.1:${endpoint.port}`;
      // Register returned ownership before checking cancellation, so cleanup can release a late acquisition.
      const created = await awaitResponse(vscode.commands.executeCommand<CursorCommandResult>('cursor.browserView.newTab', this.url, { agentId: this.ownerOptions.ownerAgentId }), 'Cursor browser creation');
      if (!created?.success || !created.browserId) throw new Error(`Cursor browser creation failed: ${created?.error}`);
      this.cursorIds.add(created.browserId);
      this.record('browser.created', { host: this.host.id, browserId: created.browserId });
      signal.throwIfAborted();
      if (this.scenario === 'cancel-browser') {
        this.record('fault.browser-acquisition-held');
        await delay(INTERFERENCE_DELAY_MS, undefined, { signal });
      }
      if (this.scenario === 'ambiguous-target') {
        const duplicate = await awaitResponse(vscode.commands.executeCommand<CursorCommandResult>('cursor.browserView.newTab', this.url, { agentId: this.ownerOptions.ownerAgentId }), 'duplicate owned browser creation');
        if (!duplicate?.success || !duplicate.browserId) throw new Error('Could not create ambiguous-target precondition');
        this.cursorIds.add(duplicate.browserId);
        // The native tab command returns before Chromium finishes navigation; observe the actual duplicate targets.
        await waitUntil(async () => {
          const response = await fetch(`${origin}/json/list`, { signal: AbortSignal.any([signal, AbortSignal.timeout(CAPTURE_TIMEOUT_MS)]) });
          const targets: unknown = await response.json();
          try { selectPageTarget(targets, this.url); return false; }
          catch (error) { if (String(error).includes('Ambiguous fixture browser targets')) { this.record('fault.duplicate-targets-observed', targets); return true; } throw error; }
        }, 'duplicate page navigation', ACTIVE_TIMEOUT_MS, signal);
        this.record('fault.duplicate-target-created', { browserId: duplicate.browserId });
      }
      let previousTargets = '';
      const target = await waitUntil(async () => {
        const response = await fetch(`${origin}/json/list`, { signal: AbortSignal.any([signal, AbortSignal.timeout(CAPTURE_TIMEOUT_MS)]) });
        if (!response.ok) throw new Error(`Cursor debugging endpoint returned ${response.status}`);
        const targets: unknown = await response.json();
        const serialized = JSON.stringify(targets);
        if (serialized !== previousTargets) { this.record('browser.targets-observed', targets); previousTargets = serialized; }
        return selectPageTarget(targets, this.url);
      }, 'unique Cursor page target', ACTIVE_TIMEOUT_MS, signal);
      this.record('browser.target-discovered', target);
      const versionResponse = await fetch(`${origin}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(CAPTURE_TIMEOUT_MS)]) });
      const version: { webSocketDebuggerUrl?: string } = await versionResponse.json();
      if (!version.webSocketDebuggerUrl || new URL(version.webSocketDebuggerUrl).host !== `127.0.0.1:${endpoint.port}`) throw new Error('Cursor upstream debugging endpoint changed');
      this.bridge = new CursorCdpBridge(version.webSocketDebuggerUrl, target.id, this.record);
      const bridgePort = await this.bridge.listen();
      debugConfiguration = { ...configuration, type: 'pwa-chrome', request: 'attach', address: '127.0.0.1', port: bridgePort, urlFilter: this.url, targetSelection: 'automatic' };
    }
    signal.throwIfAborted();
    const launching = vscode.debug.startDebugging(undefined, debugConfiguration);
    if (this.scenario === 'cancel-attach') {
      this.record('fault.attach-acquisition-held');
      // Even a cancelled hold must drain the already-issued launch before releasing its sessions.
      await delay(INTERFERENCE_DELAY_MS, undefined, { signal }).catch(() => undefined);
    }
    const launched = await awaitResponse(launching, 'owned debugger launch');
    signal.throwIfAborted();
    if (!launched) throw new Error(`${this.host.id} rejected the ${debugConfiguration.type} debugger`);
    this.record('host.debugger-started', { host: this.host.id, type: debugConfiguration.type });
    if (this.host.id === 'vscode' && this.scenario === 'cancel-browser') {
      await this.reveal(signal);
      this.record('fault.browser-acquisition-held');
      await delay(INTERFERENCE_DELAY_MS, undefined, { signal });
    }
  }

  /** Reveals the exact owned app after preparation or continuation, without adopting focused tabs. @example await browser.reveal(signal) */
  async reveal(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.host.id === 'cursor') {
      const browserId = [...this.cursorIds][0];
      if (!browserId) throw new Error('Owned Cursor browser is missing');
      const selected = await awaitResponse(vscode.commands.executeCommand<CursorCommandResult>('cursor.browserView.selectTab', browserId, this.ownerOptions), 'owned Cursor browser reveal', signal);
      if (!selected?.success) throw new Error(`Owned Cursor browser disappeared: ${selected?.error}`);
      this.record('browser.revealed', { browserId });
      return;
    }
    const browser = await waitUntil(() => {
      for (const group of vscode.window.tabGroups.all) {
        const tab = group.tabs.find(candidate => candidate === this.tab || (!this.tab && candidate.label === `codebook ${this.runId.slice(0, 8)}`));
        if (tab) return { group, tab };
      }
      return undefined;
    }, 'owned browser tab', ACTIVE_TIMEOUT_MS, signal);
    this.tab = browser.tab;
    if (browser.group.viewColumn !== vscode.ViewColumn.One) throw new Error('Fixture harness expects its owned browser in the first editor group');
    await awaitResponse(vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'), 'browser group focus', signal);
    const index = browser.group.tabs.indexOf(browser.tab);
    if (index < 0) throw new Error('Owned browser tab disappeared before reveal');
    await awaitResponse(vscode.commands.executeCommand('workbench.action.openEditorAtIndex', index), 'owned browser reveal', signal);
    signal.throwIfAborted();
    this.record('browser.revealed', { title: browser.tab.label, index });
  }

  /** Releases recorded handles and observes absence during run teardown; unrelated editors remain open. @example await browser.close() */
  async close(): Promise<void> {
    await this.bridge?.close();
    if (this.host.id === 'cursor') {
      for (const browserId of this.cursorIds) await awaitResponse(vscode.commands.executeCommand('cursor.browserView.closeTab', browserId, this.ownerOptions), 'owned Cursor browser close');
      const tabs = await awaitResponse(vscode.commands.executeCommand<CursorTabs>('cursor.browserView.listTabs', this.ownerOptions), 'Cursor browser cleanup inspection');
      if (!tabs || !Array.isArray(tabs.tabs)) throw new Error('Cursor browser cleanup could not be observed');
      if ([...this.cursorIds].some(browserId => tabs.tabs.includes(browserId))) throw new Error('Owned Cursor browser remains after cleanup');
      this.cursorIds.clear();
    } else {
      // A cancelled launch may have created a tab before the normal reveal adopted its handle.
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab === this.tab || tab.label === `codebook ${this.runId.slice(0, 8)}`);
      for (const tab of tabs) await vscode.window.tabGroups.close(tab);
      if (vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tabs.includes(tab)))) throw new Error('Owned VS Code browser remains after cleanup');
      this.tab = undefined;
    }
    this.record('browser.cleanup-verified', { host: this.host.id, remainingOwnedTabs: 0 });
  }
}
