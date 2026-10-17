import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { LockSchema, ModelSchema, type LockEntry, type ModelEntry } from './schema';

export class RegistryError extends Error {
  override name = 'RegistryError';
}

function parseWith<T>(schema: z.ZodType<T>, yamlText: string, sourceName: string): T {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    throw new RegistryError(`${sourceName}: invalid YAML (${(error as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const keys = 'keys' in issue && Array.isArray(issue.keys) ? `.${issue.keys.join(',')}` : '';
        return `${issue.path.join('.') || '(root)'}${keys}: ${issue.message}`;
      })
      .join('; ');
    throw new RegistryError(`${sourceName}: ${details}`);
  }
  return result.data;
}

export function parseModel(yamlText: string, sourceName: string): ModelEntry {
  return parseWith(ModelSchema, yamlText, sourceName);
}

export function parseLock(yamlText: string, sourceName: string): LockEntry[] {
  return parseWith(LockSchema, yamlText, sourceName).weights;
}
