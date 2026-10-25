import { characterLook, characterPrompt, type CharacterKind, type CharacterTraits, type CharacterType } from './characters';

/**
 * The starting faces: fictional characters made ahead with the Characters tab's own text (characterPrompt)
 * by Z-Image-Turbo (Apache-2.0), so that a tab asking for a person can start without a photo. Off the
 * norm on purpose (a flawless face reads as a stock picture): extreme people, animals standing like
 * people, robots, aliens, a few in clay or anime. None looks like a real person.
 *
 * Each face is rendered at the Studio's 720p in 9:16 with its own seed, kept in
 * demo-assets/faces/<id>.jpg with its recipe (<id>.recipe.json, the /api/images request that renders it
 * again), and a 240x320 thumbnail in public/characters/faces/<id>.webp.
 */
export type BankFace = {
  id: string;
  /** A first name, made up. */
  name: string;
  kind: CharacterKind;
  style: CharacterType;
  traits: CharacterTraits;
  details: string;
  seed: number;
};

export const CHARACTER_BANK: readonly BankFace[] = [
  { id: 'marlo', name: 'Marlo', kind: 'human', style: 'extreme', traits: { hair: 'sculptural', skin: 'porcelain' }, details: 'a man in his sixties with a silver beard, a long teal velvet coat and a high ruffled collar', seed: 7101 },
  { id: 'ines', name: 'Inès', kind: 'human', style: 'bold', traits: { build: 'longNeck', eyes: 'violet' }, details: 'a woman in her forties with close-cropped white hair, a structured mustard suit and chunky green earrings', seed: 7102 },
  { id: 'tavi', name: 'Tavi', kind: 'human', style: 'extreme', traits: { hair: 'geometric', skin: 'stripes' }, details: 'a young man with a blocky neon-pink haircut, a quilted silver jacket and wide orange trousers', seed: 7103 },
  { id: 'odile', name: 'Odile', kind: 'human', style: 'everyday', traits: { extra: 'pointedEars', eyes: 'huge' }, details: 'an elderly woman with freckles and round cheeks, a lavender cardigan and a long patterned skirt', seed: 7104 },
  { id: 'kwame', name: 'Kwame', kind: 'human', style: 'bold', traits: { hair: 'sculptural', build: 'elongated' }, details: 'a man in his thirties with a tall sculpted hair crown and a flowing indigo robe embroidered in gold', seed: 7105 },
  { id: 'yuki', name: 'Yuki', kind: 'human', style: 'extreme', traits: { hair: 'geometric', skin: 'chrome' }, details: 'a woman in her twenties with a sharp silver bob, a white futuristic puffer jacket and platform boots', seed: 7106 },
  { id: 'bruno', name: 'Bruno', kind: 'human', style: 'everyday', traits: { skin: 'stone', extra: 'horns' }, details: 'a stocky middle-aged man with a kind smile, a plaid flannel shirt, work trousers and a tool belt', seed: 7107 },
  { id: 'saoirse', name: 'Saoirse', kind: 'human', style: 'bold', traits: { skin: 'spots', eyes: 'violet' }, details: 'a red-haired woman in her fifties with a wide-brimmed hat, a green wax jacket and rain boots', seed: 7108 },
  { id: 'pip', name: 'Pip', kind: 'frog', style: 'bold', traits: { eyes: 'violet' }, details: 'a tailored tweed three-piece suit with a pocket watch chain', seed: 7109 },
  { id: 'juniper', name: 'Juniper', kind: 'fox', style: 'everyday', traits: { eyes: 'huge' }, details: 'a cream cable-knit sweater, corduroy trousers and a leather satchel', seed: 7110 },
  { id: 'duke', name: 'Duke', kind: 'dog', style: 'extreme', traits: { hair: 'sculptural' }, details: 'a basset hound with a towering pompadour, a sequined purple stage suit and gold sneakers', seed: 7111 },
  { id: 'atlas', name: 'Atlas', kind: 'owl', style: 'everyday', traits: { build: 'elongated' }, details: 'a grey cardigan, tiny half-moon glasses and a stack of old books under one wing', seed: 7112 },
  { id: 'mochi', name: 'Mochi', kind: 'cat', style: 'extreme', traits: { extra: 'horns', eyes: 'violet' }, details: 'a fluffy white cat with a dramatic feathered cape and a tall golden crown', seed: 7113 },
  { id: 'zuzu', name: 'Zuzu', kind: 'bee', style: 'everyday', traits: { eyes: 'huge' }, details: 'a denim barista apron, a tiny notepad and a paper cup of coffee', seed: 7114 },
  { id: 'gustav', name: 'Gustav', kind: 'lizard', style: 'bold', traits: { hair: 'geometric' }, details: 'a bright tropical shirt, cream linen shorts and woven sandals', seed: 7115 },
  { id: 'ink', name: 'Ink', kind: 'octopus', style: 'everyday', traits: { skin: 'spots' }, details: 'a white double-breasted chef jacket and a tall toque, holding a wooden spoon', seed: 7116 },
  { id: 'bolt', name: 'Bolt', kind: 'robot', style: 'everyday', traits: { skin: 'porcelain', eyes: 'huge' }, details: 'a straw hat, green gardening overalls and a watering can', seed: 7117 },
  { id: 'vesta', name: 'Vesta', kind: 'robot', style: 'bold', traits: { build: 'elongated', hair: 'geometric' }, details: 'a long red trench coat and a copper crest shaped like a hairdo', seed: 7118 },
  { id: 'clank', name: 'Clank', kind: 'robot', style: 'extreme', traits: { extra: 'antennae' }, details: 'a bulky vintage body painted mint green, a bow tie and a checkered waistcoat', seed: 7119 },
  { id: 'zorbel', name: 'Zorbel', kind: 'alien', style: 'everyday', traits: { skin: 'spots', extra: 'antennae' }, details: 'a floral tourist shirt, khaki shorts and a camera on a strap', seed: 7120 },
  { id: 'quill', name: 'Quill', kind: 'alien', style: 'bold', traits: { build: 'longNeck', skin: 'scales' }, details: 'a long pearl-white robe with a high collar and silver cuffs', seed: 7121 },
  { id: 'mirri', name: 'Mirri', kind: 'alien', style: 'extreme', traits: { hair: 'sculptural', eyes: 'huge' }, details: 'a metallic jumpsuit with shoulder pads, glitter boots and a microphone', seed: 7122 },
  { id: 'orbo', name: 'Orbo', kind: 'alien', style: 'cartoon', traits: { extra: 'horns' }, details: 'round and chubby, in a cozy striped sweater and mittens', seed: 7123 },
  { id: 'tilly', name: 'Tilly', kind: 'human', style: 'clay', traits: { hair: 'sculptural', eyes: 'huge' }, details: 'a grandmother baker with a flour-dusted apron and a rolling pin', seed: 7124 },
  { id: 'scout', name: 'Scout', kind: 'dog', style: 'clay', traits: { extra: 'pointedEars' }, details: 'a scruffy terrier postman in a blue uniform and cap, with a mail bag', seed: 7125 },
  { id: 'kiln', name: 'Kiln', kind: 'robot', style: 'clay', traits: { skin: 'stone' }, details: 'a little robot with mismatched buttons and a hand-knitted scarf', seed: 7126 },
  { id: 'ren', name: 'Ren', kind: 'human', style: 'anime', traits: { hair: 'geometric', eyes: 'violet' }, details: 'a courier in her twenties with a yellow messenger bag, a cropped bomber jacket and cargo pants', seed: 7127 },
  { id: 'kitsu', name: 'Kitsu', kind: 'fox', style: 'anime', traits: { eyes: 'violet' }, details: 'a long blue hooded traveling coat, holding a glowing paper lantern', seed: 7128 },
];

/**
 * The faces whose picture ships (demo-assets/faces/ and public/characters/faces/): the others are
 * only planned, and no tab shows them.
 */
export const FACES_WITH_PICTURE: readonly string[] = [];
/** The few faces the static showcase shows on its Characters page. */
export const SHOWCASE_FACES: readonly string[] = [];

export const STARTING_FACES: readonly BankFace[] = CHARACTER_BANK.filter((face) => FACES_WITH_PICTURE.includes(face.id));
export const faceById = (id: string): BankFace | undefined => CHARACTER_BANK.find((face) => face.id === id);

export const facePicture = (id: string) => `/characters/faces/${id}.webp`;
/** The face itself, as the demo-assets route serves it. */
export const facePhoto = (id: string) => `/media/demo-assets/faces/${id}.jpg`;
export const faceRecipe = (id: string) => `/media/demo-assets/faces/${id}.recipe.json`;

/** The portrait's text of a face: the Characters tab's own. */
export const facePrompt = (face: BankFace) => characterPrompt(face.style, face.details, face.kind, face.traits);

/** What the photo of a face shows, for the tabs that describe their start photo. */
export const faceScene = (face: BankFace) => `A fictional character, ${characterLook(face.style, face.kind, face.traits)}: ${face.details}, standing on a plain light grey background`;

/** Who the face is, in a few words: the subject of an effect on it. */
export const faceSubject = (face: BankFace) => (face.kind === 'human' ? face.details : `a ${face.kind} character, ${face.details}`);

/** The key of a face in a link of the Studio (?from=face:<id>). */
export const FACE_KEY_PREFIX = 'face:';
