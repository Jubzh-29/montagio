import { parse as parseYaml } from 'yaml';
import { PresetSchema, type Preset } from './schema';

export class PresetError extends Error {
  override name = 'PresetError';
}

export function parsePreset(yamlText: string, sourceName: string): Preset {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    throw new PresetError(`${sourceName}: invalid YAML (${(error as Error).message})`);
  }
  const result = PresetSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const keys = 'keys' in issue && Array.isArray(issue.keys) ? `.${issue.keys.join(',')}` : '';
        return `${issue.path.join('.') || '(root)'}${keys}: ${issue.message}`;
      })
      .join('; ');
    throw new PresetError(`${sourceName}: ${details}`);
  }
  return result.data;
}
