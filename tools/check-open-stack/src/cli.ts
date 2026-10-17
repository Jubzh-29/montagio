#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { checkOpenStack } from './check';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
const root = resolve(args.find((arg, index) => !arg.startsWith('--') && index !== outIndex + 1) ?? '.');

const report = await checkOpenStack(root);
if (out) {
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
}

if (report.ok) {
  console.log(`open stack: OK — ${report.models.length} model(s), every weight Apache-2.0 or MIT, no closed API`);
} else {
  console.error(`open stack: ${report.violations.length} violation(s)`);
  for (const v of report.violations) console.error(`  [${v.rule}] ${v.file}: ${v.detail}`);
  process.exitCode = 1;
}
