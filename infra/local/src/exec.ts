/**
 * Running programs. Never through a shell: every path (a clone or a user
 * folder can hold spaces) reaches the program as one argument.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Os } from './platform.ts';
import { pathFor } from './platform.ts';

export type Captured = { code: number | null; stdout: string; stderr: string };
export type Capture = (cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }) => Promise<Captured>;
export type Stream = (cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean }) => Promise<number>;

/** Run a program and read its output. A program that cannot be started gives code null. */
export const capture: Capture = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, opts.timeoutMs ?? 30_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', () => done(null));
    child.on('close', (code) => done(code));
  });

/** Run a program with its output shown to the person, and give its exit code. */
export const stream: Stream = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    // shell is only ever true for the `npm` fallback, whose arguments hold no path.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: opts.shell ?? false, stdio: 'inherit', windowsHide: true });
    child.on('error', (error) => reject(new Error(`cannot run ${cmd}: ${error.message}`)));
    child.on('close', (code) => resolve(code ?? 1));
  });

/**
 * How to run npm without a shell: npm-cli.js next to this node (npm.cmd on
 * Windows cannot be spawned without one). `npm` through a shell is the last resort.
 */
export function npmInvocation(
  execPath: string,
  os: Os,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): { cmd: string; args: string[]; shell: boolean } {
  const path = pathFor(os);
  const candidates = [
    env.npm_execpath?.endsWith('npm-cli.js') ? env.npm_execpath : null,
    os === 'windows'
      ? path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(path.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const cli of candidates) if (cli && exists(cli)) return { cmd: execPath, args: [cli], shell: false };
  return { cmd: 'npm', args: [], shell: true };
}

export function tsxCli(repoRoot: string): string {
  return join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

export function nextBin(repoRoot: string): string {
  return join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
}
