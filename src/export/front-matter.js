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
 * Strings use JSON.stringify (valid YAML double-quoted scalars).
 * @param {{ meta: Object }} doc
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
  ];
  const lines = entries
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${k === 'tags' ? v : JSON.stringify(String(v))}`);
  return `---\n${lines.join('\n')}\n---\n`;
}
