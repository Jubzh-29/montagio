import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MontagioClient, type ClientDeps } from './client';
import type { Config } from './config';
import { registerTools } from './tools';

export { MontagioClient, type ClientDeps, type RenderStatus } from './client';
export { readConfig, type Config } from './config';
export { ToolFailure } from './errors';
export { TOOL_NAMES } from './tools';

/** What an MCP client reads once, before its first call. */
const INSTRUCTIONS = [
  'Montagio is a local video studio: these tools drive a running Montagio app over its HTTP API.',
  'A photo is an imageRef: get one from upload_photo (a local file), use_sample_photo or text_to_image, or pass path to any tool that takes a photo.',
  'camera_move takes a preset (list_camera_presets) and, strongly recommended, a description of what the photo shows.',
  'apply_effect and apply_hook take ids from list_effects_and_hooks.',
  'Renders block until done (minutes on a GPU) and return the clip URL and its id; past the timeout, follow the render with get_job.',
  'Consent: edit_photo, apply_effect, apply_hook and talking_avatar on an imported photo need consent: true, and motion_transfer, restyle_video and swap_object need rights: true.',
  'Set them only when the user has confirmed it (the person in the photo is them, or has agreed; they hold the rights); never on their behalf.',
].join(' ');

/** The MCP server, its tools bound to the app at config.baseUrl. */
export function createMontagioServer(config: Config, deps: ClientDeps = {}): McpServer {
  const server = new McpServer({ name: 'montagio', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, new MontagioClient(config, deps));
  return server;
}
