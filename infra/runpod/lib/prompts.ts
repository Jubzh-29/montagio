/**
 * The default negative prompt of the official Wan 2.2 templates (Comfy-Org/workflow_templates, MIT,
 * commit 59a3b48b): node 99 of video_wan2_2_14B_fun_camera.json. The workflow conversion leaves it out,
 * since the compiler writes each preset's negative; GPU session S2 compares the two (checklist part 6.4).
 */
export const WAN_DEFAULT_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

/** smoke --negative: "wan" stands for the templates' default negative, any other text is used as it is. */
export function negativeOverride(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) throw new Error(`--negative needs a text, or "wan" for the Wan templates' default negative`);
  return text === 'wan' ? WAN_DEFAULT_NEGATIVE : text;
}
