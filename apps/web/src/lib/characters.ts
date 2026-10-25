import type { MessageKey } from '@/i18n';

/**
 * Characters and their photodump. A character is fictional by construction: its portrait comes
 * from a text (Z-Image-Turbo), never from a photo of someone; the photodump places that portrait
 * in new scenes with the photo edit (Qwen-Image-Edit), which keeps the face and the outfit.
 */

/** The style of a character. "creature" (an animal person, before the kinds) stays readable on old characters. */
export const CHARACTER_TYPES = ['everyday', 'bold', 'extreme', 'cartoon', 'creature', 'anime', 'clay'] as const;
export type CharacterType = (typeof CHARACTER_TYPES)[number];
/** The styles a new character picks from. */
export const CHARACTER_STYLES = ['everyday', 'bold', 'extreme', 'cartoon', 'anime', 'clay'] as const satisfies readonly CharacterType[];

/** Who the character is: a person, or an animal, a creature or a machine that stands and dresses like one. */
export const CHARACTER_KINDS = ['human', 'cat', 'dog', 'fox', 'frog', 'owl', 'bee', 'ant', 'octopus', 'lizard', 'robot', 'alien'] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

const TYPE_PHRASE: Record<CharacterType, string> = {
  everyday: 'an everyday person with a natural look',
  bold: 'a person with a bold, striking personal style',
  extreme: 'a person with an extreme, larger-than-life look, exaggerated hair and outfit',
  cartoon: 'a stylized 3D animated cartoon character',
  creature: 'an anthropomorphic animal character standing upright and wearing clothes',
  anime: 'an anime character',
  clay: 'a claymation character',
};

/** The body of each kind, short: the portrait's text has 500 characters for everything. */
const KIND_NOUN: Record<Exclude<CharacterKind, 'human'>, string> = {
  cat: 'anthropomorphic cat with soft fur and whiskers',
  dog: 'anthropomorphic dog with floppy ears',
  fox: 'anthropomorphic red fox with a bushy tail',
  frog: 'anthropomorphic frog with green skin and big round eyes',
  owl: 'anthropomorphic owl with feathers and large round eyes',
  bee: 'anthropomorphic bee with fuzzy yellow and black stripes',
  ant: 'anthropomorphic ant with a shiny segmented body',
  octopus: 'anthropomorphic octopus with smooth skin and tentacles',
  lizard: 'anthropomorphic lizard with green scales and a long tail',
  robot: 'friendly humanoid robot with a sleek metal body',
  alien: 'friendly humanoid alien with large eyes',
};

const withArticle = (noun: string) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

const KIND_LOOK: Record<CharacterType, (noun: string) => string> = {
  everyday: (noun) => `${withArticle(noun)}, in everyday clothes`,
  bold: (noun) => `${withArticle(noun)}, with a bold, striking style`,
  extreme: (noun) => `${withArticle(noun)}, with a larger-than-life look`,
  cartoon: (noun) => `a 3D cartoon ${noun}`,
  creature: (noun) => `${withArticle(noun)}, in everyday clothes`,
  anime: (noun) => `an anime ${noun}`,
  clay: (noun) => `a claymation ${noun}`,
};

const FINISH: Record<CharacterType, string> = {
  everyday: 'photorealistic, sharp focus',
  bold: 'photorealistic, sharp focus',
  extreme: 'photorealistic, sharp focus',
  creature: 'photorealistic, sharp focus',
  cartoon: 'clean 3D animation render',
  anime: 'anime style, clean line art, cel shading',
  clay: 'claymation, stop-motion look',
};

/**
 * The fine traits, at most one per group, on top of the kind and the style: a face a little off the norm
 * reads less as a stock picture. Each is a design choice from fiction or fashion (a stone skin, horns,
 * a sculpted hairdo), never the look of a real medical condition.
 */
export const TRAIT_GROUPS = {
  hair: ['sculptural', 'geometric'],
  build: ['longNeck', 'elongated'],
  skin: ['porcelain', 'chrome', 'stone', 'spots', 'stripes', 'scales'],
  extra: ['horns', 'antennae', 'pointedEars'],
  eyes: ['huge', 'violet'],
} as const;
export type TraitGroup = keyof typeof TRAIT_GROUPS;
export const TRAIT_GROUP_NAMES = Object.keys(TRAIT_GROUPS) as TraitGroup[];
export type CharacterTraits = { [G in TraitGroup]?: (typeof TRAIT_GROUPS)[G][number] };

/** What a skin trait covers: the fur, the feathers or the plating of a kind that has no bare skin. */
const SURFACE: Partial<Record<CharacterKind, string>> = { cat: 'fur', dog: 'fur', fox: 'fur', owl: 'feathers', robot: 'plating' };

const TRAIT_PHRASE: { [G in TraitGroup]: Record<(typeof TRAIT_GROUPS)[G][number], (surface: string) => string> } = {
  hair: { sculptural: () => 'sculptural swirling hair', geometric: () => 'sharp geometric hair' },
  build: { longNeck: () => 'a long graceful neck', elongated: () => 'a tall elongated build' },
  skin: {
    porcelain: (surface) => `${surface} like glazed porcelain`,
    chrome: (surface) => `mirror-chrome ${surface}`,
    stone: (surface) => `${surface} of carved grey stone`,
    spots: (surface) => `${surface} patterned with leopard-like spots`,
    stripes: (surface) => `${surface} patterned with tiger-like stripes`,
    scales: () => 'fine shimmering scales',
  },
  extra: { horns: () => 'two small curved horns', antennae: () => 'two thin antennae', pointedEars: () => 'long pointed ears' },
  eyes: { huge: () => 'very large eyes', violet: () => 'vivid violet eyes' },
};

/** The traits that are known choices, in the groups' order; anything else is left out. */
export function knownTraits(traits: unknown): CharacterTraits | null {
  if (traits === undefined) return {};
  if (typeof traits !== 'object' || traits === null || Array.isArray(traits)) return null;
  const known: Record<string, string> = {};
  for (const [group, value] of Object.entries(traits)) {
    const choices: readonly string[] | undefined = Object.hasOwn(TRAIT_GROUPS, group) ? TRAIT_GROUPS[group as TraitGroup] : undefined;
    if (!choices || typeof value !== 'string' || !choices.includes(value)) return null;
    known[group] = value;
  }
  return known as CharacterTraits;
}

/** The traits as words of the portrait's text: "with a, b and c", or nothing. */
function traitWords(traits: CharacterTraits, kind: CharacterKind): string {
  const surface = SURFACE[kind] ?? 'skin';
  const words = TRAIT_GROUP_NAMES.flatMap((group) => {
    const value = traits[group];
    return value ? [(TRAIT_PHRASE[group] as Record<string, (surface: string) => string>)[value]!(surface)] : [];
  });
  if (words.length === 0) return '';
  return `, with ${words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`}`;
}

export const traitGroupKey = (group: TraitGroup) => `characterTraitGroup${group[0]!.toUpperCase()}${group.slice(1)}` as MessageKey;
export const traitKey = (value: string) => `characterTrait${value[0]!.toUpperCase()}${value.slice(1)}` as MessageKey;

/** Who the character is, in its style, with its traits: the start of its portrait's text. */
export function characterLook(type: CharacterType, kind: CharacterKind = 'human', traits: CharacterTraits = {}): string {
  return `${kind === 'human' ? TYPE_PHRASE[type] : KIND_LOOK[type](KIND_NOUN[kind])}${traitWords(traits, kind)}`;
}

/** The text-to-image limit (IMAGE_PROMPT_MAX of @montagio/presets, which the browser does not load; a test keeps both equal). */
export const PORTRAIT_PROMPT_MAX = 500;

/**
 * The portrait's text: who and in which style, its traits, the visitor's words, then a plain full-body
 * studio shot, always fully clothed. The words are cut, rarely, so that the whole text fits the model's limit.
 */
export function characterPrompt(type: CharacterType, details: string, kind: CharacterKind = 'human', traits: CharacterTraits = {}): string {
  const head = `Full-body portrait of a fictional character, ${characterLook(type, kind, traits)}: `;
  // "Fully clothed" alone let an open jacket show skin (GPU, 2026-10-24): the outfit is asked modest too.
  const tail = `. Fully clothed in a modest outfit, facing the camera, plain light grey background, soft even light, ${FINISH[type]}, no text.`;
  return `${head}${fit(details.trim(), PORTRAIT_PROMPT_MAX - head.length - tail.length)}${tail}`;
}

/** The words within `room` characters, cut after a whole word when one ends late enough. */
function fit(words: string, room: number): string {
  if (words.length <= room) return words;
  const cut = words.slice(0, room);
  const space = cut.lastIndexOf(' ');
  return (space > room * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '');
}

export const characterTypeKey = (type: CharacterType) => `characterType${type[0]!.toUpperCase()}${type.slice(1)}` as MessageKey;
/**
 * The kinds whose sample portrait ships in public/characters/kinds/<kind>.webp: Z-Image-Turbo
 * (Apache-2.0) portraits of fictional characters made from characterPrompt on an L4 (2026-10-22 and
 * 2026-10-24), cropped to 240x320.
 */
export const KINDS_WITH_PICTURE: readonly CharacterKind[] = CHARACTER_KINDS;
export const kindPicture = (kind: CharacterKind) => `/characters/kinds/${kind}.webp`;

export const characterKindKey = (kind: CharacterKind) => `characterKind${kind[0]!.toUpperCase()}${kind.slice(1)}` as MessageKey;

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
