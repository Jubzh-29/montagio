import { parse as parseYaml } from 'yaml';
import { PresetSchema, type Preset } from './schema';

export class PresetError extends Error {
  override name = 'PresetError';
  /** One entry per problem, "<path>: <message>", without the source name. */
  readonly issues: string[];

  constructor(message: string, issues: string[] = [message]) {
    super(message);
    this.issues = issues;
  }
}

export function parsePreset(yamlText: string, sourceName: string): Preset {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (error) {
    const issue = `invalid YAML (${(error as Error).message})`;
    throw new PresetError(`${sourceName}: ${issue}`, [issue]);
  }
  const result = PresetSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const keys = 'keys' in issue && Array.isArray(issue.keys) ? `.${issue.keys.join(',')}` : '';
      return `${issue.path.join('.') || '(root)'}${keys}: ${issue.message}`;
    });
    throw new PresetError(`${sourceName}: ${issues.join('; ')}`, issues);
  }
  return result.data;
}
