// The browser-safe part of @montagio/presets: everything but loadLibrary, which
// reads the repository with node:fs. The static showcase checks a remixed
// preset in the page with validatePreset, on a library it gets as JSON.
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
export type { Library } from './library';
export { validatePreset, type PresetValidation } from './validate';
