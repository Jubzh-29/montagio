import { AI_METADATA, metadataArgs, PLACEHOLDER_METADATA, type VideoTags } from '@montagio/sequence/tags';

/** A film says it is AI-generated only when every shot is a rendered clip. */
export const filmTags = (placeholder: boolean): VideoTags => (placeholder ? PLACEHOLDER_METADATA : AI_METADATA);

/**
 * Join the clips listed in `list` without re-encoding them: every showcase
 * clip shares one encoding (SHOWCASE_X264), checked when the showcase is built.
 */
export function concatArgs(list: string, out: string, tags: VideoTags): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...metadataArgs(tags), '-movflags', '+faststart', out];
}
