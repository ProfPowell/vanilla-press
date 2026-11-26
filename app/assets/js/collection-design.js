/**
 * The collection design editor: title, description, address, who can see it, fields, lists,
 * grading and sort order, with Save design and Update site. The edits live in a working copy
 * until Save design; the server checks them (a list or choice items use cannot be removed, a
 * field items have values for asks first). Renders and wires events only.
 * @module collection-design
 */
import { api, h } from './app-api.js';
import { newId } from '../../../src/catalogs/model.js';

const LEVELS = [['public', 'Public'], ['friends', 'Friends'], ['private', 'Private']];
const TYPES = [['text', 'Text'], ['number', 'Number'], ['money', 'Money'], ['date', 'Date'], ['bool', 'Yes/no'], ['url', 'Link'], ['choice', 'Choice']];
const typeLabel = (type) => TYPES.find(([v]) => v === type)?.[1] || type;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The sort keys a design offers, in menu order: `[key, label]`. */
function sortChoices(design) {
  return [['title', 'Title'], ['added', 'Date added'], ...design.fields.map((f) => [f.id, f.label || 'Untitled field'])];
}

/** Find a choice by id anywhere in a list's tree: `{ choice, siblings }`. */
function findChoice(choices, id) {
  for (const c of choices) {
    if (c.id === id) return { choice: c, siblings: choices };
    const inner = findChoice(c.children || [], id);
    if (inner) return inner;
  }
  return null;
}

/**
 * @param {{ siteId: string, container: HTMLElement, catalog: Object, agencies: Object,
 *   confirm: (q: {title: string, description: string, items?: string[], ok?: string}) => Promise<boolean>,
 *   onSaved: (catalog: Object) => void, onPublished?: (result: Object) => void }} opts
 */
export function createDesignEditor({ siteId, container, catalog, agencies, confirm, onSaved, onPublished }) {
  const base = `/api/sites/${encodeURIComponent(siteId)}/catalogs/${encodeURIComponent(catalog.id)}`;
  let current = catalog; // the last saved collection
  const draft = {
    title: catalog.title, description: catalog.description || '', slug: catalog.slug, access: catalog.access,
    design: clone(catalog.design),
  };
  let dirty = false;
  let busy = false;
  const parts = {};
  const locked = () => (current.publishedCount ?? 0) > 0;

  const markDirty = () => { dirty = true; setStatus(''); };
  function setStatus(message) { parts.status.textContent = message || ''; }
  function setError(message) {
    parts.error.textContent = message || '';
    parts.error.hidden = !message;
  }
  /** After a structural change: redraw, then put focus back on the control with this key. */
  function redraw(focusKey) {
    drawFields(); drawLists(); drawGrading(); drawSort();
    markDirty();
    if (focusKey) (container.querySelector(`[data-key="${focusKey}"]`) || null)?.focus?.();
  }

  const levelSelect = (value, onChange, attrs = {}) => {
    const select = h('select', attrs, ...LEVELS.map(([v, l]) => h('option', { value: v }, l)));
    const shown = LEVELS.some(([v]) => v === value) ? value : 'private';
    for (const o of select.options) o.toggleAttribute('selected', o.value === shown); // a fresh select: the attribute is the choice
    select.addEventListener('change', () => onChange(select.value));
    return select;
  };
  const labelled = (id, text, control, hint) => h('div', { class: 'theme-field' },
    h('label', { for: id }, text), control, hint || null);

  // --- Basics ---
  function buildBasics() {
    const title = h('input', { type: 'text', id: 'design-title', maxlength: '120', autocomplete: 'off' });
    title.value = draft.title;
    title.addEventListener('input', () => { draft.title = title.value; markDirty(); });
    const description = h('textarea', { id: 'design-description', rows: '3' });
    description.value = draft.description;
    description.addEventListener('input', () => { draft.description = description.value; markDirty(); });
    const slug = h('input', { type: 'text', id: 'design-slug', maxlength: '80', autocomplete: 'off', 'aria-describedby': 'design-slug-note', disabled: locked() });
    slug.value = draft.slug;
    slug.addEventListener('input', () => { draft.slug = slug.value; markDirty(); });
    const note = h('p', { id: 'design-slug-note', class: 'detail-hint' },
      locked()
        ? 'The address can’t change once the collection has published items, so existing links keep working.'
        : 'The collection’s address on the site: /collections/<address>/');
    const access = levelSelect(draft.access, (v) => { draft.access = v; markDirty(); }, { id: 'design-access', 'aria-describedby': 'design-access-note' });
    return h('div', { class: 'design-basics' },
      labelled('design-title', 'Title', title),
      labelled('design-description', 'Description', description),
      labelled('design-slug', 'Address', slug, note),
      labelled('design-access', 'Who can see this collection', access,
        h('p', { id: 'design-access-note', class: 'detail-hint' }, 'Friends and Private collections are left out of the public site. An item is never more public than its collection.')));
  }

  // --- Fields ---
  function drawFields() {
    const fields = draft.design.fields;
    const rows = fields.map((f, i) => {
      const label = h('input', { type: 'text', 'data-role': 'label', 'data-key': `field:${f.id}:label`, 'aria-label': 'Field label', maxlength: '80', autocomplete: 'off' });
      label.value = f.label;
      label.addEventListener('input', () => { f.label = label.value; markDirty(); drawSort(); });
      const level = levelSelect(f.level, (v) => { f.level = v; markDirty(); }, { 'data-role': 'level', 'aria-label': `Who can see ${f.label || 'this field'}` });
      const type = h('td', {}, typeLabel(f.type));
      if (f.type === 'choice') {
        const options = h('input', { type: 'text', 'data-role': 'options', 'aria-label': `Options for ${f.label}`, placeholder: 'Options, separated by commas', autocomplete: 'off' });
        options.value = (f.options || []).join(', ');
        options.addEventListener('input', () => { f.options = options.value.split(',').map((s) => s.trim()).filter(Boolean); markDirty(); });
        type.append(' ', options);
      }
      const total = h('td', {});
      if (f.type === 'money') {
        const box = h('input', { type: 'checkbox', 'data-role': 'total', 'aria-label': `Total ${f.label}`, checked: !!f.total });
        box.addEventListener('change', () => { f.total = box.checked; markDirty(); });
        total.append(box);
      }
      const move = (by) => () => {
        const to = i + by;
        [fields[i], fields[to]] = [fields[to], fields[i]];
        redraw(`field:${f.id}:${by < 0 ? 'up' : 'down'}`);
      };
      const up = h('button', { type: 'button', 'data-role': 'up', 'data-key': `field:${f.id}:up`, 'aria-label': `Move ${f.label} up`, disabled: i === 0 }, 'Up');
      const down = h('button', { type: 'button', 'data-role': 'down', 'data-key': `field:${f.id}:down`, 'aria-label': `Move ${f.label} down`, disabled: i === fields.length - 1 }, 'Down');
      up.addEventListener('click', move(-1));
      down.addEventListener('click', move(1));
      const remove = h('button', { type: 'button', 'data-role': 'remove', 'aria-label': `Remove ${f.label}` }, 'Remove');
      remove.addEventListener('click', () => {
        fields.splice(i, 1);
        redraw('design-new-field-label');
      });
      return h('tr', { 'data-field-id': f.id }, h('td', {}, label), type, h('td', {}, level), total, h('td', { class: 'design-row-actions' }, up, down, remove));
    });
    parts.fields.replaceChildren(
      h('thead', {}, h('tr', {}, ...['Label', 'Type', 'Who can see it', 'Total', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...rows));
  }

  function buildAddField() {
    const label = h('input', { type: 'text', id: 'design-new-field-label', 'data-key': 'design-new-field-label', placeholder: 'New field label', maxlength: '80', autocomplete: 'off' });
    const type = h('select', { id: 'design-new-field-type', 'aria-label': 'Field type' }, ...TYPES.map(([v, l]) => h('option', { value: v }, l)));
    const add = h('button', { type: 'button', id: 'design-new-field-add' }, 'Add field');
    add.addEventListener('click', () => {
      const text = label.value.trim();
      if (!text) { label.focus(); return; }
      // New fields start private: nothing shows on the public site until the owner says so.
      const field = { id: newId('f'), label: text, type: type.value, level: 'private' };
      if (field.type === 'choice') field.options = ['Option 1'];
      if (field.type === 'money') field.total = false;
      draft.design.fields.push(field);
      label.value = '';
      redraw(`field:${field.id}:label`);
    });
    return h('div', { class: 'design-add' }, label, type, add);
  }

  // --- Lists ---
  function drawLists() {
    parts.lists.replaceChildren(...draft.design.lists.map((list) => {
      const name = h('input', { type: 'text', 'aria-label': 'List name', 'data-key': `list:${list.id}`, maxlength: '80', autocomplete: 'off' });
      name.value = list.label;
      name.addEventListener('input', () => { list.label = name.value; markDirty(); });
      const addTop = h('button', { type: 'button', 'data-role': 'add', 'aria-label': `Add a choice to ${list.label}` }, 'Add choice');
      addTop.addEventListener('click', () => {
        const choice = { id: newId('c'), label: 'New choice', children: [] };
        list.choices.push(choice);
        redraw(`choice:${choice.id}`);
      });
      const removeList = h('button', { type: 'button', 'data-role': 'remove', 'aria-label': `Remove the ${list.label} list` }, 'Remove list');
      removeList.addEventListener('click', () => {
        draft.design.lists = draft.design.lists.filter((l) => l !== list);
        redraw('design-new-list-label');
      });
      return h('li', { class: 'design-list', 'data-list-id': list.id },
        h('div', { class: 'design-list-head' }, name, addTop, removeList), choiceTree(list, list.choices));
    }));
  }

  function choiceTree(list, choices) {
    return h('ul', { class: 'design-choices' }, ...choices.map((c) => {
      const label = h('input', { type: 'text', 'aria-label': 'Choice name', 'data-key': `choice:${c.id}`, maxlength: '80', autocomplete: 'off' });
      label.value = c.label;
      label.addEventListener('input', () => { c.label = label.value; markDirty(); });
      const child = h('button', { type: 'button', 'data-role': 'add-child', 'aria-label': `Add a choice under ${c.label}` }, 'Add child');
      child.addEventListener('click', () => {
        const fresh = { id: newId('c'), label: 'New choice', children: [] };
        (c.children ||= []).push(fresh);
        redraw(`choice:${fresh.id}`);
      });
      const remove = h('button', { type: 'button', 'data-role': 'remove', 'aria-label': `Remove ${c.label}` }, 'Remove');
      remove.addEventListener('click', () => {
        const { siblings } = findChoice(list.choices, c.id);
        siblings.splice(siblings.indexOf(c), 1);
        redraw(`list:${list.id}`);
      });
      return h('li', { 'data-choice-id': c.id },
        h('div', { class: 'design-choice-row' }, label, child, remove),
        c.children?.length ? choiceTree(list, c.children) : null);
    }));
  }

  function buildAddList() {
    const label = h('input', { type: 'text', id: 'design-new-list-label', 'data-key': 'design-new-list-label', placeholder: 'New list name', maxlength: '80', autocomplete: 'off' });
    const add = h('button', { type: 'button', id: 'design-new-list-add' }, 'Add list');
    add.addEventListener('click', () => {
      const text = label.value.trim();
      if (!text) { label.focus(); return; }
      const list = { id: newId('l'), label: text, choices: [] };
      draft.design.lists.push(list);
      label.value = '';
      redraw(`list:${list.id}`);
    });
    return h('div', { class: 'design-add' }, label, add);
  }

  // --- Grading ---
  function drawGrading() {
    const g = draft.design.grading;
    const on = h('input', { type: 'checkbox', id: 'design-grading-on', checked: !!g });
    on.addEventListener('change', () => {
      draft.design.grading = on.checked ? { level: 'public', agencies: [] } : null;
      redraw('design-grading-on');
    });
    const out = [h('label', { class: 'design-check' }, on, ' Items can be graded')];
    if (g) {
      out.push(h('div', { class: 'design-agencies', role: 'group', 'aria-label': 'Grading agencies' },
        ...Object.entries(agencies || {}).map(([id, a]) => {
          const box = h('input', { type: 'checkbox', 'data-agency': id, checked: g.agencies.includes(id) });
          box.addEventListener('change', () => {
            const set = new Set(g.agencies);
            if (box.checked) set.add(id); else set.delete(id);
            g.agencies = Object.keys(agencies).filter((k) => set.has(k));
            markDirty();
          });
          return h('label', { class: 'design-check' }, box, ` ${a.label || id}`);
        })));
      out.push(labelled('design-grading-level', 'Who can see grades',
        levelSelect(g.level, (v) => { g.level = v; markDirty(); }, { id: 'design-grading-level' })));
    }
    parts.grading.replaceChildren(...out);
  }

  // --- Sort ---
  function drawSort() {
    const offered = sortChoices(draft.design);
    const keys = offered.map(([k]) => k);
    const sort = (draft.design.sort = (draft.design.sort || []).filter((k) => keys.includes(k)));
    const nameOf = (k) => offered.find(([key]) => key === k)[1];
    const row = (k, i) => {
      const checked = i >= 0;
      const box = h('input', { type: 'checkbox', 'data-sort': k, 'data-key': `sort:${k}`, checked });
      box.addEventListener('change', () => {
        if (box.checked) sort.push(k); else sort.splice(sort.indexOf(k), 1);
        drawSort(); markDirty();
        container.querySelector(`[data-key="sort:${k}"]`)?.focus?.();
      });
      const li = h('li', {}, h('label', { class: 'design-check' }, box, ` ${nameOf(k)}`, checked && i === 0 ? ' (default)' : ''));
      if (checked) {
        const move = (by) => () => {
          [sort[i], sort[i + by]] = [sort[i + by], sort[i]];
          drawSort(); markDirty();
          container.querySelector(`[data-key="sortmove:${k}:${by < 0 ? 'up' : 'down'}"]`)?.focus?.();
        };
        const up = h('button', { type: 'button', 'data-role': 'up', 'data-key': `sortmove:${k}:up`, 'aria-label': `Move ${nameOf(k)} earlier in the sort order`, disabled: i === 0 }, 'Up');
        const down = h('button', { type: 'button', 'data-role': 'down', 'data-key': `sortmove:${k}:down`, 'aria-label': `Move ${nameOf(k)} later in the sort order`, disabled: i === sort.length - 1 }, 'Down');
        up.addEventListener('click', move(-1));
        down.addEventListener('click', move(1));
        li.append(up, down);
      }
      return li;
    };
    parts.sort.replaceChildren(...sort.map((k, i) => row(k, i)), ...keys.filter((k) => !sort.includes(k)).map((k) => row(k, -1)));
  }

  // --- Save and Update site ---
  function refusalText(err) {
    const d = err.data || {};
    if (err.status === 409 && d.count != null && !d.field) return `Used by ${plural(d.count, 'item')}; move them first.`;
    if (d.errors?.length) return d.errors.join(' ');
    return err.message;
  }

  async function save(extra = {}) {
    const body = { title: draft.title, description: draft.description, access: draft.access, design: clone(draft.design), ...extra };
    if (!locked() && draft.slug !== current.slug) body.slug = draft.slug;
    return api(base, { method: 'PUT', body });
  }

  async function onSave() {
    if (busy) return;
    busy = true; setError(''); setStatus('Saving…');
    try {
      let saved;
      try {
        saved = await save();
      } catch (err) {
        if (err.status === 409 && err.data?.field) {
          setStatus('');
          const sure = await confirm({
            title: 'Remove this field?',
            description: `${plural(err.data.count, 'item')} ${err.data.count === 1 ? 'has' : 'have'} a value for “${err.data.field}”. Saving removes ${err.data.count === 1 ? 'it' : 'those values'} from the collection. This can’t be undone.`,
            ok: 'Remove values and save', busyText: 'Saving…',
          });
          if (!sure) { setStatus(''); return; }
          setStatus('Saving…');
          saved = await save({ confirmDropValues: true });
        } else throw err;
      }
      current = { ...current, ...saved, publishedCount: saved.publishedCount ?? current.publishedCount };
      dirty = false;
      setStatus('Design saved.');
      onSaved?.(current);
    } catch (err) {
      setStatus('');
      setError(refusalText(err));
    } finally {
      busy = false;
    }
  }

  async function onPublish() {
    if (busy) return;
    if (dirty) { setError('Save the design before updating the site.'); return; }
    busy = true; setError(''); setStatus('Updating the site…');
    try {
      let result;
      try {
        result = await api(`${base}/publish`, { method: 'POST', body: {} });
      } catch (err) {
        const warnings = err.status === 409 ? err.data?.photoWarnings : null;
        if (!warnings?.length) throw err;
        setStatus('');
        const sure = await confirm({
          title: 'Make these photos less visible?',
          description: 'These photos are less restricted than the items that use them, so they would show on a site the item does not. Raising them also hides them in the posts that use them.',
          items: warnings.map((w) => `${w.file}: ${w.access} becomes ${w.needed}, for “${w.item?.title || 'an item'}”${w.posts?.length ? `; also used in posts: ${w.posts.join(', ')}` : ''}`),
          ok: 'Raise and update site', busyText: 'Updating…',
        });
        if (!sure) return;
        setStatus('Updating the site…');
        result = await api(`${base}/publish`, { method: 'POST', body: { confirmRaisePhotoAccess: true } });
      }
      setStatus(`Site updated.${result?.url ? ` ${result.url}` : ''}`);
      onPublished?.(result);
    } catch (err) {
      setStatus('');
      setError(refusalText(err));
    } finally {
      busy = false;
    }
  }

  // --- Build ---
  parts.error = h('p', { id: 'design-error', class: 'error', role: 'alert', hidden: true });
  parts.status = h('p', { id: 'design-status', class: 'design-status', role: 'status' });
  parts.fields = h('table', { id: 'design-fields', class: 'design-fields' });
  parts.lists = h('ul', { id: 'design-lists', class: 'design-lists' });
  parts.grading = h('div', { id: 'design-grading', class: 'design-grading' });
  parts.sort = h('ul', { id: 'design-sort', class: 'design-sort' });
  const save$ = h('button', { type: 'button', id: 'design-save', class: 'primary' }, 'Save design');
  save$.addEventListener('click', onSave);
  const publish$ = h('button', { type: 'button', id: 'design-publish', hidden: !locked() }, 'Update site');
  publish$.addEventListener('click', onPublish);
  const section = (id, title, ...kids) => h('section', { class: 'design-section', 'aria-labelledby': id }, h('h2', { id }, title), ...kids);

  drawFields(); drawLists(); drawGrading(); drawSort();
  container.replaceChildren(
    h('div', { class: 'design-actions' }, save$, publish$, parts.status),
    parts.error,
    section('design-basics-h', 'About this collection', buildBasics()),
    section('design-fields-h', 'Fields', parts.fields, buildAddField()),
    section('design-lists-h', 'Lists', parts.lists, buildAddList()),
    section('design-grading-h', 'Grading', parts.grading),
    section('design-sort-h', 'Sort by', h('p', { class: 'detail-hint' }, 'The first one checked is the default order.'), parts.sort));
  return { isDirty: () => dirty };
}
