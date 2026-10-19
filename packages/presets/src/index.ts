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
  bindExtension,
  compileMusic,
  compileUpscale,
  UPSCALE_TARGETS,
  type ExtensionCompiled,
  type MusicInputs,
  type UpscaleInputs,
} from './extensions';
