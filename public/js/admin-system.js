/**
 * Plejar admin - System Status: every API endpoint, grouped by category, read from the running server.
 * Depends on admin.js (adminFetch, showAdminToast) and admin-users.js (E, val).
 */

const SYS = { catalog: null, open: new Set(['users']) };

const ACCESS_BADGE = {
  public: 'badge-active', 'signed-in': 'badge-user', vendor: 'badge-agent', 'vendor-owner': 'badge-agent',
  'admin-team': 'badge-manager', administrators: 'badge-admin', roles: 'badge-inactive'
};

async function loadEndpoints() {
  const box = document.getElementById('endpointGroups');
  if (!SYS.catalog) box.innerHTML = '<p class="detail-muted">Loading endpoints...</p>';
  const { ok, data } = await adminFetch('/api/v1/admin/system/endpoints');
  if (!ok) { box.innerHTML = `<p style="color: var(--color-danger)">${E(data.message || 'Could not load the endpoints.')}</p>`; return; }
  SYS.catalog = data.data;
  renderEndpoints();
}

function renderEndpoints() {
  const c = SYS.catalog;
  if (!c) return;
  const q = val('epSearch').trim().toLowerCase();
  const access = val('epAccess');
  const method = val('epMethod');
  const filtering = Boolean(q || access || method);
  const groups = c.categories.map(g => ({
    ...g,
    shown: g.endpoints.filter(e => (!q || e.path.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) && (!access || e.access === access) && (!method || e.method === method))
  })).filter(g => g.shown.length);
  const shownCount = groups.reduce((n, g) => n + g.shown.length, 0);

  document.getElementById('epSummary').textContent = filtering
    ? `${shownCount} of ${c.total} endpoints match, in ${groups.length} ${groups.length === 1 ? 'category' : 'categories'}.`
    : `${c.total} endpoints in ${c.categories.length} categories, read from the running server just now.`;

  document.getElementById('endpointGroups').innerHTML = groups.length ? groups.map(g => `
    <details class="ep-group" data-key="${E(g.key)}" ${filtering || SYS.open.has(g.key) ? 'open' : ''}>
      <summary>
        <span class="ep-group-name">${E(g.name)}</span>
        <span class="mini-count">${g.shown.length}${filtering && g.shown.length !== g.endpoints.length ? ` of ${g.endpoints.length}` : ''}</span>
        <span class="ep-group-desc">${E(g.description)}</span>
      </summary>
      <div class="table-container">
        <table class="admin-table ep-table">
          <thead><tr><th style="width:88px">Method</th><th>Path</th><th style="width:170px">Who can use it</th><th style="width:60px"></th></tr></thead>
          <tbody>${g.shown.map(e => `
            <tr>
              <td><span class="ep-method ep-${e.method.toLowerCase()}">${E(e.method)}</span></td>
              <td><code class="ep-path">${highlightParams(e.path)}</code></td>
              <td><span class="badge ${ACCESS_BADGE[e.access] || 'badge-inactive'}">${E(e.label)}</span></td>
              <td style="text-align:right"><button class="btn btn-secondary btn-sm" title="Copy path" onclick="copyEndpoint('${E(e.method)}', '${E(e.path)}')">Copy</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>`).join('') : '<p class="empty-note">No endpoints match. Try a shorter search.</p>';

  // Remember which groups the admin opened (when not filtering)
  document.querySelectorAll('#endpointGroups .ep-group').forEach(d => d.addEventListener('toggle', () => {
    if (filtering) return;
    if (d.open) SYS.open.add(d.dataset.key); else SYS.open.delete(d.dataset.key);
  }));
}

// /api/v1/users/:id -> the :id part shown as a placeholder
function highlightParams(path) {
  return E(path).replace(/(:[A-Za-z]+)/g, '<span class="ep-param">$1</span>');
}

function toggleAllEndpointGroups(open) {
  if (!SYS.catalog) return;
  SYS.open = open ? new Set(SYS.catalog.categories.map(g => g.key)) : new Set();
  document.querySelectorAll('#endpointGroups .ep-group').forEach(d => { d.open = open; });
}

function copyEndpoint(method, path) {
  const text = `${method} ${location.origin}${path}`;
  navigator.clipboard.writeText(text).then(() => showAdminToast('Copied.', 'success')).catch(() => showAdminToast(text, 'info'));
}
