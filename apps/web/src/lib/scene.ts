import { defaultSubject } from './effect-choice';
import type { StudioRestore } from './reprise';
import type { Tab } from './tabs';

/** The longest description the Studio sends: the field's limit, and the server's cut (api/generations, api/sequences). */
export const SCENE_MAX = 500;

/**
 * A camera move renders well only from a description of what the photo shows: without one, Fun Camera
 * invents what it cannot see (the ghost of the first GPU render, docs/S2_RESULTATS.md part 3). The Camera
 * and Film tabs ask for it; the showcase plays clips already rendered and asks for nothing.
 */
export function needsScene(tab: Tab, showcase: boolean): boolean {
  return !showcase && (tab === 'camera' || tab === 'film');
}

/** Generate waits on a camera move until the photo is described. */
export function sceneMissing(tab: Tab, showcase: boolean, scene: string): boolean {
  return needsScene(tab, showcase) && scene.trim().length === 0;
}

/** The description a photo comes with: the text it was made from, cut on a word; none for another photo. */
export function sceneOf(photoText: string | undefined): string {
  return defaultSubject(photoText, SCENE_MAX);
}

/** A Reuse's description: the scene its clip was rendered with, else the text its photo was made from. */
export function restoredScene(back: Pick<StudioRestore, 'prompt' | 'photoPrompt'>): string {
  return back.prompt ?? sceneOf(back.photoPrompt);
}
