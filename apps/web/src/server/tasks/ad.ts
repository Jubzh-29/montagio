import { randomInt } from 'node:crypto';
import { basename, join } from 'node:path';
import { AD_STYLES, adInstruction, compileEdit, compileEffect, compileMusic, type AdStyle, type Library } from '@montagio/presets';
import { exportVertical, mixMusic, overlayImage } from '@montagio/sequence';
import { JobError } from '../errors';
import { musicModel, requireExtension, visibleEffects } from '../extensions';
import { mediaUrlFor } from '../generations';
import { assertConsent, assertAllowedText } from '../guards';
import type { TaskDef } from '../jobs';
import { readUploadMeta } from '../uploads';
import { extensionFile, uploadPath } from './files';

/** The longest tagline: two short lines over a 9:16 frame. */
export const TAGLINE_MAX = 60;
/** The tagline arrives drawn by the browser, a transparent PNG the size of the 9:16 cut. */
const OVERLAY = { width: 720, height: 1280 } as const;
/** ACE-Step's shortest take; the mix cuts it to the clip with a fade. */
const AD_MUSIC_S = 10;

function editModelOf(lib: Library) {
  const model = [...lib.extensionModels.values()].find((entry) => entry.task === 'i2i-edit');
  const template = model && lib.extensionTemplates.get(model.workflow);
  if (!model || !template) throw new Error('no edit model or workflow for an ad');
  return { model, template };
}

/**
 * A product ad, ready to post: the edit stages the product (and a character presenting it) in a
 * scene of the chosen style, an effect animates it, ACE-Step writes its music, then the clip is
 * mixed, cut to 9:16, and the tagline the browser drew is laid over it. Everything is tagged
 * "AI-generated", as every render is.
 */
export const adTask: TaskDef = {
  async prepare(body, lib) {
    await requireExtension('edit');
    await requireExtension('music');
    const effect = (await visibleEffects()).find((entry) => entry.id === body.effectId);
    if (!effect) throw new JobError('extension-disabled');
    const product = typeof body.productRef === 'string' ? await readUploadMeta(body.productRef) : null;
    if (!product) throw new JobError('unknown-image');
    const character = body.characterRef === undefined || body.characterRef === null ? null : typeof body.characterRef === 'string' ? await readUploadMeta(body.characterRef) : undefined;
    if (character === undefined) throw new JobError('unknown-image');
    const style = Object.keys(AD_STYLES).find((id) => id === body.style) as AdStyle | undefined;
    if (!style) throw new JobError('invalid-input');
    const tagline = typeof body.tagline === 'string' ? body.tagline.trim() : '';
    if (tagline.length > TAGLINE_MAX) throw new JobError('invalid-input');
    let overlayRef: string | undefined;
    if (body.overlayRef !== undefined && body.overlayRef !== null) {
      const overlay = typeof body.overlayRef === 'string' ? await readUploadMeta(body.overlayRef) : null;
      if (!overlay || overlay.width !== OVERLAY.width || overlay.height !== OVERLAY.height) throw new JobError('invalid-input');
      overlayRef = overlay.imageRef;
    }
    for (const meta of character ? [product, character] : [product]) assertConsent(meta, body.consent);
    await assertAllowedText(tagline);
    const model = lib.extensionModels.get(effect.models.preferred);
    if (!model) throw new Error(`ad: unknown effect model ${effect.models.preferred}`);
    return {
      inputs: {
        productRef: product.imageRef,
        ...(character ? { characterRef: character.imageRef } : {}),
        style,
        effectId: effect.id,
        ...(tagline ? { tagline } : {}),
        ...(overlayRef ? { overlayRef } : {}),
        personal: product.personal || character?.personal === true,
      },
      label: { itemId: effect.id, name: `Ad · ${effect.name}` },
      modelId: model.id,
      seed: randomInt(0, 2 ** 32),
      aspect: product.aspect,
    };
  },

  steps: (record, lib) => [
    {
      name: 'scene',
      presetId: 'ad-scene',
      extension: 'edit',
      compile: async () => {
        const { model, template } = editModelOf(lib);
        const productRef = String(record.inputs.productRef);
        const characterRef = typeof record.inputs.characterRef === 'string' ? record.inputs.characterRef : undefined;
        const instruction = adInstruction(record.inputs.style as AdStyle, Boolean(characterRef));
        const { workflow, output } = compileEdit(
          model,
          template,
          { imageRef: productRef, ...(characterRef ? { image2Ref: characterRef } : {}), instruction, seed: record.seed, fast: true },
          lib.lock,
        );
        const files = [extensionFile(model, 'image', uploadPath(productRef))];
        if (characterRef) files.push(extensionFile(model, 'image2', uploadPath(characterRef)));
        return { workflow, output, files };
      },
    },
    {
      name: 'effect',
      presetId: String(record.inputs.effectId),
      extension: 'effects',
      compile: async (current) => {
        const preset = lib.effects.get(String(current.inputs.effectId));
        const model = lib.extensionModels.get(current.modelId);
        const template = model && lib.extensionTemplates.get(model.workflow);
        const scene = current.steps[0]?.outputPath;
        if (!preset || !model || !template || !scene) throw new Error('ad: no effect, workflow or scene to animate');
        const { workflow, output } = compileEffect(
          preset,
          model,
          template,
          { imageRef: basename(scene), seed: current.seed, aspect: current.aspect ?? '16:9', fast: preset.defaults.fast },
          lib.lock,
        );
        return { workflow, output, files: [extensionFile(model, 'image', scene)] };
      },
    },
    {
      name: 'music',
      presetId: 'music',
      extension: 'music',
      compile: async () => {
        const model = musicModel(lib);
        const template = lib.extensionTemplates.get(model.workflow);
        if (!template) throw new Error(`the workflow ${model.workflow} of ${model.id} is missing`);
        const prompt = AD_STYLES[record.inputs.style as AdStyle].music;
        const { workflow, output } = compileMusic(model, template, { prompt, duration_s: AD_MUSIC_S, seed: record.seed });
        return { workflow, output, files: [] };
      },
    },
  ],

  async deliver(record, outputPath, dir) {
    const clip = record.steps[1]?.outputPath;
    if (!clip) throw new Error('ad: the animated clip is gone');
    const mixed = join(dir, 'ad-mix.mp4');
    const vertical = join(dir, 'ad-9x16.mp4');
    await mixMusic(clip, outputPath, mixed);
    await exportVertical(mixed, vertical);
    if (typeof record.inputs.overlayRef !== 'string') return { outputUrl: mediaUrlFor(vertical)!, verticalUrl: mediaUrlFor(vertical)! };
    const final = join(dir, 'ad.mp4');
    await overlayImage(vertical, uploadPath(record.inputs.overlayRef), final);
    return { outputUrl: mediaUrlFor(final)!, verticalUrl: mediaUrlFor(final)! };
  },
};
