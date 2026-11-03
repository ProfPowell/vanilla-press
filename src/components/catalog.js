/**
 * The components Vanilla Press offers in its editor: editor hints only.
 * Attributes come from each package's custom-elements.json (see manifest.js);
 * the catalog adds what manifests lack: label, content kind, defaults.
 * Static data, no fs.
 */

/** @typedef {'none'|'text'|'code'|'blocks'|'inline'} ContentKind */
/**
 * `kind: 'inline'` is inline display; every other kind is block display.
 * `codeWrap` (required for `kind: 'code'`) is how the code string sits in the
 * element. `codeLanguage` names the attribute that carries the language.
 * `icon` is a short icon name for the palette.
 * @typedef {{ tag: string, label: string, icon: string, description: string, group: string,
 *   kind: ContentKind, codeWrap?: 'text'|'template'|'script', codeLanguage?: string,
 *   defaults: Record<string, string|number|boolean>, advanced: string[] }} ElementHint
 */
/** @typedef {{ package: string, bundled?: boolean, elements: ElementHint[] }} CatalogEntry */

/** @type {ContentKind[]} */
export const CONTENT_KINDS = ['none', 'text', 'code', 'blocks', 'inline'];

/** @type {CatalogEntry[]} */
export const CATALOG = [
  {
    package: '@profpowell/code-block',
    elements: [
      {
        // README: <code-block language="js">escaped source</code-block>
        tag: 'code-block', label: 'Code block', icon: 'code', group: 'Code',
        description: 'Syntax-highlighted code with a copy button.',
        kind: 'code', codeWrap: 'text', codeLanguage: 'language',
        defaults: { language: 'javascript' },
        advanced: ['theme', 'data-page-theme', 'lazy', 'src', 'copy-text', 'copied-text', 'show-share', 'show-download', 'no-copy', 'focus-mode', 'max-height'],
      },
    ],
  },
  {
    package: '@profpowell/browser-window',
    elements: [
      {
        // README: children are the framed content (an <img>, usually)
        tag: 'browser-window', label: 'Browser window', icon: 'browser', group: 'Frames',
        description: 'A browser chrome around a screenshot or content.',
        kind: 'blocks',
        defaults: { url: 'https://example.com', title: 'Demo' },
        advanced: ['shadow', 'src', 'device', 'device-color', 'orientation', 'show-safe-areas', 'allow', 'allowfullscreen', 'referrerpolicy'],
      },
    ],
  },
  {
    package: '@profpowell/terminal-window',
    elements: [
      {
        // README basic usage has no content: title, prompt and welcome attributes only
        tag: 'terminal-window', label: 'Terminal window', icon: 'terminal', group: 'Code',
        description: 'A terminal emulator window with a welcome message.',
        kind: 'none',
        defaults: { title: 'Terminal', prompt: '$ ', welcome: 'Welcome! Type help for commands.' },
        advanced: ['theme', 'cursor-style', 'cursor-blink', 'font-family', 'font-size', 'line-height', 'typing-effect', 'typing-speed', 'show-header', 'show-controls', 'show-copy', 'show-theme-toggle', 'readonly', 'max-lines', 'enable-vfs', 'persist-history', 'force-animations'],
      },
    ],
  },
  {
    package: '@profpowell/code-playground',
    elements: [
      {
        // README feeds source through <textarea slot="html|css|js"> children, which
        // no codeWrap can express, so v1 offers settings only (html-src, css-src, js-src).
        tag: 'code-playground', label: 'Code playground', icon: 'play', group: 'Code',
        description: 'Live HTML, CSS and JS editors with a preview.',
        kind: 'none',
        defaults: { 'inherit-theme': true },
        advanced: ['mode', 'run-mode', 'debounce', 'preview-position', 'show-console', 'persist', 'fit-preview', 'head-src'],
      },
    ],
  },
  {
    package: '@profpowell/pdf-viewer',
    elements: [
      {
        // README: <pdf-viewer src="report.pdf"></pdf-viewer>, no content
        tag: 'pdf-viewer', label: 'PDF viewer', icon: 'file', group: 'Media',
        description: 'Embeds a PDF with page, zoom and search controls.',
        kind: 'none',
        defaults: { zoom: 'fit-width' },
        advanced: ['page', 'mode', 'view', 'show-thumbnails', 'show-search', 'no-download', 'no-print', 'lazy'],
      },
    ],
  },
  {
    package: '@profpowell/bg-wc',
    elements: [
      {
        // README: heading and paragraphs sit above the rendered layer
        tag: 'bg-wc', label: 'Animated background', icon: 'image', group: 'Frames',
        description: 'Content over a generative background.',
        kind: 'blocks',
        defaults: { preset: 'mesh-gradient', intensity: 0.65 },
        advanced: ['palette', 'speed', 'density', 'seed', 'paused', 'pixel-ratio', 'quality', 'fit', 'motion', 'mode', 'power-save'],
      },
    ],
  },
  {
    package: '@profpowell/border-wc',
    elements: [
      {
        // README: wraps a <blockquote> or any content. The published tarball has no
        // custom-elements.json, so these names come from the README attribute table.
        tag: 'border-wc', label: 'Decorative border', icon: 'frame', group: 'Frames',
        description: 'Wraps content in an animated decorative border.',
        kind: 'blocks',
        defaults: { effect: 'squiggle', animate: true },
        advanced: ['thickness', 'speed', 'radius', 'mode', 'motion'],
      },
    ],
  },
  {
    package: '@profpowell/marquee-wc',
    elements: [
      {
        // README: <marquee-wc speed="60" pause-on-hover> scrolling text </marquee-wc>
        tag: 'marquee-wc', label: 'Marquee', icon: 'marquee', group: 'Fun',
        description: 'Scrolling text.',
        kind: 'text',
        defaults: { speed: 50, 'pause-on-hover': true },
        advanced: ['behavior', 'gap', 'play-state', 'autofill', 'fade', 'reduced-motion', 'mode', 'unit'],
      },
    ],
  },
  {
    package: '@profpowell/blink-wc',
    elements: [
      {
        // README: <blink-wc>Now you see me</blink-wc> wraps a run of text in a line
        tag: 'blink-wc', label: 'Blink', icon: 'blink', group: 'Fun',
        description: 'Blinking, pulsing or stepping text, inline.',
        kind: 'inline',
        defaults: { behavior: 'blink' },
        advanced: ['min-opacity', 'count', 'steps', 'step-durations', 'step-by', 'play-state', 'pause-on-hover', 'reduced-motion', 'mode', 'unit'],
      },
    ],
  },
  {
    package: '@profpowell/image-editor',
    elements: [
      {
        // README: <image-editor src="photo.jpg"> with an optional drop-zone message child;
        // treated as settings-only
        tag: 'image-editor', label: 'Image editor', icon: 'edit-image', group: 'Media',
        description: 'Crop, rotate and filter an image in the page.',
        kind: 'none',
        defaults: {},
        advanced: ['mode', 'width', 'height', 'format', 'quality', 'max-history', 'readonly', 'no-toolbar', 'aspect-ratio'],
      },
    ],
  },
  {
    // Elements the Cook + VB bundle already ships; nothing to install per site.
    package: 'vanilla-breeze',
    bundled: true,
    elements: [
      {
        tag: 'audio-player', label: 'Audio player', icon: 'audio', group: 'Media',
        description: 'Audio with themed controls.',
        kind: 'blocks', defaults: {}, advanced: ['shuffle'],
      },
      {
        tag: 'video-player', label: 'Video player', icon: 'video', group: 'Media',
        description: 'Video with themed controls.',
        kind: 'blocks', defaults: {}, advanced: ['autoplay', 'loop', 'muted'],
      },
      {
        tag: 'image-gallery', label: 'Image gallery', icon: 'gallery', group: 'Media',
        description: 'A grid or lightbox gallery of images.',
        kind: 'blocks', defaults: { columns: '200px' }, advanced: ['gap', 'ratio', 'loop', 'captions', 'transition'],
      },
      {
        tag: 'youtube-player', label: 'YouTube video', icon: 'youtube', group: 'Embeds',
        description: 'A click-to-play YouTube embed.',
        kind: 'none', defaults: { 'video-id': '' }, advanced: ['start', 'list', 'params', 'autoplay', 'thumbnail', 'state'],
      },
      {
        tag: 'social-embed', label: 'Social embed', icon: 'share', group: 'Embeds',
        description: 'Embeds a post from a social network.',
        kind: 'none', defaults: { url: '' }, advanced: ['provider', 'theme', 'activate', 'state'],
      },
      {
        tag: 'accordion-wc', label: 'Accordion', icon: 'accordion', group: 'Layout',
        description: 'Grouped collapsible sections.',
        kind: 'blocks', defaults: {}, advanced: ['single', 'bordered', 'flush', 'compact', 'indicator', 'transition'],
      },
      {
        tag: 'carousel-wc', label: 'Carousel', icon: 'carousel', group: 'Layout',
        description: 'A scrolling carousel of slides.',
        kind: 'blocks', defaults: {}, advanced: ['autoplay', 'autoplay-delay', 'loop', 'item-width', 'gap', 'start', 'persist', 'transition'],
      },
      {
        tag: 'chart-wc', label: 'Chart', icon: 'chart', group: 'Data',
        description: 'A chart drawn from a table or values.',
        kind: 'blocks', defaults: {}, advanced: ['data-config', 'data-subtitle', 'data-legend', 'data-tooltip', 'data-palette', 'data-label-x', 'data-label-y', 'data-size', 'data-chart'],
      },
      {
        tag: 'diagram-wc', label: 'Diagram', icon: 'diagram', group: 'Data',
        description: 'A diagram rendered from text source.',
        // README: source sits in a <pre><code class="language-mermaid"> child, which
        // no codeWrap expresses, so the author puts a code block inside.
        kind: 'blocks',
        defaults: { type: 'mermaid' }, advanced: ['src', 'loading', 'data-theme-base', 'min-height'],
      },
      {
        tag: 'geo-map', label: 'Map', icon: 'map', group: 'Embeds',
        description: 'A map with a marker.',
        kind: 'none', defaults: { zoom: 12 }, advanced: ['marker-color', 'provider', 'tile-url', 'interactive', 'static-only', 'src'],
      },
      {
        tag: 'qr-code', label: 'QR code', icon: 'qr', group: 'Embeds',
        description: 'A QR code for a link or text.',
        kind: 'none', defaults: { value: '' }, advanced: ['size', 'color', 'background', 'error-correction'],
      },
    ],
  },
];
