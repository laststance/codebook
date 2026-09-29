import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { isEndpointClosed } from '../runtimeSupport/utils/isEndpointClosed';
import { REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS, REPOSITORY_APPLICATION_LOG_LIMIT_BYTES, REPOSITORY_SETUP_TIMEOUT_MS } from '../constants';
import { repositoryEntryPathSchema } from '../repositoryConfigSchemas';
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint';
import { verifyServerInspectorOwnership } from './verifyServerInspectorOwnership';
import type { Cdp } from '../runtimeSupport/cdp';

/** Acquires one owned process group synchronously for {@link ConfiguredBrowserRun}, exposing cancellable readiness and bounded shutdown. @example const app = launchDevelopmentServer(target, node, record); await app.ready(signal) */
export function launchDevelopmentServer(target: string, node: string, record: (type: string, detail?: unknown) => unknown, inspectServer = false) {
  const environment: NodeJS.ProcessEnv = { NEXT_TELEMETRY_DISABLED: '1', HUSKY: '0', CI: 'true' };
  // Inherit only basic process settings; credentials and unrelated application configuration stay outside the owned process.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'PNPM_HOME', 'USER', 'LOGNAME']) environment[name] = process.env[name];
  const arguments_ = [join(target, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '0'];
  if (inspectServer) arguments_.push('--inspect', '127.0.0.1:0');
  const child = spawn(node, arguments_, { cwd: target, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = Buffer.alloc(0), inspectorLog = Buffer.alloc(0), inspectorCandidate: string | undefined, inspectorError: Error | undefined;
  let error: Error | undefined, origin: string | undefined, closing: Promise<void> | undefined;
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', cause => { error = cause; resolve(); }); });
  const receive = (chunk: Buffer) => { log = Buffer.concat([log, chunk]).subarray(-REPOSITORY_APPLICATION_LOG_LIMIT_BYTES); };
  child.stdout.on('data', receive);
  child.stderr.on('data', (chunk: Buffer) => {
    receive(chunk);
    if (!inspectServer || inspectorError) return;
    inspectorLog = Buffer.concat([inspectorLog, chunk]).subarray(-REPOSITORY_APPLICATION_LOG_LIMIT_BYTES);
    try {
      const candidate = readNodeInspectorEndpoint(inspectorLog.toString('utf8'));
      if (candidate && inspectorCandidate && candidate !== inspectorCandidate) throw new Error('Server inspector endpoint changed during acquisition');
      inspectorCandidate ??= candidate;
    } catch (cause) { inspectorError = cause instanceof Error ? cause : new Error(String(cause)); }
  });
  record('application.acquired', { pid: child.pid, node, arguments: arguments_, cwd: target, secretEnvironmentInherited: false });
  return {
    pid: child.pid,
    isRunning: () => child.pid !== undefined && child.exitCode === null && child.signalCode === null && error === undefined && closing === undefined,
    /** Checks the selected native inspector against this launch before granting server control. @example await app.verifyInspector(cdp, signal) */
    async verifyInspector(inspector: Pick<Cdp, 'request'>, signal: AbortSignal) {
      const assertRunning = () => {
        if (!inspectServer || !child.pid || closing || child.exitCode !== null || child.signalCode !== null || error) throw new Error('Owned server is unavailable for inspector verification');
      };
      assertRunning();
      return verifyServerInspectorOwnership(inspector, target, child.pid!, signal, assertRunning);
    },
    /** Supplies only a candidate for native server attachment; process identity must be verified before runtime control. @example await app.inspectorEndpoint(signal) */
    async inspectorEndpoint(signal: AbortSignal): Promise<string> {
      if (!inspectServer) throw new Error('Server inspection was not requested for this application');
      return waitUntil(() => {
        if (closing || child.exitCode !== null || child.signalCode !== null || error) throw error ?? new Error('Application stopped before server inspector acquisition');
        if (inspectorError) throw inspectorError;
        return inspectorCandidate;
      }, 'owned application inspector announcement', REPOSITORY_SETUP_TIMEOUT_MS, signal);
    },
    /** Waits for the actual ephemeral listener and root compilation, called during preparation. @example await app.ready(signal) */
    async ready(signal: AbortSignal, entryPath = '/') {
      repositoryEntryPathSchema.parse(entryPath);
      origin = await waitUntil(() => {
        if (error || child.exitCode !== null) throw error ?? new Error(`Application exited: ${child.exitCode}: ${log}`);
        // Process chunks may split a port; only a received delimiter proves its complete value.
        return /http:\/\/127\.0\.0\.1:\d+(?=\D)/.exec(log.toString('utf8'))?.[0];
      }, 'owned Next listener', REPOSITORY_SETUP_TIMEOUT_MS, signal);
      const response = await fetch(origin, { signal: AbortSignal.any([signal, AbortSignal.timeout(REPOSITORY_SETUP_TIMEOUT_MS)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Application root failed: ${response.status}: ${log}`);
      if (entryPath !== '/') {
        const entry = await fetch(`${origin}${entryPath}`, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(REPOSITORY_SETUP_TIMEOUT_MS)]) });
        await entry.body?.cancel();
        if (!entry.ok) throw new Error(`Selected application page failed or redirected: ${entry.status}. Select the actual entry path and prerequisites.`);
      }
      record('application.ready', { pid: child.pid, origin });
      return origin;
    },
    /** Stops only the acquired process group and verifies its listener; cleanup calls this even after failed readiness. @example await app.close() */
    async close() {
      const attempt = closing ??= (async () => {
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); }
          catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH')) throw cause; }
          const waitForExit = async () => {
            await awaitResponse(exited, 'owned Next exit', undefined, REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS);
            await waitUntil(() => { try { process.kill(-child.pid!, 0); return false; } catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH') return true; throw cause; } }, 'owned Next process group exit', REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS);
          };
          // A leader may exit before its workers; escalation must cover the entire owned group.
          try { await waitForExit(); }
          catch {
            try { process.kill(-child.pid, 'SIGKILL'); }
            catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH')) throw cause; }
            await waitForExit();
          }
        }
        if (origin) await waitUntil(() => isEndpointClosed(origin!), 'owned Next listener exit', REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS);
        record('application.closed', { pid: child.pid, origin, exitCode: child.exitCode, signal: child.signalCode, log: log.toString('utf8') });
      })();
      // Preserve successful release, while allowing a later stop to retry a failed signal or exit check.
      try { await attempt; } catch (cause) { if (closing === attempt) closing = undefined; throw cause; }
    },
  };
}
