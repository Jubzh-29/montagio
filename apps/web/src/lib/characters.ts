import type { MessageKey } from '@/i18n';

/**
 * Characters and their photodump. A character is fictional by construction: its portrait comes
 * from a text (Z-Image-Turbo), never from a photo of someone; the photodump places that portrait
 * in new scenes with the photo edit (Qwen-Image-Edit), which keeps the face and the outfit.
 */
export const CHARACTER_TYPES = ['everyday', 'bold', 'extreme', 'cartoon', 'creature'] as const;
export type CharacterType = (typeof CHARACTER_TYPES)[number];

const TYPE_PHRASE: Record<CharacterType, string> = {
  everyday: 'an everyday person with a natural look',
  bold: 'a person with a bold, striking personal style',
  extreme: 'a person with an extreme, larger-than-life look, exaggerated hair and outfit',
  cartoon: 'a stylized 3D animated cartoon character',
  creature: 'an anthropomorphic animal character standing upright and wearing clothes',
};

/** The portrait's text: the type, the visitor's words, then a plain studio full-body shot. */
export function characterPrompt(type: CharacterType, details: string): string {
  const finish = type === 'cartoon' ? 'clean 3D animation render' : 'photorealistic, sharp focus';
  return `Full-body portrait of a fictional character, ${TYPE_PHRASE[type]}: ${details.trim()}. Standing and facing the camera, plain light grey studio background, soft even light, ${finish}, no text.`;
}

export const characterTypeKey = (type: CharacterType) => `characterType${type[0]!.toUpperCase()}${type.slice(1)}` as MessageKey;

/** The photodump's scenes: places a creator posts from. */
export const SCENES = ['cafe', 'beach', 'street', 'mountain', 'kitchen', 'rooftop', 'studio', 'snow'] as const;
export type Scene = (typeof SCENES)[number];
export const DEFAULT_SCENES: readonly Scene[] = SCENES.slice(0, 6);

const SCENE_PHRASE: Record<Scene, string> = {
  cafe: 'sitting at a café terrace in Paris in the morning',
  beach: 'walking on a sandy beach at sunset',
  street: 'standing on a neon-lit city street at night',
  mountain: 'hiking on a mountain trail on a sunny day',
  kitchen: 'cooking in a cozy home kitchen',
  rooftop: 'on a city rooftop at golden hour',
  studio: 'posing in a photo studio in front of a colored backdrop',
  snow: 'walking in a snowy forest in winter',
};

export const sceneKey = (scene: Scene) => `scene${scene[0]!.toUpperCase()}${scene.slice(1)}` as MessageKey;
export const scenePhrase = (scene: Scene) => SCENE_PHRASE[scene];

/** The place of a photodump picture, read back from what it shows (its text ends with the place's phrase). */
export const placeOf = (shows: string): Scene | undefined => SCENES.find((scene) => shows.endsWith(SCENE_PHRASE[scene]));

/** The edit's instruction for one photodump picture. */
export function photodumpInstruction(where: string): string {
  return `Show this same character ${where.trim()}. Keep the exact same face, hair, body and outfit. A natural, candid photo, as if taken by a friend, realistic light.`;
}

/** What the picture shows, for the camera moves that animate it later (the Studio's "what the photo shows"). */
export function photodumpScene(description: string, where: string): string {
  return `${description.trim()}, ${where.trim()}`.slice(0, 500);
}
