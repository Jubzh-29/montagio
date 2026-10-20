// Size limits shared by the server routes and the showcase's in-page router.

/** A remixed preset is a small text file: 16 KiB of UTF-8 at most. */
export const MAX_PRESET_YAML_BYTES = 16 * 1024;
/** Request bodies that may carry a preset: room for its JSON escaping, nothing near a pasted megabyte. */
export const MAX_REQUEST_BYTES = 128 * 1024;
/** A motion transfer's reference video, as sent: the Studio checks it before sending, the server again. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
