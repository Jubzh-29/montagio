import { join } from 'node:path';
import type { ExtensionBindingKey, ExtensionModel } from '@montagio/registry';
import { getEnv } from '../env';

/** The node and input an extension model binds a file to (its first target), with the local file to upload. */
export function extensionFile(model: ExtensionModel, key: ExtensionBindingKey, path: string): { node: string; field: string; path: string } {
  const binding = model.bindings[key];
  const target = Array.isArray(binding) ? binding[0] : binding;
  if (!target) throw new Error(`model ${model.id} has no ${key} binding`);
  return { node: target.node, field: target.field, path };
}

/** The file behind an upload's imageRef ("uploads/<id>.png"), under MONTAGIO_DATA. */
export function uploadPath(imageRef: string): string {
  return join(getEnv().data, ...imageRef.split('/'));
}
