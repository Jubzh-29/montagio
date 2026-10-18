// Types only: the web app imports them in the browser (`@montagio/showcase/data`).
import type { OpenStackReport } from '@montagio/check-open-stack';
import type { ApiWorkflow, Aspect } from '@montagio/presets';
import type { LockEntry, ModelEntry } from '@montagio/registry';

/**
 * Everything the static showcase needs, written by `showcase prepare` to
 * public/showcase/data.json. URLs are relative to the showcase folder
 * ("clips/…"); the page prefixes them with its base path.
 */
export type ShowcaseData = {
  schema: 'montagio/showcase-data@0.1';
  builtAt: string;
  /** The public repository (source code link, AGPL-3.0 §13, and "run it yourself"). */
  repoUrl: string | null;
  /** The model every rendered clip was made with. */
  model: { id: string; name: string; license: string };
  /** `preview` is a light loop of the preset on the first sample, for the gallery tile. */
  presets: { id: string; name: string; description: string; poses: string[]; speed: number; defaultModel: string; preview: string; yaml: string }[];
  models: { id: string; name: string; kind: 'video' | 'image'; tier: 'quality' | 'fast'; license: string; estimate_s: { '480p': number; '720p'?: number } }[];
  /** What validatePreset needs, as Map entries. */
  library: { models: [string, ModelEntry][]; templates: [string, ApiWorkflow][]; lock: [string, LockEntry][] };
  samples: { id: string; title: { en: string; fr: string }; aspect: Aspect; url: string; placeholder: boolean; credit: string }[];
  clips: { preset: string; sample: string; url: string; verticalUrl: string; workflowUrl: string; placeholder: boolean }[];
  openStack: OpenStackReport;
};
