/** What the canvas (the Studio's right-hand area) shows. */
export type CanvasView = 'gallery' | 'result' | 'atelier';

/** The view, and the one the atelier returns to when it closes. */
export type CanvasState = { view: CanvasView; before: Exclude<CanvasView, 'atelier'> };

export type CanvasEvent = 'generate' | 'change' | 'tab' | 'open-atelier' | 'close-atelier';

/**
 * Generate shows the result; "Change" and a new tab bring the wall back; the photo
 * atelier (text to image, edit) opens over either, and closing it returns there.
 */
export function nextView(event: CanvasEvent, state: CanvasState): CanvasState {
  switch (event) {
    case 'generate':
      return { view: 'result', before: state.before };
    case 'change':
    case 'tab':
      return { view: 'gallery', before: state.before };
    case 'open-atelier':
      return state.view === 'atelier' ? state : { view: 'atelier', before: state.view };
    case 'close-atelier':
      return { view: state.before, before: state.before };
  }
}

/** The tab the Studio shows, and whether /api/extensions had answered when it was chosen. */
export type ShownTab = { tab: string; known: boolean };

/**
 * A tab the visitor opens brings its wall back. Until /api/extensions answers, the tab is a
 * guess (Camera): the answer only settles it, and leaves an open atelier or a render in place.
 */
export function tabEvent(before: ShownTab, after: ShownTab): CanvasEvent | null {
  return before.known && before.tab !== after.tab ? 'tab' : null;
}
