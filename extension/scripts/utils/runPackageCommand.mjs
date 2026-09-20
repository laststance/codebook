import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PACKAGE_COMMAND_OUTPUT_BYTES, PACKAGE_COMMAND_TIMEOUT_MS } from './packageConstants.mjs';

/** Runs package tools with literal arguments and bounded output/time for the build pipeline. @example await runPackageCommand('pnpm', ['build'], extensionRoot) */
export async function runPackageCommand(executable, arguments_, cwd) {
  return promisify(execFile)(executable, arguments_, { cwd, encoding: 'utf8', timeout: PACKAGE_COMMAND_TIMEOUT_MS, maxBuffer: PACKAGE_COMMAND_OUTPUT_BYTES });
}
