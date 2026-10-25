/**
 * Plezar admin - Destinations: list, map, featured and trending, categories, statistics,
 * and the destination editor (details, location, photos, availability, search, statistics).
 * Depends on admin.js (adminFetch, switchTab, showAdminToast, openModal, closeModal)
 * and admin-users.js (E, fmtDate, fmtDateTime, takaFmt, val, tableMessage, renderPager, makeDebounce, formError).
 * Maps use Leaflet with OpenStreetMap tiles.
 */

const D = {
  sub: 'all',
  page: 1,
  options: [], // every destination in a few fields, for pickers
  categories: [],
  detail: null,
  tab: 'details',
  creating: false,
  featured: [],
  featuredDirty: false,
  map: null,
  editMap: null,
  editMarker: null,
  categoryCtx: null
};

const DEST_TYPES = { country: 'Country', region: 'Region', city: 'City / district', attraction: 'Attraction' };
const DEST_STATUS_BADGE = { published: 'badge-active', draft: 'badge-manager', archived: 'badge-inactive' };
const AVAIL_TEXT = { open: 'Open all year', seasonal: 'Seasonal', restricted: 'Restricted', closed: 'Closed' };
const AVAIL_BADGE = { open: 'badge-active', seasonal: 'badge-user', restricted: 'badge-manager', closed: 'badge-admin' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PIN_COLORS = { country: '#4f46e5', region: '#0e7490', city: '#b45309', attraction: '#be123c' };
const ALLOWED_PARENTS = { country: [], region: ['country'], city: ['region', 'country'], attraction: ['city', 'region', 'country'] };
const BD_CENTER = [23.685, 90.3563];

const monthList = months => (months && months.length ? months.map(m => MONTHS[m - 1]).join(', ') : '');
const pathText = d => (d.path && d.path.length ? d.path.join(' › ') : '');
const hasLoc = d => d.location && d.location.coordinates && d.location.coordinates.length === 2;
const n = v => new Intl.NumberFormat('en-US').format(v || 0);

function tileLayer() {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  });
}

function pinIcon(type) {
  return L.divIcon({ className: '', html: `<span class="map-pin" style="background:${PIN_COLORS[type] || '#334155'}"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}

// ---------- Sub-tabs ----------

const DEST_SUB_LOADERS = {
  all: () => loadDestinations(D.page),
  map: () => loadDestinationMap(),
  featured: () => loadFeaturedPane(),
  categories: () => loadDestinationCategories(),
  statistics: () => loadDestinationStats()
};

function switchDestinationSub(name) {
  D.sub = name;
  document.querySelectorAll('#tab-destinations .subtab').forEach(b => {
    const on = b.dataset.dsub === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#tab-destinations .subpane').forEach(p => p.classList.toggle('active', p.id === `dsub-${name}`));
  if (DEST_SUB_LOADERS[name]) DEST_SUB_LOADERS[name]();
}

document.querySelectorAll('#tab-destinations .subtab').forEach(btn => btn.addEventListener('click', () => switchDestinationSub(btn.dataset.dsub)));

function refreshDestinationViews() {
  loadDestinationSummary();
  ensureDestinationOptions(true);
  if (DEST_SUB_LOADERS[D.sub]) DEST_SUB_LOADERS[D.sub]();
}

function backToDestinations() {
  switchTab('destinations');
  refreshDestinationViews();
}

// ---------- Shared lists ----------

async function ensureDestinationOptions(force) {
  if (D.options.length && !force) return D.options;
  const { ok, data } = await adminFetch('/api/v1/admin/destinations/options');
  if (ok) D.options = data.data.destinations;
  const within = document.getElementById('dWithinF');
  if (within) {
    const keep = within.value;
    within.innerHTML = '<option value="">Anywhere</option>' + D.options
      .filter(o => o.type === 'country' || o.type === 'region' || o.type === 'city')
      .map(o => `<option value="${E(o._id)}">Inside ${E([...o.path, o.name].join(' › '))}</option>`).join('');
    within.value = keep;
  }
  return D.options;
}

async function ensureDestinationCategories(force) {
  if (D.categories.length && !force) return D.categories;
  const { ok, data } = await adminFetch('/api/v1/admin/destination-categories');
  if (ok) D.categories = data.data.categories;
  const select = document.getElementById('dCategoryF');
  if (select) {
    const keep = select.value;
    select.innerHTML = '<option value="">Any category</option>' + D.categories.map(c => `<option value="${E(c._id)}">${E(c.name)}</option>`).join('');
    select.value = keep;
  }
  return D.categories;
}

// ---------- Summary ----------

async function loadDestinationSummary() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/destinations/summary');
    if (!ok) return;
    const s = data.data.summary;
    const chips = [
      ['all', 'All places', s.total], ['country', 'Countries', s.countries], ['region', 'Regions', s.regions], ['city', 'Cities', s.cities],
      ['attraction', 'Attractions', s.attractions], ['draft', 'Drafts', s.draft], ['featured', 'Featured', s.featured],
      ['location', 'No map location', s.noLocation], ['cover', 'No cover photo', s.noCover], ['limited', 'Seasonal or closed', s.limited],
      ['vendor', 'Added by vendors, to review', s.vendorPending]
    ];
    const box = document.getElementById('destinationChips');
    if (box) box.innerHTML = chips.map(([key, text, count]) => `<button type="button" class="chip" onclick="applyDestinationChip('${key}')"><strong>${count}</strong> ${E(text)}</button>`).join('');
    const badge = document.getElementById('destinationsAttentionCount');
    if (badge) { badge.textContent = s.vendorPending; badge.hidden = !s.vendorPending; badge.title = `${s.vendorPending} place${s.vendorPending === 1 ? '' : 's'} added by vendors to review`; }
  } catch (e) { /* chips are informational */ }
}

function applyDestinationChip(key) {
  ['dSearch', 'dTypeF', 'dWithinF', 'dStatusF', 'dCategoryF', 'dAvailF', 'dMissingF', 'dSourceF'].forEach(id => { document.getElementById(id).value = ''; });
  if (key === 'vendor') { document.getElementById('dSourceF').value = 'vendor'; document.getElementById('dStatusF').value = 'draft'; }
  if (['country', 'region', 'city', 'attraction'].includes(key)) document.getElementById('dTypeF').value = key;
  if (key === 'draft') document.getElementById('dStatusF').value = 'draft';
  if (key === 'location' || key === 'cover') document.getElementById('dMissingF').value = key;
  if (key === 'featured') return switchDestinationSub('featured');
  if (key === 'limited') document.getElementById('dAvailF').value = 'seasonal';
  loadDestinations(1);
}

// ---------- List ----------

async function loadDestinations(page = D.page) {
  D.page = page;
  ensureDestinationCategories();
  ensureDestinationOptions();
  tableMessage('destinationsTableBody', 8, 'Loading destinations...');
  const params = new URLSearchParams({ page, limit: 25 });
  [['search', 'dSearch'], ['type', 'dTypeF'], ['within', 'dWithinF'], ['status', 'dStatusF'], ['category', 'dCategoryF'], ['availability', 'dAvailF'], ['missing', 'dMissingF'], ['source', 'dSourceF'], ['sort', 'dSortF']]
    .forEach(([k, id]) => { const v = val(id).trim(); if (v) params.set(k, v); });
  const { ok, data } = await adminFetch(`/api/v1/admin/destinations?${params}`);
  if (!ok) return tableMessage('destinationsTableBody', 8, data.message || 'Could not load destinations.', 'var(--color-danger)');
  const rows = data.data.destinations;
  if (!rows.length) {
    tableMessage('destinationsTableBody', 8, params.toString().includes('search') || params.toString().length > 20
      ? 'No destinations match these filters.'
      : 'No destinations yet. Start with a country, then add its regions, cities and attractions.');
  } else {
    document.getElementById('destinationsTableBody').innerHTML = rows.map(d => {
      const id = E(d._id);
      return `
      <tr class="row-link" onclick="openDestination('${id}')">
        <td><div class="dest-cell">
          ${d.coverImage ? `<img class="dest-thumb" src="${E(d.coverImage)}" alt="" loading="lazy">` : '<span class="dest-thumb dest-thumb-empty">No photo</span>'}
          <div><span class="lead-main">${E(d.name)}${d.featured ? ' <span class="tag">Featured</span>' : ''}${d.trendingPinned ? ' <span class="tag">Trending</span>' : ''}</span>
          <span class="lead-sub">${E(pathText(d)) || 'Top level'}${d.nameBn ? ` · <span lang="bn">${E(d.nameBn)}</span>` : ''}</span>
          ${d.source === 'vendor' ? `<span class="lead-sub vendor-added">Added by ${E(d.addedByAgency ? d.addedByAgency.name : 'a vendor')}${d.status === 'draft' ? ', waiting for review' : ''}</span>` : ''}</div>
        </div></td>
        <td>${E(DEST_TYPES[d.type])}${d.childCount ? `<span class="lead-sub">${n(d.childCount)} inside</span>` : ''}</td>
        <td><span class="lead-sub" style="margin:0">${d.hasLocation ? '📍 On the map' : '<span style="color:var(--color-danger)">No location</span>'}</span><span class="lead-sub">${d.photoCount} photo${d.photoCount === 1 ? '' : 's'}</span></td>
        <td><span class="badge ${AVAIL_BADGE[d.availability.status]}">${E(AVAIL_TEXT[d.availability.status])}</span>${d.availability.status === 'seasonal' ? `<span class="lead-sub">${E(monthList(d.availability.openMonths))}</span>` : ''}</td>
        <td>${n(d.stats.upcomingEvents)} upcoming<span class="lead-sub">${n(d.stats.events)} in total</span></td>
        <td>${n(d.stats.travelers)}<span class="lead-sub">${n(d.stats.recentTravelers)} in 30 days</span></td>
        <td><span class="badge ${DEST_STATUS_BADGE[d.status]}">${E(label(d.status))}</span></td>
        <td style="text-align:right;"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openDestination('${id}')">Edit</button></td>
      </tr>`;
    }).join('');
  }
  renderPager('destinationsPager', data.data, 'loadDestinations');
}

const debouncedDestinations = makeDebounce(() => loadDestinations(1));

// ---------- Map of all destinations ----------

async function loadDestinationMap() {
  const box = document.getElementById('destinationMap');
  if (typeof L === 'undefined') {
    box.innerHTML = '<p class="empty-note" style="padding:24px">The map library could not load. Check the internet connection and reload.</p>';
    return;
  }
  const params = new URLSearchParams({ limit: 100 });
  if (!document.getElementById('mapShowDrafts').checked) params.set('status', 'published');
  // Load every page of destinations (the list endpoint caps pages at 100)
  let rows = [];
  for (let page = 1; page < 50; page += 1) {
    params.set('page', page);
    // eslint-disable-next-line no-await-in-loop
    const { ok, data } = await adminFetch(`/api/v1/admin/destinations?${params}`);
    if (!ok) break;
    rows = rows.concat(data.data.destinations);
    if (page >= data.data.pages) break;
  }

  if (!D.map) {
    D.map = L.map(box, { scrollWheelZoom: true }).setView(BD_CENTER, 7);
    tileLayer().addTo(D.map);
    D.mapLayer = L.layerGroup().addTo(D.map);
  }
  D.mapLayer.clearLayers();
  const placed = rows.filter(hasLoc);
  placed.forEach(d => {
    const [lng, lat] = d.location.coordinates;
    L.marker([lat, lng], { icon: pinIcon(d.type), title: d.name })
      .bindPopup(`<strong>${E(d.name)}</strong><br><span>${E(DEST_TYPES[d.type])}${pathText(d) ? `, ${E(pathText(d))}` : ''}</span><br><span>${n(d.stats.upcomingEvents)} upcoming events, ${E(label(d.status))}</span><br><button type="button" class="btn btn-primary btn-sm" style="margin-top:6px" onclick="openDestination('${E(d._id)}')">Open</button>`)
      .addTo(D.mapLayer);
  });
  if (placed.length) D.map.fitBounds(L.latLngBounds(placed.map(d => [d.location.coordinates[1], d.location.coordinates[0]])).pad(0.15), { maxZoom: 9 });
  setTimeout(() => D.map.invalidateSize(), 50);

  const missing = rows.filter(d => !hasLoc(d));
  document.getElementById('mapSummary').textContent = `${n(placed.length)} of ${n(rows.length)} destinations have a map location. Select a pin to open it.`;
  document.getElementById('mapMissing').innerHTML = missing.length ? `
    <div class="detail-card" style="margin-top:14px">
      <h3>Not on the map yet</h3>
      <div class="tag-row">${missing.map(d => `<button type="button" class="chip" onclick="openDestination('${E(d._id)}', 'location')">${E(d.name)}</button>`).join('')}</div>
    </div>` : '';
}

// ---------- Featured and trending ----------

async function loadFeaturedPane() {
  const [featured, trending] = await Promise.all([
    adminFetch('/api/v1/admin/destinations/featured'),
    adminFetch('/api/v1/admin/destinations/trending'),
    ensureDestinationOptions()
  ]);
  if (featured.ok) {
    D.featured = featured.data.data.destinations.map(d => ({ _id: d._id, name: d.name, path: d.path, coverImage: d.coverImage }));
    D.featuredDirty = false;
    renderFeatured();
  }
  document.getElementById('featureAddList').innerHTML = D.options.filter(o => o.status === 'published')
    .map(o => `<option value="${E([...o.path, o.name].join(' › '))}"></option>`).join('');
  const list = document.getElementById('trendingList');
  if (trending.ok) {
    const rows = trending.data.data.destinations;
    list.innerHTML = rows.length ? rows.map(d => `
      <li>
        <div class="feature-item">
          ${d.coverImage ? `<img class="dest-thumb" src="${E(d.coverImage)}" alt="">` : '<span class="dest-thumb dest-thumb-empty"></span>'}
          <div><strong>${E(d.name)}</strong><span class="lead-sub">${d.trendingPinned ? 'Pinned by Plezar. ' : ''}${n(d.stats.recentTravelers)} travelers in 30 days, ${n(d.stats.upcomingEvents)} upcoming events</span></div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="toggleTrendingPin('${E(d._id)}', ${!d.trendingPinned})">${d.trendingPinned ? 'Unpin' : 'Pin'}</button>
      </li>`).join('') : '<li class="detail-muted">Nothing is trending yet. Places show up here as travelers register for tour events linked to them, or when you pin one.</li>';
  }
}

function renderFeatured() {
  const list = document.getElementById('featuredList');
  list.innerHTML = D.featured.length ? D.featured.map((d, i) => `
    <li>
      <div class="feature-item">
        ${d.coverImage ? `<img class="dest-thumb" src="${E(d.coverImage)}" alt="">` : '<span class="dest-thumb dest-thumb-empty"></span>'}
        <div><strong>${E(d.name)}</strong><span class="lead-sub">${E(pathText(d))}</span></div>
      </div>
      <div class="lead-actions">
        <button class="btn btn-secondary btn-sm" ${i === 0 ? 'disabled' : ''} onclick="moveFeatured(${i}, -1)" aria-label="Move up">↑</button>
        <button class="btn btn-secondary btn-sm" ${i === D.featured.length - 1 ? 'disabled' : ''} onclick="moveFeatured(${i}, 1)" aria-label="Move down">↓</button>
        <button class="btn btn-danger btn-sm" onclick="removeFeatured(${i})">Remove</button>
      </div>
    </li>`).join('') : '<li class="detail-muted">Nothing featured yet. Add a few of your best places below.</li>';
  document.getElementById('featuredSave').disabled = !D.featuredDirty;
}

function moveFeatured(i, dir) {
  const j = i + dir;
  [D.featured[i], D.featured[j]] = [D.featured[j], D.featured[i]];
  D.featuredDirty = true;
  renderFeatured();
}

function removeFeatured(i) {
  D.featured.splice(i, 1);
  D.featuredDirty = true;
  renderFeatured();
}

function addFeatured() {
  const input = document.getElementById('featureAdd');
  const wanted = input.value.trim();
  const match = D.options.find(o => o.status === 'published' && ([...o.path, o.name].join(' › ') === wanted || o.name === wanted));
  if (!match) return showAdminToast('Pick a published destination from the list.', 'error');
  if (D.featured.some(f => f._id === match._id)) return showAdminToast(`${match.name} is already featured.`, 'info');
  D.featured.push({ _id: match._id, name: match.name, path: match.path, coverImage: '' });
  D.featuredDirty = true;
  input.value = '';
  renderFeatured();
}

async function saveFeatured() {
  const { ok, data } = await adminFetch('/api/v1/admin/destinations/featured', { method: 'PUT', body: JSON.stringify({ ids: D.featured.map(f => f._id) }) });
  if (!ok) return showAdminToast(data.message || 'Could not save the featured list.', 'error');
  showAdminToast('Featured list saved.', 'success');
  loadFeaturedPane();
  loadDestinationSummary();
}

async function toggleTrendingPin(id, pinned) {
  const { ok, data } = await adminFetch(`/api/v1/admin/destinations/${id}`, { method: 'PATCH', body: JSON.stringify({ trendingPinned: pinned }) });
  if (!ok) return showAdminToast(data.message || 'Could not update.', 'error');
  showAdminToast(pinned ? 'Pinned to trending.' : 'Unpinned.', 'success');
  if (D.sub === 'featured') loadFeaturedPane();
  if (D.detail && D.detail.destination._id === id) { D.detail = data.data; renderDestinationDetail(D.tab); }
}

// ---------- Categories ----------

async function loadDestinationCategories() {
  tableMessage('destinationCategoriesBody', 6, 'Loading categories...');
  const cats = await ensureDestinationCategories(true);
  document.getElementById('destinationCategoriesBody').innerHTML = cats.length ? cats.map(c => `
    <tr class="${c.active ? '' : 'is-muted'}">
      <td><strong>${E(c.name)}</strong></td>
      <td lang="bn">${E(c.nameBn) || '—'}</td>
      <td style="color: var(--text-muted); font-size: 0.85rem;">${E(c.description) || '—'}</td>
      <td>${n(c.destinations)}</td>
      <td><span class="badge ${c.active ? 'badge-active' : 'badge-inactive'}">${c.active ? 'Active' : 'Switched off'}</span></td>
      <td style="text-align:right;"><div class="lead-actions" style="justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" onclick="openDestinationCategoryModal('${E(c._id)}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleDestinationCategory('${E(c._id)}', ${!c.active})">${c.active ? 'Switch off' : 'Switch on'}</button>
        ${isMoneyAdmin() ? `<button class="btn btn-danger btn-sm" onclick="deleteDestinationCategory('${E(c._id)}')">Delete</button>` : ''}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-dim)">No categories yet. Add kinds of places, like Beaches, Hills, Forests or Heritage.</td></tr>';
}

function openDestinationCategoryModal(id) {
  const c = id ? D.categories.find(x => x._id === id) : null;
  D.categoryCtx = c;
  document.getElementById('dcTitle').textContent = c ? 'Edit category' : 'New category';
  document.getElementById('dcName').value = c ? c.name : '';
  document.getElementById('dcNameBn').value = c ? c.nameBn : '';
  document.getElementById('dcDesc').value = c ? c.description : '';
  formError('dcError');
  openModal('destCategoryModal');
  document.getElementById('dcName').focus();
}

async function submitDestinationCategory(e) {
  e.preventDefault();
  const body = { name: val('dcName').trim(), nameBn: val('dcNameBn').trim(), description: val('dcDesc').trim() };
  if (!body.name) return formError('dcError', 'Enter a name.');
  const c = D.categoryCtx;
  const { ok, data } = await adminFetch(c ? `/api/v1/admin/destination-categories/${c._id}` : '/api/v1/admin/destination-categories', { method: c ? 'PATCH' : 'POST', body: JSON.stringify(body) });
  if (!ok) return formError('dcError', /duplicate|E11000/i.test(data.message || '') ? 'A category with this name already exists.' : (data.message || 'Could not save.'));
  closeModal('destCategoryModal');
  showAdminToast(c ? 'Category saved.' : 'Category added.', 'success');
  loadDestinationCategories();
}

async function toggleDestinationCategory(id, active) {
  const { ok, data } = await adminFetch(`/api/v1/admin/destination-categories/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (!ok) return showAdminToast(data.message || 'Could not update.', 'error');
  loadDestinationCategories();
}

async function deleteDestinationCategory(id) {
  const c = D.categories.find(x => x._id === id);
  if (!c || !confirm(`Delete the category "${c.name}"?`)) return;
  const { ok, status, data } = await adminFetch(`/api/v1/admin/destination-categories/${id}`, { method: 'DELETE' });
  if (!ok && status !== 204) return showAdminToast(data.message || 'Could not delete.', 'error');
  showAdminToast('Category deleted.', 'info');
  loadDestinationCategories();
}

// ---------- Statistics ----------

function rankTable(title, rows, value, unit) {
  return `<div class="detail-card"><h3>${E(title)}</h3>${rows.length ? `<ol class="rank-list">${rows.map(r => `
    <li><button type="button" class="link-btn" onclick="openDestination('${E(r._id)}', 'statistics')">${E(r.name)}</button><span class="lead-sub">${E(r.path.join(' › '))}</span><strong>${E(value(r))}</strong></li>`).join('')}</ol>`
    : `<p class="detail-muted">No ${E(unit)} yet.</p>`}</div>`;
}

async function loadDestinationStats() {
  const box = document.getElementById('destinationStats');
  box.innerHTML = '<p style="color:var(--text-dim); padding:16px">Loading statistics...</p>';
  const { ok, data } = await adminFetch('/api/v1/admin/destinations/statistics');
  if (!ok) { box.innerHTML = `<p style="color:var(--color-danger); padding:16px">${E(data.message)}</p>`; return; }
  const s = data.data;
  box.innerHTML = `
    <div class="kpi-grid">
      ${vTile('Destination page views', n(s.totals.views), 'From the app and website')}
      ${vTile('Tour events linked to a place', n(s.totals.linkedEvents), `${n(s.totals.unlinkedEvents)} not linked yet`)}
    </div>
    <div class="feature-grid" style="margin-top:16px">
      ${rankTable('Most travelers', s.topByTravelers, r => n(r.stats.travelers), 'registrations')}
      ${rankTable('Most upcoming tour events', s.topByEvents, r => n(r.stats.upcomingEvents), 'upcoming events')}
      ${rankTable('Most paid revenue', s.topByRevenue, r => takaFmt(r.stats.revenue), 'paid bookings')}
      ${rankTable('Most viewed', s.topByViews, r => n(r.views), 'page views')}
    </div>
    <div class="detail-card" style="margin-top:16px">
      <h3>By region</h3>
      ${s.regions.length ? barList(s.regions.map(r => ({ label: r.name, count: r.stats.travelers }))) + '<p class="detail-muted" style="margin-top:8px">Travelers registered for tour events anywhere in each region.</p>' : '<p class="detail-muted">Add regions to see this breakdown.</p>'}
    </div>`;
}

// ---------- Destination editor ----------

const DEST_TABS = [['details', 'Details'], ['location', 'Location'], ['photos', 'Photos'], ['availability', 'Availability & categories'], ['seo', 'Search & sharing'], ['statistics', 'Statistics']];

async function openDestination(id, tab = 'details') {
  D.creating = false;
  switchTab('destinationDetail');
  const box = document.getElementById('destinationDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading destination...</p>';
  const [{ ok, data }] = await Promise.all([adminFetch(`/api/v1/admin/destinations/${id}`), ensureDestinationOptions(), ensureDestinationCategories()]);
  if (!ok) { box.innerHTML = `<p style="color: var(--color-danger); padding: 24px;">${E(data.message || 'Could not load this destination.')}</p>`; return; }
  D.detail = data.data;
  renderDestinationDetail(tab);
}

async function openNewDestination(parentId) {
  D.creating = true;
  D.detail = null;
  switchTab('destinationDetail');
  const box = document.getElementById('destinationDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading...</p>';
  const [{ ok, data }] = await Promise.all([adminFetch('/api/v1/admin/destinations/geography'), ensureDestinationOptions(true)]);
  D.geo = ok ? data.data : { divisions: [] };
  D.autoFilled = {};

  // Started from "+ Add a place inside": work out the type, division and district from the parent
  const parent = parentId ? D.options.find(o => o._id === parentId) : null;
  let type = 'attraction';
  let division = '';
  let district = '';
  let other = false;
  if (parent) {
    type = { country: 'region', region: 'city', city: 'attraction' }[parent.type] || 'attraction';
    const hit = geoCodeOf(parent._id);
    if (hit && hit.division) { division = hit.division.code; district = hit.district ? hit.district.code : ''; }
    else if (parent.type !== 'country' || !hit) other = true;
  }

  box.innerHTML = `
    <div class="profile-head">
      <button class="btn btn-secondary btn-sm" onclick="backToDestinations()">&larr; Destinations</button>
      <div class="profile-id"><div><h2>New destination</h2><p>Start with the basics. You can add photos, the description and the rest next.</p></div></div>
    </div>
    <form class="detail-card" style="max-width: 720px" onsubmit="submitNewDestination(event)" novalidate>
      <div class="form-group"><span class="form-label">What are you adding? *</span>
        <div class="type-pick">${[['attraction', 'A place to visit', 'Sajek Valley, Ratargul'], ['city', 'A district or city', 'Cox’s Bazar, Sreemangal'], ['region', 'A division', 'Chattogram, Sylhet'], ['country', 'A country', 'Bangladesh, Nepal']].map(([k, t, eg]) => `
          <label class="type-option"><input type="radio" name="ndType" value="${k}" ${k === type ? 'checked' : ''} onchange="syncNewDestinationForm()"><span><strong>${t}</strong><small>${eg}</small></span></label>`).join('')}</div>
      </div>

      <fieldset class="where-box" id="ndWhere">
        <legend class="form-label">Where is it?</legend>
        <div class="where-country">
          <label class="check"><input type="radio" name="ndCountry" value="bd" ${other ? '' : 'checked'} onchange="syncNewDestinationForm()"> Bangladesh</label>
          <label class="check"><input type="radio" name="ndCountry" value="other" ${other ? 'checked' : ''} onchange="syncNewDestinationForm()"> Another country</label>
        </div>
        <div class="form-row-2" id="ndBdPickers">
          <div class="form-group"><label class="form-label" for="ndDivision">Division *</label>
            <select id="ndDivision" class="form-select" onchange="fillDistrictSelect(); applyGeoDefaults()">
              <option value="">Choose a division</option>
              ${D.geo.divisions.map(dv => `<option value="${E(dv.code)}">${E(dv.name)} (${E(dv.nameBn)})</option>`).join('')}
            </select></div>
          <div class="form-group" id="ndDistrictGroup"><label class="form-label" for="ndDistrict" id="ndDistrictLabel">District *</label>
            <select id="ndDistrict" class="form-select" onchange="applyGeoDefaults()" disabled><option value="">Choose the division first</option></select></div>
        </div>
        <div class="form-group" id="ndOtherParent" hidden><label class="form-label" for="ndParent">Inside</label><select id="ndParent" class="form-select"></select>
          <p class="detail-muted" style="margin:4px 0 0">Add the country first if it isn't in the list.</p></div>
        <div id="ndExisting"></div>
      </fieldset>

      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="ndName">Name *</label><input id="ndName" class="form-input" maxlength="120" placeholder="Sajek Valley"></div>
        <div class="form-group"><label class="form-label" for="ndNameBn">Name in Bangla</label><input id="ndNameBn" class="form-input" maxlength="120" lang="bn" placeholder="সাজেক ভ্যালি"></div>
      </div>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="ndLat">Latitude <span class="detail-muted">(optional)</span></label><input id="ndLat" class="form-input" inputmode="decimal" placeholder="23.3820"></div>
        <div class="form-group"><label class="form-label" for="ndLng">Longitude <span class="detail-muted">(optional)</span></label><input id="ndLng" class="form-input" inputmode="decimal" placeholder="92.2938"></div>
      </div>
      <p class="detail-muted" id="ndCoordHint" style="margin:-6px 0 12px">Leave empty to set it on the map later. Tip: right-click a spot in Google Maps to copy its coordinates.</p>
      <div class="form-group"><label class="form-label" for="ndSummary">Short summary</label><textarea id="ndSummary" class="form-input" rows="2" maxlength="300" placeholder="One or two lines travelers see on the card."></textarea></div>
      <div class="form-group"><label class="form-label" for="ndPhoto">Cover photo <span class="detail-muted">(optional)</span></label>
        <input id="ndPhoto" type="file" class="form-input" accept="image/jpeg,image/png,image/webp" onchange="previewNewPhoto(this)">
        <img id="ndPhotoPreview" class="new-photo-preview" alt="" hidden>
        <p class="detail-muted" style="margin:4px 0 0">JPG, PNG or WebP, up to 5 MB. You can add more photos, captions and credits afterwards.</p></div>
      <div class="form-error-box" id="ndError" role="alert" hidden></div>
      <button type="submit" class="btn btn-primary" id="ndSubmit">Create as draft</button>
    </form>`;

  if (division) document.getElementById('ndDivision').value = division;
  fillDistrictSelect(district);
  syncNewDestinationForm();
  if (other && parent) document.getElementById('ndParent').value = parent._id;
  document.getElementById('ndName').focus();
}

// Which built-in division or district a destination is (by its code), if any
function geoCodeOf(destinationId) {
  for (const dv of (D.geo && D.geo.divisions) || []) {
    if (dv.existing && dv.existing._id === destinationId) return { division: dv };
    const dt = dv.districts.find(x => x.existing && x.existing._id === destinationId);
    if (dt) return { division: dv, district: dt };
  }
  if (D.geo && D.geo.country && D.geo.country.existing && D.geo.country.existing._id === destinationId) return { country: true };
  return null;
}

const newType = () => (document.querySelector('input[name="ndType"]:checked') || {}).value || 'attraction';
const inBangladesh = () => ((document.querySelector('input[name="ndCountry"]:checked') || {}).value || 'bd') === 'bd';
const pickedDivision = () => D.geo.divisions.find(dv => dv.code === val('ndDivision'));
const pickedDistrict = () => { const dv = pickedDivision(); return dv ? dv.districts.find(x => x.code === val('ndDistrict')) : null; };

function syncNewDestinationForm() {
  const type = newType();
  const bd = inBangladesh();
  document.getElementById('ndWhere').hidden = type === 'country';
  document.getElementById('ndBdPickers').hidden = !bd;
  document.getElementById('ndOtherParent').hidden = bd;
  // A division is picked from the division list; districts and attractions also pick a district
  document.getElementById('ndDistrictGroup').hidden = type === 'region';
  document.getElementById('ndDistrictLabel').textContent = type === 'city' ? 'Which district (fills in the name)' : 'District *';
  const placeholders = { attraction: 'Sajek Valley', city: 'Cox’s Bazar', region: 'Chattogram', country: 'Nepal' };
  document.getElementById('ndName').placeholder = placeholders[type];
  document.getElementById('ndNameBn').placeholder = { attraction: 'সাজেক ভ্যালি', city: 'কক্সবাজার', region: 'চট্টগ্রাম', country: 'নেপাল' }[type];
  if (!bd) fillParentSelect('ndParent', type, val('ndParent'));
  fillDistrictSelect(val('ndDistrict'));
  applyGeoDefaults();
}

function fillDistrictSelect(selected) {
  const select = document.getElementById('ndDistrict');
  const dv = pickedDivision();
  if (!dv) {
    select.innerHTML = '<option value="">Choose the division first</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = `<option value="">${newType() === 'city' ? 'Another city in this division' : 'Choose a district'}</option>`
    + dv.districts.map(dt => `<option value="${E(dt.code)}">${E(dt.name)} (${E(dt.nameBn)})${dt.existing ? ' ✓' : ''}</option>`).join('');
  if (selected) select.value = selected;
}

// Fill name and coordinates from the picked division or district (without overwriting what the admin typed)
function applyGeoDefaults() {
  const type = newType();
  const dv = pickedDivision();
  const dt = pickedDistrict();
  const source = type === 'region' ? dv : (type === 'city' ? dt : null);
  const fill = (id, value) => {
    const el = document.getElementById(id);
    if (!el.value.trim() || el.value === D.autoFilled[id]) {
      el.value = value == null ? '' : value;
      D.autoFilled[id] = el.value;
    }
  };
  if (type !== 'country' && inBangladesh()) {
    fill('ndName', source ? source.name : '');
    fill('ndNameBn', source ? source.nameBn : '');
    fill('ndLat', source ? source.lat : '');
    fill('ndLng', source ? source.lng : '');
  }
  const near = dt || dv;
  document.getElementById('ndLat').placeholder = near ? String(near.lat) : '23.3820';
  document.getElementById('ndLng').placeholder = near ? String(near.lng) : '92.2938';
  document.getElementById('ndCoordHint').textContent = source
    ? `Filled in with ${source.name}'s approximate centre. Change it if you know better, or fix it on the map later.`
    : 'Leave empty to set it on the map later. Tip: right-click a spot in Google Maps to copy its coordinates.';

  // Already a destination? Say so before the admin fills in the rest
  const existing = source && source.existing;
  document.getElementById('ndExisting').innerHTML = existing
    ? `<div class="callout callout-warn"><div><strong>${E(existing.name)} is already a destination.</strong>Open it instead of adding it again.</div><button type="button" class="btn btn-secondary btn-sm" onclick="openDestination('${E(existing._id)}')">Open ${E(existing.name)}</button></div>`
    : '';
  if (type === 'attraction' && dv && !dt) document.getElementById('ndExisting').innerHTML = '';
}

function previewNewPhoto(input) {
  const img = document.getElementById('ndPhotoPreview');
  const file = input.files[0];
  if (!file) { img.hidden = true; return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    input.value = '';
    img.hidden = true;
    return formError('ndError', 'Use a JPG, PNG or WebP photo under 5 MB.');
  }
  formError('ndError');
  img.src = URL.createObjectURL(file);
  img.hidden = false;
}

async function submitNewDestination(e) {
  e.preventDefault();
  const type = newType();
  const body = { name: val('ndName').trim(), nameBn: val('ndNameBn').trim(), type, summary: val('ndSummary').trim(), lat: val('ndLat').trim(), lng: val('ndLng').trim() };
  if (!body.name) return formError('ndError', 'Enter the name.');
  if ((body.lat === '') !== (body.lng === '')) return formError('ndError', 'Enter both latitude and longitude, or leave both empty.');
  if (body.lat !== '' && (!Number.isFinite(Number(body.lat)) || Math.abs(Number(body.lat)) > 90)) return formError('ndError', 'Latitude must be a number between -90 and 90.');
  if (body.lng !== '' && (!Number.isFinite(Number(body.lng)) || Math.abs(Number(body.lng)) > 180)) return formError('ndError', 'Longitude must be a number between -180 and 180.');
  if (type !== 'country') {
    if (inBangladesh()) {
      if (!val('ndDivision')) return formError('ndError', 'Choose the division.');
      if (type === 'attraction' && !val('ndDistrict')) return formError('ndError', 'Choose the district this place is in.');
      body.geo = { division: val('ndDivision'), district: type === 'region' ? '' : val('ndDistrict') };
    } else {
      if (!val('ndParent')) return formError('ndError', 'Choose where this place is.');
      body.parent = val('ndParent');
    }
  }
  formError('ndError');
  const btn = document.getElementById('ndSubmit');
  btn.disabled = true;
  try {
    const { ok, status, data } = await adminFetch('/api/v1/admin/destinations', { method: 'POST', body: JSON.stringify(body) });
    if (status === 409 && data.data && data.data.existing) {
      document.getElementById('ndExisting').innerHTML = `<div class="callout callout-warn"><div><strong>${E(data.message)}</strong></div><button type="button" class="btn btn-secondary btn-sm" onclick="openDestination('${E(data.data.existing._id)}')">Open ${E(data.data.existing.name)}</button></div>`;
      return formError('ndError', data.message);
    }
    if (!ok) return formError('ndError', data.message || 'Could not create the destination.');
    D.creating = false;
    D.detail = data.data;
    const also = data.data.alsoCreated || [];
    // The cover photo goes up once the destination exists
    const photo = document.getElementById('ndPhoto').files[0];
    if (photo) {
      const fd = new FormData();
      fd.append('photos', photo);
      const up = await adminForm(`/api/v1/admin/destinations/${data.data.destination._id}/photos`, 'POST', fd);
      if (up.ok) D.detail = up.data.data;
      else showAdminToast(`Created, but the photo didn't upload: ${up.data.message || 'try again in Photos'}.`, 'error');
    }
    showAdminToast(`${body.name} created as a draft.${also.length ? ` Also added ${also.join(', ')}.` : ''}`, 'success');
    ensureDestinationOptions(true);
    renderDestinationDetail(D.detail.destination.hasLocation ? 'photos' : 'location');
  } finally {
    btn.disabled = false;
  }
}

// Fill a "put this under" select with the places a destination of `type` may sit under
function fillParentSelect(selectId, type, selected, excludeId) {
  const select = document.getElementById(selectId);
  const allowed = ALLOWED_PARENTS[type] || [];
  // A place can't move inside itself or inside one of its own places
  const inside = o => excludeId && (o._id === excludeId || (o.ancestors || []).map(String).includes(String(excludeId)));
  const choices = D.options.filter(o => allowed.includes(o.type) && !inside(o));
  select.innerHTML = (type === 'country' ? '<option value="">Top level (no parent)</option>' : '<option value="">Choose...</option>')
    + choices.map(o => `<option value="${E(o._id)}">${E([...o.path, o.name].join(' › '))} (${E(DEST_TYPES[o.type])})</option>`).join('');
  select.disabled = type === 'country';
  if (selected) select.value = selected;
}

function renderDestinationDetail(tab = 'details') {
  const d = D.detail.destination;
  const path = D.detail.parentPath || [];
  document.getElementById('destinationDetail').innerHTML = `
    <div class="profile-head">
      <button class="btn btn-secondary btn-sm" onclick="backToDestinations()">&larr; Destinations</button>
      <div class="profile-id">
        ${d.coverImage ? `<img class="dest-hero" src="${E(d.coverImage)}" alt="">` : '<span class="dest-hero dest-thumb-empty">No photo</span>'}
        <div>
          <h2>${E(d.name)}${d.nameBn ? ` <span class="dest-bn" lang="bn">${E(d.nameBn)}</span>` : ''}</h2>
          <p>${E(DEST_TYPES[d.type])}${path.length ? ` in ${E(path.join(' › '))}` : ''} · /${E(d.slug)}</p>
          <p class="profile-badges">
            <span class="badge ${DEST_STATUS_BADGE[d.status]}">${E(label(d.status))}</span>
            <span class="badge ${AVAIL_BADGE[d.availability.status]}">${E(AVAIL_TEXT[d.availability.status])}</span>
            ${d.featured ? '<span class="badge badge-user">Featured</span>' : ''}
            ${d.trendingPinned ? '<span class="badge badge-user">Pinned to trending</span>' : ''}
          </p>
        </div>
      </div>
      <div class="profile-actions">
        ${d.status !== 'published' ? '<button class="btn btn-primary" onclick="setDestinationStatus(\'published\')">Publish</button>' : '<button class="btn btn-secondary" onclick="setDestinationStatus(\'draft\')">Unpublish</button>'}
        ${d.type !== 'attraction' ? `<button class="btn btn-secondary" onclick="openNewDestination('${E(d._id)}')">+ Add a place inside</button>` : ''}
        ${d.status !== 'archived' ? '<button class="btn btn-secondary" onclick="setDestinationStatus(\'archived\')">Archive</button>' : ''}
        ${isMoneyAdmin() ? '<button class="btn btn-danger" onclick="deleteDestination()">Delete</button>' : ''}
      </div>
    </div>
    ${d.source === 'vendor' ? `<div class="callout ${d.status === 'draft' ? 'callout-warn' : ''}"><div><strong>Added by ${E(d.addedByAgency ? d.addedByAgency.name : 'a vendor')} on ${E(fmtDate(d.createdAt))}</strong>${d.status === 'draft' ? 'The vendor can already link tours to it. Check the name, location and photo, then publish it so travelers can see it.' : 'Reviewed and published.'}</div>${d.addedByAgency ? `<button class="btn btn-secondary btn-sm" onclick="openVendor('${E(d.addedByAgency._id)}')">Open vendor</button>` : ''}</div>` : ''}
    ${destinationChecklist(d)}
    <div class="subtabs" role="tablist" aria-label="Destination sections">
      ${DEST_TABS.map(([key, t]) => `<button type="button" role="tab" class="subtab ${key === tab ? 'active' : ''}" data-dtab="${key}" aria-selected="${key === tab}" onclick="renderDestinationTab('${key}')">${t}</button>`).join('')}
    </div>
    <div id="destinationTabBody"></div>`;
  renderDestinationTab(tab);
}

// What's still missing before a place looks good in the app
function destinationChecklist(d) {
  const missing = [];
  if (!d.summary) missing.push(['details', 'a short summary']);
  if (!d.description) missing.push(['details', 'a description']);
  if (!d.hasLocation) missing.push(['location', 'a map location']);
  if (!d.coverImage) missing.push(['photos', 'a cover photo']);
  if (!d.seo.title || !d.seo.description) missing.push(['seo', 'search text']);
  if (!missing.length) return '';
  return `<div class="callout ${d.status === 'published' ? 'callout-warn' : ''}"><div><strong>${d.status === 'published' ? 'Published, but missing' : 'Before publishing, add'}</strong>${missing.map(([tab, what]) => `<button type="button" class="link-btn" onclick="renderDestinationTab('${tab}')">${E(what)}</button>`).join(', ')}.</div></div>`;
}

function renderDestinationTab(tab) {
  D.tab = tab;
  document.querySelectorAll('#destinationDetail [data-dtab]').forEach(b => {
    const on = b.dataset.dtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (D.editMap) { D.editMap.remove(); D.editMap = null; }
  const body = document.getElementById('destinationTabBody');
  const render = { details: destDetailsTab, location: destLocationTab, photos: destPhotosTab, availability: destAvailabilityTab, seo: destSeoTab, statistics: destStatsTab }[tab];
  body.innerHTML = render();
  if (tab === 'details') fillParentSelect('deParent', D.detail.destination.type, D.detail.destination.parent || '', D.detail.destination._id);
  if (tab === 'location') initEditMap();
  if (tab === 'seo') updateSeoPreview();
}

async function patchDestination(body, message, btn) {
  if (btn) btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/destinations/${D.detail.destination._id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) { showAdminToast(data.message || 'Could not save.', 'error'); return false; }
    D.detail = data.data;
    showAdminToast(message || 'Saved.', 'success');
    renderDestinationDetail(D.tab);
    ensureDestinationOptions(true);
    return true;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function setDestinationStatus(status) {
  const d = D.detail.destination;
  if (status === 'archived' && !confirm(`Archive ${d.name}? It disappears from the app, but its history and links stay.`)) return;
  await patchDestination({ status }, { published: `${d.name} is published.`, draft: `${d.name} is back to draft.`, archived: `${d.name} is archived.` }[status]);
}

async function deleteDestination() {
  const d = D.detail.destination;
  if (!confirm(`Delete ${d.name} and its photos? This can't be undone.`)) return;
  const { ok, status, data } = await adminFetch(`/api/v1/admin/destinations/${d._id}`, { method: 'DELETE' });
  if (!ok && status !== 204) return showAdminToast(data.message || 'Could not delete.', 'error');
  showAdminToast(`${d.name} deleted.`, 'info');
  backToDestinations();
}

// Details: names, type and place, content
function destDetailsTab() {
  const d = D.detail.destination;
  return `
    <form class="detail-card" onsubmit="saveDestinationDetails(event)" novalidate>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="deName">Name *</label><input id="deName" class="form-input" maxlength="120" value="${E(d.name)}"></div>
        <div class="form-group"><label class="form-label" for="deNameBn">Name in Bangla</label><input id="deNameBn" class="form-input" maxlength="120" lang="bn" value="${E(d.nameBn)}"></div>
      </div>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="deType">Type</label>
          <select id="deType" class="form-select" onchange="fillParentSelect('deParent', this.value, '', '${E(d._id)}')">${Object.entries(DEST_TYPES).map(([k, t]) => `<option value="${k}" ${k === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="deParent">Inside</label><select id="deParent" class="form-select"></select></div>
      </div>
      <div class="form-group"><label class="form-label" for="deSummary">Short summary <span class="detail-muted" id="deSummaryCount"></span></label>
        <textarea id="deSummary" class="form-input" rows="2" maxlength="300" oninput="countChars('deSummary', 300)" placeholder="One or two lines travelers see on the card.">${E(d.summary)}</textarea></div>
      <div class="form-group"><label class="form-label" for="deDescription">Description</label>
        <textarea id="deDescription" class="form-input" rows="8" maxlength="6000" placeholder="What the place is like, what to see and do, when it's at its best.">${E(d.description)}</textarea></div>
      <div class="form-group"><label class="form-label" for="deHighlights">Highlights</label>
        <textarea id="deHighlights" class="form-input" rows="4" placeholder="One per line: Sunrise over the clouds from Konglak hill">${E((d.highlights || []).join('\n'))}</textarea></div>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="deHow">How to get there</label><textarea id="deHow" class="form-input" rows="4" maxlength="2000" placeholder="Night bus from Dhaka to Khagrachari, then a jeep (chander gari) to the valley.">${E(d.howToGetThere)}</textarea></div>
        <div class="form-group"><label class="form-label" for="deTips">Travel tips</label><textarea id="deTips" class="form-input" rows="4" maxlength="2000" placeholder="Carry your NID for army checkpoints; mobile signal is weak.">${E(d.travelTips)}</textarea></div>
      </div>
      <div class="form-group"><span class="form-label">Best months to visit</span>${monthPicker('deBest', d.bestMonths)}</div>
      <div class="form-group"><label class="form-label" for="deVideo">Video link</label><input id="deVideo" class="form-input" maxlength="300" placeholder="https://www.youtube.com/watch?v=..." value="${E(d.videoUrl)}"></div>
      <button type="submit" class="btn btn-primary">Save details</button>
    </form>`;
}

function monthPicker(prefix, selected) {
  const set = new Set(selected || []);
  return `<div class="month-picker">${MONTHS.map((m, i) => `<label class="month-chip"><input type="checkbox" name="${prefix}" value="${i + 1}" ${set.has(i + 1) ? 'checked' : ''}><span>${m}</span></label>`).join('')}</div>`;
}

const pickedMonths = prefix => [...document.querySelectorAll(`input[name="${prefix}"]:checked`)].map(b => Number(b.value));

function countChars(id, max) {
  const el = document.getElementById(id);
  const out = document.getElementById(`${id}Count`);
  if (out) out.textContent = `${el.value.length} / ${max}`;
}

async function saveDestinationDetails(e) {
  e.preventDefault();
  const name = val('deName').trim();
  if (!name) return showAdminToast('Enter the name.', 'error');
  const type = val('deType');
  if (type !== 'country' && !val('deParent')) return showAdminToast('Choose where this place is.', 'error');
  await patchDestination({
    name,
    nameBn: val('deNameBn').trim(),
    type,
    parent: val('deParent') || null,
    summary: val('deSummary').trim(),
    description: val('deDescription').trim(),
    highlights: val('deHighlights'),
    howToGetThere: val('deHow').trim(),
    travelTips: val('deTips').trim(),
    bestMonths: pickedMonths('deBest'),
    videoUrl: val('deVideo').trim()
  }, 'Details saved.', e.submitter);
}

// Location: a map to drop the pin, plus exact coordinates
function destLocationTab() {
  const d = D.detail.destination;
  const [lng, lat] = hasLoc(d) ? d.location.coordinates : ['', ''];
  return `
    <form class="detail-card" onsubmit="saveDestinationLocation(event)" novalidate>
      <p class="detail-muted">Click the map or drag the pin to the exact spot. You can also paste coordinates, for example from Google Maps (right-click a place to copy them).</p>
      <div id="destEditMap" class="dest-map dest-map-small" role="application" aria-label="Map to choose the location"></div>
      <div class="form-row-3" style="margin-top:12px">
        <div class="form-group"><label class="form-label" for="deLat">Latitude</label><input id="deLat" class="form-input" inputmode="decimal" value="${E(lat)}" placeholder="23.3820" oninput="syncPinFromInputs()"></div>
        <div class="form-group"><label class="form-label" for="deLng">Longitude</label><input id="deLng" class="form-input" inputmode="decimal" value="${E(lng)}" placeholder="92.2938" oninput="syncPinFromInputs()"></div>
        <div class="form-group"><label class="form-label" for="deAddress">Address or area</label><input id="deAddress" class="form-input" maxlength="200" value="${E(d.address)}" placeholder="Baghaichhari, Rangamati"></div>
      </div>
      <div class="lead-actions">
        <button type="submit" class="btn btn-primary">Save location</button>
        ${hasLoc(d) ? '<button type="button" class="btn btn-secondary" onclick="clearDestinationLocation()">Remove from map</button>' : ''}
      </div>
    </form>`;
}

function initEditMap() {
  const box = document.getElementById('destEditMap');
  if (typeof L === 'undefined') { box.innerHTML = '<p class="empty-note" style="padding:24px">The map library could not load. You can still type the coordinates.</p>'; return; }
  const d = D.detail.destination;
  // Start at the place itself, else at its parent, else Bangladesh
  const parent = D.options.find(o => o._id === String(d.parent));
  const parentLoc = parent && hasLoc(parent) ? [parent.location.coordinates[1], parent.location.coordinates[0]] : null;
  let start = BD_CENTER;
  if (hasLoc(d)) start = [d.location.coordinates[1], d.location.coordinates[0]];
  else if (parentLoc) start = parentLoc;
  D.editMap = L.map(box).setView(start, hasLoc(d) ? 12 : (parentLoc ? 10 : 7));
  tileLayer().addTo(D.editMap);
  D.editMarker = null;
  const place = latlng => {
    if (!D.editMarker) {
      D.editMarker = L.marker(latlng, { draggable: true, icon: pinIcon(d.type) }).addTo(D.editMap);
      D.editMarker.on('dragend', () => writeCoords(D.editMarker.getLatLng()));
    } else D.editMarker.setLatLng(latlng);
  };
  const writeCoords = ll => {
    document.getElementById('deLat').value = ll.lat.toFixed(6);
    document.getElementById('deLng').value = ll.lng.toFixed(6);
  };
  if (hasLoc(d)) place(start);
  D.editMap.on('click', ev => { place(ev.latlng); writeCoords(ev.latlng); });
  D.placePin = place;
  setTimeout(() => D.editMap && D.editMap.invalidateSize(), 50);
}

function syncPinFromInputs() {
  const lat = Number(val('deLat'));
  const lng = Number(val('deLng'));
  if (!D.editMap || !Number.isFinite(lat) || !Number.isFinite(lng) || val('deLat') === '' || val('deLng') === '') return;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  D.placePin([lat, lng]);
  D.editMap.setView([lat, lng], Math.max(D.editMap.getZoom(), 11));
}

async function saveDestinationLocation(e) {
  e.preventDefault();
  const lat = val('deLat').trim();
  const lng = val('deLng').trim();
  if (!lat || !lng) return showAdminToast('Click the map to drop a pin, or type both coordinates.', 'error');
  await patchDestination({ lat, lng, address: val('deAddress').trim() }, 'Location saved.', e.submitter);
}

async function clearDestinationLocation() {
  if (!confirm('Remove this place from the map?')) return;
  await patchDestination({ lat: '', lng: '' }, 'Removed from the map.');
}

// Photos: upload, captions and credits, order, cover
function destPhotosTab() {
  const d = D.detail.destination;
  return `
    <div class="detail-card">
      <div class="control-bar" style="margin-bottom:12px">
        <p class="detail-muted" style="margin:0">Up to 20 photos, JPG, PNG or WebP, 5 MB each. The cover shows on cards and at the top of the page. Credit the photographer when the photo isn't yours.</p>
        <label class="btn btn-primary">+ Upload photos<input type="file" id="dePhotoInput" accept="image/jpeg,image/png,image/webp" multiple hidden onchange="uploadDestinationPhotos(this)"></label>
      </div>
      ${d.gallery.length ? `<div class="photo-grid">${d.gallery.map((p, i) => `
        <figure class="photo-card ${p.url === d.coverImage ? 'is-cover' : ''}" data-photo="${E(p._id)}">
          <img src="${E(p.url)}" alt="${E(p.caption)}" loading="lazy">
          ${p.url === d.coverImage ? '<span class="cover-flag">Cover</span>' : ''}
          <figcaption>
            <input class="form-input" data-field="caption" maxlength="200" placeholder="Caption" value="${E(p.caption)}">
            <input class="form-input" data-field="credit" maxlength="200" placeholder="Photo credit" value="${E(p.credit)}">
            <div class="lead-actions">
              <button type="button" class="btn btn-secondary btn-sm" ${i === 0 ? 'disabled' : ''} onclick="moveDestinationPhoto(${i}, -1)" aria-label="Move earlier">←</button>
              <button type="button" class="btn btn-secondary btn-sm" ${i === d.gallery.length - 1 ? 'disabled' : ''} onclick="moveDestinationPhoto(${i}, 1)" aria-label="Move later">→</button>
              ${p.url !== d.coverImage ? `<button type="button" class="btn btn-secondary btn-sm" onclick="setDestinationCover('${E(p.url)}')">Make cover</button>` : ''}
              <button type="button" class="btn btn-danger btn-sm" onclick="deleteDestinationPhoto('${E(p._id)}')">Delete</button>
            </div>
          </figcaption>
        </figure>`).join('')}</div>
        <button class="btn btn-primary" style="margin-top:14px" onclick="saveDestinationPhotos(this)">Save captions and order</button>`
      : '<p class="empty-note">No photos yet. Upload a few good ones; the first becomes the cover.</p>'}
    </div>`;
}

function readPhotoFields() {
  return [...document.querySelectorAll('#destinationTabBody .photo-card')].map(card => ({
    _id: card.dataset.photo,
    caption: card.querySelector('[data-field="caption"]').value.trim(),
    credit: card.querySelector('[data-field="credit"]').value.trim()
  }));
}

async function uploadDestinationPhotos(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const bad = files.find(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024);
  if (bad) return showAdminToast(`${bad.name} is not a JPG, PNG or WebP under 5 MB.`, 'error');
  const fd = new FormData();
  files.slice(0, 10).forEach(f => fd.append('photos', f));
  showAdminToast(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`, 'info');
  const { ok, data } = await adminForm(`/api/v1/admin/destinations/${D.detail.destination._id}/photos`, 'POST', fd);
  if (!ok) return showAdminToast(data.message || 'Could not upload.', 'error');
  D.detail = data.data;
  showAdminToast('Photos added.', 'success');
  renderDestinationDetail('photos');
}

async function savePhotoChanges(body, message, btn) {
  if (btn) btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/destinations/${D.detail.destination._id}/photos`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) return showAdminToast(data.message || 'Could not save.', 'error');
    D.detail = data.data;
    if (message) showAdminToast(message, 'success');
    renderDestinationDetail('photos');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function moveDestinationPhoto(i, dir) {
  const fields = readPhotoFields();
  const j = i + dir;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  savePhotoChanges({ gallery: fields });
}

const saveDestinationPhotos = btn => savePhotoChanges({ gallery: readPhotoFields() }, 'Photos saved.', btn);
const setDestinationCover = url => savePhotoChanges({ gallery: readPhotoFields(), coverImage: url }, 'Cover photo changed.');

async function deleteDestinationPhoto(photoId) {
  if (!confirm('Delete this photo?')) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/destinations/${D.detail.destination._id}/photos/${photoId}`, { method: 'DELETE' });
  if (!ok) return showAdminToast(data.message || 'Could not delete.', 'error');
  D.detail = data.data;
  showAdminToast('Photo deleted.', 'info');
  renderDestinationDetail('photos');
}

// Availability, categories and promotion
function destAvailabilityTab() {
  const d = D.detail.destination;
  const a = d.availability;
  const chosen = new Set((d.categories || []).map(c => c._id));
  return `
    <form class="detail-card" onsubmit="saveDestinationAvailability(event)" novalidate>
      <h3>Can travelers visit?</h3>
      <div class="avail-options">
        ${Object.entries({ open: 'Open all year', seasonal: 'Seasonal: only some months', restricted: 'Restricted: permits or limits apply', closed: 'Closed for now' }).map(([k, t]) => `
          <label class="check"><input type="radio" name="deAvail" value="${k}" ${a.status === k ? 'checked' : ''} onchange="document.getElementById('deOpenMonths').hidden = this.value !== 'seasonal'"> ${t}</label>`).join('')}
      </div>
      <div class="form-group" id="deOpenMonths" ${a.status === 'seasonal' ? '' : 'hidden'}><span class="form-label">Open in</span>${monthPicker('deOpen', a.openMonths)}</div>
      <div class="form-group"><label class="form-label" for="deAvailNote">Note for travelers</label>
        <textarea id="deAvailNote" class="form-input" rows="2" maxlength="500" placeholder="Saint Martin's: visitors need a permit from November to February.">${E(a.note)}</textarea></div>

      <h3 style="margin-top:18px">Categories</h3>
      ${D.categories.length ? `<div class="tag-row">${D.categories.filter(c => c.active || chosen.has(c._id)).map(c => `
        <label class="month-chip"><input type="checkbox" name="deCategory" value="${E(c._id)}" ${chosen.has(c._id) ? 'checked' : ''}><span>${E(c.name)}</span></label>`).join('')}</div>`
        : '<p class="detail-muted">No categories yet. Add them in Destinations › Categories.</p>'}

      <h3 style="margin-top:18px">Promotion</h3>
      <label class="check"><input type="checkbox" id="deFeatured" ${d.featured ? 'checked' : ''} ${d.status !== 'published' ? 'disabled' : ''}> Featured in the app${d.status !== 'published' ? ' (publish it first)' : ''}</label>
      <label class="check"><input type="checkbox" id="deTrending" ${d.trendingPinned ? 'checked' : ''}> Always show in trending</label>
      <button type="submit" class="btn btn-primary" style="margin-top:12px">Save</button>
    </form>`;
}

async function saveDestinationAvailability(e) {
  e.preventDefault();
  const status = (document.querySelector('input[name="deAvail"]:checked') || {}).value || 'open';
  const openMonths = pickedMonths('deOpen');
  if (status === 'seasonal' && !openMonths.length) return showAdminToast('Choose the months it is open.', 'error');
  await patchDestination({
    availability: { status, openMonths: status === 'seasonal' ? openMonths : [], note: val('deAvailNote').trim() },
    categories: [...document.querySelectorAll('input[name="deCategory"]:checked')].map(b => b.value),
    featured: document.getElementById('deFeatured').checked,
    trendingPinned: document.getElementById('deTrending').checked
  }, 'Saved.', e.submitter);
}

// Search and sharing: the title and description search engines and link previews show
function destSeoTab() {
  const d = D.detail.destination;
  return `
    <form class="detail-card" onsubmit="saveDestinationSeo(event)" novalidate>
      <div class="form-group"><label class="form-label" for="deSlug">Web address</label>
        <div class="slug-row"><span>/destinations/</span><input id="deSlug" class="form-input" maxlength="120" value="${E(d.slug)}" oninput="updateSeoPreview()"></div>
        <p class="detail-muted">Letters, numbers and dashes. Changing it breaks links people already shared.</p></div>
      <div class="form-group"><label class="form-label" for="deSeoTitle">Search title <span class="detail-muted" id="deSeoTitleCount"></span></label>
        <input id="deSeoTitle" class="form-input" maxlength="70" value="${E(d.seo.title)}" placeholder="${E(`${d.name}: travel guide and tours | Plezar`)}" oninput="updateSeoPreview()"></div>
      <div class="form-group"><label class="form-label" for="deSeoDesc">Search description <span class="detail-muted" id="deSeoDescCount"></span></label>
        <textarea id="deSeoDesc" class="form-input" rows="3" maxlength="170" placeholder="${E(d.summary || 'What makes this place worth the trip, in one or two sentences.')}" oninput="updateSeoPreview()">${E(d.seo.description)}</textarea></div>
      <div class="form-group"><label class="form-label" for="deSeoKeys">Keywords</label>
        <input id="deSeoKeys" class="form-input" value="${E((d.seo.keywords || []).join(', '))}" placeholder="sajek tour, sajek valley, rangamati"><p class="detail-muted">Separate with commas.</p></div>
      <span class="form-label">Preview</span>
      <div class="serp" id="seoPreview"></div>
      <button type="submit" class="btn btn-primary" style="margin-top:14px">Save</button>
    </form>`;
}

function updateSeoPreview() {
  const d = D.detail.destination;
  const title = val('deSeoTitle').trim() || `${d.name}: travel guide and tours | Plezar`;
  const desc = val('deSeoDesc').trim() || d.summary || '';
  countChars('deSeoTitle', 70);
  countChars('deSeoDesc', 170);
  document.getElementById('seoPreview').innerHTML = `
    <span class="serp-url">plezar.com › destinations › ${E(val('deSlug').trim() || d.slug)}</span>
    <span class="serp-title">${E(title)}</span>
    <span class="serp-desc">${E(desc) || '<em>Add a description so search results show something useful.</em>'}</span>`;
}

async function saveDestinationSeo(e) {
  e.preventDefault();
  const slug = val('deSlug').trim();
  if (!slug) return showAdminToast('Enter a web address.', 'error');
  if (slug !== D.detail.destination.slug && !confirm('Change the web address? Links people already shared will stop working.')) return;
  await patchDestination({ slug, seo: { title: val('deSeoTitle').trim(), description: val('deSeoDesc').trim(), keywords: val('deSeoKeys') } }, 'Saved.', e.submitter);
}

// Statistics for one destination (including the places inside it)
function destStatsTab() {
  const { destination: d, series, events, children, descendantCount } = D.detail;
  const s = d.stats;
  return `
    <div class="kpi-grid">
      ${vTile('Page views', n(d.views), 'In the app and on the website')}
      ${vTile('Upcoming tour events', n(s.upcomingEvents), `${n(s.events)} in total`)}
      ${vTile('Registrations', n(s.bookings), `${n(s.travelers)} travelers`)}
      ${vTile('Last 30 days', n(s.recentTravelers), 'travelers registered')}
      ${vTile('Paid revenue', takaFmt(s.revenue), 'From registrations here')}
    </div>
    ${descendantCount ? `<p class="detail-muted" style="margin:10px 0 0">Includes the ${n(descendantCount)} place${descendantCount === 1 ? '' : 's'} inside ${E(d.name)}.</p>` : ''}
    <div class="detail-grid" style="margin-top:16px">
      <div class="detail-card"><h3>Travelers by month</h3>${barList(series.map(m => ({ label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }), count: m.travelers })))}</div>
      <div class="detail-card"><h3>Places inside</h3>${children.length ? `<ul class="detail-docs">${children.map(c => `
        <li><span>${E(c.name)}<span class="lead-sub">${E(DEST_TYPES[c.type])}, ${E(label(c.status))}</span></span><button class="btn btn-secondary btn-sm" onclick="openDestination('${E(c._id)}')">Open</button></li>`).join('')}</ul>` : `<p class="detail-muted">${d.type === 'attraction' ? 'Attractions have no places inside.' : 'Nothing inside yet.'}</p>`}</div>
      <div class="detail-card detail-wide"><h3>Tour events here</h3>${events.length ? `<div class="table-container"><table class="admin-table">
        <thead><tr><th>Event</th><th>Vendor</th><th>Dates</th><th>Status</th></tr></thead>
        <tbody>${events.map(ev => `<tr><td>${E(ev.title)}</td><td>${ev.agency ? `<button type="button" class="link-btn" onclick="openVendor('${E(ev.agency._id)}', 'packages')">${E(ev.agency.name)}</button>` : '—'}</td><td>${ev.startDate ? E(fmtDate(ev.startDate)) : '—'}</td><td>${E(label(ev.status))}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="detail-muted">No tour events are linked yet. Vendors link their events to a destination in their panel.</p>'}</div>
    </div>`;
}
