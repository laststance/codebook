import * as vscode from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { nodeTestConfigSchema } from './nodeTestConfigSchemas';
import { OwnedNodeTestRun } from './ownedNodeTestRun';
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable';

/** Runs the reusable owned Node runtime against an external test in an isolated native editor profile. Called only by the extension test runner. @example --extensionTestsPath dist/nativeNodeTestBootstrap.js */
export async function run(): Promise<void> {
  const configPath = process.env.CODEBOOK_NODE_TEST_CONFIG_PATH;
  const reportPath = process.env.CODEBOOK_NODE_TEST_REPORT_PATH;
  if (!configPath || !reportPath) throw new Error('External Node test configuration and private report paths are required.');
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) throw new Error('Open the external test repository before this trial.');
  const configuration = nodeTestConfigSchema.parse(JSON.parse(await readFile(configPath, 'utf8')));
  const events: string[] = [];
  const report: Record<string, unknown> = { host: vscode.env.appName, workspace, testFile: configuration.testFile, source: configuration.source, events };
  const node = await resolveExternalNodeExecutable('node');
  const run = new OwnedNodeTestRun(workspace, configuration, node, (type, detail) => { events.push(`${type} ${JSON.stringify(detail)}`); });
  try {
    report.sourceStop = await run.prepare();
    const holdMs = Number(process.env.CODEBOOK_NODE_TEST_HOLD_MS ?? '0');
    if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 60_000) throw new Error('Invalid private Node test observation hold.');
    if (holdMs) await delay(holdMs);
    const additionalStops = [];
    while (run.hasNextStop()) additionalStops.push(await run.advance());
    report.additionalStops = additionalStops;
    report.result = await run.complete();
    const holdAfterMs = Number(process.env.CODEBOOK_NODE_TEST_HOLD_AFTER_MS ?? '0');
    if (!Number.isInteger(holdAfterMs) || holdAfterMs < 0 || holdAfterMs > 60_000) throw new Error('Invalid private Node test result observation hold.');
    if (holdAfterMs) await delay(holdAfterMs);
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    try { await run.stop(); }
    finally { await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }); }
  }
}
