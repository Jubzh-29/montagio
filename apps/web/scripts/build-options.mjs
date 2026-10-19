// Options of the showcase build (showcase-build.mjs), kept apart so they can be tested.

/**
 * The URL prefix of a GitHub Pages project site ("/montagio"), or '' at the root
 * of a host. "montagio" is accepted too: Git Bash rewrites an argument that starts
 * with "/" into a Windows path ("C:/Program Files/Git/montagio").
 */
export function normalizeBasePath(raw) {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  if (!/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(trimmed)) {
    throw new Error(
      `--base-path must be a URL path such as /montagio, got "${raw}" ` +
        '(under Git Bash, write it without the leading slash: --base-path montagio)',
    );
  }
  return `/${trimmed}`;
}
