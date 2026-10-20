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
