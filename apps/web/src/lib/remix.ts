import type { GenerationRecord } from './api-types';

/** The remix editor, as far as the result's "Remix preset" needs to know it. */
export type RemixEditorState = {
  baseId: string;
  /** The generation whose preset the editor holds: the remix it was opened from, or the last one it rendered. */
  generationId?: string;
  text: string;
  original: string;
};

type FinishedGeneration = Pick<GenerationRecord, 'id' | 'presetId' | 'remix'>;

/** Where a finished generation's preset text is: a remix kept its own copy, any other comes from the library. */
export function presetTextUrl(record: FinishedGeneration): string {
  return record.remix
    ? `/api/generations/${encodeURIComponent(record.id)}/preset`
    : `/api/presets/${encodeURIComponent(record.presetId)}/yaml`;
}

/**
 * What the result's "Remix preset" does with the editor as it stands: "focus" when it
 * already holds this generation's preset, "confirm" before edits of another preset are
 * replaced, "open" otherwise.
 */
export function resultRemixAction(editor: RemixEditorState | null, record: FinishedGeneration): 'focus' | 'confirm' | 'open' {
  if (!editor) return 'open';
  const holdsThis = record.remix ? editor.generationId === record.id : editor.baseId === record.presetId;
  if (holdsThis) return 'focus';
  return editor.text === editor.original ? 'open' : 'confirm';
}
