import type { ApiWorkflow, InputSlot, RecipeContext, RecipeDraft, RecipeStack } from '../src';

/** Four weights of the real lock (registry/models.lock.yaml), and the 5B's own. */
export const LOCK = [
  {
    id: 'wan22-fun-camera-high',
    file: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors',
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors',
    sha256: '89a99cb5ab29e388f2e24fddac48eab4d88ca339d236c7a8d96aabacd0f525ae',
    size: 15301408048,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera',
  },
  {
    id: 'wan22-fun-camera-low',
    file: 'wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors',
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors',
    sha256: 'a2b7b361e3fad907958aa6ad662a3673bad5ffdce14706cffde4baabb98f9020',
    size: 15301408048,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera',
  },
  {
    id: 'wan22-ti2v-5b',
    file: 'wan2.2_ti2v_5B_fp16.safetensors',
    url: 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors',
    sha256: '456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e',
    size: 9999658848,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B',
  },
  {
    id: 'umt5-xxl-fp8',
    file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    sha256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68',
    size: 6735906897,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/google/umt5-xxl',
  },
  {
    id: 'wan21-vae',
    file: 'wan_2.1_vae.safetensors',
    url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors',
    sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
    size: 253815318,
    license: 'Apache-2.0',
    source: 'https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P',
  },
];

/** A pack the voice node reads by folder name: no file of it is named in the workflow. */
export const VOICE_LOCK = [
  't3_mtl23ls_v3.safetensors',
  's3gen.safetensors',
  've.safetensors',
  'conds.pt',
  'grapheme_mtl_merged_expanded_v1.json',
  // the Chinese table the patched tokenizer reads beside the grapheme table
  'Cangjie5_TC.json',
].map(
  (file, index) => ({
    id: `chatterbox-${index}`,
    file,
    url: `https://huggingface.co/ResembleAI/chatterbox/resolve/main/${file}`,
    sha256: String(index).repeat(64),
    license: 'MIT',
    source: 'https://huggingface.co/ResembleAI/chatterbox',
    folder: 'tts/chatterbox/resembleai-mtl-v3',
  }),
);

export const MODELS = [
  {
    id: 'wan22-i2v-a14b-fun-camera',
    name: 'Wan 2.2 Fun Camera',
    license: 'Apache-2.0',
    weights: ['wan22-fun-camera-high', 'wan22-fun-camera-low', 'umt5-xxl-fp8', 'wan21-vae'],
  },
  // Shares the text encoder with the camera model: it must not be listed for a camera clip.
  { id: 'wan22-ti2v-5b', name: 'Wan 2.2 5B', license: 'Apache-2.0', weights: ['wan22-ti2v-5b', 'umt5-xxl-fp8'] },
  { id: 'chatterbox-mtl-voice', name: 'Chatterbox Multilingual V3', license: 'MIT', weights: VOICE_LOCK.map((weight) => weight.id) },
];

export const STACK: RecipeStack = {
  montagio: { version: '0.1.0', commit: '4ac55b6f0000000000000000000000000000beef' },
  comfyui: { tag: 'v0.41.0', commit: '98cc0bf84b7cb1383654c5b402e7612d875d6d22' },
  proxy: '0.1.6',
  nodes: [{ name: 'montagio', version: '0.1.0' }],
};

export const CONTEXT: RecipeContext = { lock: [...LOCK, ...VOICE_LOCK], models: MODELS, stack: STACK };

export const PHOTO_SHA = '9bf2c4365d1a364dfde4a6b7dfd1fcf9d9d16e473959aa42ebd9cc26fec4b532';

/** A camera clip's workflow as Montagio saves it: the start photo is still named by its upload. */
export function cameraWorkflow(): ApiWorkflow {
  return {
    '37': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    '56': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan' } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'A harbour at dawn, slow push in', clip: ['38', 0] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, static', clip: ['38', 0] } },
    '58': { class_type: 'LoadImage', inputs: { image: 'uploads/1b2c3d4e-0000-4000-8000-123456789abc.jpg' } },
    '51': { class_type: 'WanCameraImageToVideo', inputs: { width: 832, height: 480, length: 81, batch_size: 1, start_image: ['58', 0] } },
    '57': { class_type: 'KSamplerAdvanced', inputs: { noise_seed: 42, steps: 4, cfg: 1, sampler_name: 'euler', add_noise: 'enable' } },
    '60': { class_type: 'CreateVideo', inputs: { fps: 16, images: ['8', 0] } },
  };
}

export const PHOTO_SLOT: InputSlot = { node: '58', field: 'image', from: 'imageRef', sha256: PHOTO_SHA };

export function cameraDraft(overrides: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    kind: 'clip',
    task: 'camera',
    name: 'Slow Push',
    createdAt: '2026-10-24T18:00:00.000Z',
    backend: 'local',
    seed: 42,
    preset: { id: 'slow-push', remix: false, sha256: 'a'.repeat(64) },
    presetYaml: 'schema: montagio/preset@0.1\nid: slow-push\n',
    reprise: { tab: 'camera', presetId: 'slow-push', modelId: 'wan22-i2v-a14b-fun-camera', seed: 42 },
    request: {
      route: '/api/generations',
      body: { presetId: 'slow-push', modelId: 'wan22-i2v-a14b-fun-camera', userPrompt: 'A harbour at dawn', seed: 42 },
      files: [{ field: 'imageRef', sha256: PHOTO_SHA }],
    },
    steps: [{ name: 'camera', workflow: cameraWorkflow(), inputs: [PHOTO_SLOT] }],
    post: ['tag'],
    ...overrides,
  };
}
