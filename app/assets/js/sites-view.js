/**
 * Pure helpers for the Sites screen (no DOM).
 * @module sites-view
 */

/**
 * Published and draft counts for the posts collection only.
 * @param {Array<{ meta: { collection: string, status: string } }>} docs
 * @returns {{ published: number, drafts: number }}
 */
export function countPosts(docs) {
  const posts = (docs || []).filter((d) => d.meta?.collection === 'posts');
  return {
    published: posts.filter((d) => d.meta.status === 'published').length,
    drafts: posts.filter((d) => d.meta.status === 'draft').length,
  };
}

/**
 * One line of GitHub sync state and its tone.
 * @param {{ connected: boolean, branch: string|null, ahead: number|null, behind: number|null }} [git]
 * @returns {{ text: string, tone: 'ok'|'warn'|'off' }}
 */
export function syncText(git) {
  if (!git?.connected) return { text: 'Not connected to GitHub', tone: 'off' };
  const todo = [];
  if (git.ahead > 0) todo.push(`${git.ahead} to push`);
  if (git.behind > 0) todo.push(`${git.behind} to pull`);
  const text = ['GitHub', git.branch, ...(todo.length ? todo : ['in sync'])].join(' · ');
  return { text, tone: todo.length ? 'warn' : 'ok' };
}

/**
 * When the last backup happened, for people.
 * @param {string|null} iso
 * @param {Date} now
 * @returns {string}
 */
export function backupText(iso, now) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'Not backed up yet';
  if (d.toDateString() === now.toDateString()) {
    return `Backed up ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return `Backed up ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
