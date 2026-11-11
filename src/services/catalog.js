/**
 * The outside services Vanilla Press can use, in groups for the Services screen.
 * `mode` is how a result is used: 'copy' downloads it into the site, 'link' only
 * links to it (never copied or edited).
 *
 * @module services/catalog
 */

/** @type {{ id: string, label: string }[]} */
export const SERVICE_GROUPS = [
  { id: 'image-search', label: 'Image search' },
  { id: 'sound-video', label: 'Sound and video' },
  { id: 'ai', label: 'AI generation' },
];

/**
 * @typedef {{ id: string, label: string, group: string, needsKey: boolean,
 *   signupUrl: string|null, mode: 'copy'|'link' }} Service
 */

/** @type {Service[]} */
export const SERVICES = [
  { id: 'openverse', label: 'Openverse', group: 'image-search', needsKey: false, signupUrl: null, mode: 'copy' },
  { id: 'pexels', label: 'Pexels', group: 'image-search', needsKey: true, signupUrl: 'https://www.pexels.com/api/', mode: 'copy' },
  { id: 'pixabay', label: 'Pixabay', group: 'image-search', needsKey: true, signupUrl: 'https://pixabay.com/api/docs/', mode: 'copy' },
  { id: 'unsplash', label: 'Unsplash', group: 'image-search', needsKey: true, signupUrl: 'https://unsplash.com/developers', mode: 'link' },
];
