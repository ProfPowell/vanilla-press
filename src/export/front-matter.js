/**
 * YAML front matter for exported HTML pages (pure).
 *
 * @module export/front-matter
 */

const pad = (n) => String(n).padStart(2, '0');

/**
 * Local calendar day of an ISO timestamp, as YYYY-MM-DD.
 * @param {string} iso
 * @returns {string}
 */
export function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build front matter for a document. Keys in fixed order; empty values omitted.
 * Strings use JSON.stringify (valid YAML double-quoted scalars). The last key,
 * `vp_id`, marks the page as written by Vanilla Press for that document (see
 * readVpId).
 * @param {{ id: string, meta: Object }} doc
 * @param {{ layout: string }} options
 * @returns {string} `---\n...\n---\n`
 */
export function frontMatter(doc, { layout }) {
  const m = doc.meta;
  const dateSrc = m.published || m.created;
  const tags = Array.isArray(m.tags) ? m.tags.filter(Boolean) : [];
  const entries = [
    ['title', m.title],
    ['description', m.description],
    ['date', dateSrc ? localDay(dateSrc) : ''],
    ['published', m.published],
    ['updated', m.updated],
    ['author', m.author_id],
    ['tags', tags.length ? `[${tags.map((t) => JSON.stringify(t)).join(',')}]` : ''],
    ['layout', layout],
    ['slug', m.slug],
    ['vp_id', doc.id],
  ];
  const lines = entries
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${k === 'tags' ? v : JSON.stringify(String(v))}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * The `vp_id` that frontMatter wrote into an HTML page's leading front
 * matter, or null when the text has no front matter or no readable `vp_id`.
 * @param {string} text
 * @returns {string|null}
 */
export function readVpId(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const line = /^vp_id:[ \t]*(.*?)[ \t]*$/m.exec(m[1]);
  if (!line) return null;
  try {
    const v = JSON.parse(line[1]);
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    return null;
  }
}
