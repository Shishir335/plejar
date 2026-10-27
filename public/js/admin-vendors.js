/**
 * Plezar admin - Vendors section: vendor list, applications, verification, categories,
 * bookings, payouts, commission, activity logs, and the full vendor profile page.
 * Depends on helpers from admin.js and admin-users.js (adminFetch, E, fmtDate, askReason...).
 */

const V = {
  sub: 'all',
  page: 1,
  detail: null, // everything GET /admin/vendors/:id returned for the open profile
  tab: 'overview',
  categories: [],
  vendorOptions: [],
  defaultRate: null,
  bookings: new Map(),
  payouts: new Map(),
  statusCtx: null,
  payoutCtx: null,
  commissionCtx: null,
  bookingCtx: null
};

const METHOD_LABEL = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', bank: 'Bank transfer' };
const VENDOR_STATUS_BADGE = { active: 'badge-active', suspended: 'badge-admin', deactivated: 'badge-inactive' };
const CONTRACT_BADGE = { none: 'badge-inactive', draft: 'badge-inactive', sent: 'badge-user', signed: 'badge-active', expired: 'badge-admin', terminated: 'badge-admin' };
const PAYOUT_BADGE = { pending: 'badge-manager', paid: 'badge-active', rejected: 'badge-admin' };
const pct = n => (n == null ? '—' : `${Number(n)}%`);

// Old names used elsewhere in admin.js
function loadAgencies() { return loadVendors(V.page); }
function openAgency(id) { return openVendor(id); }

// multipart requests can't use adminFetch (it always sends JSON headers)
async function adminForm(url, method, formData) {
  const headers = {};
  if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const res = await fetch(url, { method, headers, body: formData, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function vendorBadges(v) {
  const verify = v.verified ? 'verified' : (v.verificationStatus || 'none');
  const verifyBadge = { verified: 'badge-active', pending: 'badge-manager', rejected: 'badge-admin', none: 'badge-inactive' }[verify] || 'badge-inactive';
  const verifyText = { verified: 'Verified', pending: 'Awaiting review', rejected: 'Changes requested', none: 'Not verified' }[verify];
  return `<span class="badge ${VENDOR_STATUS_BADGE[v.status] || 'badge-inactive'}">${E(label(v.status))}</span> <span class="badge ${verifyBadge}">${E(verifyText)}</span>`;
}

// ---------- Sub-tabs ----------

const VENDOR_SUB_LOADERS = {
  all: () => loadVendors(V.page),
  applications: () => { loadApplications(); loadPendingAgencies(); },
  verification: () => loadPendingAgencies(),
  categories: () => loadCategories(),
  bookings: () => loadBookings(),
  payouts: () => loadPayouts(),
  commission: () => loadCommissionPane(),
  activity: () => loadVendorActivity()
};

function switchVendorSub(name) {
  V.sub = name;
  document.querySelectorAll('#tab-vendors .subtab').forEach(b => {
    const on = b.dataset.vsub === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#tab-vendors .subpane').forEach(p => p.classList.toggle('active', p.id === `vsub-${name}`));
  if (VENDOR_SUB_LOADERS[name]) VENDOR_SUB_LOADERS[name]();
  try {
    const route = `#vendors/${name}`;
    history.replaceState(null, '', route);
    sessionStorage.setItem('plezar_admin_tab', route);
  } catch (_) {}
}

document.querySelectorAll('#tab-vendors .subtab').forEach(btn => {
  btn.addEventListener('click', () => switchVendorSub(btn.dataset.vsub));
});

function refreshVendorViews() {
  loadVendorSummary();
  if (document.getElementById('tab-vendorDetail').classList.contains('active') && V.detail) reloadVendor();
  else if (VENDOR_SUB_LOADERS[V.sub]) VENDOR_SUB_LOADERS[V.sub]();
}

// ---------- Summary chips and sidebar badges ----------

async function loadVendorSummary() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/vendors/summary');
    if (!ok) return;
    const s = data.data.summary;
    const chips = [
      ['total', 'All vendors', s.total], ['active', 'Active', s.active], ['suspended', 'Suspended', s.suspended],
      ['deactivated', 'Deactivated', s.deactivated], ['verified', 'Verified', s.verified],
      ['pending', 'Awaiting verification', s.pendingVerification], ['invited', 'Invite not accepted', s.invited]
    ];
    const box = document.getElementById('vendorChips');
    if (box) box.innerHTML = chips.map(([key, text, n]) => `<button type="button" class="chip" onclick="applyVendorChip('${key}')"><strong>${n}</strong> ${E(text)}</button>`).join('');
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = n; el.hidden = !n; }
    };
    setBadge('vsubLeadCount', s.newLeads);
    setBadge('vsubVerifyCount', s.pendingVerification);
    setBadge('vsubPayoutCount', s.pendingPayouts);
    setBadge('vendorsAttentionCount', s.newLeads + s.pendingVerification + s.pendingPayouts);
  } catch (e) { /* badges are informational */ }
}

function applyVendorChip(key) {
  ['vSearch', 'vStatusF', 'vVerifF', 'vCategoryF'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('vCustomF').checked = false;
  if (['active', 'suspended', 'deactivated'].includes(key)) document.getElementById('vStatusF').value = key;
  if (key === 'verified') document.getElementById('vVerifF').value = 'verified';
  if (key === 'pending') document.getElementById('vVerifF').value = 'pending';
  if (key === 'invited') return switchVendorSub('applications');
  loadVendors(1);
}

// ---------- Shared option lists (categories, vendors) ----------

async function ensureCategories(force) {
  if (V.categories.length && !force) return V.categories;
  const { ok, data } = await adminFetch('/api/v1/admin/vendor-categories');
  if (ok) V.categories = data.data.categories;
  const select = document.getElementById('vCategoryF');
  if (select) {
    const keep = select.value;
    select.innerHTML = '<option value="">Any category</option>' + V.categories.map(c => `<option value="${E(c._id)}">${E(c.name)}</option>`).join('');
    select.value = keep;
  }
  return V.categories;
}

async function ensureVendorOptions() {
  if (V.vendorOptions.length) return V.vendorOptions;
  const { ok, data } = await adminFetch('/api/v1/admin/vendors?limit=100&sort=name');
  if (ok) V.vendorOptions = data.data.vendors.map(v => ({ id: v.id, name: v.name }));
  const html = V.vendorOptions.map(v => `<option value="${E(v.id)}">${E(v.name)}</option>`).join('');
  [['bkVendor', 'All vendors'], ['vaVendor', 'All vendors']].forEach(([id, first]) => {
    const el = document.getElementById(id);
    if (el) { const keep = el.value; el.innerHTML = `<option value="">${first}</option>${html}`; el.value = keep; }
  });
  return V.vendorOptions;
}

// ---------- All vendors ----------

const debouncedVendors = makeDebounce(() => loadVendors(1));

async function loadVendors(page = 1) {
  V.page = page;
  tableMessage('vendorsTableBody', 9, 'Loading vendors...');
  ensureCategories();
  const q = queryString({
    search: val('vSearch').trim(), status: val('vStatusF'), verification: val('vVerifF'), category: val('vCategoryF'),
    sort: val('vSortF'), commission: document.getElementById('vCustomF')?.checked ? 'custom' : '', page, limit: 15
  });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors?${q}`);
    if (!ok) return tableMessage('vendorsTableBody', 9, data.message || 'Could not load vendors.', true);
    renderPager('vendorsPager', data.data, 'loadVendors');
    if (!data.data.vendors.length) return tableMessage('vendorsTableBody', 9, 'No vendors match these filters. Invite one, or approve an application.');
    document.getElementById('vendorsTableBody').innerHTML = data.data.vendors.map(v => `
      <tr>
        <td><div class="user-cell">${agencyLogo(v)}<div class="user-cell-info">
          <span class="user-cell-name">${E(v.name)}</span>
          <span class="user-cell-email">${E((v.regions || []).join(', ')) || 'No areas listed'}</span>
          ${v.categories.length ? `<span class="tag-row">${v.categories.map(c => `<span class="tag">${E(c.name)}</span>`).join('')}</span>` : ''}</div></div></td>
        <td>${v.owner ? `<span class="lead-main">${E(v.owner.name)}</span><span class="lead-sub">${E(v.owner.email)}${v.owner.accountStatus === 'invited' ? ' · invite pending' : ''}</span>` : '—'}</td>
        <td>${v.packages.published}<span class="lead-sub">${v.packages.total} total</span></td>
        <td>${v.bookings.total}<span class="lead-sub">${v.bookings.completed} completed · ${v.bookings.cancelled} cancelled</span></td>
        <td style="white-space: nowrap;">${takaFmt(v.revenue)}</td>
        <td>${v.rating.average ? `<span class="stars">★</span> ${v.rating.average}<span class="lead-sub">${v.rating.count} review${v.rating.count === 1 ? '' : 's'}</span>` : '<span class="lead-sub" style="margin:0">No reviews</span>'}</td>
        <td style="white-space: nowrap;">${pct(v.commission.rate)}${v.commission.custom ? '<span class="lead-sub">custom</span>' : '<span class="lead-sub">default</span>'}</td>
        <td class="standing"><div class="standing-wrap">${vendorBadges(v)}</div></td>
        <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="openVendor('${E(v.id)}')">Open</button></td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('vendorsTableBody', 9, 'Failed to load vendors.', true);
  }
  loadVendorSummary();
}

// ---------- Categories ----------

async function loadCategories() {
  tableMessage('categoriesTableBody', 5, 'Loading...');
  const cats = await ensureCategories(true);
  const canEdit = isMoneyAdmin();
  document.getElementById('newCategoryBtn').hidden = !canEdit;
  if (!cats.length) return tableMessage('categoriesTableBody', 5, 'No categories yet. Add the kinds of trips your vendors run, such as hill treks or houseboat trips.');
  document.getElementById('categoriesTableBody').innerHTML = cats.map(c => `
    <tr class="${c.active ? '' : 'row-muted'}">
      <td><span class="lead-main">${E(c.name)}</span></td>
      <td><div class="lead-message">${E(c.description) || '—'}</div></td>
      <td>${c.vendors}</td>
      <td><span class="badge ${c.active ? 'badge-active' : 'badge-inactive'}">${c.active ? 'Active' : 'Switched off'}</span></td>
      <td style="text-align: right;">${canEdit ? `<div class="lead-actions">
        <button class="btn btn-secondary btn-sm" onclick="openCategoryModal('${E(c._id)}')">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="toggleCategory('${E(c._id)}')">${c.active ? 'Switch off' : 'Switch on'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCategory('${E(c._id)}')">Delete</button></div>` : ''}</td>
    </tr>`).join('');
}

let editingCategory = null;

function openCategoryModal(id) {
  editingCategory = id ? V.categories.find(c => c._id === id) : null;
  document.getElementById('categoryModalTitle').textContent = editingCategory ? 'Edit category' : 'New category';
  document.getElementById('catName').value = editingCategory ? editingCategory.name : '';
  document.getElementById('catDesc').value = editingCategory ? editingCategory.description : '';
  formError('categoryError');
  openModal('categoryModal');
  document.getElementById('catName').focus();
}

async function submitCategory(e) {
  e.preventDefault();
  const name = val('catName').trim();
  if (!name) return formError('categoryError', 'Enter a category name.');
  const btn = document.getElementById('categorySubmit');
  btn.disabled = true;
  try {
    const url = editingCategory ? `/api/v1/admin/vendor-categories/${editingCategory._id}` : '/api/v1/admin/vendor-categories';
    const { ok, data } = await adminFetch(url, { method: editingCategory ? 'PATCH' : 'POST', body: JSON.stringify({ name, description: val('catDesc').trim() }) });
    if (!ok) return formError('categoryError', data.message || 'Could not save the category.');
    closeModal('categoryModal');
    showAdminToast('Category saved.', 'success');
    loadCategories();
  } catch (x) {
    formError('categoryError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

async function toggleCategory(id) {
  const c = V.categories.find(x => x._id === id);
  const { ok, data } = await adminFetch(`/api/v1/admin/vendor-categories/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !c.active }) });
  if (!ok) return showAdminToast(data.message || 'Could not update the category.', 'error');
  loadCategories();
}

async function deleteCategory(id) {
  const c = V.categories.find(x => x._id === id);
  if (!confirm(`Delete the category "${c.name}"?`)) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/vendor-categories/${id}`, { method: 'DELETE' });
  if (!ok) return showAdminToast(data.message || 'Could not delete the category.', 'error');
  showAdminToast('Category deleted.', 'info');
  loadCategories();
}

// ---------- Bookings (all vendors) ----------

const debouncedBookings = makeDebounce(() => loadBookings(1));

const KIND_LABEL = { tour: 'Tour', hotel: 'Hotel stay', guide: 'Guide' };

function bookingRow(b, { withVendor = true } = {}) {
  V.bookings.set(b._id, b);
  return `
    <tr>
      <td><span class="lead-main">${E(b.packageTitle)}</span><span class="lead-sub">${E(KIND_LABEL[b.kind || 'tour'])} · ${E(b.reference)} · booked ${E(fmtDate(b.createdAt))}</span></td>
      <td>${b.user ? `<a href="#" onclick="event.preventDefault(); openUser('${E(b.user._id)}')">${E(b.user.name)}</a><span class="lead-sub">${b.travelers} traveler${b.travelers === 1 ? '' : 's'}</span>` : '—'}</td>
      ${withVendor ? `<td>${b.agency ? `<a href="#" onclick="event.preventDefault(); openVendor('${E(b.agency._id)}')">${E(b.agency.name)}</a>` : (b.kind === 'hotel' ? '<span class="lead-sub" style="display:inline;">Plezar confirms</span>' : '—')}</td>` : ''}
      <td style="white-space: nowrap;">${E(fmtDate(b.travelDate))}${b.endDate && b.endDate !== b.travelDate ? `<span class="lead-sub">to ${E(fmtDate(b.endDate))}${b.units ? ` · ${b.units} ${b.kind === 'hotel' ? 'night' : 'day'}${b.units === 1 ? '' : 's'}` : ''}</span>` : ''}</td>
      <td style="white-space: nowrap;">${takaFmt(b.amount)}<span class="lead-sub">Plezar ${takaFmt(b.commissionAmount)} (${pct(b.commissionRate)})</span></td>
      <td><span class="badge ${BOOKING_BADGE[b.status]}">${E(label(b.status))}</span></td>
      <td>${E(PAY_LABEL[b.paymentStatus] || b.paymentStatus)}</td>
      <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="openBookingModal('${E(b._id)}')">Manage</button></td>
    </tr>`;
}

async function loadBookings(page = 1) {
  tableMessage('bookingsTableBody', 8, 'Loading bookings...');
  ensureVendorOptions();
  const q = queryString({ search: val('bkSearch').trim(), status: val('bkStatus'), paymentStatus: val('bkPayment'), kind: val('bkKind'), agency: val('bkVendor'), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/bookings?${q}`);
    if (!ok) return tableMessage('bookingsTableBody', 8, data.message || 'Could not load bookings.', true);
    renderPager('bookingsPager', data.data, 'loadBookings');
    document.getElementById('bookingTotals').textContent = data.data.total
      ? `${data.data.total} booking${data.data.total === 1 ? '' : 's'} · ${takaFmt(data.data.totals.amount)} booked · ${takaFmt(data.data.totals.commission)} Plezar commission`
      : '';
    if (!data.data.bookings.length) return tableMessage('bookingsTableBody', 8, 'No bookings match these filters.');
    document.getElementById('bookingsTableBody').innerHTML = data.data.bookings.map(b => bookingRow(b)).join('');
  } catch (e) {
    tableMessage('bookingsTableBody', 8, 'Failed to load bookings.', true);
  }
}

const BOOKING_NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [] };

function openBookingModal(id) {
  const b = V.bookings.get(id);
  if (!b) return;
  V.bookingCtx = b;
  document.getElementById('bookingLead').innerHTML = `<strong>${E(b.reference)}</strong> · ${E(b.packageTitle)} · ${takaFmt(b.amount)} · ${E(fmtDate(b.travelDate))}`;
  const opts = [b.status, ...BOOKING_NEXT[b.status]];
  document.getElementById('bmStatus').innerHTML = opts.map(s => `<option value="${s}">${s === b.status ? `${label(s)} (current)` : label(s)}</option>`).join('');
  const locked = ['partially_refunded', 'refunded'].includes(b.paymentStatus) || b.status === 'cancelled';
  const canPay = isMoneyAdmin() && !locked;
  document.getElementById('bmPaymentGroup').hidden = !canPay && !locked;
  document.getElementById('bmPayment').innerHTML = locked
    ? `<option>${E(PAY_LABEL[b.paymentStatus])}</option>`
    : '<option value="unpaid">Unpaid</option><option value="paid">Paid</option>';
  document.getElementById('bmPayment').value = locked ? '' : b.paymentStatus;
  document.getElementById('bmPayment').disabled = !canPay;
  document.getElementById('bmReason').value = '';
  formError('bookingError');
  openModal('bookingModal');
}

async function submitBooking(e) {
  e.preventDefault();
  const b = V.bookingCtx;
  const body = {};
  if (val('bmStatus') !== b.status) body.status = val('bmStatus');
  if (!document.getElementById('bmPayment').disabled && val('bmPayment') && val('bmPayment') !== b.paymentStatus) body.paymentStatus = val('bmPayment');
  if (val('bmReason').trim()) body.reason = val('bmReason').trim();
  if (!body.status && !body.paymentStatus) return formError('bookingError', 'Choose a new status or payment state to save.');
  if (body.status === 'cancelled' && (body.reason || '').length < 3) return formError('bookingError', 'Add a reason for cancelling this booking.');
  const btn = document.getElementById('bookingSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/bookings/${b._id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) return formError('bookingError', data.message || 'Could not update the booking.');
    closeModal('bookingModal');
    showAdminToast('Booking updated.', 'success');
    refreshVendorViews();
  } catch (x) {
    formError('bookingError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Payouts ----------

const debouncedPayouts = makeDebounce(() => loadPayouts(1));

function payoutRows(payouts, { withVendor = true } = {}) {
  const canDecide = isMoneyAdmin();
  return payouts.map(p => {
    V.payouts.set(p._id, p);
    return `
    <tr>
      ${withVendor ? `<td>${p.agency ? `<a href="#" onclick="event.preventDefault(); openVendor('${E(p.agency._id)}')">${E(p.agency.name)}</a>` : '—'}<span class="lead-sub">${E(fmtDate(p.createdAt))}</span></td>` : `<td>${E(fmtDate(p.createdAt))}</td>`}
      <td style="white-space: nowrap; font-weight: 700;">${takaFmt(p.amount)}</td>
      <td>${E(METHOD_LABEL[p.method] || p.method)}<span class="lead-sub">${E(p.account)}</span></td>
      <td>${p.source === 'vendor' ? 'Vendor request' : 'Admin'}${p.note ? `<span class="lead-sub">${E(p.note)}</span>` : ''}</td>
      <td><span class="badge ${PAYOUT_BADGE[p.status]}">${E(label(p.status))}</span>${p.status === 'paid' ? `<span class="lead-sub">${E(p.reference)} · ${E(fmtDate(p.paidAt))}</span>` : ''}${p.status === 'rejected' ? `<span class="lead-sub">${E(p.rejectedReason)}</span>` : ''}</td>
      <td style="text-align: right;">${p.status === 'pending' && canDecide ? `<div class="lead-actions">
        <button class="btn btn-primary btn-sm" onclick="markPayoutPaid('${E(p._id)}')">Mark paid</button>
        <button class="btn btn-danger btn-sm" onclick="rejectPayout('${E(p._id)}')">Reject</button></div>` : ''}</td>
    </tr>`;
  }).join('');
}

async function loadPayouts(page = 1) {
  tableMessage('payoutsTableBody', 6, 'Loading payouts...');
  const q = queryString({ status: val('poStatus'), search: val('poSearch').trim(), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/payouts?${q}`);
    if (!ok) return tableMessage('payoutsTableBody', 6, data.message || 'Could not load payouts.', true);
    const t = data.data.totals;
    const get = k => t[k] || { amount: 0, count: 0 };
    document.getElementById('payoutKpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Waiting to be paid</div><div class="kpi-value">${takaFmt(get('pending').amount)}</div><div class="kpi-note">${get('pending').count} payout${get('pending').count === 1 ? '' : 's'}</div></div>
      <div class="kpi"><div class="kpi-label">Paid out so far</div><div class="kpi-value">${takaFmt(get('paid').amount)}</div><div class="kpi-note">${get('paid').count} payout${get('paid').count === 1 ? '' : 's'}</div></div>
      <div class="kpi"><div class="kpi-label">Rejected</div><div class="kpi-value">${get('rejected').count}</div><div class="kpi-note">${takaFmt(get('rejected').amount)} released back</div></div>`;
    renderPager('payoutsPager', data.data, 'loadPayouts');
    if (!data.data.payouts.length) return tableMessage('payoutsTableBody', 6, 'No payouts match these filters.');
    document.getElementById('payoutsTableBody').innerHTML = payoutRows(data.data.payouts);
  } catch (e) {
    tableMessage('payoutsTableBody', 6, 'Failed to load payouts.', true);
  }
  loadVendorSummary();
}

function markPayoutPaid(id) {
  const p = V.payouts.get(id);
  askReason({
    title: `Mark ${takaFmt(p.amount)} as paid`,
    lead: `Send the money to ${METHOD_LABEL[p.method] || p.method} ${p.account} first, then enter the transaction ID here.`,
    label: 'Transaction ID', confirmLabel: 'Mark as paid',
    onSubmit: async reference => {
      const { ok, data } = await adminFetch(`/api/v1/admin/payouts/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'mark_paid', reference }) });
      if (!ok) throw new Error(data.message || 'Could not mark the payout as paid.');
      showAdminToast('Payout marked as paid.', 'success');
      refreshVendorViews();
    }
  });
}

function rejectPayout(id) {
  const p = V.payouts.get(id);
  askReason({
    title: `Reject the ${takaFmt(p.amount)} payout`,
    lead: 'The money goes back into the vendor\'s available balance. They see your reason.',
    label: 'Reason', confirmLabel: 'Reject payout',
    onSubmit: async reason => {
      const { ok, data } = await adminFetch(`/api/v1/admin/payouts/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject', reason }) });
      if (!ok) throw new Error(data.message || 'Could not reject the payout.');
      showAdminToast('Payout rejected.', 'info');
      refreshVendorViews();
    }
  });
}

// ---------- Commission ----------

async function loadCommissionPane() {
  tableMessage('commissionTableBody', 4, 'Loading...');
  const [setting, list] = await Promise.all([
    adminFetch('/api/v1/admin/settings/commission'),
    adminFetch('/api/v1/admin/vendors?commission=custom&limit=100&sort=name')
  ]);
  if (!setting.ok || !list.ok) return tableMessage('commissionTableBody', 4, 'Could not load commission settings.', true);
  V.defaultRate = setting.data.data.defaultRate;
  const canEdit = isMoneyAdmin();
  document.getElementById('commissionHero').innerHTML = `
    <div><div class="kpi-label">Platform default commission</div><div class="commission-rate">${pct(V.defaultRate)}</div>
    <p class="pane-sub">Plezar keeps this share of every booking, unless the vendor has its own rate below.</p></div>
    ${canEdit ? '<button class="btn btn-primary" onclick="openCommissionModal(null)">Change default</button>' : '<span class="detail-muted" style="margin:0">Only administrators can change commission.</span>'}`;
  const vendors = list.data.data.vendors;
  if (!vendors.length) return tableMessage('commissionTableBody', 4, 'No vendor has a custom rate. They all pay the platform default.');
  document.getElementById('commissionTableBody').innerHTML = vendors.map(v => {
    const diff = Math.round((v.commission.rate - V.defaultRate) * 100) / 100;
    return `<tr>
      <td><div class="user-cell">${agencyLogo(v)}<div class="user-cell-info"><span class="user-cell-name">${E(v.name)}</span></div></div></td>
      <td style="font-weight: 700;">${pct(v.commission.rate)}</td>
      <td>${diff === 0 ? 'Same as the default' : (diff > 0 ? `${diff} points higher` : `${Math.abs(diff)} points lower`)}</td>
      <td style="text-align: right;"><div class="lead-actions"><button class="btn btn-secondary btn-sm" onclick="openVendor('${E(v.id)}', 'commission')">Open</button>
      ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="openCommissionModal('${E(v.id)}', ${v.commission.rate}, true)">Change</button>` : ''}</div></td></tr>`;
  }).join('');
  V.commissionNames = Object.fromEntries(vendors.map(v => [v.id, v.name]));
}

// vendorId null = the platform default
function openCommissionModal(vendorId, rate, custom) {
  const d = V.detail;
  const name = vendorId ? ((d && d.agency._id === vendorId ? d.agency.name : (V.commissionNames || {})[vendorId]) || 'this vendor') : '';
  V.commissionCtx = { vendorId, name };
  document.getElementById('vcTitle').textContent = vendorId ? `Commission for ${name}` : 'Platform default commission';
  document.getElementById('vcLead').textContent = vendorId
    ? 'Set a rate for this vendor only. It applies to bookings made after you save; existing bookings keep their rate.'
    : 'The share of each booking Plezar keeps from vendors without their own rate. It applies to bookings made after you save.';
  document.getElementById('vcLabel').textContent = vendorId ? 'Commission for this vendor (%)' : 'Default commission (%)';
  const startRate = vendorId ? (rate != null ? rate : (d ? d.commission.rate : V.defaultRate)) : V.defaultRate;
  document.getElementById('vcRate').value = startRate;
  document.getElementById('vcRate').disabled = false;
  document.getElementById('vcResetRow').hidden = !vendorId;
  document.getElementById('vcReset').checked = false;
  document.getElementById('vcReset').onchange = e => { document.getElementById('vcRate').disabled = e.target.checked; };
  formError('vcError');
  openModal('vCommissionModal');
}

async function submitCommission(e) {
  e.preventDefault();
  const { vendorId } = V.commissionCtx;
  const reset = document.getElementById('vcReset').checked;
  const rate = Number(val('vcRate'));
  if (!reset && (!Number.isFinite(rate) || rate < 0 || rate > 100 || val('vcRate') === '')) return formError('vcError', 'Enter a percentage between 0 and 100.');
  const btn = document.getElementById('vcSubmit');
  btn.disabled = true;
  try {
    const res = vendorId
      ? await adminFetch(`/api/v1/admin/vendors/${vendorId}/commission`, { method: 'PUT', body: JSON.stringify({ rate: reset ? null : rate }) })
      : await adminFetch('/api/v1/admin/settings/commission', { method: 'PUT', body: JSON.stringify({ defaultRate: rate }) });
    if (!res.ok) return formError('vcError', res.data.message || 'Could not save the commission.');
    closeModal('vCommissionModal');
    showAdminToast('Commission saved. It applies to new bookings.', 'success');
    if (!vendorId) V.defaultRate = rate;
    refreshVendorViews();
    if (document.getElementById('vsub-commission').classList.contains('active')) loadCommissionPane();
  } catch (x) {
    formError('vcError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Activity logs (all vendors) ----------

const debouncedVendorActivity = makeDebounce(() => loadVendorActivity(1));

function activityRows(entries, withVendor = true) {
  return entries.map(a => `
    <tr>
      <td style="white-space: nowrap;">${E(fmtDateTime(a.createdAt))}</td>
      <td>${E(a.summary)}</td>
      ${withVendor ? `<td>${a.agency ? `<a href="#" onclick="event.preventDefault(); openVendor('${E(a.agency._id)}')">${E(a.agency.name)}</a>` : '—'}</td>` : ''}
      <td>${E(a.actorName) || 'System'}${a.actorRole ? `<span class="lead-sub">${E(a.actorRole)}</span>` : ''}</td>
    </tr>`).join('');
}

async function loadVendorActivity(page = 1) {
  tableMessage('vendorActivityBody', 4, 'Loading...');
  ensureVendorOptions();
  const q = queryString({ agency: val('vaVendor') || 'any', search: val('vaSearch').trim(), page, limit: 30 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/activity?${q}`);
    if (!ok) return tableMessage('vendorActivityBody', 4, data.message || 'Could not load activity.', true);
    renderPager('vendorActivityPager', data.data, 'loadVendorActivity');
    if (!data.data.entries.length) return tableMessage('vendorActivityBody', 4, 'No vendor activity recorded yet.');
    document.getElementById('vendorActivityBody').innerHTML = activityRows(data.data.entries);
  } catch (e) {
    tableMessage('vendorActivityBody', 4, 'Failed to load activity.', true);
  }
}
