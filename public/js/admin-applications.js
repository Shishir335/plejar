/**
 * Plejar admin: membership applications (Vendors > Applications, and the application page)
 * Depends on admin.js (adminFetch, switchTab, showAdminToast, openModal, closeModal, leadLink, inviteLinkBox)
 * and admin-users.js (E, fmtDate, fmtDateTime, label, val, tableMessage, renderPager, makeDebounce, askReason, formError).
 */

const APPLICATION_LABELS = {
  new: 'New', reviewing: 'Reviewing', needs_info: 'Waiting on applicant', approved: 'Accepted',
  rejected: 'Rejected', contacted: 'Contacted', archived: 'Archived'
};
const APPLICATION_BADGES = {
  new: 'badge-manager', reviewing: 'badge-user', needs_info: 'badge-agent', approved: 'badge-active',
  rejected: 'badge-admin', contacted: 'badge-user', archived: 'badge-inactive'
};
const APPLICATION_DOCS = { trade_license: 'Trade license', nid: "Owner's national ID", tourism_license: 'Tourism license / TOAB', insurance: 'Proof of insurance', tax_id: 'Tax ID or business number', other: 'Other' };
const TEAM_LABELS = { 1: 'Just the owner', '2-5': '2 to 5 people', '6-15': '6 to 15 people', '16+': '16 or more' };

const AP = { status: 'attention', page: 1, detail: null };

const isDecided = app => app.status === 'approved' || app.status === 'rejected';

// ---------- List ----------

async function loadApplicationSummary() {
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/applications/summary?kind=${V.kind}`);
    if (!ok) return null;
    const { counts, attention } = data.data;
    const chips = [
      ['attention', 'Need a look', attention], ['open', 'All open', counts.open], ['needs_info', 'Waiting on applicant', counts.needs_info],
      ['approved', 'Accepted', counts.approved], ['rejected', 'Rejected', counts.rejected], ['archived', 'Archived', counts.archived], ['all', 'Everything', counts.all]
    ];
    const box = document.getElementById('applicationChips');
    if (box) {
      box.innerHTML = chips.map(([key, text, n]) => `<button type="button" class="chip ${AP.status === key ? 'chip-active' : ''}" aria-pressed="${AP.status === key}" onclick="setApplicationFilter('${key}')"><strong>${n}</strong> ${E(text)}</button>`).join('');
    }
    const badge = document.getElementById('vsubLeadCount');
    if (badge) { badge.textContent = attention; badge.hidden = !attention; }
    return data.data;
  } catch (e) {
    return null; // counts are informational
  }
}

function setApplicationFilter(key) {
  AP.status = key;
  loadApplications(1);
}

async function loadApplications(page = AP.page) {
  AP.page = page;
  loadApplicationSummary();
  tableMessage('applicationsTableBody', 7, 'Loading applications...');
  const params = new URLSearchParams({ page, limit: 20, kind: V.kind });
  if (AP.status !== 'all') params.set('status', AP.status);
  if (val('apSearch').trim()) params.set('search', val('apSearch').trim());
  if (val('apSort')) params.set('sort', val('apSort'));

  const { ok, data } = await adminFetch(`/api/v1/admin/applications?${params}`);
  if (!ok) return tableMessage('applicationsTableBody', 7, data.message || 'Could not load applications.', 'var(--color-danger)');
  const rows = data.data.applications;
  if (!rows.length) {
    const empty = AP.status === 'attention'
      ? 'Nothing needs a look right now. New applications and replies from applicants show up here.'
      : 'No applications match. Agencies apply on the website at /apply.';
    tableMessage('applicationsTableBody', 7, empty);
  } else {
    document.getElementById('applicationsTableBody').innerHTML = rows.map(r => `
      <tr class="row-link" onclick="openApplication('${E(r._id)}')">
        <td><span class="lead-main">${E(r.agencyName)}${r.vendorType === 'hotel' ? ' <span class="tag">Hotel</span>' : ''}</span><span class="lead-sub">${r.reference ? E(r.reference) : 'From the old contact form'}${r.source === 'app' ? ' · from the app' : ''}</span></td>
        <td><span class="lead-main">${E(r.contactName)}</span><span class="lead-sub">${E(r.phone)}</span></td>
        <td><span class="lead-sub" style="margin-top:0">${E([r.district, r.regions].filter(Boolean).join(': ')) || '—'}</span></td>
        <td>${r.documentCount
          ? `${r.documentCount} file${r.documentCount === 1 ? '' : 's'}${r.hasRequiredDocuments ? '' : `<span class="lead-sub" style="color:var(--color-danger)">${r.source === 'app' ? 'License, insurance or tax ID missing' : 'License or NID missing'}</span>`}`
          : '<span class="lead-sub" style="margin-top:0">None</span>'}</td>
        <td style="white-space: nowrap; color: var(--text-muted);">${E(fmtDate(r.createdAt))}</td>
        <td><span class="badge ${APPLICATION_BADGES[r.status]}">${E(APPLICATION_LABELS[r.status])}</span>${r.unreadReply ? '<span class="lead-sub" style="color: var(--color-warning, #b7791f); font-weight: 600;">New reply</span>' : ''}</td>
        <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openApplication('${E(r._id)}')">${isDecided(r) ? 'Open' : 'Review'}</button></td>
      </tr>`).join('');
  }
  renderPager('applicationsPager', data.data, 'loadApplications');
}

const debouncedApplications = makeDebounce(() => loadApplications(1));
document.getElementById('apSearch')?.addEventListener('input', debouncedApplications);

// ---------- Application page ----------

async function openApplication(id) {
  try {
    const route = `#applications/${id}`;
    history.replaceState(null, '', route);
    sessionStorage.setItem('plezar_admin_tab', route);
  } catch (_) {}
  switchTab('applicationDetail', false);
  const box = document.getElementById('applicationDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading application...</p>';
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/applications/${id}`);
    if (!ok) {
      box.innerHTML = `<p style="color: var(--color-danger); padding: 24px;">${E(data.message || 'Could not load this application.')}</p>`;
      return;
    }
    AP.detail = data.data;
    // Light up Travel agents or Hotels in the sidebar, whichever this application is for
    setVendorKind(AP.detail.application.vendorType === 'hotel' ? 'hotel' : 'agency');
    switchTab('applicationDetail', false);
    renderApplication();
    loadApplicationSummary();
    loadVendorSummary();
  } catch (e) {
    box.innerHTML = '<p style="color: var(--color-danger); padding: 24px;">Failed to load this application.</p>';
  }
}

const reloadApplication = () => AP.detail && openApplication(AP.detail.application._id);

function backToApplications() {
  switchTab('vendors');
  switchVendorSub('applications');
}

function appRow(name, value) {
  return `<div class="kv-row"><dt>${E(name)}</dt><dd>${value || '<span class="detail-muted">—</span>'}</dd></div>`;
}

// What a reviewer should know before deciding
function applicationChecks(app, checks) {
  const notes = [];
  const has = kind => app.documents.some(d => d.kind === kind);
  if (!has('trade_license')) notes.push(['warn', 'No trade license file. Ask for it before accepting.']);
  if (app.source === 'app') {
    if (!has('insurance')) notes.push(['warn', 'No proof of insurance. Ask for it before accepting.']);
    if (!has('tax_id')) notes.push(['warn', 'No tax ID document. Ask for it before accepting.']);
  } else if (!has('nid')) notes.push(['warn', "No owner's national ID. Ask for it before accepting."]);
  if (checks.account) {
    const roles = (checks.account.roles && checks.account.roles.length ? checks.account.roles : [checks.account.role]).map(r => ROLE_NAMES[r] || r).join(', ');
    if (checks.account.agency) notes.push(['error', `${app.email} already belongs to an agency (${checks.account.name}). Accepting needs a different email.`]);
    else if (app.applicant && String(app.applicant._id || app.applicant) === String(checks.account._id)) notes.push(['info', `${app.email} is the applicant's own Plejar account (${roles}). Accepting adds the vendor role to it; they sign in with their usual password.`]);
    else notes.push(['warn', `${app.email} already has a Plejar account (${checks.account.name}, ${roles}). Accepting adds the vendor role to that account; tick the box when you accept.`]);
  }
  if (checks.agencyWithLicense) notes.push(['error', `The vendor "${checks.agencyWithLicense.name}" already uses trade license ${app.tradeLicenseNumber}.`]);
  (checks.otherApplications || []).forEach(o => notes.push(['info', `Earlier application ${o.reference || ''} for "${o.agencyName}" (${APPLICATION_LABELS[o.status] || o.status}, ${fmtDate(o.createdAt)}) used the same email, phone or license.`]));
  if (!notes.length) notes.push(['ok', 'No problems found: the required documents are here, and the email, phone and license are not used anywhere else.']);
  const cls = { warn: 'callout-warn', error: 'callout-error', ok: 'callout-ok', info: '' };
  return notes.map(([kind, text]) => `<div class="callout ${cls[kind]}"><div>${E(text)}</div></div>`).join('');
}

const STAY_NAMES = { hotel: 'Hotel', resort: 'Resort', cottage: 'Cottage', guest_house: 'Guest house', homestay: 'Homestay', eco_resort: 'Eco resort', houseboat: 'Houseboat' };

// The draft listing an approved hotel got, opened in Hotels > Listings
async function openHotelListing(id) {
  closeModal('approveModal');
  const a = AP.detail.application;
  const search = document.getElementById('hSearch');
  if (search) search.value = (a.hotelListing && a.hotelListing.name) || a.agencyName || '';
  const status = document.getElementById('hStatusF');
  if (status) status.value = '';
  setVendorKind('hotel');
  showTabPane('vendors', 'hotels');
  switchVendorSub('listings');
  await loadHotels(1);
  if (C.hotels.some(h => h._id === id)) openHotel(id);
}

function renderApplication() {
  const { application: a, checks, statusURL, appOptions = {} } = AP.detail;
  const isHotel = a.vendorType === 'hotel';
  const h = a.hotel || {};
  const opt = (group, key) => ((appOptions[group] || {})[key]) || key || '';
  const biz = a.business || {};
  // Applications from the app's 3-step form carry business details too
  const appCard = a.source === 'app' ? `
      <div class="detail-card">
        <h3>Business details (from the app)</h3>
        <dl class="kv">
          ${appRow('Business type', E(opt('businessTypes', a.businessType)))}
          ${appRow('Address', E([a.officeAddress, a.city, a.stateProvince, a.postalCode, a.country].filter(Boolean).join(', ')))}
          ${appRow('Annual sales (USD)', E(opt('annualSales', biz.annualSales)))}
          ${appRow('Employees', E(opt('employees', biz.employees)))}
          ${appRow('Clients a year', E(opt('annualClients', biz.annualClients)))}
          ${appRow('Specializations', E((biz.specializations || []).map(k => opt('specializations', k)).join(', ')))}
          ${appRow('Partnerships', biz.partnerships ? `<span class="pre">${E(biz.partnerships)}</span>` : '')}
          ${appRow('Heard about us', E(opt('heardFrom', biz.heardFrom)))}
          ${appRow('Traveler account', a.applicant ? `${E(a.applicant.name)} (${E(a.applicant.email || a.applicant.phone || '')})` : '')}
        </dl>
      </div>` : '';
  const decided = isDecided(a);
  const categories = (a.categories || []).map(c => `<span class="tag">${E(c.name)}</span>`).join('');

  const actions = decided ? '' : `
    <button class="btn btn-primary" onclick="openApproveModal()">Accept</button>
    <button class="btn btn-secondary" onclick="requestApplicationInfo()">Ask for more</button>
    <button class="btn btn-danger" onclick="rejectApplication()">Reject</button>`;

  let outcome = '';
  if (a.status === 'approved') {
    const owner = AP.detail.owner;
    const signIn = !owner ? 'The owner account no longer exists.'
      : owner.mustChangePassword || owner.accountStatus === 'invited'
        ? `${owner.name} hasn't signed in yet. Send them the sign-in details if you haven't.`
        : owner.lastLoginAt
          ? `${owner.name} has signed in (last sign-in ${fmtDateTime(owner.lastLoginAt)}).`
          : `${owner.name} hasn't signed in yet.`;
    outcome = `<div class="callout callout-ok"><div><strong>Accepted ${E(fmtDate(a.decidedAt))}${a.decidedBy ? ` by ${E(a.decidedBy.name)}` : ''}</strong>The ${isHotel ? 'hotel' : 'agency'} is now a vendor.${a.hotelListing && a.hotelListing.status === 'draft' ? ' Its listing is still a draft: add photos and a map position, then publish it.' : ''} ${E(signIn)}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${owner && isMoneyAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="openOwnerPassword()">${owner.mustChangePassword || owner.accountStatus === 'invited' ? 'Set password' : 'Change password'}</button>` : ''}
        ${a.agency ? `<button class="btn btn-secondary btn-sm" onclick="openVendor('${E(a.agency._id)}')">Open vendor</button>` : ''}
        ${a.hotelListing ? `<button class="btn btn-secondary btn-sm" onclick="openHotelListing('${E(a.hotelListing._id)}')">Open hotel listing (${E(a.hotelListing.status)})</button>` : ''}
      </div></div>`;
  } else if (a.status === 'rejected') {
    outcome = `<div class="callout callout-error"><div><strong>Rejected ${E(fmtDate(a.decidedAt))}${a.decidedBy ? ` by ${E(a.decidedBy.name)}` : ''}</strong>Reason given: ${E(a.rejectedReason)}</div></div>`;
  } else if (a.status === 'needs_info') {
    outcome = '<div class="callout callout-warn"><div><strong>Waiting on the applicant</strong>They were asked for more information and can reply on their application page.</div></div>';
  }

  const docs = a.documents.length ? a.documents.map(d => `
    <li><span>${E(APPLICATION_DOCS[d.kind] || d.kind)}<span class="lead-sub">${E(d.originalName || 'file')}, ${E(fmtDateTime(d.uploadedAt))}</span></span>
    <a class="btn btn-secondary btn-sm" href="/api/v1/admin/applications/${E(a._id)}/documents/${E(d._id)}" target="_blank" rel="noopener">View</a></li>`).join('')
    : '<li><span>No documents. This came from the old contact form.</span></li>';

  const thread = a.messages.length ? `<ul class="app-thread">${a.messages.map(m => `
    <li class="from-${m.from}"><div class="lead-sub" style="margin:0 0 4px">${E(m.from === 'admin' ? (m.byName || 'Plejar team') : `${a.contactName} (applicant)`)}, ${E(fmtDateTime(m.at))}</div><p>${E(m.text)}</p></li>`).join('')}</ul>`
    : '<p class="detail-muted">No messages yet. Use "Ask for more" to request something from the applicant; they reply on their application page.</p>';

  document.getElementById('applicationDetail').innerHTML = `
    <div class="profile-head">
      <button class="btn btn-secondary btn-sm" onclick="backToApplications()">&larr; Applications</button>
      <div class="profile-id">
        <span class="user-cell-avatar" style="width:56px;height:56px;font-size:22px">${E((a.agencyName || '?').charAt(0).toUpperCase())}</span>
        <div>
          <h2>${E(a.agencyName)}</h2>
          <p>${a.reference ? `${E(a.reference)}, ` : ''}received ${E(fmtDateTime(a.createdAt))}</p>
          <p class="profile-badges"><span class="badge ${APPLICATION_BADGES[a.status]}">${E(APPLICATION_LABELS[a.status])}</span>${isHotel ? ' <span class="tag">Hotel</span>' : ''}</p>
        </div>
      </div>
      <div class="profile-actions">${actions}</div>
    </div>

    ${outcome}

    <div class="detail-grid">
      <div class="detail-card">
        <h3>${isHotel ? 'Hotel' : 'Agency'}</h3>
        <dl class="kv">
          ${isHotel ? appRow('Kind of stay', E(STAY_NAMES[h.stayType] || h.stayType || '')) : ''}
          ${isHotel ? appRow('Lowest price a night', h.pricePerNight != null ? E(`৳${Number(h.pricePerNight).toLocaleString('en-US')}`) : '') : ''}
          ${isHotel ? appRow('Rooms', h.rooms ? E(String(h.rooms)) : '') : ''}
          ${isHotel ? appRow('Star rating', h.starRating ? E('★'.repeat(h.starRating)) : '') : ''}
          ${isHotel ? appRow('Check-in / out', E([h.checkIn, h.checkOut].filter(Boolean).join(' / '))) : ''}
          ${appRow('Trade license number', E(a.tradeLicenseNumber))}
          ${appRow('Started', a.yearStarted ? E(String(a.yearStarted)) : '')}
          ${appRow('Team size', E(TEAM_LABELS[a.teamSize] || ''))}
          ${appRow(isHotel ? 'Address' : 'Office', E([a.officeAddress, a.district].filter(Boolean).join(', ')))}
          ${isHotel ? '' : appRow('Tours in', E(a.regions))}
          ${isHotel ? '' : appRow('Kinds of tours', categories)}
          ${appRow('Facebook or website', leadLink(a.website))}
          ${appRow('About', a.about ? `<span class="pre">${E(a.about)}</span>` : '')}
        </dl>
      </div>

      <div class="detail-card">
        <h3>Applicant</h3>
        <dl class="kv">
          ${appRow('Name', E(a.contactName))}
          ${appRow('Role', E(a.contactRole))}
          ${appRow('Phone', `<a href="tel:${E(a.phone)}">${E(a.phone)}</a>`)}
          ${appRow('Email', `<a href="mailto:${E(a.email)}">${E(a.email)}</a>`)}
          ${appRow('Agreed to terms', a.agreedToTerms ? `Yes, ${E(fmtDateTime(a.agreedAt))}` : 'No (old contact form)')}
          ${appRow('Their note', a.message ? `<span class="pre">${E(a.message)}</span>` : '')}
        </dl>
        ${statusURL ? `<p class="detail-muted" style="margin-top:12px">The applicant follows this application at <a href="${E(statusURL)}" target="_blank" rel="noopener">their status page</a> (reference and email needed).</p>` : ''}
      </div>

      ${appCard}

      <div class="detail-card">
        <h3>Documents</h3>
        <ul class="detail-docs">${docs}</ul>
      </div>

      <div class="detail-card">
        <h3>Checks</h3>
        ${applicationChecks(a, checks)}
      </div>

      <div class="detail-card detail-wide">
        <h3>Messages with the applicant</h3>
        ${thread}
      </div>

      <div class="detail-card detail-wide">
        <h3>Team notes</h3>
        <p class="detail-muted">Only admins and managers see these.</p>
        <textarea id="apNote" class="form-input" rows="3" maxlength="2000" placeholder="For example: called the owner on 25 Oct, the office address checks out">${E(a.internalNote)}</textarea>
        <div class="profile-actions" style="margin-top: 10px;">
          <button class="btn btn-secondary" onclick="saveApplicationNote()">Save note</button>
          ${a.status === 'new' ? '<button class="btn btn-secondary" onclick="setApplicationStatus(\'reviewing\')">Mark as reviewing</button>' : ''}
          ${!decided && a.status !== 'archived' ? '<button class="btn btn-secondary" onclick="setApplicationStatus(\'archived\')">Archive without a decision</button>' : ''}
          ${a.status === 'archived' ? '<button class="btn btn-secondary" onclick="setApplicationStatus(\'reviewing\')">Reopen</button>' : ''}
          ${isMoneyAdmin() ? '<button class="btn btn-danger" onclick="deleteApplication()">Delete application</button>' : ''}
        </div>
      </div>
    </div>`;
}

async function updateApplication(body, done) {
  const { ok, data } = await adminFetch(`/api/v1/admin/applications/${AP.detail.application._id}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!ok) return showAdminToast(data.message || 'Could not save.', 'error');
  showAdminToast(done, 'success');
  reloadApplication();
}

const saveApplicationNote = () => updateApplication({ internalNote: val('apNote') }, 'Note saved.');
const setApplicationStatus = status => updateApplication({ status }, `Marked as ${APPLICATION_LABELS[status].toLowerCase()}.`);

// Shared by "ask for more" and "reject": both email the applicant
function applicationAction(path, field) {
  return async text => {
    const { ok, data } = await adminFetch(`/api/v1/admin/applications/${AP.detail.application._id}/${path}`, { method: 'POST', body: JSON.stringify({ [field]: text }) });
    if (!ok) throw new Error(data.message || 'Could not save.');
    showAdminToast(data.message, data.data.emailSent ? 'success' : 'info');
    reloadApplication();
    loadVendorSummary();
  };
}

function requestApplicationInfo() {
  askReason({
    title: 'Ask the applicant for more',
    lead: `${AP.detail.application.contactName} gets this by email and replies on their application page. Be specific about what is missing.`,
    label: 'What do you need?',
    confirmLabel: 'Send request',
    danger: false,
    maxLength: 2000,
    onSubmit: applicationAction('request-info', 'message')
  });
}

function rejectApplication() {
  askReason({
    title: `Reject ${AP.detail.application.agencyName}?`,
    lead: 'The applicant sees this reason in the email and on their application page. They can apply again later.',
    label: 'Reason',
    confirmLabel: 'Reject application',
    maxLength: 1000,
    onSubmit: applicationAction('reject', 'reason')
  });
}

async function deleteApplication() {
  const a = AP.detail.application;
  if (!confirm(`Delete the application from ${a.agencyName}, with its documents? This can't be undone.`)) return;
  const { ok, status, data } = await adminFetch(`/api/v1/admin/applications/${a._id}`, { method: 'DELETE' });
  if (!ok && status !== 204) return showAdminToast(data.message || 'Could not delete the application.', 'error');
  showAdminToast(`Deleted the application from ${a.agencyName}.`, 'info');
  backToApplications();
  loadVendorSummary();
}

// ---------- Accept ----------

async function openApproveModal() {
  const a = AP.detail.application;
  // Someone who already has a Plejar account becomes the owner with the login they have.
  // From the website nobody proved they own that email, so the admin confirms it's the same person.
  const acct = AP.detail.checks && AP.detail.checks.account;
  const isHotel = a.vendorType === 'hotel';
  // An account with this email becomes the owner, keeping its password (one tour agency and one hotel each)
  const roles = acct ? (acct.roles && acct.roles.length ? acct.roles : [acct.role]).map(r => ROLE_NAMES[r] || r).join(', ') : '';
  const accountNote = acct
    ? `<br>${E(acct.name || a.email)} already has a Plejar account (${E(roles)}). The ${isHotel ? 'hotel' : 'agency'} is added to that account and they sign in with their usual password.`
    : '<br>A new account with a temporary password is created.';
  document.getElementById('approveLead').innerHTML = `<strong>${E(a.agencyName)}</strong>${isHotel ? ' <span class="tag">Hotel</span>' : ''}<br>Owner: ${E(a.contactName)} (${E(a.email)})${accountNote}${isHotel ? '<br>A draft hotel listing is created from the application, for you to add photos to and publish.' : ''}`;
  AP.approveLabel = acct ? (isHotel ? 'Accept hotel' : 'Accept agency') : 'Accept and create account';
  document.getElementById('approveTitle').textContent = isHotel ? 'Accept this hotel' : 'Accept this agency';
  document.getElementById('apVerify').checked = true;
  document.getElementById('approveSubmit').textContent = AP.approveLabel;
  document.getElementById('approveSubmit').disabled = false;
  document.getElementById('approveForm').hidden = false;
  document.getElementById('approveResult').hidden = true;
  formError('approveError');

  const chosen = new Set((a.categories || []).map(c => c._id));
  const categories = (await ensureCategories()).filter(c => c.active || chosen.has(c._id));
  // Tour categories don't apply to a hotel
  document.getElementById('apCategoriesGroup').hidden = !categories.length || isHotel;
  document.getElementById('apCategories').innerHTML = categories.map(c => `
    <label class="check"><input type="checkbox" name="apCategory" value="${E(c._id)}" ${chosen.has(c._id) ? 'checked' : ''}> ${E(c.name)}</label>`).join('');
  openModal('approveModal');
}

async function submitApprove(e) {
  e.preventDefault();
  const btn = document.getElementById('approveSubmit');
  const categories = [...document.querySelectorAll('input[name="apCategory"]:checked')].map(box => box.value);
  btn.disabled = true;
  btn.textContent = 'Accepting...';
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/applications/${AP.detail.application._id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ verify: document.getElementById('apVerify').checked, categories, send: document.getElementById('apSend').checked })
    });
    if (!ok) return formError('approveError', data.message || 'Could not accept this application.');

    document.getElementById('approveForm').hidden = true;
    const result = document.getElementById('approveResult');
    result.hidden = false;
    result.innerHTML = `
      <div class="callout ${data.data.emailSent === true ? 'callout-ok' : (data.data.emailSent === false ? 'callout-warn' : '')}"><div>${E(data.message)}</div></div>
      ${credentialsBox(data.data.credentials)}
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button class="btn btn-primary" onclick="closeModal('approveModal'); openVendor('${E(data.data.agency._id)}')">Open vendor</button>
        ${data.data.hotel ? `<button class="btn btn-secondary" onclick="openHotelListing('${E(data.data.hotel._id)}')">Open hotel listing</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('approveModal'); reloadApplication();">Done</button>
      </div>`;
    loadVendorSummary();
    updateStats();
    // The new vendor shows up in vendor pickers, such as Change Account Roles
    if (typeof V !== 'undefined' && V.vendorOptions) V.vendorOptions = [];
  } catch (err) {
    formError('approveError', 'Could not reach the server.');
  } finally {
    btn.textContent = AP.approveLabel;
    btn.disabled = false;
  }
}

// ---------- Sign-in details for a new vendor ----------

// The temporary password, an email ready to copy, and a button that opens it in the admin's email app
function credentialsBox(c) {
  // An existing account keeps its own password, so there are no sign-in details to send
  if (!c) return '';
  const draft = c.emailDraft;
  const mailto = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return `
    <div class="cred-box">
      <dl class="kv">
        <div class="kv-row"><dt>Sign-in page</dt><dd>${E(c.loginURL)}</dd></div>
        ${c.vendorId ? `<div class="kv-row"><dt>Vendor ID</dt><dd>${E(c.vendorId)}</dd></div>` : ''}
        <div class="kv-row"><dt>Email</dt><dd>${E(c.email)}</dd></div>
        <div class="kv-row"><dt>${c.temporary === false ? 'Password' : 'Temporary password'}</dt><dd><code class="cred-pass">${E(c.password)}</code></dd></div>
      </dl>
      <label class="form-label" for="credDraft" style="margin-top: 12px;">Email to send</label>
      <textarea id="credDraft" class="form-input" rows="8" readonly>${E(`Subject: ${draft.subject}\n\n${draft.body}`)}</textarea>
      <div style="display:flex; gap:8px; flex-wrap: wrap; margin-top: 10px;">
        <a class="btn btn-primary btn-sm" href="${E(mailto)}">Open in my email app</a>
        <button type="button" class="btn btn-secondary btn-sm" onclick="copyCredentials()">Copy email text</button>
      </div>
      <p class="detail-muted" style="margin-top: 10px;">The password is shown only now.${c.temporary === false ? ' They can keep using it, or change it with "Forgot your password?".' : ' They choose their own the first time they sign in.'} Lost it before sending? Set a new one from the application or the vendor's Team tab.</p>
    </div>`;
}

function copyCredentials() {
  const text = document.getElementById('credDraft').value.replace(/^Subject: .*\n\n/, '');
  navigator.clipboard.writeText(text).then(() => showAdminToast('Email text copied.', 'success')).catch(() => showAdminToast('Select the text and copy it yourself.', 'info'));
}

// Set or change the owner's password from the application page (same dialog as the vendor's Team tab)
function openOwnerPassword() {
  const { application: a, owner } = AP.detail;
  openVendorPasswordModal(owner._id, {
    agencyId: a.agency._id,
    agencyName: a.agency.name,
    member: { ...owner, id: owner._id },
    onDone: reloadApplication
  });
}
