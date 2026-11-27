/**
 * The Collections routes on a site's router (internal name "catalog"): templates,
 * collections (create, read, update, delete), their choices and their items. Every
 * response is JSON. Status codes: 400 invalid input (`errors` lists validation
 * messages), 404 unknown collection/item/list, 409 a conflict with existing data
 * (slug taken, choice in use, published items block a delete), 422 a slug that is
 * locked because something was published. Publishing is a separate set of routes.
 *
 * @module app/catalog-routes
 */

import { sendJson } from '../server/router.js';
import { validAccess } from '../schema/content-schema.js';
import {
  ChoiceInUseError, addChoice, renameChoice, removeChoice, validateDesign, validateItem, isSlug,
} from '../catalogs/model.js';
import { TEMPLATES, designFromTemplate } from '../catalogs/templates.js';
import { AGENCIES } from '../catalogs/grading.js';
import { removeCatalogFile } from '../sync/catalog-files.js';
import { publishCatalog } from './catalog-publish.js';
import { publishErrorResponse } from './publish.js';
import {
  CatalogHasPublishedError, listCatalogs, getCatalog, createCatalog, updateCatalog, deleteCatalog,
  listItems, getItem, createItem, updateItem, deleteItem, usedTags, everPublished,
} from '../store/catalogs.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Item properties a client may set (status and publishing belong to the publish routes). */
const ITEM_KEYS = [
  'title', 'slug', 'access', 'rating', 'description', 'video', 'links', 'tags',
  'categories', 'grade', 'fields', 'photos',
];

class HttpError extends Error {
  constructor(status, message, body = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/** Store errors that mean a conflict (409) or a locked slug (422); anything else is unexpected. */
function storeStatus(err) {
  if (err instanceof CatalogHasPublishedError) return 409;
  if (/already in use/.test(err.message)) return 409;
  if (/slug cannot change/.test(err.message)) return 422;
  return 0;
}

const hasValue = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Every choice id in a list's tree. */
function choiceIds(choices, out = new Set()) {
  for (const c of choices ?? []) {
    out.add(c.id);
    choiceIds(c.children, out);
  }
  return out;
}

/**
 * What a new design takes away from the old one, as the items see it: the choice ids
 * removed (a removed list takes all its choices) and the field ids removed.
 */
function removals(oldDesign, newDesign) {
  const newLists = new Map(newDesign.lists.map((l) => [l.id, choiceIds(l.choices)]));
  const choices = new Map(); // listId -> removed choice ids
  for (const l of oldDesign.lists) {
    const kept = newLists.get(l.id) ?? new Set();
    const gone = [...choiceIds(l.choices)].filter((id) => !kept.has(id));
    if (gone.length) choices.set(l.id, new Set(gone));
  }
  const keptFields = new Set(newDesign.fields.map((f) => f.id));
  const fields = oldDesign.fields.map((f) => f.id).filter((id) => !keptFields.has(id));
  return { choices, fields };
}

/**
 * @param {{ add: Function }} router
 * @param {string} prefix - `/api/sites/<id>`
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   ws?: import('../workspace/workspace.js').Workspace,
 *   publishing?: { run: (fn: Function) => Promise<any>, deps: () => Object, onBuilt?: () => void },
 * }} context - publishing: how the publish routes take the site's write lock (`run`) and
 *   the publishCatalog deps; without it (or ws) the publish routes are not mounted
 */
export function mountCatalogRoutes(router, prefix, { db, ws = null, publishing = null }) {
  const body = (req) => (isObj(req.body) ? req.body : {});

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.body });
      if (err instanceof ChoiceInUseError) return sendJson(res, 409, { error: err.message, count: err.count });
      const status = storeStatus(err);
      if (status) return sendJson(res, status, { error: err.message });
      console.error('Catalog error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    }
  };
  // Writes already wait for a running publish: the server queues them (isQueuedWrite),
  // so a handler must not take the write lock again.
  const write = handle;

  const need = (catalogId) => {
    const catalog = getCatalog(db, catalogId);
    if (!catalog) throw new HttpError(404, 'Collection not found');
    return catalog;
  };
  const needItem = (catalog, itemId) => {
    const item = getItem(db, itemId);
    if (!item || item.catalogId !== catalog.id) throw new HttpError(404, 'Item not found');
    return item;
  };
  const checkAccess = (access) => {
    if (access !== undefined && !validAccess.includes(access)) throw new HttpError(400, `Access must be one of: ${validAccess.join(', ')}`);
  };
  const needList = (catalog, listId) => {
    if (!catalog.design.lists.some((l) => l.id === listId)) throw new HttpError(404, 'List not found');
  };
  const needLabel = (label) => {
    if (typeof label !== 'string' || !label.trim()) throw new HttpError(400, 'A label is required');
    return label.trim();
  };
  /** A slug the client gives must be what slugify produces: it becomes a path and a URL. */
  const checkSlug = (slug) => {
    if (slug !== undefined && !isSlug(slug)) {
      throw new HttpError(400, 'The address may use only lowercase letters, numbers and single hyphens (like "retro-games").');
    }
  };
  /** A collection as the API returns it: with whether its address is locked (anything ever published). */
  const withLock = (c) => c && { ...c, everPublished: everPublished(db, c.id) };
  const saveDesign = (catalog, design) => updateCatalog(db, catalog.id, { design });

  router.add('GET', `${prefix}/catalogs/templates`, handle((req, res) => {
    sendJson(res, 200, {
      templates: TEMPLATES.map(({ id, label, description }) => ({ id, label, description })),
      agencies: AGENCIES,
    });
  }));

  router.add('GET', `${prefix}/catalogs`, handle((req, res) => {
    const catalogs = listCatalogs(db).map((c) => {
      const items = listItems(db, c.id);
      return { ...withLock(c), itemCount: items.length, publishedCount: items.filter((i) => i.status === 'published').length };
    });
    sendJson(res, 200, { catalogs });
  }));

  router.add('POST', `${prefix}/catalogs`, write((req, res) => {
    const { title, template, access, description } = body(req);
    if (typeof title !== 'string' || !title.trim()) throw new HttpError(400, 'A title is required');
    checkAccess(access);
    let design;
    try {
      design = designFromTemplate(template);
    } catch {
      throw new HttpError(400, `Unknown template: ${template}`);
    }
    const catalog = createCatalog(db, {
      title: title.trim(), template, design, ...(access !== undefined && { access }),
      ...(typeof description === 'string' && { description }),
    });
    sendJson(res, 201, catalog);
  }));

  router.add('GET', `${prefix}/catalogs/:id`, handle((req, res) => {
    sendJson(res, 200, withLock(need(req.params.id)));
  }));

  router.add('PUT', `${prefix}/catalogs/:id`, write((req, res) => {
    need(req.params.id);
    const patch = pick(body(req), ['title', 'description', 'access', 'slug', 'design']);
    if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) throw new HttpError(400, 'A title is required');
    checkSlug(patch.slug);
    checkAccess(patch.access);
    if (patch.design !== undefined) {
      const errors = validateDesign(patch.design);
      if (errors.length) throw new HttpError(400, 'The design is not valid', { errors });
    }
    if (patch.design === undefined) return sendJson(res, 200, withLock(updateCatalog(db, req.params.id, patch)));
    const catalog = need(req.params.id);
    const items = listItems(db, catalog.id);
    const gone = removals(catalog.design, patch.design);
    // A choice or list that items still use cannot go: move the items first.
    const inUse = items.filter((it) => [...gone.choices].some(([listId, ids]) => (it.categories?.[listId] ?? []).some((c) => ids.has(c))));
    if (inUse.length) {
      throw new HttpError(409, `${inUse.length} item${inUse.length === 1 ? ' uses' : 's use'} a list or choice this design removes. Move them first.`, { count: inUse.length });
    }
    // A field with values is dropped only when the caller confirms; its values go with it.
    const withValues = gone.fields.map((field) => ({ field, items: items.filter((it) => hasValue(it.fields?.[field])) }))
      .filter((f) => f.items.length);
    if (withValues.length && body(req).confirmDropValues !== true) {
      const [{ field, items: used }] = withValues;
      throw new HttpError(409, `${used.length} item${used.length === 1 ? ' has' : 's have'} a value in a field this design removes.`, { count: used.length, field });
    }
    const saved = db.transaction(() => {
      for (const it of items) {
        const dropped = gone.fields.filter((f) => f in (it.fields ?? {}));
        if (dropped.length) updateItem(db, it.id, { fields: Object.fromEntries(Object.entries(it.fields).filter(([k]) => !dropped.includes(k))) });
      }
      return updateCatalog(db, catalog.id, patch);
    })();
    sendJson(res, 200, withLock(saved));
  }));

  router.add('DELETE', `${prefix}/catalogs/:id`, write((req, res) => {
    const catalog = need(req.params.id);
    deleteCatalog(db, req.params.id);
    if (ws?.contentDir) removeCatalogFile(ws, catalog.slug); // the next backup commits the removal
    res.writeHead(204);
    res.end();
  }));

  router.add('POST', `${prefix}/catalogs/:id/choices`, write((req, res) => {
    const catalog = need(req.params.id);
    const { listId, parentId = null, label } = body(req);
    needList(catalog, listId);
    const name = needLabel(label);
    const { design, id } = addChoice(catalog.design, listId, parentId, name);
    saveDesign(catalog, design);
    sendJson(res, 200, { design, id });
  }));

  router.add('PUT', `${prefix}/catalogs/:id/choices/:choiceId`, write((req, res) => {
    const catalog = need(req.params.id);
    const { listId, label } = body(req);
    needList(catalog, listId);
    const design = renameChoice(catalog.design, listId, req.params.choiceId, needLabel(label));
    saveDesign(catalog, design);
    sendJson(res, 200, { design });
  }));

  router.add('DELETE', `${prefix}/catalogs/:id/choices/:choiceId`, write((req, res) => {
    const catalog = need(req.params.id);
    const { listId } = req.query;
    if (!listId) throw new HttpError(400, 'listId is required');
    needList(catalog, listId);
    const design = removeChoice(catalog.design, listId, req.params.choiceId, listItems(db, catalog.id));
    saveDesign(catalog, design);
    sendJson(res, 200, { design });
  }));

  router.add('GET', `${prefix}/catalogs/:id/items`, handle((req, res) => {
    const catalog = need(req.params.id);
    sendJson(res, 200, { items: listItems(db, catalog.id), tags: usedTags(db, catalog.id) });
  }));

  router.add('POST', `${prefix}/catalogs/:id/items`, write((req, res) => {
    const catalog = need(req.params.id);
    const partial = pick(body(req), ITEM_KEYS);
    checkSlug(partial.slug);
    // The item's own level is stored as given; what it shows at is the higher of that and
    // the collection's (effectiveLevel), so a collection made more public later takes its items along.
    checkAccess(partial.access);
    const errors = validateItem(partial, catalog.design);
    if (errors.length) throw new HttpError(400, 'The item is not valid', { errors });
    sendJson(res, 201, createItem(db, catalog.id, partial));
  }));

  router.add('GET', `${prefix}/catalogs/:id/items/:itemId`, handle((req, res) => {
    sendJson(res, 200, needItem(need(req.params.id), req.params.itemId));
  }));

  router.add('PUT', `${prefix}/catalogs/:id/items/:itemId`, write((req, res) => {
    const catalog = need(req.params.id);
    const cur = needItem(catalog, req.params.itemId);
    const patch = pick(body(req), ITEM_KEYS);
    checkSlug(patch.slug);
    checkAccess(patch.access);
    const next = { ...cur, ...patch };
    const errors = validateItem(next, catalog.design);
    if (errors.length) throw new HttpError(400, 'The item is not valid', { errors });
    sendJson(res, 200, updateItem(db, cur.id, patch));
  }));

  router.add('DELETE', `${prefix}/catalogs/:id/items/:itemId`, write((req, res) => {
    const item = needItem(need(req.params.id), req.params.itemId);
    deleteItem(db, item.id);
    res.writeHead(204);
    res.end();
  }));

  if (!ws || !publishing) return;

  // Publish, Unpublish and the collection's own publish (design or level). Not queued by
  // the server (CATALOG_ACTION_PATH): each takes the write lock here, as a post's publish does.
  const publishRoute = (changeOf) => async (req, res) => {
    try {
      const result = await publishing.run(() => publishCatalog({
        ws, db, catalogId: req.params.id, change: changeOf(req),
        confirmRaisePhotoAccess: body(req).confirmRaisePhotoAccess === true,
        deps: publishing.deps(),
      }));
      publishing.onBuilt?.();
      sendJson(res, 200, { status: result.status, url: result.url, sha: result.sha });
    } catch (err) {
      const known = publishErrorResponse(err);
      if (known) return sendJson(res, known.status, known.body);
      console.error('Collection publish error:', err);
      sendJson(res, 500, { error: err.message });
    }
  };
  router.add('POST', `${prefix}/catalogs/:id/publish`, publishRoute(() => null));
  router.add('POST', `${prefix}/catalogs/:id/items/:itemId/publish`, publishRoute((req) => ({ itemId: req.params.itemId, publish: true })));
  router.add('POST', `${prefix}/catalogs/:id/items/:itemId/unpublish`, publishRoute((req) => ({ itemId: req.params.itemId, publish: false })));
}
