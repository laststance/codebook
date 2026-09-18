import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Observes only the exact fresh Chrome profile during owned launch/cleanup; never signals other processes. @example await profileProcesses('/tmp/codebook-browser-unique') */
export async function profileProcesses(profile: string): Promise<{ pid: number; command: string }[]> {
  const { stdout } = await promisify(execFile)('ps', ['-axww', '-o', 'pid=,command=']);
  const argument = `--user-data-dir=${profile}`;
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) return [];
    const command = match[2];
    const offset = command.indexOf(argument);
    // Prefix-sharing profiles do not establish ownership.
    if (offset < 0 || (command[offset + argument.length] && command[offset + argument.length] !== ' ')) return [];
    return [{ pid: Number(match[1]), command }];
  });
}
