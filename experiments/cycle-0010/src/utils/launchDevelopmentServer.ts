import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { isEndpointClosed } from 'codebook-cycle-0001/dist/utils/isEndpointClosed';
import { APPLICATION_EXIT_TIMEOUT_MS, APPLICATION_LOG_LIMIT_BYTES, SETUP_TIMEOUT_MS } from '../constants';

/** Acquires one owned process group synchronously for {@link RepositoryRun}, exposing cancellable readiness and bounded shutdown. @example const app = launchDevelopmentServer(target, node, record); await app.ready(signal) */
export function launchDevelopmentServer(target: string, node: string, record: (type: string, detail?: unknown) => unknown) {
  const environment: NodeJS.ProcessEnv = { NEXT_TELEMETRY_DISABLED: '1', HUSKY: '0', CI: 'true' };
  // Inherit only basic process settings; credentials and unrelated application configuration stay outside the clone.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'PNPM_HOME', 'USER', 'LOGNAME']) environment[name] = process.env[name];
  const arguments_ = [join(target, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '0'];
  const child = spawn(node, arguments_, { cwd: target, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', error: Error | undefined, origin: string | undefined, closing: Promise<void> | undefined;
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', cause => { error = cause; resolve(); }); });
  const receive = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-APPLICATION_LOG_LIMIT_BYTES); };
  child.stdout.on('data', receive); child.stderr.on('data', receive);
  record('application.acquired', { pid: child.pid, node, arguments: arguments_, cwd: target, secretEnvironmentInherited: false });
  return {
    pid: child.pid,
    /** Waits for the actual ephemeral listener and root compilation, called during preparation. @example await app.ready(signal) */
    async ready(signal: AbortSignal) {
      origin = await waitUntil(() => {
        if (error || child.exitCode !== null) throw error ?? new Error(`Application exited: ${child.exitCode}: ${log}`);
        return /http:\/\/127\.0\.0\.1:\d+/.exec(log)?.[0];
      }, 'owned Next listener', SETUP_TIMEOUT_MS, signal);
      const response = await fetch(origin, { signal: AbortSignal.any([signal, AbortSignal.timeout(SETUP_TIMEOUT_MS)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Application root failed: ${response.status}: ${log}`);
      record('application.ready', { pid: child.pid, origin });
      return origin;
    },
    /** Stops only the acquired process group and verifies its listener; cleanup calls this even after failed readiness. @example await app.close() */
    close() {
      return closing ??= (async () => {
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); }
          catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH')) throw cause; }
          try { await awaitResponse(exited, 'owned Next exit', undefined, APPLICATION_EXIT_TIMEOUT_MS); }
          catch { process.kill(-child.pid, 'SIGKILL'); await awaitResponse(exited, 'owned Next forced exit', undefined, APPLICATION_EXIT_TIMEOUT_MS); }
          await waitUntil(() => { try { process.kill(-child.pid!, 0); return false; } catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH') return true; throw cause; } }, 'owned Next process group exit', APPLICATION_EXIT_TIMEOUT_MS);
        }
        if (origin) await waitUntil(() => isEndpointClosed(origin!), 'owned Next listener exit', APPLICATION_EXIT_TIMEOUT_MS);
        record('application.closed', { pid: child.pid, origin, exitCode: child.exitCode, signal: child.signalCode, log });
      })();
    },
  };
}
