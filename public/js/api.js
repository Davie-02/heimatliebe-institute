/**
 * API client used by every page.
 *
 * Requests go to the same origin and carry the httpOnly session cookie automatically, so no
 * keys or tokens are ever stored in the browser.
 *
 *   await api.get('/api/courses', { order: 'title.asc' })
 *   await api.rows('payments', { status: 'eq.pending' })      // generic data API, see app/rest.py
 *   await api.post('/api/conversations', { recipient, body })
 */
(function (global) {
  'use strict';

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  /** Turn an object (or ready-made string) into a query string, skipping empty values. */
  function toQuery(query) {
    if (!query) return '';
    if (typeof query === 'string') return query.replace(/^[?&]+/, '');
    const params = new URLSearchParams();
    Object.keys(query).forEach(key => {
      const value = query[key];
      if (value !== undefined && value !== null && value !== '') params.append(key, value);
    });
    return params.toString();
  }

  /** Called when the session has expired; portals set this to redirect to the login page. */
  let onUnauthorized = null;

  async function request(method, path, options) {
    const { body, query, headers } = options || {};
    const qs = toQuery(query);
    const url = path + (qs ? (path.includes('?') ? '&' : '?') + qs : '');
    const init = { method, credentials: 'same-origin', headers: Object.assign({ Accept: 'application/json' }, headers) };
    if (body !== undefined) {
      if (body instanceof Blob) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new ApiError('You appear to be offline. Check your connection and try again.', 0);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    if (!response.ok) {
      if (response.status === 401 && onUnauthorized && !path.startsWith('/api/login')) onUnauthorized();
      const message = (data && (data.error || data.message)) || `Request failed (${response.status})`;
      throw new ApiError(typeof message === 'string' ? message : JSON.stringify(message), response.status);
    }
    // List endpoints called with count=exact report the total number of matching rows.
    const total = response.headers.get('X-Total-Count');
    if (total !== null && Array.isArray(data)) data.total = Number(total);
    return data;
  }

  const api = {
    request,
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    del: path => request('DELETE', path),
    // Generic data API (one table at a time, permissions enforced by the server).
    rows: (table, query) => request('GET', `/api/${table}`, { query }),
    row: (table, id, query) => request('GET', `/api/${table}/${encodeURIComponent(id)}`, { query }),
    create: (table, body) => request('POST', `/api/${table}`, { body }),
    update: (table, id, body) => request('PATCH', `/api/${table}/${encodeURIComponent(id)}`, { body }),
    remove: (table, id) => request('DELETE', `/api/${table}/${encodeURIComponent(id)}`),
    setUnauthorizedHandler: fn => { onUnauthorized = fn; },
  };

  /* Short-lived cache for lookups (e.g. class lists in dropdowns) so switching pages stays instant. */
  const cache = new Map();
  async function cachedRows(table, query, ttlMs) {
    const key = `${table}?${toQuery(query)}`;
    const hit = cache.get(key);
    if (hit && hit.time > Date.now() - (ttlMs || 20000)) return hit.data;
    const data = await api.rows(table, query);
    cache.set(key, { time: Date.now(), data });
    return data;
  }
  function clearCache(table) {
    [...cache.keys()].forEach(key => { if (!table || key.startsWith(table + '?')) cache.delete(key); });
  }

  /** Upload a File to a storage area ("gallery", "payment-proofs" …) and return its URL. */
  async function uploadFile(area, file) {
    const name = encodeURIComponent((file.name || 'upload').replace(/[^\w.\-]+/g, '_'));
    const result = await request('POST', `/api/upload/${area}/${name}`, {
      body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    return result.url;
  }

  /** Public site settings (institution details, homepage text, feature flags). Fetched once per page. */
  let configPromise = null;
  function siteConfig() {
    if (!configPromise) {
      configPromise = fetch('/config.json').then(r => r.json()).catch(() => ({ institution: {}, site: {} }));
    }
    return configPromise;
  }

  /** Today's date as YYYY-MM-DD in the user's own time zone (not UTC). */
  function todayISO() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  Object.assign(global, { api, ApiError, cachedRows, clearCache, uploadFile, siteConfig, todayISO });
})(window);
