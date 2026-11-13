/**
 * Plejar admin - the vendor profile page (opened from Vendors > All vendors).
 * Depends on admin.js, admin-users.js and admin-vendors.js.
 */

const VENDOR_TABS = [
  ['overview', 'Overview'], ['verification', 'Verification & documents'], ['packages', 'Tour events'], ['bookings', 'Bookings'],
  ['performance', 'Performance'], ['ratings', 'Ratings'], ['earnings', 'Earnings & payouts'], ['commission', 'Commission'],
  ['contract', 'Contract'], ['team', 'Team'], ['activity', 'Activity']
];

async function openVendor(id, tab = 'overview') {
  try {
    const route = `#vendors/${id}${tab && tab !== 'overview' ? `/${tab}` : ''}`;
    history.replaceState(null, '', route);
    sessionStorage.setItem('plezar_admin_tab', route);
  } catch (_) {}
  switchTab('vendorDetail', false);
  const box = document.getElementById('vendorDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading vendor...</p>';
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${id}`);
    if (!ok) {
      box.innerHTML = `<p style="color: var(--color-danger); padding: 24px;">${E(data.message || 'Could not load this vendor.')}</p>`;
      return;
    }
    V.detail = data.data;
    // Light up Travel agents or Hotels in the sidebar, whichever this vendor is
    setVendorKind(V.detail.agency.kind === 'hotel' ? 'hotel' : 'agency');
    switchTab('vendorDetail', false);
    renderVendorDetail(tab);
  } catch (e) {
    box.innerHTML = '<p style="color: var(--color-danger); padding: 24px;">Failed to load this vendor.</p>';
  }
}

async function reloadVendor() {
  if (!V.detail) return;
  const tab = V.tab;
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}`);
  if (!ok) return;
  V.detail = data.data;
  renderVendorDetail(tab);
}

function refreshVendorReviews() {
  if (V.detail && document.getElementById('tab-vendorDetail').classList.contains('active') && V.tab === 'ratings') renderVendorTab('ratings');
}

function renderVendorDetail(tab = 'overview') {
  const d = V.detail;
  const a = d.agency;
  const owner = d.members.find(m => m.agencyRole === 'owner');
  const verify = a.verified ? 'verified' : d.verification.status;
  const badge = { verified: 'badge-active', pending: 'badge-manager', rejected: 'badge-admin', none: 'badge-inactive' }[verify];
  const text = { verified: 'Verified', pending: 'Awaiting review', rejected: 'Changes requested', none: 'Not verified' }[verify];

  document.getElementById('vendorDetail').innerHTML = `
    <div class="profile-head">
      <button class="btn btn-secondary btn-sm" onclick="switchTab('vendors')">&larr; ${a.kind === 'hotel' ? 'All hotels' : 'All travel agents'}</button>
      <div class="profile-id">
        ${agencyLogo(a, 56)}
        <div>
          <h2>${E(a.name)}</h2>
          <p>${E(d.vendorId)} · ${E((a.regions || []).join(', ')) || 'No areas listed'}${owner ? ` · Owner: ${E(owner.name)}` : ''}</p>
          <p class="profile-badges">
            <span class="badge ${VENDOR_STATUS_BADGE[a.status]}">${E(label(a.status))}</span>
            <span class="badge ${badge}">${E(text)}</span>
            <span class="badge ${CONTRACT_BADGE[d.contract.status]}">Contract: ${E(label(d.contract.status))}</span>
            ${d.ratings.average ? `<span class="badge badge-inactive"><span class="stars">★</span>&nbsp;${d.ratings.average} (${d.ratings.count})</span>` : ''}
          </p>
        </div>
      </div>
      <div class="profile-actions">${isMoneyAdmin() ? '<button class="btn btn-secondary" onclick="openSendLoginDetails()">Send login details</button> <button class="btn btn-secondary" onclick="openVendorReportModal()">Send report</button> ' : ''}${a.status === 'active'
        ? '<button class="btn btn-danger" onclick="openVendorStatusModal()">Suspend or deactivate</button>'
        : '<button class="btn btn-primary" onclick="reactivateVendor()">Reactivate vendor</button>'}</div>
    </div>
    <div class="subtabs" role="tablist" aria-label="Vendor profile sections">
      ${VENDOR_TABS.map(([key, t]) => `<button type="button" role="tab" class="subtab ${key === tab ? 'active' : ''}" data-vtab="${key}" aria-selected="${key === tab}" onclick="renderVendorTab('${key}')">${t}${key === 'verification' && d.verification.status === 'pending' ? ' <span class="mini-count">1</span>' : ''}${key === 'earnings' && d.earnings.pendingPayoutCount ? ` <span class="mini-count">${d.earnings.pendingPayoutCount}</span>` : ''}${key === 'bookings' && d.stats.bookings ? ` <span class="mini-count">${d.stats.bookings}</span>` : ''}</button>`).join('')}
    </div>
    <div id="vendorTabBody"></div>`;
  renderVendorTab(tab);
}

function vTile(labelText, valueText, note) {
  return `<div class="kpi"><div class="kpi-label">${E(labelText)}</div><div class="kpi-value">${E(valueText)}</div><div class="kpi-note">${E(note || '')}</div></div>`;
}

async function renderVendorTab(tab) {
  V.tab = tab;
  document.querySelectorAll('#vendorDetail [data-vtab]').forEach(b => {
    const on = b.dataset.vtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const body = document.getElementById('vendorTabBody');
  if (!body || !V.detail) return;
  const id = V.detail.agency._id;
  const fail = text => { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(text)}</p>`; };
  body.innerHTML = '<p style="color: var(--text-dim); padding: 16px;">Loading...</p>';
  try {
    if (tab === 'overview') { await ensureCategories(); return void (body.innerHTML = vendorOverview()); }
    if (tab === 'verification') return void (body.innerHTML = vendorVerification());
    if (tab === 'packages') return void (body.innerHTML = vendorPackages());
    if (tab === 'commission') return void (body.innerHTML = vendorCommission());
    if (tab === 'contract') return void (body.innerHTML = vendorContract());
    if (tab === 'team') return void (body.innerHTML = vendorTeam());
    if (tab === 'bookings') return void loadVendorBookings(1);
    if (tab === 'activity') return void loadVendorActivityTab(1);
    if (tab === 'performance') {
      const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${id}/performance`);
      return ok ? void (body.innerHTML = vendorPerformance(data.data)) : fail(data.message);
    }
    if (tab === 'ratings') {
      const [r, list] = await Promise.all([adminFetch(`/api/v1/admin/vendors/${id}/ratings`), adminFetch(`/api/v1/admin/reviews?agency=${id}&limit=50`)]);
      return r.ok && list.ok ? void (body.innerHTML = vendorRatings(r.data.data.ratings, list.data.data.reviews)) : fail('Could not load ratings.');
    }
    if (tab === 'earnings') {
      const [p, m] = await Promise.all([adminFetch(`/api/v1/admin/vendors/${id}/payouts`), adminFetch(`/api/v1/admin/vendors/${id}/earnings`)]);
      return p.ok && m.ok ? void (body.innerHTML = vendorEarnings(p.data.data, m.data.data)) : fail('Could not load earnings.');
    }
  } catch (e) {
    fail('Could not load this section.');
  }
}

// ---------- Overview ----------

function vendorOverview() {
  const d = V.detail;
  const a = d.agency;
  const owner = d.members.find(m => m.agencyRole === 'owner');
  const assigned = new Set(d.categories.map(c => c.id));
  return `
    <div class="kpi-grid" style="margin-bottom: 18px;">
      ${vTile('Bookings', String(d.stats.bookings), `${d.stats.complaints} complaint${d.stats.complaints === 1 ? '' : 's'} on record`)}
      ${vTile('Rating', d.ratings.average ? `${d.ratings.average} out of 5` : 'No reviews', `${d.ratings.count} review${d.ratings.count === 1 ? '' : 's'}`)}
      ${vTile('Available to pay out', takaFmt(d.earnings.available), `${takaFmt(d.earnings.paidOut)} paid so far`)}
      ${vTile('Published packages', String(d.stats.packages.published), `${d.stats.packages.draft} draft · ${d.stats.packages.hidden} hidden`)}
      ${vTile('Team', String(d.stats.teamSize), owner ? `Owner: ${owner.name}` : 'No owner')}
    </div>
    <div class="detail-grid">
      <form class="detail-card" onsubmit="saveVendorProfile(event)" novalidate>
        <h3>Profile</h3>
        <div class="form-group"><label class="form-label" for="vpName">Agency name</label><input id="vpName" class="form-input" value="${E(a.name)}" maxlength="120" required></div>
        <div class="form-group"><label class="form-label" for="vpDesc">Description</label><textarea id="vpDesc" class="form-input" rows="4" maxlength="1500">${E(a.description)}</textarea></div>
        <div class="form-group"><label class="form-label" for="vpRegions">Areas covered (comma separated)</label><input id="vpRegions" class="form-input" value="${E((a.regions || []).join(', '))}"></div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="vpPhone">Phone</label><input id="vpPhone" class="form-input" value="${E(a.phone)}" maxlength="20"></div>
          <div class="form-group"><label class="form-label" for="vpEmail">Public email</label><input id="vpEmail" class="form-input" value="${E(a.email)}"></div>
        </div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="vpWebsite">Facebook page or website</label><input id="vpWebsite" class="form-input" value="${E(a.website)}" maxlength="200"></div>
          <div class="form-group"><label class="form-label" for="vpLicense">Trade license number</label><input id="vpLicense" class="form-input" value="${E(a.tradeLicenseNumber)}" maxlength="60"></div>
        </div>
        <div class="form-note-box is-error" id="vpError" role="alert" hidden></div>
        <button type="submit" class="btn btn-primary" id="vpSave">Save profile</button>
      </form>
      <div>
        <div class="detail-card">
          <h3>Standing</h3>
          <p><span class="badge ${VENDOR_STATUS_BADGE[a.status]}">${E(label(a.status))}</span></p>
          ${a.status !== 'active' ? `<p class="detail-note">${E(a.statusReason)}${a.statusUntil ? ` (until ${E(fmtDate(a.statusUntil))})` : ''}</p>` : ''}
          <p class="detail-muted" style="margin-top: 10px;">Joined ${E(fmtDate(a.createdAt))}${owner ? `<br>Owner: ${E(owner.name)} · ${E(owner.email)}${owner.accountStatus === 'invited' ? ' (invite not accepted yet)' : ''}` : ''}</p>
        </div>
        <div class="detail-card" style="margin-top: 16px;">
          <h3>Categories</h3>
          ${V.categories.filter(c => c.active || assigned.has(c._id)).length ? `<div class="check-list" id="vendorCatList">${V.categories.filter(c => c.active || assigned.has(c._id)).map(c => `<label class="check"><input type="checkbox" value="${E(c._id)}" ${assigned.has(c._id) ? 'checked' : ''}> ${E(c.name)}${c.active ? '' : ' (switched off)'}</label>`).join('')}</div>
            <button class="btn btn-secondary" style="margin-top: 14px;" onclick="saveVendorCategories()">Save categories</button>` : '<p class="detail-muted">No categories yet. Add some under Vendors, Categories.</p>'}
        </div>
      </div>
    </div>`;
}

async function saveVendorProfile(e) {
  e.preventDefault();
  const name = val('vpName').trim();
  if (!name) return showFormNote('vpError', 'Enter the agency name.', true);
  const btn = document.getElementById('vpSave');
  btn.disabled = true;
  try {
    const body = { name, description: val('vpDesc'), regions: val('vpRegions'), phone: val('vpPhone').trim(), email: val('vpEmail').trim(), website: val('vpWebsite').trim(), tradeLicenseNumber: val('vpLicense').trim() };
    const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${V.detail.agency._id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) return showFormNote('vpError', data.message || 'Could not save the profile.', true);
    showAdminToast('Vendor profile saved.', 'success');
    reloadVendor();
  } catch (x) {
    showFormNote('vpError', 'Could not reach the server.', true);
  } finally {
    btn.disabled = false;
  }
}

async function saveVendorCategories() {
  const ids = [...document.querySelectorAll('#vendorCatList input:checked')].map(i => i.value);
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/categories`, { method: 'PUT', body: JSON.stringify({ categories: ids }) });
  if (!ok) return showAdminToast(data.message || 'Could not save categories.', 'error');
  showAdminToast('Categories saved.', 'success');
  ensureCategories(true);
  reloadVendor();
}

// ---------- Status ----------

function syncVendorStatusForm() {
  document.getElementById('vsUntilGroup').hidden = val('vsStatus') !== 'suspended';
}

function openVendorStatusModal() {
  const a = V.detail.agency;
  document.getElementById('vStatusLead').textContent = `${a.name} will be locked out of the agency panel and won't take new bookings until you reactivate it.`;
  document.getElementById('vsStatus').value = 'suspended';
  document.getElementById('vsReason').value = '';
  document.getElementById('vsUntil').value = '';
  document.getElementById('vsUntil').min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  formError('vStatusError');
  syncVendorStatusForm();
  openModal('vStatusModal');
}

async function submitVendorStatus(e) {
  e.preventDefault();
  const status = val('vsStatus');
  const reason = val('vsReason').trim();
  if (reason.length < 3) return formError('vStatusError', 'Add a reason. The agency sees it when they try to sign in.');
  const body = { status, reason };
  if (status === 'suspended' && val('vsUntil')) body.until = new Date(`${val('vsUntil')}T23:59:59`).toISOString();
  const btn = document.getElementById('vStatusSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/status`, { method: 'POST', body: JSON.stringify(body) });
    if (!ok) return formError('vStatusError', data.message || 'Could not change the status.');
    closeModal('vStatusModal');
    showAdminToast(`Vendor ${status}.`, 'success');
    refreshVendorViews();
  } catch (x) {
    formError('vStatusError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

async function reactivateVendor() {
  const a = V.detail.agency;
  if (!confirm(`Reactivate ${a.name}? Its team can use the agency panel again and travelers can book it.`)) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${a._id}/status`, { method: 'POST', body: JSON.stringify({ status: 'active' }) });
  if (!ok) return showAdminToast(data.message || 'Could not reactivate.', 'error');
  showAdminToast('Vendor reactivated.', 'success');
  refreshVendorViews();
}

// ---------- Verification & documents ----------

function vendorVerification() {
  const d = V.detail;
  const a = d.agency;
  const v = d.verification;
  const banners = {
    approved: ['callout-ok', 'Verified', `Reviewed ${E(fmtDate(v.reviewedAt))}.`],
    pending: ['callout-warn', 'Waiting for your review', `Submitted ${E(fmtDate(v.submittedAt))}.`],
    rejected: ['callout-error', 'Changes requested', E(v.note || '')],
    none: ['', 'Nothing submitted', 'The vendor has not uploaded a trade license or ID yet.']
  };
  const [cls, title, text] = banners[a.verified ? 'approved' : v.status] || banners.none;
  const DOCS = { trade_license: 'Trade license', nid: "Owner's national ID" };
  return `
    <div class="callout ${cls}"><div><strong>${E(title)}</strong>${text}</div></div>
    <p class="detail-muted">Trade license number: <strong>${E(v.tradeLicenseNumber) || '—'}</strong></p>
    <ul class="detail-docs">
      ${v.documents.length ? v.documents.map(doc => `<li><span>${E(DOCS[doc.kind] || doc.kind)}<span class="lead-sub">${E(doc.originalName)} · uploaded ${E(fmtDate(doc.uploadedAt))}</span></span>
        <a class="btn btn-secondary btn-sm" href="/api/v1/admin/agencies/${E(a._id)}/documents/${E(doc.id)}" target="_blank" rel="noopener">View</a></li>`).join('') : '<li><span>No documents uploaded.</span></li>'}
    </ul>
    ${v.documents.length ? `
      <div class="form-group"><label class="form-label" for="vvNote">Note to the vendor (required when asking for changes)</label>
        <textarea id="vvNote" class="form-input" rows="2" maxlength="500" placeholder="For example: the trade license photo is blurry, upload a clearer one"></textarea></div>
      <div class="profile-actions">
        ${v.documents.length >= 2 && !a.verified ? '<button class="btn btn-primary" onclick="reviewVendorVerification(\'approve\')">Approve and verify</button>' : ''}
        <button class="btn btn-secondary" onclick="reviewVendorVerification('reject')">Request changes</button>
        ${a.verified ? '<button class="btn btn-danger" onclick="reviewVendorVerification(\'revoke\')">Remove verified mark</button>' : ''}
      </div>` : ''}`;
}

async function reviewVendorVerification(decision) {
  const note = (document.getElementById('vvNote')?.value || '').trim();
  if (decision === 'reject' && !note) {
    showAdminToast('Add a note telling the vendor what to fix.', 'error');
    return document.getElementById('vvNote')?.focus();
  }
  if (decision === 'revoke' && !confirm('Remove the verified mark from this vendor?')) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${V.detail.agency._id}/verify`, { method: 'POST', body: JSON.stringify({ decision, note }) });
  if (!ok) return showAdminToast(data.message || 'Could not update verification.', 'error');
  showAdminToast({ approve: 'Vendor verified.', reject: 'Changes requested. The vendor will see your note.', revoke: 'Verified mark removed.' }[decision], 'success');
  refreshVendorViews();
}

// ---------- Packages ----------

function vendorPackages() {
  const pk = V.detail.packages;
  if (!pk.length) return '<p class="empty-note">This vendor has not created any tour events yet.</p>';
  const aid = E(V.detail.agency._id);
  const STATUS_BADGE = { published: 'badge-active', draft: 'badge-manager', hidden: 'badge-inactive', cancelled: 'badge-admin' };
  return `<div class="table-container"><table class="admin-table lead-table">
    <thead><tr><th>Tour event</th><th>Dates</th><th>Seats</th><th>Price</th><th>Status</th><th style="text-align: right;">Actions</th></tr></thead>
    <tbody>${pk.map(p => `<tr>
      <td><span class="lead-main">${E(p.title)}</span><span class="lead-sub">${E(p.destination)}, ${p.photos.length} photo${p.photos.length === 1 ? '' : 's'}</span></td>
      <td style="white-space: nowrap;">${p.startDate ? `${E(fmtDate(p.startDate))}${p.endDate && p.endDate !== p.startDate ? `<span class="lead-sub">to ${E(fmtDate(p.endDate))}</span>` : ''}` : '<span class="lead-sub" style="margin:0">No date</span>'}<span class="lead-sub">${Number(p.durationDays)}D / ${Number(p.durationNights || 0)}N</span></td>
      <td>${p.seats ? Number(p.seats) : '—'}</td>
      <td>${takaFmt(p.priceFrom)}</td>
      <td><span class="badge ${STATUS_BADGE[p.status] || 'badge-inactive'}">${E(label(p.status))}</span>${p.hiddenByAdmin ? '<span class="lead-sub">Hidden by Plejar</span>' : ''}${p.status === 'cancelled' && p.cancelReason ? `<span class="lead-sub">${E(p.cancelReason)}</span>` : ''}
        <span class="lead-sub" style="${p.planMissing && p.planMissing.length ? 'color: var(--color-warning, #b7791f)' : ''}">${p.planMissing && p.planMissing.length ? `Plan missing ${p.planMissing.length}` : 'Plan complete'}</span></td>
      <td style="text-align: right;"><div class="lead-actions" style="justify-content: flex-end;"><button class="btn btn-secondary btn-sm" onclick="showEventPlan('${E(p._id)}')">View plan</button>${p.status === 'cancelled' ? '' : p.hiddenByAdmin
        ? `<button class="btn btn-secondary btn-sm" onclick="moderateVendorPackage('${aid}', '${E(p._id)}', false)">Allow again</button>`
        : `<button class="btn btn-danger btn-sm" onclick="moderateVendorPackage('${aid}', '${E(p._id)}', true)">Hide</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
}

// The full plan a vendor declared for one tour event, as travelers see it
const TRANSPORT_TEXT = { bus: 'Non-AC bus', ac_bus: 'AC bus', train: 'Train', launch: 'Launch', plane: 'Plane', jeep: 'Jeep', boat: 'Boat', car: 'Car or microbus', walking: 'On foot', mixed: 'A mix' };
const STAY_TEXT = { none: 'No overnight stay', hotel: 'Hotel', resort: 'Resort', cottage: 'Cottage', camp: 'Camping', houseboat: 'Houseboat', homestay: 'Homestay', mixed: 'A mix' };
const STOP_TEXT = { departure: 'Departure', stop: 'Stop', activity: 'Activity', meal: 'Meal', stay: 'Check in', return: 'Return' };

function showEventPlan(packageId) {
  // From the open vendor profile, or from Travel agents > Tour packages
  const p = [...(V.detail ? V.detail.packages : []), ...(V.pkgList || [])].find(x => String(x._id) === String(packageId));
  if (!p) return;
  const listOf = items => (items && items.length ? `<ul class="plan-ul">${items.map(i => `<li>${E(i)}</li>`).join('')}</ul>` : '<span class="detail-muted">Not given</span>');
  const row = (name, value) => appPlanRow(name, value);
  const day = (d, i) => {
    const date = p.startDate ? new Date(new Date(p.startDate).getTime() + i * 86400000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
    const meals = ['breakfast', 'lunch', 'dinner'].filter(m => d.meals && d.meals[m]);
    return `<div class="plan-day"><h4>Day ${d.day}${date ? `, ${E(date)}` : ''}${d.title ? `: ${E(d.title)}` : ''}</h4>
      ${d.stops && d.stops.length ? `<ol class="plan-stops">${d.stops.map(st => `<li><span class="plan-time">${E(st.time || '')}</span><span><strong>${E(st.place)}</strong> <span class="tag">${E(STOP_TEXT[st.kind] || st.kind)}</span>${st.destinationRef && st.destinationRef.name ? ' <span class="lead-sub" style="display:inline">on Plejar</span>' : ''}${st.note ? `<span class="lead-sub">${E(st.note)}</span>` : ''}</span></li>`).join('')}</ol>` : '<p class="detail-muted">No stops.</p>'}
      <p class="lead-sub">${meals.length ? `Meals: ${E(meals.join(', '))}` : 'No meals included'}${d.stay ? `. Night at ${E(d.stay)}` : ''}</p></div>`;
  };
  document.getElementById('epTitle').textContent = p.title;
  document.getElementById('epBody').innerHTML = `
    ${p.planMissing && p.planMissing.length ? `<div class="callout callout-warn"><div><strong>Plan incomplete</strong>Missing: ${E(p.planMissing.join(', '))}.</div></div>` : ''}
    <dl class="kv">
      ${row('Dates', p.startDate ? `${E(fmtDate(p.startDate))}${p.endDate ? ` to ${E(fmtDate(p.endDate))}` : ''} (${Number(p.durationDays)}D / ${Number(p.durationNights || 0)}N)` : '')}
      ${row('Destination', E(p.destination))}
      ${row('Price', `${takaFmt(p.priceFrom)} per person${p.childPrice != null ? `, ${takaFmt(p.childPrice)} per child` : ''}${p.advanceAmount != null ? `. Advance ${takaFmt(p.advanceAmount)}` : ''}`)}
      ${row('In the app', `${E(label(p.tourType || 'group'))} tour${p.regularPrice > p.priceFrom ? `, on sale from ${takaFmt(p.regularPrice)} (${Math.round(((p.regularPrice - p.priceFrom) / p.regularPrice) * 100)}% off)` : ''}${p.groupSize && (p.groupSize.min || p.groupSize.max) ? `, groups of ${E([p.groupSize.min, p.groupSize.max].filter(Boolean).join(' to '))}` : ''}${p.flexibleDates ? ', flexible dates' : ''}`)}
      ${row('Highlights', listOf(p.highlights))}
      ${row('Seats', p.seats ? Number(p.seats) : '')}
      ${row('Meeting point', `${E(p.meetingPoint)}${p.departureTime ? ` at ${E(p.departureTime)}` : ''}`)}
      ${row('Tour ends', E(p.returnInfo))}
      ${row('Transport', p.transport && p.transport.mode ? `${E(TRANSPORT_TEXT[p.transport.mode])}${p.transport.details ? `: ${E(p.transport.details)}` : ''}` : '')}
      ${row('Stay', p.accommodation && p.accommodation.type ? `${E(STAY_TEXT[p.accommodation.type])}${p.accommodation.details ? `: ${E(p.accommodation.details)}` : ''}` : '')}
      ${row('Difficulty', E(label(p.difficulty || '')))}
      ${row('Included', listOf(p.included))}
      ${row('Not included', listOf(p.excluded))}
      ${row('What to bring', listOf(p.whatToBring))}
      ${row('Cancellation policy', p.cancellationPolicy ? `<span class="pre">${E(p.cancellationPolicy)}</span>` : '')}
    </dl>
    <h3 style="margin: 18px 0 8px; font-size: 1rem;">Day by day</h3>
    ${(p.itinerary || []).length ? p.itinerary.map(day).join('') : '<p class="detail-muted">No day-by-day plan yet.</p>'}`;
  openModal('eventPlanModal');
}

function appPlanRow(name, value) {
  return `<div class="kv-row"><dt>${E(name)}</dt><dd>${value || '<span class="detail-muted">Not given</span>'}</dd></div>`;
}

async function moderateVendorPackage(agencyId, packageId, hidden) {
  if (hidden && !confirm('Hide this tour event? The vendor cannot publish it again until you allow it.')) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}/packages/${packageId}`, { method: 'PATCH', body: JSON.stringify({ hidden }) });
  if (!ok) return showAdminToast(data.message || 'Could not update the package.', 'error');
  showAdminToast(hidden ? 'Tour event hidden.' : 'Tour event allowed again.', 'success');
  if (document.getElementById('tab-vendorDetail').classList.contains('active') && V.detail) reloadVendor();
  else loadPackages(V.pkPage);
}

// ---------- Bookings ----------

async function loadVendorBookings(page) {
  const body = document.getElementById('vendorTabBody');
  const { ok, data } = await adminFetch(`/api/v1/admin/bookings?${queryString({ agency: V.detail.agency._id, page, limit: 15 })}`);
  if (!ok) { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(data.message)}</p>`; return; }
  body.innerHTML = data.data.bookings.length ? `
    <p class="totals-line">${data.data.total} booking${data.data.total === 1 ? '' : 's'} · ${takaFmt(data.data.totals.amount)} booked · ${takaFmt(data.data.totals.commission)} Plejar commission</p>
    <div class="table-container"><table class="admin-table lead-table">
      <thead><tr><th>Booking</th><th>Traveler</th><th>Travel date</th><th>Amount</th><th>Status</th><th>Payment</th><th style="text-align: right;">Actions</th></tr></thead>
      <tbody>${data.data.bookings.map(b => bookingRow(b, { withVendor: false })).join('')}</tbody></table></div>
    <div class="pager" id="vendorBookingsPager"></div>` : '<p class="empty-note">No bookings for this vendor yet.</p>';
  renderPager('vendorBookingsPager', data.data, 'loadVendorBookings');
}

// ---------- Performance ----------

function vendorPerformance({ metrics: m, series }) {
  const oneOf = (n, total) => (total ? `${n} of ${total}` : 'No customers yet');
  return `
    <div class="kpi-grid" style="margin-bottom: 20px;">
      ${vTile('Bookings', String(m.bookings), `${m.completed} completed · ${m.confirmed} confirmed · ${m.pending} pending`)}
      ${vTile('Completion rate', pct(m.completionRate), 'Completed trips out of completed plus cancelled')}
      ${vTile('Cancellation rate', pct(m.cancellationRate), `${m.cancelled} cancelled`)}
      ${vTile('Average booking', m.averageBookingValue == null ? '—' : takaFmt(m.averageBookingValue), 'Excluding cancelled bookings')}
      ${vTile('Repeat customers', pct(m.repeatRate), oneOf(m.repeatCustomers, m.customers))}
      ${vTile('Rating', m.rating.average ? `${m.rating.average} out of 5` : 'No reviews', `${m.rating.count} visible review${m.rating.count === 1 ? '' : 's'}`)}
      ${vTile('Open complaints', String(m.openComplaints), `${m.totalComplaints} in total`)}
      ${vTile('Last 30 days', `${m.last30Bookings} bookings`, `${takaFmt(m.last30Revenue)} paid`)}
    </div>
    <div class="chart-grid">
      ${columnChart('vpBookings', 'Bookings per day', ['booking', 'bookings'], series.dates, series.bookings)}
      ${columnChart('vpRevenue', 'Paid amount per day (৳)', ['taka', 'taka'], series.dates, series.revenue)}
    </div>`;
}

// ---------- Ratings ----------

function vendorRatings(r, reviews) {
  const rows = [5, 4, 3, 2, 1].map(n => ({ label: `${n} star${n === 1 ? '' : 's'}`, count: r.distribution[n] }));
  return `
    <div class="chart-grid" style="margin-bottom: 18px;">
      <div class="chart-card"><div class="kpi-label">Average rating</div>
        <div class="rating-big">${r.average ? r.average : '—'}<span>${r.average ? ' out of 5' : ''}</span></div>
        ${r.average ? `<div class="stars" style="font-size: 1.2rem;">${stars(Math.round(r.average))}</div>` : ''}
        <p class="detail-muted" style="margin-top: 8px;">${r.count} visible review${r.count === 1 ? '' : 's'}${r.hidden ? ` · ${r.hidden} hidden` : ''}</p></div>
      <div class="chart-card"><div class="chart-head"><div class="chart-title">Rating breakdown</div></div>${barList(rows)}</div>
    </div>
    ${reviews.length ? `<div class="table-container"><table class="admin-table lead-table">
      <thead><tr><th>Traveler</th><th>Trip</th><th>Rating</th><th>Review</th><th>Date</th><th style="text-align: right;">Actions</th></tr></thead>
      <tbody>${reviewRows(reviews)}</tbody></table></div>` : '<p class="empty-note">No reviews for this vendor yet.</p>'}`;
}

// ---------- Earnings & payouts ----------

function vendorEarnings({ payouts, earnings: e }, { monthly }) {
  const canPay = isMoneyAdmin();
  return `
    <div class="wallet-top">
      <div><div class="kpi-label">Available to pay out</div><div class="wallet-balance">${takaFmt(e.available)}</div>
        <p class="detail-muted" style="margin: 4px 0 0;">Earned from completed, paid trips, after Plejar's commission and any payouts already sent or waiting.</p></div>
      ${canPay ? `<button class="btn btn-primary" onclick="openPayoutModal()" ${e.available < 1 ? 'disabled' : ''}>Create payout</button>` : '<span class="detail-muted" style="margin:0">Only administrators can create payouts.</span>'}
    </div>
    <div class="kpi-grid" style="margin-bottom: 20px;">
      ${vTile('Earned so far', takaFmt(e.earned), `${e.completedTrips} completed trip${e.completedTrips === 1 ? '' : 's'}`)}
      ${vTile('Coming up', takaFmt(e.upcoming), `${e.upcomingTrips} paid trip${e.upcomingTrips === 1 ? '' : 's'} not yet taken`)}
      ${vTile('Paid out', takaFmt(e.paidOut), 'Sent to the vendor')}
      ${vTile('Waiting to be paid', takaFmt(e.pendingPayouts), `${e.pendingPayoutCount} payout${e.pendingPayoutCount === 1 ? '' : 's'}`)}
      ${vTile('Plejar commission', takaFmt(e.commission), `On ${takaFmt(e.gross)} of completed trips`)}
    </div>
    <h3 class="section-label">Last six months (by completion date)</h3>
    <div class="table-container" style="margin-bottom: 24px;"><table class="admin-table">
      <thead><tr><th>Month</th><th>Trips</th><th>Booked</th><th>Plejar commission</th><th>Vendor earned</th></tr></thead>
      <tbody>${monthly.map(m => `<tr><td>${E(new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</td><td>${m.trips}</td><td>${takaFmt(m.gross)}</td><td>${takaFmt(m.commission)}</td><td><strong>${takaFmt(m.net)}</strong></td></tr>`).join('')}</tbody></table></div>
    <h3 class="section-label">Payouts</h3>
    ${payouts.length ? `<div class="table-container"><table class="admin-table lead-table">
      <thead><tr><th>Date</th><th>Amount</th><th>Send to</th><th>Started by</th><th>Status</th><th style="text-align: right;">Actions</th></tr></thead>
      <tbody>${payoutRows(payouts, { withVendor: false })}</tbody></table></div>` : '<p class="empty-note">No payouts yet.</p>'}`;
}

async function openPayoutModal() {
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/payouts`);
  const available = ok ? data.data.earnings.available : 0;
  V.payoutCtx = { available };
  document.getElementById('payoutLead').textContent = `${V.detail.agency.name} has ${takaFmt(available)} available. The payout is created as "waiting to be paid"; mark it paid after you send the money.`;
  document.getElementById('poAmount').max = available;
  document.getElementById('poAmount').value = available;
  document.getElementById('poAccount').value = V.detail.agency.phone || '';
  document.getElementById('poNote').value = '';
  formError('payoutError');
  openModal('payoutModal');
}

async function submitPayout(e) {
  e.preventDefault();
  const amount = Number(val('poAmount'));
  const account = val('poAccount').trim();
  if (!(amount >= 1)) return formError('payoutError', 'Enter an amount of at least ৳1.');
  if (amount > V.payoutCtx.available) return formError('payoutError', `Only ${takaFmt(V.payoutCtx.available)} is available.`);
  if (!account) return formError('payoutError', 'Enter the account or mobile number to send to.');
  const btn = document.getElementById('payoutSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/payouts`, { method: 'POST', body: JSON.stringify({ amount, method: val('poMethod'), account, note: val('poNote').trim() }) });
    if (!ok) return formError('payoutError', data.message || 'Could not create the payout.');
    closeModal('payoutModal');
    showAdminToast('Payout created. Mark it paid once the money is sent.', 'success');
    refreshVendorViews();
  } catch (x) {
    formError('payoutError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Commission ----------

function vendorCommission() {
  const d = V.detail;
  const c = d.commission;
  const isHotel = d.agency.kind === 'hotel';
  const sample = 10000;
  const keep = !c.enabled ? 0 : (c.type === 'amount' ? Math.min(c.value, sample) : Math.round(sample * c.value) / 100);
  const contractRate = d.contract.agreedCommission;
  const charged = c.enabled && c.type === 'percent' ? c.value : null;
  let contractNote = '<p class="detail-muted">This matches what is being charged.</p>';
  if (!c.enabled) contractNote = `<p class="detail-note">The contract says ${pct(contractRate)}, but commission is off for this vendor.</p>`;
  else if (c.type === 'amount') contractNote = `<p class="detail-note">The contract says ${pct(contractRate)}, but this vendor is charged a flat ${takaFmt(c.value)} per booking.</p>`;
  else if (contractRate !== charged) contractNote = `<p class="detail-note">The contract says ${pct(contractRate)} but bookings are charged at ${pct(charged)}. Update one so they match.</p>`;
  return `
    <div class="detail-grid">
      <div class="detail-card">
        <h3>Commission</h3>
        <div class="commission-rate">${c.enabled ? E(c.type === 'amount' ? takaFmt(c.value) : `${c.value}%`) : 'Off'}</div>
        <p class="detail-muted">${c.enabled
          ? (c.type === 'amount' ? 'A flat amount on every booking.' : 'A percent of every booking.')
          : `Plejar takes no commission from this ${isHotel ? 'hotel' : 'travel agent'}.`}</p>
        ${c.enabled ? `<p class="detail-muted">Example: on a ${takaFmt(sample)} ${isHotel ? 'stay' : 'booking'}, Plejar's commission is ${takaFmt(keep)} and the ${isHotel ? 'hotel' : 'vendor'} keeps ${takaFmt(sample - keep)}.</p>` : ''}
        ${isHotel ? '<p class="detail-muted">Guests pay the hotel directly, so the hotel owes Plejar the commission on each accepted stay once it is over.</p>' : ''}
        <p class="detail-muted">Changes apply to bookings made after you save. Bookings already made keep the terms they were made with.</p>
        ${isMoneyAdmin() ? `<button class="btn btn-primary" onclick="openCommissionModal('${E(d.agency._id)}')">${c.enabled ? 'Change commission' : 'Turn on commission'}</button>` : '<p class="detail-muted">Only administrators can change commission.</p>'}
      </div>
      <div class="detail-card">
        <h3>What the contract says</h3>
        ${contractRate == null ? '<p class="detail-muted">No commission is written into the contract.</p>' : `<p class="commission-rate" style="font-size: 1.6rem;">${pct(contractRate)}</p>${contractNote}`}
      </div>
    </div>`;
}

// ---------- Contract ----------

function vendorContract() {
  const c = V.detail.contract;
  const id = E(V.detail.agency._id);
  const canEdit = isMoneyAdmin();
  const day = d => (d ? String(d).slice(0, 10) : '');
  return `
    <div class="detail-grid">
      <div class="detail-card">
        <h3>Agreement</h3>
        <p><span class="badge ${CONTRACT_BADGE[c.status]}">${E(label(c.status))}</span> ${c.version ? `<span class="badge badge-inactive">Version ${E(c.version)}</span>` : ''}</p>
        ${c.status === 'expired' ? '<p class="detail-note">This agreement ran past its end date. Renew it or mark it terminated.</p>' : ''}
        <dl class="complaint-facts" style="margin-top: 12px;">
          <div><dt>Starts</dt><dd>${c.startDate ? E(fmtDate(c.startDate)) : '—'}</dd></div>
          <div><dt>Ends</dt><dd>${c.endDate ? E(fmtDate(c.endDate)) : '—'}${c.daysLeft != null && c.daysLeft >= 0 ? ` (${c.daysLeft} days left)` : ''}</dd></div>
          <div><dt>Agreed commission</dt><dd>${c.agreedCommission == null ? '—' : pct(c.agreedCommission)}</dd></div>
          <div><dt>Signed by</dt><dd>${c.signedBy ? `${E(c.signedBy)}${c.signedAt ? ` on ${E(fmtDate(c.signedAt))}` : ''}` : '—'}</dd></div>
        </dl>
        ${c.terms ? `<p class="complaint-text">${E(c.terms)}</p>` : ''}
        ${c.hasDocument ? `<a class="btn btn-secondary" href="/api/v1/admin/vendors/${id}/contract/document" target="_blank" rel="noopener">View signed document (${E(c.documentName)})</a>` : '<p class="detail-muted">No document uploaded.</p>'}
      </div>
      ${canEdit ? `<form class="detail-card" onsubmit="saveVendorContract(event)" novalidate>
        <h3>Update the agreement</h3>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="ctStatus">Status</label>
            <select id="ctStatus" class="form-select">${['none', 'draft', 'sent', 'signed', 'terminated'].map(s => `<option value="${s}" ${c.storedStatus === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label" for="ctVersion">Version</label><input id="ctVersion" class="form-input" value="${E(c.version)}" maxlength="20" placeholder="v1.0"></div>
        </div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="ctStart">Start date</label><input id="ctStart" class="form-input" type="date" value="${E(day(c.startDate))}"></div>
          <div class="form-group"><label class="form-label" for="ctEnd">End date</label><input id="ctEnd" class="form-input" type="date" value="${E(day(c.endDate))}"></div>
        </div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="ctRate">Agreed commission (%)</label><input id="ctRate" class="form-input" type="number" min="0" max="100" step="0.1" value="${c.agreedCommission == null ? '' : c.agreedCommission}"></div>
          <div class="form-group"><label class="form-label" for="ctSigned">Signed by (required when signed)</label><input id="ctSigned" class="form-input" value="${E(c.signedBy)}" maxlength="100"></div>
        </div>
        <div class="form-group"><label class="form-label" for="ctTerms">Key terms</label><textarea id="ctTerms" class="form-input" rows="3" maxlength="4000">${E(c.terms)}</textarea></div>
        <div class="form-group"><label class="form-label" for="ctFile">Signed document (PDF or photo, up to 5 MB)</label><input id="ctFile" type="file" class="form-input" accept="application/pdf,image/jpeg,image/png,image/webp">
          ${c.hasDocument ? '<label class="check" style="margin-top: 8px;"><input type="checkbox" id="ctRemove"> Remove the current document</label>' : ''}</div>
        <div class="form-note-box is-error" id="ctError" role="alert" hidden></div>
        <button type="submit" class="btn btn-primary" id="ctSave">Save agreement</button>
      </form>` : '<div class="detail-card"><p class="detail-muted">Only administrators can change contracts.</p></div>'}
    </div>`;
}

async function saveVendorContract(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('status', val('ctStatus'));
  fd.append('version', val('ctVersion').trim());
  fd.append('startDate', val('ctStart'));
  fd.append('endDate', val('ctEnd'));
  fd.append('agreedCommission', val('ctRate'));
  fd.append('signedBy', val('ctSigned').trim());
  fd.append('terms', val('ctTerms'));
  const file = document.getElementById('ctFile').files[0];
  if (file) fd.append('document', file);
  if (document.getElementById('ctRemove')?.checked) fd.append('removeDocument', 'true');
  if (val('ctStatus') === 'signed' && !val('ctSigned').trim()) return showFormNote('ctError', 'Add the name of the person who signed for the agency.', true);
  const btn = document.getElementById('ctSave');
  btn.disabled = true;
  try {
    const { ok, data } = await adminForm(`/api/v1/admin/vendors/${V.detail.agency._id}/contract`, 'PUT', fd);
    if (!ok) return showFormNote('ctError', data.message || 'Could not save the agreement.', true);
    showAdminToast('Agreement saved.', 'success');
    reloadVendor();
  } catch (x) {
    showFormNote('ctError', 'Could not reach the server.', true);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Team ----------

function vendorTeam() {
  const aid = E(V.detail.agency._id);
  return `<div class="table-container"><table class="admin-table lead-table">
    <thead><tr><th>Person</th><th>Role</th><th>Status</th><th style="text-align: right;">Actions</th></tr></thead>
    <tbody>${V.detail.members.map(m => `<tr>
      <td><span class="lead-main">${E(m.name)}</span><span class="lead-sub">${E(m.email)}</span></td>
      <td>${m.agencyRole === 'owner' ? 'Owner' : 'Team member'}</td>
      <td>${memberSignInBadge(m)}</td>
      <td style="text-align: right;"><div class="lead-actions" style="justify-content: flex-end;">
        ${isMoneyAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="openVendorPasswordModal('${E(m.id)}')">${m.accountStatus === 'invited' || m.mustChangePassword ? 'Set password' : 'Change password'}</button>` : ''}
        ${m.accountStatus === 'invited' ? `<button class="btn btn-secondary btn-sm" onclick="resendMemberInvite('${aid}', '${E(m.id)}')">Resend invite</button>` : `<button class="btn btn-secondary btn-sm" onclick="openUser('${E(m.id)}')">Open account</button>`}
      </div></td></tr>`).join('')}</tbody></table></div>
    <div id="memberInviteResult"></div>`;
}

function memberSignInBadge(m) {
  if (m.accountStatus === 'invited') return '<span class="badge badge-manager">Invite not accepted</span>';
  if (m.mustChangePassword) return `<span class="badge badge-manager">Hasn't signed in yet</span><span class="lead-sub">${m.credentialsSentAt ? `Details emailed ${E(fmtDate(m.credentialsSentAt))}` : 'Using a password set by Plejar'}</span>`;
  return `<span class="badge badge-active">Active</span><span class="lead-sub">${m.lastLoginAt ? `Last sign-in ${E(fmtDate(m.lastLoginAt))}` : 'Hasn\'t signed in yet'}</span>`;
}

// ---------- Vendor passwords (administrators only) ----------

// agencyId and member come from the open vendor profile, or are passed in from the application page
function openVendorPasswordModal(userId, from, { sending = false } = {}) {
  const source = from || { agencyId: V.detail.agency._id, agencyName: V.detail.agency.name, member: V.detail.members.find(x => String(x.id) === String(userId)) };
  if (!source.member) return;
  document.getElementById('vpMemberGroup').hidden = !sending;
  document.getElementById('vpSend').checked = sending;
  document.getElementById('vpSubmit').textContent = sending ? 'Send login details' : 'Set password';
  V.passwordTarget = { agencyId: source.agencyId, userId: source.member.id || source.member._id, name: source.member.name, onDone: source.onDone };
  document.getElementById('vpTitle').textContent = sending
    ? `Send login details for ${source.agencyName}`
    : `${source.member.accountStatus === 'invited' || source.member.mustChangePassword ? 'Set' : 'Change'} password for ${source.member.name}`;
  document.getElementById('vpLead').textContent = sending
    ? 'Passwords are stored scrambled, so Plejar can\'t look one up. Sending login details sets a new password and emails it with the vendor ID, sign-in email and the vendor panel link.'
    : `${source.member.name} (${source.member.email}) signs in to the ${source.agencyName} vendor panel with this password. Any device they're signed in on will be signed out.`;
  const keepSend = document.getElementById('vpSend').checked;
  document.getElementById('vendorPasswordForm').reset();
  document.getElementById('vpSend').checked = keepSend;
  document.getElementById('vendorPasswordForm').hidden = false;
  document.getElementById('vpResult').hidden = true;
  document.getElementById('vpPassword').type = 'password';
  formError('vpError');
  syncVendorPasswordForm();
  openModal('vendorPasswordModal');
}

function syncVendorPasswordForm() {
  const typed = document.querySelector('input[name="vpMode"]:checked').value === 'type';
  document.getElementById('vpTyped').hidden = !typed;
  if (typed) document.getElementById('vpPassword').focus();
}

function toggleVendorPasswordVisibility(btn) {
  const show = document.getElementById('vpPassword').type === 'password';
  ['vpPassword', 'vpConfirm'].forEach(id => { document.getElementById(id).type = show ? 'text' : 'password'; });
  btn.textContent = show ? 'Hide' : 'Show';
}

// "Send login details" from the profile header: choose who gets them (the owner by default)
function openSendLoginDetails() {
  const members = V.detail.members;
  const owner = members.find(m => m.agencyRole === 'owner') || members[0];
  if (!owner) return showAdminToast('This vendor has no team members yet.', 'error');
  document.getElementById('vpMember').innerHTML = members.map(m => `<option value="${E(m.id)}">${E(m.name)} (${m.agencyRole === 'owner' ? 'owner' : 'team member'}), ${E(m.email)}</option>`).join('');
  document.getElementById('vpMember').value = owner.id;
  openVendorPasswordModal(owner.id, null, { sending: true });
}

function pickVendorPasswordMember() {
  const m = V.detail.members.find(x => String(x.id) === val('vpMember'));
  if (m) V.passwordTarget = { ...V.passwordTarget, userId: m.id, name: m.name };
}

async function submitVendorPassword(e) {
  e.preventDefault();
  const t = V.passwordTarget;
  const generate = document.querySelector('input[name="vpMode"]:checked').value === 'generate';
  const body = { generate, requireChange: document.getElementById('vpRequireChange').checked, send: document.getElementById('vpSend').checked };
  if (!generate) {
    body.password = val('vpPassword');
    body.confirmPassword = val('vpConfirm');
    if (body.password.length < 8) return formError('vpError', 'Use at least 8 characters.');
    if (body.password !== body.confirmPassword) return formError('vpError', "The two passwords don't match.");
  }
  const btn = document.getElementById('vpSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${t.agencyId}/members/${t.userId}/password`, { method: 'PUT', body: JSON.stringify(body) });
    if (!ok) return formError('vpError', data.message || 'Could not set the password.');
    document.getElementById('vendorPasswordForm').hidden = true;
    const result = document.getElementById('vpResult');
    result.hidden = false;
    result.innerHTML = `
      <div class="callout ${data.data.emailSent === true ? 'callout-ok' : (data.data.emailSent === false ? 'callout-warn' : '')}"><div>${E(data.message)}${data.data.emailSent === null ? ' Send them the details below.' : ''}</div></div>
      ${credentialsBox(data.data.credentials)}
      <div style="display:flex; gap:8px; margin-top: 16px;"><button class="btn btn-secondary" onclick="closeModal('vendorPasswordModal')">Done</button></div>`;
    if (t.onDone) t.onDone();
    else reloadVendor();
  } catch (err) {
    formError('vpError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Reports emailed to the vendor ----------

const dhakaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const reportKind = () => document.querySelector('input[name="vrKind"]:checked').value;

function openVendorReportModal() {
  const today = dhakaToday();
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() - 86400000));
  const [y, m] = today.split('-').map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  document.getElementById('vrTitle').textContent = `Report for ${V.detail.agency.name}`;
  document.querySelector('input[name="vrKind"][value="daily"]').checked = true;
  Object.assign(document.getElementById('vrDay'), { value: yesterday, max: today });
  Object.assign(document.getElementById('vrMonth'), { value: lastMonth, max: today.slice(0, 7) });
  const agencyEmail = V.detail.agency.email;
  document.getElementById('vrAgencyEmailRow').hidden = !agencyEmail;
  document.getElementById('vrAgencyEmailText').textContent = `Also send to the agency's public email (${agencyEmail || ''})`;
  document.getElementById('vrAgencyEmail').checked = false;
  document.getElementById('vrResult').innerHTML = '';
  formError('vrError');
  syncReportForm();
  openModal('vendorReportModal');
}

function syncReportForm() {
  const daily = reportKind() === 'daily';
  document.getElementById('vrDayGroup').hidden = !daily;
  document.getElementById('vrMonthGroup').hidden = daily;
  previewVendorReport();
}

const reportQuery = () => (reportKind() === 'daily'
  ? { period: 'daily', date: val('vrDay') }
  : { period: 'monthly', month: val('vrMonth') });

function reportTable(r) {
  const row = (k, v) => `<div class="kv-row"><dt>${E(k)}</dt><dd>${v}</dd></div>`;
  return `
    <h4 class="report-title">${E(r.period.label)}</h4>
    <div class="report-cols">
      <dl class="kv">
        ${row('New registrations', `${r.registrations.new} (${r.registrations.travelers} travelers)`)}
        ${row('Value of new registrations', takaFmt(r.registrations.value))}
        ${row('Cancelled', r.registrations.cancelled)}
        ${row('Trips completed', `${r.trips.completed} (${r.trips.travelers} travelers)`)}
        ${row('New reviews', `${r.reviews.count}${r.reviews.average ? `, average ${r.reviews.average} of 5` : ''}`)}
      </dl>
      <dl class="kv">
        ${row('Payments received', takaFmt(r.money.paid))}
        ${row('Plejar commission', takaFmt(r.money.commission))}
        ${row('Vendor earnings', takaFmt(r.money.earned))}
        ${row('Payouts sent', takaFmt(r.money.payoutsPaid))}
        ${row('Available now', takaFmt(r.money.available))}
      </dl>
    </div>
    <p class="detail-muted" style="margin:10px 0 4px">Coming up in the next 30 days</p>
    ${r.upcoming.length ? `<ul class="plan-ul">${r.upcoming.map(e => `<li>${E(e.title)}, ${E(fmtDate(e.startDate))}: ${e.seatsTaken}${e.seats ? ` of ${e.seats}` : ''} seats taken</li>`).join('')}</ul>` : '<p class="detail-muted">No published tour events.</p>'}`;
}

async function previewVendorReport() {
  const box = document.getElementById('vrPreview');
  formError('vrError');
  if ((reportKind() === 'daily' && !val('vrDay')) || (reportKind() === 'monthly' && !val('vrMonth'))) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="detail-muted">Loading preview...</p>';
  const q = new URLSearchParams({ ...reportQuery(), alsoToAgencyEmail: document.getElementById('vrAgencyEmail').checked });
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/report?${q}`);
  if (!ok) { box.innerHTML = ''; return formError('vrError', data.message || 'Could not build the report.'); }
  const { report, recipients, schedule } = data.data;
  box.innerHTML = reportTable(report);
  document.getElementById('vrRecipients').textContent = recipients.length
    ? `Goes to ${recipients.map(r => `${r.name} (${r.email})`).join(' and ')}.`
    : 'This vendor has no owner email, so the report can\'t be sent.';
  document.getElementById('vrSend').disabled = !recipients.length;
  document.getElementById('vrSchedule').value = schedule.schedule || 'off';
  const parts = [];
  if (schedule.lastSentAt) parts.push(`Last sent automatically ${fmtDateTime(schedule.lastSentAt)}.`);
  if (schedule.lastError) parts.push(`Last automatic send failed: ${schedule.lastError}`);
  document.getElementById('vrScheduleStatus').textContent = parts.join(' ') || (schedule.schedule && schedule.schedule !== 'off' ? 'Nothing sent automatically yet.' : '');
}

async function sendVendorReport() {
  const btn = document.getElementById('vrSend');
  btn.disabled = true;
  formError('vrError');
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/report`, {
      method: 'POST',
      body: JSON.stringify({ ...reportQuery(), alsoToAgencyEmail: document.getElementById('vrAgencyEmail').checked })
    });
    const box = document.getElementById('vrResult');
    if (ok) {
      box.innerHTML = `<div class="callout callout-ok"><div>${E(data.message)}</div></div>`;
      showAdminToast('Report sent.', 'success');
    } else if (data.data && data.data.text) {
      const owner = V.detail.members.find(m => m.agencyRole === 'owner');
      const subject = `${V.detail.agency.name}: report for ${data.data.report.period.label}`;
      const mailto = `mailto:${encodeURIComponent(owner ? owner.email : '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(data.data.text)}`;
      box.innerHTML = `<div class="callout callout-warn"><div>${E(data.message)}</div></div>
        <textarea class="form-input" id="vrText" rows="8" readonly>${E(data.data.text)}</textarea>
        <div class="lead-actions" style="margin-top:8px"><a class="btn btn-primary btn-sm" href="${E(mailto)}">Open in my email app</a>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('vrText').value).then(() => showAdminToast('Report copied.', 'success'))">Copy report</button></div>`;
    } else {
      formError('vrError', data.message || 'Could not send the report.');
    }
  } finally {
    btn.disabled = false;
  }
}

async function saveReportSchedule() {
  const { ok, data } = await adminFetch(`/api/v1/admin/vendors/${V.detail.agency._id}/report-schedule`, {
    method: 'PUT',
    body: JSON.stringify({ schedule: val('vrSchedule'), alsoToAgencyEmail: document.getElementById('vrAgencyEmail').checked })
  });
  if (!ok) return showAdminToast(data.message || 'Could not save.', 'error');
  document.getElementById('vrScheduleStatus').textContent = data.message;
  showAdminToast('Report schedule saved.', 'success');
}

// ---------- Activity ----------

async function loadVendorActivityTab(page) {
  const body = document.getElementById('vendorTabBody');
  const { ok, data } = await adminFetch(`/api/v1/admin/activity?${queryString({ agency: V.detail.agency._id, page, limit: 20 })}`);
  if (!ok) { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(data.message)}</p>`; return; }
  body.innerHTML = data.data.entries.length ? `<div class="table-container"><table class="admin-table">
    <thead><tr><th>Time</th><th>What happened</th><th>By</th></tr></thead><tbody>${activityRows(data.data.entries, false)}</tbody></table></div>
    <div class="pager" id="vendorTabActivityPager"></div>` : '<p class="empty-note">No activity recorded for this vendor yet.</p>';
  renderPager('vendorTabActivityPager', data.data, 'loadVendorActivityTab');
}
