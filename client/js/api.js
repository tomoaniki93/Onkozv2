/* ── API Helper ──────────────────────────────────────────────────────────────
   Centralise tous les appels HTTP vers le serveur ONKOZ.
   ─────────────────────────────────────────────────────────────────────────── */
const API = (() => {
  const BASE = '/api';

  function getToken() { return localStorage.getItem('onkoz_token'); }
  function setToken(t) { localStorage.setItem('onkoz_token', t); }
  function clearToken() { localStorage.removeItem('onkoz_token'); localStorage.removeItem('onkoz_user'); }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    getToken, setToken, clearToken,
    get:    (p)    => request('GET',    p),
    post:   (p, b) => request('POST',   p, b),
    patch:  (p, b) => request('PATCH',  p, b),
    delete: (p)    => request('DELETE', p),

    // ── Auth ──────────────────────────────────────────────────────────────
    setup:    (u, p)  => request('POST', '/auth/setup',   { username: u, password: p }),
    register: (u, p)  => request('POST', '/auth/register', { username: u, password: p }),
    login:    (u, p)  => request('POST', '/auth/login',    { username: u, password: p }),
    me:       ()      => request('GET',  '/auth/me'),
    checkUsername: (u) => request('GET', `/auth/check-username/${encodeURIComponent(u)}`),

    // ── Channels ─────────────────────────────────────────────────────────
    getChannels:   ()      => request('GET',    '/channels'),
    createChannel: (n, t)  => request('POST',   '/channels',     { name: n, type: t }),
    deleteChannel: (id)    => request('DELETE',  `/channels/${id}`),
    getMessages:   (id, before) => request('GET', `/channels/${id}/messages${before ? `?before=${before}` : ''}`),

    // ── Users ─────────────────────────────────────────────────────────────
    getUsers:     ()       => request('GET',   '/users'),
    changeRole:   (id, r)  => request('PATCH', `/users/${id}/role`, { role: r }),
    deleteUser:   (id)     => request('DELETE', `/users/${id}`),

    // ── DM ────────────────────────────────────────────────────────────────
    getDMConversations: ()   => request('GET', '/users/dm/conversations'),
    getDMHistory: (partnerId) => request('GET', `/users/dm/${partnerId}`),
    getUnreadCount: ()        => request('GET', '/users/dm/unread/count'),
  };
})();

// Patch API to add categories support
const _origAPI = API;
Object.assign(API, {
  // ── Categories ─────────────────────────────────────────────────────────
  getCategories:    ()           => API.get('/categories'),
  createCategory:   (name, pos)  => API.post('/categories', { name, position: pos || 0 }),
  renameCategory:   (id, name)   => API.patch(`/categories/${id}`, { name }),
  deleteCategory:   (id)         => API.delete(`/categories/${id}`),
  assignToCategory: (catId, chId) => API.post(`/categories/${catId}/channels/${chId}`),
  createChannelInCategory: (name, type, catId) => API.post('/channels', { name, type, category_id: catId }),
});
