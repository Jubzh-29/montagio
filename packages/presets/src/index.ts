export { CAMERA_COMBINES, CAMERA_POSES, PresetSchema, type CameraCombine, type CameraPose, type Preset } from './schema';
export { parsePreset, PresetError } from './parse';
export { dimensionsFor, frameCount, pickAspect, type Aspect, type Resolution } from './dimensions';
export {
  CAMERA_POSE_PROMPTS,
  CAMERA_POSE_VALUES,
  COMBINED_CAMERA_NODE,
  compileJob,
  CompileError,
  type ApiWorkflow,
  type CompiledParams,
  type JobInputs,
} from './compile';
export { loadLibrary, LibraryError, type Library } from './library';
export { validatePreset, type PresetValidation } from './validate';
export {
  AVATAR_DEFAULT_PROMPT,
  bindExtension,
  compileAvatar,
  compileEdit,
  compileMusic,
  compileSpeech,
  compileUpscale,
  EDIT_LOOKS,
  UPSCALE_TARGETS,
  type AvatarInputs,
  type EditInputs,
  type EditLook,
  type ExtensionCompiled,
  type MusicInputs,
  type SpeechInputs,
  type UpscaleInputs,
} from './extensions';
