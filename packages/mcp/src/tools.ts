import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TERMINAL_STATES, type ExtensionsInfo, type RenderStatus, type MontagioClient, type UploadResult } from './client';
import { messageFor, toFailure, ToolFailure } from './errors';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Every tool this server registers, in the order a client lists them. */
export const TOOL_NAMES = [
  'list_camera_presets',
  'list_effects_and_hooks',
  'list_motion_library',
  'upload_photo',
  'use_sample_photo',
  'text_to_image',
  'edit_photo',
  'camera_move',
  'apply_effect',
  'apply_hook',
  'talking_avatar',
  'motion_transfer',
  'restyle_video',
  'upscale_to_1080p',
  'get_job',
  'list_history',
  'get_workflow',
] as const;

const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The windows a motion transfer of `seconds` is sampled in, as motionWindows of @montagio/presets counts them
 * (81 frames at 16 fps in one; past that, 21 latent frames overlapping by 8): what its time scales with.
 */
function motionWindowsOf(seconds: number): number {
  const frames = Math.min(481, 4 * Math.ceil((Math.floor(seconds * 16) - 1) / 4) + 1);
  return frames <= 81 ? 1 : Math.ceil(((frames - 1) / 4 + 1 - 21) / 13) + 1;
}

// ---------------------------------------------------------------- shared schemas

const imageRef = z
  .string()
  .min(1)
  .optional()
  .describe('A photo the app already has: the imageRef from upload_photo, use_sample_photo, text_to_image, edit_photo or list_history. Give this or path.');
const path = z
  .string()
  .min(1)
  .optional()
  .describe('A local PNG, JPEG or WebP file (10 MB at most), uploaded first. Prefer an absolute path. Give this or imageRef.');
const consent = z
  .boolean()
  .default(false)
  .describe(
    'The person in the photo is you (the user), or has agreed to this. Defaults to false. Set it to true only when the user has said so; never assume it. ' +
      'The app refuses an imported photo without it (consent-required); the sample photo and generated images do not need it.',
  );
const timeoutMinutes = z
  .number()
  .positive()
  .max(24 * 60)
  .optional()
  .describe('How long to wait for the render, in minutes (default 30). Past it the render goes on in the app; follow it with get_job.');

// ---------------------------------------------------------------- results

const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

/** A refusal or a failed render as a tool result: the code, a readable message, what helps to go on. */
function failure(error: unknown): CallToolResult {
  const { code, message, details } = toFailure(error);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: code, message, ...details }, null, 2) }] };
}

/** Run a tool's body: its value as JSON, or its failure with isError, never a thrown error. */
async function guard(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await body());
  } catch (error) {
    return failure(error);
  }
}

/** Add what helps to go on (the photo already uploaded, the estimate) to a failure. */
function annotate(error: unknown, more: Record<string, unknown>): unknown {
  if (error instanceof ToolFailure) {
    for (const [key, value] of Object.entries(more)) if (value !== undefined && !(key in error.details)) error.details[key] = value;
  }
  return error;
}

/** MCP progress notifications while a render runs, when the client asked for them. */
function progressOf(extra: Extra): ((status: RenderStatus) => void) | undefined {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let last = -1;
  return (status) => {
    const progress = Math.round(Math.min(Math.max(status.progress, 0), 1) * 100);
    if (progress <= last) return;
    last = progress;
    extra
      .sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total: 100, message: `${status.task}: ${status.state}` } })
      .catch(() => undefined);
  };
}

// ---------------------------------------------------------------- helpers

type PhotoArgs = { imageRef?: string; path?: string };

/** The photo of a call: its imageRef, uploading the local file first when a path is given. */
async function photoOf(client: MontagioClient, args: PhotoArgs, names = { ref: 'imageRef', path: 'path' }): Promise<{ imageRef: string; uploaded?: UploadResult }> {
  if (args.imageRef && args.path) throw new ToolFailure('invalid-arguments', `Give ${names.ref} or ${names.path}, not both.`);
  if (args.imageRef) return { imageRef: args.imageRef };
  if (args.path) {
    const uploaded = await client.uploadPhoto(args.path);
    return { imageRef: uploaded.imageRef, uploaded };
  }
  throw new ToolFailure('invalid-arguments', `Give the photo: ${names.ref} (from upload_photo, use_sample_photo, text_to_image…) or ${names.path} (a local image file).`);
}

/** The clip of a motion transfer or a restyle: a local file, an earlier videoRef, or a motion of the library. */
type ClipArgs = { videoPath?: string; videoRef?: string; libraryMotion?: string };
async function clipOf(client: MontagioClient, args: ClipArgs): Promise<{ videoRef: string; video?: Record<string, unknown> }> {
  const given = [args.videoPath, args.videoRef, args.libraryMotion].filter(Boolean).length;
  if (given > 1) throw new ToolFailure('invalid-arguments', 'Give one of videoPath, videoRef and libraryMotion.');
  if (given === 0) throw new ToolFailure('invalid-arguments', 'Give the clip: videoPath (a local file), videoRef, or libraryMotion (list_motion_library).');
  if (args.videoRef) return { videoRef: args.videoRef };
  const made = args.videoPath ? await client.uploadVideo(args.videoPath) : await client.pickLibraryMotion(args.libraryMotion!);
  return { videoRef: made.videoRef, video: { duration_s: made.duration_s, sourceDuration_s: made.sourceDuration_s, frames: made.frames, aspect: made.aspect } };
}

/** An estimate in seconds from GET /api/extensions; none when the app does not give one. */
async function estimateOf(client: MontagioClient, pick: (info: ExtensionsInfo) => number | undefined): Promise<number | undefined> {
  try {
    const value = pick(await client.extensions());
    return typeof value === 'number' && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A finished render as a tool returns it, downloaded into MONTAGIO_MCP_OUT when it is set. */
async function finished(client: MontagioClient, done: RenderStatus, more: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...done, ...more };
  if (done.state === 'succeeded' && client.config.outDir && done.outputUrl) {
    try {
      result.file = await client.download(done);
    } catch (error) {
      result.downloadError = toFailure(error).message;
    }
  }
  return result;
}

/** Start a render, poll it to its end, and return it; a failed or canceled render is a ToolFailure. */
async function render(
  client: MontagioClient,
  extra: Extra,
  options: { timeoutMinutes?: number; more?: Record<string, unknown> },
  start: () => Promise<RenderStatus>,
): Promise<Record<string, unknown>> {
  const more = options.more ?? {};
  let done: RenderStatus;
  try {
    const started = await start();
    done = await client.wait(started, {
      ...(options.timeoutMinutes ? { timeoutMs: options.timeoutMinutes * 60_000 } : {}),
      signal: extra.signal,
      onProgress: progressOf(extra),
    });
  } catch (error) {
    throw annotate(error, more);
  }
  if (done.state !== 'succeeded') {
    const reason = done.error ?? done.state;
    const code = CODE.test(reason) ? reason : 'failed';
    throw new ToolFailure(code, CODE.test(reason) ? undefined : `The render failed: ${reason}`, { kind: done.kind, id: done.id, state: done.state, ...more });
  }
  return finished(client, done, more);
}

const defined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

// ---------------------------------------------------------------- tools

export function registerTools(server: McpServer, client: MontagioClient): void {
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const renders = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  server.registerTool(
    'list_camera_presets',
    {
      title: 'List camera presets',
      description:
        'List the camera presets (Slow Push, Crash Push, Pan Left, Crane Up…): id, name, what the move does, and the video models that render them with ' +
        'their time estimate in seconds. Pass a preset id to camera_move.',
      annotations: readOnly,
    },
    async () =>
      guard(async () => {
        const [presets, models] = await Promise.all([client.presets(), client.models()]);
        return {
          presets: presets.map((preset) =>
            defined({
              id: preset.id,
              name: preset.name,
              description: preset.description,
              poses: preset.poses,
              speed: preset.speed,
              defaultModel: preset.defaultModel,
              previewUrl: client.absolute(preset.previewUrl),
            }),
          ),
          models: models
            .filter((model) => model.kind === 'video')
            .map((model) => ({ id: model.id, name: model.name, tier: model.tier, license: model.license, estimate_s: model.estimate_s['480p'] })),
        };
      }),
  );

  server.registerTool(
    'list_effects_and_hooks',
    {
      title: 'List effects, hooks and extensions',
      description:
        'List what this installation renders beyond camera moves: the one-photo effects (Squish, Explode…) for apply_effect, the hooks (keyframe ' +
        'transitions; references: 2 means a second photo, an outfit) for apply_hook, the extensions switched on (edit, effects, transitions, avatar, ' +
        'upscale, motion, restyle…), and the time estimates in seconds.',
      annotations: readOnly,
    },
    async () =>
      guard(async () => {
        const info = await client.extensions();
        return defined({
          extensions: info.extensions,
          effects: info.effects.map((effect) =>
            defined({
              id: effect.id,
              name: effect.name,
              description: effect.description,
              estimate_s: effect.estimate_s,
              subjectMax: effect.subjectMax,
              model: `${effect.modelName} (${effect.license})`,
              previewUrl: client.absolute(effect.previewUrl),
            }),
          ),
          hooks: info.hooks.map((hook) =>
            defined({
              id: hook.id,
              name: hook.name,
              description: hook.description,
              estimate_s: hook.estimate_s,
              references: hook.references,
              model: `${hook.modelName} (${hook.license})`,
              previewUrl: client.absolute(hook.previewUrl),
            }),
          ),
          estimates_s: info.estimates,
          models: defined({ edit: info.editModel, avatar: info.avatarModel, upscale: info.upscaleModel, motion: info.motionModel, restyle: info.restyleModel }),
        });
      }),
  );

  server.registerTool(
    'list_motion_library',
    {
      title: 'List the motion library',
      description:
        'List the reference motions of the library (a dance, jumping jacks, a ballet spin, a 30 s dance…): made by Montagio itself from ' +
        'fictional characters, so no rights to clear. Give an id as libraryMotion to motion_transfer or restyle_video.',
      annotations: readOnly,
    },
    async () =>
      guard(async () =>
        (await client.motions()).map((motion) =>
          defined({ id: motion.id, name: motion.name, description: motion.description, duration_s: motion.duration_s, previewUrl: client.absolute(motion.previewUrl) }),
        ),
      ),
  );

  server.registerTool(
    'upload_photo',
    {
      title: 'Upload a photo',
      description:
        'Send a local photo (PNG, JPEG or WebP, 10 MB at most) to Montagio and get its imageRef for the other tools. An uploaded photo counts as ' +
        'personal: an edit, effect, hook or avatar on it needs consent from the user.',
      inputSchema: { path: z.string().min(1).describe('The local image file. Prefer an absolute path.') },
      annotations: renders,
    },
    async (args) => guard(() => client.uploadPhoto(args.path)),
  );

  server.registerTool(
    'use_sample_photo',
    {
      title: 'Use the sample photo',
      description: 'Get the imageRef of the sample photo bundled with Montagio (16:9, no consent needed), to try any tool without a photo of your own.',
      annotations: renders,
    },
    async () => guard(() => client.useSample()),
  );

  server.registerTool(
    'text_to_image',
    {
      title: 'Text to image',
      description:
        'Make a start photo from a text. Blocks until the image is ready, then returns its URL and its outputImageRef, which every other tool ' +
        'takes as imageRef. Texts naming a well-known person are refused.',
      inputSchema: {
        prompt: z.string().min(1).max(500).describe('What the image shows, in plain words (500 characters at most).'),
        aspect: z.enum(['16:9', '9:16', '1:1']).default('16:9').describe('The image shape. Default 16:9.'),
        seed: z.number().int().min(0).optional().describe('A seed, to make the same image again.'),
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const estimate_s = await estimateOf(client, (info) => info.estimates.t2i);
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { estimate_s } }, () =>
          client.startJob('/api/images', { prompt: args.prompt, aspect: args.aspect, ...(args.seed !== undefined ? { seed: args.seed } : {}) }),
        );
      }),
  );

  server.registerTool(
    'edit_photo',
    {
      title: 'Edit a photo',
      description:
        'Edit a photo with an instruction in plain words ("make the jacket red", "put him on a beach"), optionally with a look: infl8 (inflated), ' +
        'action (action figure), angles (another angle of view). Blocks until done; the result\'s outputImageRef is the edited photo. Needs the edit extension.',
      inputSchema: {
        imageRef,
        path,
        instruction: z.string().min(1).max(500).describe('The change to make, in plain words (500 characters at most).'),
        look: z.enum(['infl8', 'action', 'angles']).optional().describe('A ready-made look instead of, or on top of, the instruction.'),
        consent,
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const photo = await photoOf(client, args);
        const estimate_s = await estimateOf(client, (info) => info.estimates.edit);
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { inputImageRef: photo.imageRef, estimate_s } }, () =>
          client.startJob('/api/edits', {
            imageRef: photo.imageRef,
            instruction: args.instruction,
            ...(args.look ? { look: args.look } : {}),
            consent: args.consent,
          }),
        );
      }),
  );

  server.registerTool(
    'camera_move',
    {
      title: 'Camera move',
      description:
        'Animate a photo with a camera preset (Crash Push, Slow Push, Pull Back Reveal…; ids from list_camera_presets) into a 5 s clip. ' +
        'Strongly recommended: description, what the photo shows; without it the model tends to invent the scene instead of following the photo. ' +
        'Blocks until the clip is ready, then returns its URL and id (for upscale_to_1080p and get_workflow).',
      inputSchema: {
        imageRef,
        path,
        presetId: z.string().min(1).describe('The camera preset id, e.g. "crash-push" (list_camera_presets).'),
        description: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Strongly recommended. What the photo shows, in plain words: the subject, the setting, the light ("a red vintage car on a wet street at ' +
              'night, neon signs"). It matters a lot for quality. Sent to the app as userPrompt.',
          ),
        modelId: z.string().min(1).optional().describe('A video model id (list_camera_presets); default: the preset\'s own.'),
        seed: z.number().int().min(0).optional().describe('A seed, to make the same clip again.'),
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const photo = await photoOf(client, args);
        let estimate_s: number | undefined;
        try {
          const [presets, models] = await Promise.all([client.presets(), client.models()]);
          const modelId = args.modelId ?? presets.find((preset) => preset.id === args.presetId)?.defaultModel;
          estimate_s = models.find((model) => model.id === modelId)?.estimate_s['480p'];
        } catch {
          // no estimate: the render does not need one
        }
        const note = args.description?.trim()
          ? undefined
          : 'No description was given: the clip may drift from the photo. Describe what the photo shows next time.';
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { inputImageRef: photo.imageRef, estimate_s, note } }, () =>
          client.startGeneration({
            presetId: args.presetId,
            imageRef: photo.imageRef,
            ...(args.modelId ? { modelId: args.modelId } : {}),
            ...(args.description?.trim() ? { userPrompt: args.description.trim() } : {}),
            ...(args.seed !== undefined ? { seed: args.seed } : {}),
          }),
        );
      }),
  );

  server.registerTool(
    'apply_effect',
    {
      title: 'Apply an effect',
      description:
        'Apply a one-photo effect (Squish, Cake-ify, Explode, Snap Zoom…; ids from list_effects_and_hooks) to a photo: a 5 s clip. ' +
        'Blocks until the clip is ready, then returns its URL and id.',
      inputSchema: {
        imageRef,
        path,
        effectId: z.string().min(1).describe('The effect id (list_effects_and_hooks), e.g. "squish".'),
        subject: z
          .string()
          .max(500)
          .optional()
          .describe('What the photo shows, in a few words ("a brown dog on a sofa"), up to the effect\'s subjectMax (120 characters by default). Left out, the effect\'s own text is used.'),
        consent,
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const photo = await photoOf(client, args);
        const estimate_s = await estimateOf(client, (info) => info.effects.find((effect) => effect.id === args.effectId)?.estimate_s);
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { inputImageRef: photo.imageRef, estimate_s } }, () =>
          client.startJob('/api/effects', {
            imageRef: photo.imageRef,
            effectId: args.effectId,
            ...(args.subject?.trim() ? { subject: args.subject.trim() } : {}),
            consent: args.consent,
          }),
        );
      }),
  );

  server.registerTool(
    'apply_hook',
    {
      title: 'Apply a hook',
      description:
        'Apply a hook, a keyframe transition (Wardrobe Swap, Ignite…; ids from list_effects_and_hooks): an edit makes the end frame from the photo, ' +
        'then the video model animates the way there. A hook with references: 2 also takes a second photo (an outfit). Blocks until the clip is ready.',
      inputSchema: {
        imageRef,
        path,
        hookId: z.string().min(1).describe('The hook id (list_effects_and_hooks).'),
        image2Ref: z.string().min(1).optional().describe('The second photo of a two-reference hook (an outfit), as an imageRef. Give this or image2Path.'),
        image2Path: z.string().min(1).optional().describe('The second photo as a local image file, uploaded first. Give this or image2Ref.'),
        consent,
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const photo = await photoOf(client, args);
        const second =
          args.image2Ref || args.image2Path
            ? await photoOf(client, { imageRef: args.image2Ref, path: args.image2Path }, { ref: 'image2Ref', path: 'image2Path' }).catch((error: unknown) => {
                throw annotate(error, { inputImageRef: photo.imageRef });
              })
            : undefined;
        const estimate_s = await estimateOf(client, (info) => info.hooks.find((hook) => hook.id === args.hookId)?.estimate_s);
        const more = { inputImageRef: photo.imageRef, ...(second ? { inputImage2Ref: second.imageRef } : {}), estimate_s };
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more }, () =>
          client.startJob('/api/hooks', {
            imageRef: photo.imageRef,
            hookId: args.hookId,
            ...(second ? { image2Ref: second.imageRef } : {}),
            consent: args.consent,
          }),
        );
      }),
  );

  server.registerTool(
    'talking_avatar',
    {
      title: 'Talking avatar',
      description:
        'Make the person of a photo say a text: a voice is made from the text (English or French), then the photo speaks it. The speech must last ' +
        '1 to 15 s. Blocks until the clip is ready. Needs the avatar extension.',
      inputSchema: {
        imageRef,
        path,
        text: z.string().min(1).max(300).describe('What the avatar says (300 characters at most, 15 s of speech at most).'),
        language: z.enum(['en', 'fr']).default('en').describe('The language of the text. Default en.'),
        consent,
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const photo = await photoOf(client, args);
        const estimate_s = await estimateOf(client, (info) => info.estimates.avatar);
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { inputImageRef: photo.imageRef, estimate_s } }, () =>
          client.startJob('/api/avatars', { imageRef: photo.imageRef, text: args.text, language: args.language, consent: args.consent }),
        );
      }),
  );

  server.registerTool(
    'motion_transfer',
    {
      title: 'Motion transfer',
      description:
        'Make the character of a photo move like a reference video (a dance, a gesture). The video is cut to its first 30 s, without sound; ' +
        'past 5 s the render takes about that many times longer, window by window. ' +
        'Needs rights: true, the user\'s word that they hold the rights on the photo and the video; checked before anything is uploaded. ' +
        'Blocks until the clip is ready. Needs the motion extension.',
      inputSchema: {
        imageRef,
        path,
        videoPath: z.string().min(1).optional().describe('The reference video, a local MP4, WebM or MOV file (50 MB at most). Give this or videoRef.'),
        videoRef: z.string().min(1).optional().describe('A reference video already uploaded (the videoRef of an earlier motion_transfer). Give one of videoPath, videoRef, libraryMotion.'),
        libraryMotion: z.string().min(1).optional().describe('A motion of the library (an id from list_motion_library), generated from a fictional character.'),
        character: z.string().max(500).optional().describe('Who the character of the photo is, in a few words (optional).'),
        motion: z.string().max(500).optional().describe('What the character does in the video, in a few words (optional).'),
        rights: z
          .boolean()
          .default(false)
          .describe('The user holds the rights on the photo and the video. Defaults to false. Set it to true only when the user has said so; never assume it.'),
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        // Nothing is sent without the user's word: the app would refuse the same way (rights-required).
        if (args.rights !== true) throw new ToolFailure('rights-required');
        const photo = await photoOf(client, args);
        let clip: Awaited<ReturnType<typeof clipOf>>;
        try {
          clip = await clipOf(client, args);
        } catch (error) {
          throw annotate(error, { inputImageRef: photo.imageRef });
        }
        const { videoRef } = clip;
        const video = clip.video ? { video: clip.video } : {};
        // A clip past one window of 5 s is sampled in context windows: the estimate scales with them.
        const seconds = typeof clip.video?.duration_s === 'number' ? clip.video.duration_s : 5;
        const estimate_s = await estimateOf(client, (info) => (info.estimates.motion === undefined ? undefined : info.estimates.motion * motionWindowsOf(seconds)));
        const more = { inputImageRef: photo.imageRef, videoRef, ...video, estimate_s };
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more }, () =>
          client.startJob('/api/motion', {
            imageRef: photo.imageRef,
            videoRef,
            ...(args.character?.trim() ? { character: args.character.trim() } : {}),
            ...(args.motion?.trim() ? { motion: args.motion.trim() } : {}),
            rights: args.rights,
          }),
        );
      }),
  );

  server.registerTool(
    'restyle_video',
    {
      title: 'Restyle a video',
      description:
        'Rebuild the whole scene of a short clip from a text ("a snowy winter evening", "a watercolor painting"), keeping its motion, camera move ' +
        'and timing. Its first 5 s are rebuilt, without sound. An optional image gives a look to follow; without one, the edit first ' +
        'restyles the clip\'s first frame from the text (when the edit extension is on). Needs rights: true, the user\'s word that they hold the ' +
        'rights on the clip and the image; checked before anything is uploaded. Blocks until the clip is ready. Needs the restyle extension.',
      inputSchema: {
        prompt: z.string().min(1).max(500).describe('What the scene becomes, in a few words.'),
        videoPath: z.string().min(1).optional().describe('The clip, a local MP4, WebM or MOV file (50 MB at most). Give this or videoRef.'),
        videoRef: z.string().min(1).optional().describe('A clip already uploaded (the videoRef of an earlier restyle_video or motion_transfer). Give one of videoPath, videoRef, libraryMotion.'),
        libraryMotion: z.string().min(1).optional().describe('A motion of the library (an id from list_motion_library), generated from a fictional character.'),
        imageRef: z.string().min(1).optional().describe('An image whose look to follow, already in the app (optional). Give this, path, or neither.'),
        path: z.string().min(1).optional().describe('An image whose look to follow, a local file (optional). Give this, imageRef, or neither.'),
        rights: z
          .boolean()
          .default(false)
          .describe('The user holds the rights on the clip (and the image). Defaults to false. Set it to true only when the user has said so; never assume it.'),
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        // Nothing is sent without the user's word: the app would refuse the same way (rights-required).
        if (args.rights !== true) throw new ToolFailure('rights-required');
        const look = args.imageRef || args.path ? await photoOf(client, args) : undefined;
        let clip: Awaited<ReturnType<typeof clipOf>>;
        try {
          clip = await clipOf(client, args);
        } catch (error) {
          throw look ? annotate(error, { inputImageRef: look.imageRef }) : error;
        }
        const { videoRef } = clip;
        const video = clip.video ? { video: clip.video } : {};
        // The restyle, and the edit of its first frame when there is no look image and the edit is on.
        const estimate_s = await estimateOf(client, (info) =>
          info.estimates.restyle === undefined ? undefined : info.estimates.restyle + (!look && info.extensions.includes('edit') ? (info.estimates.edit ?? 0) : 0),
        );
        const more = { ...(look ? { inputImageRef: look.imageRef } : {}), videoRef, ...video, estimate_s };
        return render(client, extra, { timeoutMinutes: args.timeoutMinutes, more }, () =>
          client.startJob('/api/restyle', { videoRef, prompt: args.prompt.trim(), ...(look ? { imageRef: look.imageRef } : {}), rights: args.rights }),
        );
      }),
  );

  server.registerTool(
    'upscale_to_1080p',
    {
      title: 'Upscale to 1080p',
      description:
        'Make an HD 1080p copy of a finished clip: a camera_move clip, or an effect, hook, avatar, motion or restyle clip. The clip must be 121 frames at ' +
        'most (upscale model\'s maxFrames in list_effects_and_hooks). Blocks until done. Needs the upscale extension.',
      inputSchema: {
        id: z.string().min(1).describe('The id of the finished clip (returned by the tool that made it, or from list_history).'),
        kind: z.enum(['generation', 'job']).optional().describe('generation for a camera_move clip, job for the others; found from the id when left out.'),
        smooth: z
          .boolean()
          .optional()
          .describe('Smooth motion: RIFE puts a frame between each two, twice the frame rate (16 fps clips come out at 32), same length. Default true.'),
        timeoutMinutes,
      },
      annotations: renders,
    },
    async (args, extra) =>
      guard(async () => {
        const kind = args.kind ?? (await client.find(args.id)).kind;
        const estimate_s = await estimateOf(client, (info) => info.estimates.upscale);
        try {
          return await render(client, extra, { timeoutMinutes: args.timeoutMinutes, more: { sourceId: args.id, estimate_s } }, () =>
            client.startUpscale(kind, args.id, args.smooth ?? true),
          );
        } catch (error) {
          if (error instanceof ToolFailure && error.code === 'invalid-input') {
            throw new ToolFailure(
              'invalid-input',
              'This clip cannot be upscaled: it must be finished and 121 frames at most (the upscale model\'s maxFrames).',
              error.details,
            );
          }
          throw error;
        }
      }),
  );

  server.registerTool(
    'get_job',
    {
      title: 'Get a render',
      description:
        'Read a render by id: a job (image, edit, effect, hook, avatar, motion, upscale) or a camera clip. Reading it also moves it forward in the ' +
        'app. With wait: true, block until it ends (use it after a timeout).',
      inputSchema: {
        id: z.string().min(1).describe('The render id.'),
        wait: z.boolean().default(false).describe('Block until the render ends. Default false: one read.'),
        timeoutMinutes,
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      guard(async () => {
        let status = await client.find(args.id);
        if (args.wait && !TERMINAL_STATES.has(status.state)) {
          status = await client.wait(status, {
            ...(args.timeoutMinutes ? { timeoutMs: args.timeoutMinutes * 60_000 } : {}),
            signal: extra.signal,
            onProgress: progressOf(extra),
          });
        }
        const result = await finished(client, status);
        if (status.state === 'failed' || status.state === 'canceled') {
          const reason = status.error ?? status.state;
          result.message = CODE.test(reason) ? messageFor(reason) : `The render failed: ${reason}`;
        }
        return result;
      }),
  );

  server.registerTool(
    'list_history',
    {
      title: 'List history',
      description:
        'List what this Montagio has made, newest first: photos, clips and films with their URLs. A photo\'s imageRef can start a new render; ' +
        'a clip\'s id works with upscale_to_1080p and get_workflow.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(20).describe('How many items, newest first. Default 20.'),
        kind: z.enum(['photo', 'clip', 'film']).optional().describe('Only photos, clips or films.'),
      },
      annotations: readOnly,
    },
    async (args) =>
      guard(async () => {
        const items = (await client.history()).filter((item) => !args.kind || item.kind === args.kind).slice(0, args.limit);
        return items.map((item) =>
          defined({
            id: item.key.slice(item.key.indexOf(':') + 1),
            source: item.source,
            kind: item.kind,
            task: item.task,
            name: item.name,
            model: item.modelName,
            createdAt: item.createdAt,
            url: client.absolute(item.downloadUrl),
            // A photo's own imageRef; a clip's start photo.
            ...(item.kind === 'photo' ? { imageRef: item.reprise?.imageRef } : { startImageRef: item.reprise?.imageRef }),
            presetId: item.reprise?.presetId,
            effectId: item.reprise?.effectId,
            hookId: item.reprise?.hookId,
          }),
        );
      }),
  );

  server.registerTool(
    'get_workflow',
    {
      title: 'Get the ComfyUI workflow',
      description:
        'Get the ComfyUI workflow (API format JSON) behind a clip or an image, to open, inspect or tweak it in ComfyUI. With save: true it is ' +
        'written as a new .json file in the output folder (MONTAGIO_MCP_OUT) and the path is returned; otherwise the JSON itself is returned.',
      inputSchema: {
        id: z.string().min(1).describe('The id of the clip or image (returned by the tool that made it, or from list_history).'),
        save: z.boolean().optional().describe('Write the JSON into the output folder (MONTAGIO_MCP_OUT) instead of returning it. Never overwrites a file.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { workflow, filename } = await client.workflow(args.id);
        if (!args.save) return { id: args.id, filename, workflow };
        // Writes go to the output folder only, as a new .json file: a tool call never chooses where on disk it writes.
        const outDir = client.config.outDir;
        if (!outDir) {
          throw new ToolFailure('no-output-folder', 'Set MONTAGIO_MCP_OUT to save files; without it, call get_workflow without save to get the JSON.');
        }
        await mkdir(outDir, { recursive: true });
        const folder = await realpath(outDir);
        const stem = basename(filename).replace(/\.json$/i, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'workflow';
        for (let n = 0; n < 100; n++) {
          const target = join(folder, `${stem}${n > 0 ? `-${n}` : ''}.json`);
          try {
            await writeFile(target, `${JSON.stringify(workflow, null, 2)}\n`, { flag: 'wx' });
            return { id: args.id, filename, path: target };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          }
        }
        throw new ToolFailure('save-failed', `The output folder already holds 100 files named ${stem}*.json.`);
      }),
  );
}
