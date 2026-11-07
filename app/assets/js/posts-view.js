/**
 * Pure helpers for the Posts section (no DOM).
 * @module posts-view
 */
import { formatDate } from './app-api.js';

const isPost = (d) => d.meta?.collection === 'posts';
const isPublished = (d) => d.meta?.status === 'published';
const sortKey = (d) => String(d.meta?.published || d.meta?.updated || d.meta?.created || '');

/**
 * Posts for the list: one filter and a search, newest first.
 * @param {Array<object>} docs
 * @param {{ filter: 'all'|'published'|'drafts', query: string }} opts
 */
export function filterPosts(docs, { filter, query }) {
  const q = String(query || '').trim().toLowerCase();
  return (docs || [])
    .filter(isPost)
    .filter((d) => filter === 'published' ? isPublished(d) : filter === 'drafts' ? !isPublished(d) : true)
    .filter((d) => !q || `${d.meta?.title || ''}\n${d.meta?.description || ''}`.toLowerCase().includes(q))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

/** @param {Array<object>} docs @returns {{ all: number, published: number, drafts: number }} */
export function filterCounts(docs) {
  const posts = (docs || []).filter(isPost);
  const published = posts.filter(isPublished).length;
  return { all: posts.length, published, drafts: posts.length - published };
}

/**
 * What one list row shows.
 * @param {object} doc
 */
export function rowModel(doc) {
  const meta = doc.meta || {};
  const description = String(meta.description || '').trim();
  return {
    title: String(meta.title || '').trim() || 'Untitled',
    description: description || 'No description',
    descriptionMissing: !description,
    path: `/posts/${meta.slug || ''}`,
    statusText: isPublished(doc) ? 'Published' : 'Draft',
    date: formatDate(meta.published || meta.updated || meta.created),
  };
}

/** @param {'all'|'published'|'drafts'} filter @param {string} query */
export function emptyText(filter, query) {
  const q = String(query || '').trim();
  if (q) return `No posts match "${q}".`;
  if (filter === 'published') return 'Nothing published yet.';
  if (filter === 'drafts') return 'No drafts. Start a new post.';
  return 'No posts yet. Start a new post.';
}
