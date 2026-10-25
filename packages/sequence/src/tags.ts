// MP4 tags Montagio writes on the videos it hands out. No Node module here: the
// showcase writes the same tags on the films it joins in the browser.

/** Container tags, written as `-metadata key=value`. */
export type VideoTags = Readonly<Record<string, string>>;

/** The mention every exported video carries (spec §13: C2PA comes after the contest). */
export const AI_METADATA = {
  comment: 'AI-generated',
  description: 'AI-generated video made with Montagio, an open-source camera-move studio running open-weights models.',
} as const;

/** The mention for a sound: FLAC's Vorbis comments fold a description into the comment, so it is the one tag. */
export const AI_AUDIO_METADATA = { comment: 'AI-generated' } as const;

/** The same mention for a still image (a photo made from a text, or edited). */
export const AI_IMAGE_METADATA = {
  comment: 'AI-generated',
  description: 'AI-generated image made with Montagio, an open-source camera-move studio running open-weights models.',
} as const;

/** What a showcase placeholder says instead: it is FFmpeg's work, not a model's. */
export const PLACEHOLDER_METADATA = {
  comment: 'Montagio showcase placeholder',
  description: 'Placeholder: the camera move is simulated by FFmpeg from the sample photo; it is not a model output.',
} as const;

/** What a clip of the demo backend says when FFmpeg moved the photo: no model made it. */
export const DEMO_MOVE_METADATA = {
  comment: 'Montagio demo render',
  description: 'Demo render: the photo is moved by FFmpeg along the preset; no model made this clip.',
} as const;

/**
 * Where a delivered file carries its compact recipe (@montagio/recipe), beside the mention: MP4's standard
 * `synopsis` atom (no `use_metadata_tags`, so `comment` and `description` stay where players read them),
 * and a PNG tEXt chunk.
 */
export const RECIPE_TAG = { video: 'synopsis', image: 'Montagio-Recipe' } as const;

/** Drop the source's tags (a pod path, an encoder string) and write `tags` as standard MP4 tags. */
export function metadataArgs(tags: VideoTags): string[] {
  return ['-map_metadata', '-1', ...Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`])];
}
