/**
 * Plejar admin - App content: vouchers travelers buy with points, the point rules,
 * the Help Center's questions and contact information, and the About / Privacy / Terms pages.
 * Depends on admin.js, admin-users.js (E, fmtDate, tableMessage, formError, val, askReason),
 * admin-vendors.js (adminForm) and admin-content.js (taka, dayInput).
 */

const R = { vouchers: [], categories: [], editingVoucher: null, articles: [], helpCategories: [], editingArticle: null, pages: [] };
const VOUCHER_BADGE = { live: 'badge-active', sold_out: 'badge-manager', ended: 'badge-inactive', off: 'badge-inactive' };
const VOUCHER_STATE = { live: 'live', sold_out: 'sold out', ended: 'ended', off: 'off' };

// ---------- Point rules ----------

async function loadRewardSettings() {
  const { ok, data } = await adminFetch('/api/v1/admin/rewards-settings');
  if (!ok) return;
  const s = data.data.settings;
  document.getElementById('rsPerTaka').value = s.pointsPerTaka;
  document.getElementById('rsReferral').value = s.referralReward;
  document.getElementById('rsWelcome').value = s.referralWelcomeBonus;
}

async function saveRewardSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('rewardSettingsSubmit');
  btn.disabled = true;
  const { ok, data } = await adminFetch('/api/v1/admin/rewards-settings', {
    method: 'PATCH',
    body: JSON.stringify({ pointsPerTaka: val('rsPerTaka'), referralReward: val('rsReferral'), referralWelcomeBonus: val('rsWelcome') })
  });
  btn.disabled = false;
  if (!ok) return showAdminToast(data.message || 'Could not save the point rules.', 'error');
  showAdminToast('Point rules saved.', 'success');
}

// ---------- Vouchers ----------

const voucherGives = v => {
  if (v.discount.type === 'free') return 'Free';
  if (v.discount.type === 'amount') return `${taka(v.discount.value)} off`;
  return `${v.discount.value}% off${v.discount.maxAmount ? `, up to ${taka(v.discount.maxAmount)}` : ''}`;
};

async function loadVouchers() {
  loadRewardSettings();
  tableMessage('vouchersTableBody', 7, 'Loading...');
  const category = val('vCategoryF');
  const { ok, data } = await adminFetch(`/api/v1/admin/vouchers${category ? `?category=${encodeURIComponent(category)}` : ''}`);
  if (!ok) return tableMessage('vouchersTableBody', 7, data.message || 'Could not load vouchers.', true);
  R.vouchers = data.data.vouchers;
  R.categories = data.data.categories;
  const filter = document.getElementById('vCategoryF');
  if (filter.options.length === 1) filter.innerHTML += R.categories.map(c => `<option value="${E(c.key)}">${E(c.label)}</option>`).join('');
  if (!R.vouchers.length) return tableMessage('vouchersTableBody', 7, 'No vouchers yet. Add one so travelers can spend their points.');
  document.getElementById('vouchersTableBody').innerHTML = R.vouchers.map(v => `
    <tr class="${v.state === 'live' ? '' : 'row-muted'}">
      <td><div style="display:flex; gap:10px; align-items:center;">
        ${v.image ? `<img src="${E(v.image)}" alt="" style="width:56px; height:40px; object-fit:cover; border-radius:6px;">` : ''}
        <div><strong>${E(v.title)}</strong><span class="lead-sub">${E(v.categoryLabel)}${v.code ? ` · ${E(v.code)}` : ''}${v.location ? ` · ${E(v.location)}` : ''}</span></div></div></td>
      <td>${E(voucherGives(v))}${v.minSpend ? `<span class="lead-sub">Min. ${taka(v.minSpend)}</span>` : ''}</td>
      <td>${new Intl.NumberFormat('en-US').format(v.pointsCost)}</td>
      <td style="white-space:nowrap;">${E(v.dates || 'Any time')}<span class="lead-sub">${v.validDays} days after redeeming</span></td>
      <td>${v.redeemedCount}${v.stock != null ? ` of ${v.stock}` : ''} / ${v.usedCount}${v.discountGiven ? `<span class="lead-sub">${taka(v.discountGiven)} off bookings</span>` : ''}</td>
      <td><span class="badge ${VOUCHER_BADGE[v.state]}">${E(VOUCHER_STATE[v.state])}</span></td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="openVoucher('${E(v._id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteVoucher('${E(v._id)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function showVoucherDiscount() {
  const type = val('vcDiscountType');
  document.querySelector('[data-vc-discount="value"]').hidden = type === 'free';
  document.querySelector('[data-vc-discount="max"]').hidden = type === 'amount';
  document.getElementById('vcDiscountValueLabel').textContent = type === 'amount' ? 'Taka off (৳)' : 'Percent off';
}

function openVoucher(id) {
  const v = id ? R.vouchers.find(x => x._id === id) : null;
  R.editingVoucher = v;
  document.getElementById('voucherForm').reset();
  formError('voucherError');
  document.getElementById('voucherModalTitle').textContent = v ? 'Edit voucher' : 'Add voucher';
  document.getElementById('vcCategory').innerHTML = R.categories.map(c => `<option value="${E(c.key)}">${E(c.label)}</option>`).join('');
  const set = (fid, value) => { document.getElementById(fid).value = value == null ? '' : value; };
  set('vcTitle', v && v.title);
  set('vcCategory', v ? v.category : 'hotel');
  set('vcDescription', v && v.description);
  set('vcDiscountType', v ? v.discount.type : 'percent');
  set('vcDiscountValue', v && v.discount.value);
  set('vcDiscountMax', v && v.discount.maxAmount);
  set('vcPoints', v && v.pointsCost);
  set('vcCode', v && v.code);
  set('vcLocation', v && v.location);
  set('vcFrom', v && dayInput(v.usableFrom));
  set('vcUntil', v && dayInput(v.usableUntil));
  set('vcValidDays', v ? v.validDays : 90);
  set('vcMinSpend', v && v.minSpend ? v.minSpend : '');
  set('vcStock', v && v.stock);
  set('vcPerUser', v ? v.perUserLimit : 1);
  set('vcTerms', v ? (v.terms || []).join('\n') : '');
  document.getElementById('vcActive').checked = v ? v.active : true;
  showVoucherDiscount();
  openModal('voucherModal');
}

async function saveVoucher(e) {
  e.preventDefault();
  if (!val('vcTitle').trim()) return formError('voucherError', 'Give the voucher a title.');
  if (val('vcPoints') === '') return formError('voucherError', 'Set how many points it costs.');
  const fd = new FormData();
  const add = (k, value) => fd.append(k, value == null ? '' : value);
  const type = val('vcDiscountType');
  add('title', val('vcTitle').trim());
  add('category', val('vcCategory'));
  add('description', val('vcDescription').trim());
  add('discountType', type);
  add('discountValue', type === 'free' ? 0 : val('vcDiscountValue'));
  add('discountMax', type === 'amount' ? '' : val('vcDiscountMax'));
  add('pointsCost', val('vcPoints'));
  add('code', val('vcCode').trim());
  add('locationLabel', val('vcLocation').trim());
  add('usableFrom', val('vcFrom'));
  add('usableUntil', val('vcUntil'));
  add('validDays', val('vcValidDays'));
  add('minSpend', val('vcMinSpend'));
  add('stock', val('vcStock'));
  add('perUserLimit', val('vcPerUser'));
  add('terms', val('vcTerms'));
  add('active', document.getElementById('vcActive').checked);
  const file = document.getElementById('vcImage').files[0];
  if (file) fd.append('image', file);
  const btn = document.getElementById('voucherSubmit');
  btn.disabled = true;
  const editing = R.editingVoucher;
  const { ok, data } = await adminForm(editing ? `/api/v1/admin/vouchers/${editing._id}` : '/api/v1/admin/vouchers', editing ? 'PATCH' : 'POST', fd);
  btn.disabled = false;
  if (!ok) return formError('voucherError', data.message || 'Could not save the voucher.');
  closeModal('voucherModal');
  showAdminToast(editing ? 'Voucher saved.' : 'Voucher added.', 'success');
  loadVouchers();
}

function deleteVoucher(id) {
  const v = R.vouchers.find(x => x._id === id);
  askReason({
    title: 'Delete this voucher',
    lead: `"${v ? v.title : 'This voucher'}" leaves the app. If travelers already redeemed it, it is switched off instead so their codes keep working. Type a short note to confirm.`,
    label: 'Note', confirmLabel: 'Delete voucher', maxLength: 200,
    onSubmit: async () => {
      const { ok, data } = await adminFetch(`/api/v1/admin/vouchers/${id}`, { method: 'DELETE' });
      if (!ok) throw new Error(data.message || 'Could not delete the voucher.');
      showAdminToast((data && data.message) || 'Voucher deleted.', 'info');
      loadVouchers();
    }
  });
}

// ---------- Help Center ----------

async function loadHelp() {
  tableMessage('helpTableBody', 6, 'Loading...');
  const { ok, data } = await adminFetch('/api/v1/admin/help/articles');
  if (!ok) return tableMessage('helpTableBody', 6, data.message || 'Could not load the Help Center.', true);
  R.articles = data.data.articles;
  R.helpCategories = data.data.categories;
  const c = data.data.contact;
  const set = (fid, value) => { document.getElementById(fid).value = value || ''; };
  set('hcEmail', c.email);
  set('hcEmailHours', c.emailHours);
  set('hcPhone', c.emergencyPhone);
  set('hcPhoneHours', c.emergencyHours);
  set('hcHq', c.headquarters);
  set('hcWhatsapp', c.whatsapp);
  set('hcPartnerEmail', c.partnerEmail);
  set('hcPartnerPhone', c.partnerPhone);
  const filter = document.getElementById('haCategoryF');
  if (filter.options.length === 1) filter.innerHTML += R.helpCategories.map(x => `<option value="${E(x.key)}">${E(x.label)}</option>`).join('');
  renderHelpArticles();
}

function renderHelpArticles() {
  const category = val('haCategoryF');
  const rows = R.articles.filter(a => !category || a.category === category);
  if (!rows.length) return tableMessage('helpTableBody', 6, 'No questions here yet. Add the ones travelers ask most.');
  const label = key => (R.helpCategories.find(c => c.key === key) || {}).label || key;
  document.getElementById('helpTableBody').innerHTML = rows.map(a => `
    <tr class="${a.published ? '' : 'row-muted'}">
      <td><strong>${E(a.question)}</strong><span class="lead-sub">${E(a.answer.slice(0, 120))}${a.answer.length > 120 ? '…' : ''}</span></td>
      <td>${E(label(a.category))}</td>
      <td>${Number(a.order) || 0}</td>
      <td style="white-space:nowrap;">👍 ${a.helpful.yes} · 👎 ${a.helpful.no}</td>
      <td><span class="badge ${a.published ? 'badge-active' : 'badge-inactive'}">${a.published ? 'published' : 'hidden'}</span></td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="openHelpArticle('${E(a._id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteHelpArticle('${E(a._id)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function openHelpArticle(id) {
  const a = id ? R.articles.find(x => x._id === id) : null;
  R.editingArticle = a;
  document.getElementById('helpForm').reset();
  formError('helpError');
  document.getElementById('helpModalTitle').textContent = a ? 'Edit question' : 'Add question';
  document.getElementById('haCategory').innerHTML = R.helpCategories.map(c => `<option value="${E(c.key)}">${E(c.label)}</option>`).join('');
  document.getElementById('haCategory').value = a ? a.category : (val('haCategoryF') || 'booking');
  document.getElementById('haOrder').value = a ? a.order : '';
  document.getElementById('haQuestion').value = a ? a.question : '';
  document.getElementById('haAnswer').value = a ? a.answer : '';
  document.getElementById('haPublished').checked = a ? a.published : true;
  openModal('helpModal');
}

async function saveHelpArticle(e) {
  e.preventDefault();
  if (!val('haQuestion').trim()) return formError('helpError', 'Write the question.');
  if (!val('haAnswer').trim()) return formError('helpError', 'Write the answer.');
  const btn = document.getElementById('helpSubmit');
  btn.disabled = true;
  const editing = R.editingArticle;
  const { ok, data } = await adminFetch(editing ? `/api/v1/admin/help/articles/${editing._id}` : '/api/v1/admin/help/articles', {
    method: editing ? 'PATCH' : 'POST',
    body: JSON.stringify({ category: val('haCategory'), order: val('haOrder'), question: val('haQuestion').trim(), answer: val('haAnswer').trim(), published: document.getElementById('haPublished').checked })
  });
  btn.disabled = false;
  if (!ok) return formError('helpError', data.message || 'Could not save the question.');
  closeModal('helpModal');
  showAdminToast(editing ? 'Question saved.' : 'Question added.', 'success');
  loadHelp();
}

function deleteHelpArticle(id) {
  const a = R.articles.find(x => x._id === id);
  askReason({
    title: 'Delete this question', lead: `"${a ? a.question : 'This question'}" disappears from the Help Center. Type a short note to confirm.`, label: 'Note', confirmLabel: 'Delete question', maxLength: 200,
    onSubmit: async () => {
      const { ok, data } = await adminFetch(`/api/v1/admin/help/articles/${id}`, { method: 'DELETE' });
      if (!ok) throw new Error(data.message || 'Could not delete the question.');
      showAdminToast('Question deleted.', 'info');
      loadHelp();
    }
  });
}

async function saveHelpContact(e) {
  e.preventDefault();
  const btn = document.getElementById('helpContactSubmit');
  btn.disabled = true;
  const { ok, data } = await adminFetch('/api/v1/admin/help/contact', {
    method: 'PATCH',
    body: JSON.stringify({ email: val('hcEmail').trim(), emailHours: val('hcEmailHours').trim(), emergencyPhone: val('hcPhone').trim(), emergencyHours: val('hcPhoneHours').trim(), headquarters: val('hcHq').trim(), whatsapp: val('hcWhatsapp').trim(), partnerEmail: val('hcPartnerEmail').trim(), partnerPhone: val('hcPartnerPhone').trim() })
  });
  btn.disabled = false;
  if (!ok) return showAdminToast(data.message || 'Could not save the contact information.', 'error');
  showAdminToast('Contact information saved.', 'success');
}

// ---------- About / Privacy / Terms ----------

async function loadPages() {
  const { ok, data } = await adminFetch('/api/v1/admin/pages');
  if (!ok) return formError('pageError', data.message || 'Could not load the pages.');
  R.pages = data.data.pages;
  showPage();
}

function showPage() {
  const p = R.pages.find(x => x.key === val('pgKey'));
  if (!p) return;
  formError('pageError');
  document.getElementById('pgTitle').value = p.title;
  document.getElementById('pgBody').value = p.body;
  document.getElementById('pgPublished').checked = p.published;
  document.getElementById('pgState').textContent = p.published
    ? `Published ${fmtDateTime(p.publishedAt)} (version ${p.version}).`
    : 'Not published yet: the app shows that this page is coming soon.';
}

async function savePage(e) {
  e.preventDefault();
  const published = document.getElementById('pgPublished').checked;
  if (published && !val('pgBody').trim()) return formError('pageError', 'Write the page before publishing it.');
  const btn = document.getElementById('pageSubmit');
  btn.disabled = true;
  const { ok, data } = await adminFetch(`/api/v1/admin/pages/${val('pgKey')}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: val('pgTitle').trim(), body: val('pgBody'), published })
  });
  btn.disabled = false;
  if (!ok) return formError('pageError', data.message || 'Could not save the page.');
  R.pages = R.pages.map(x => (x.key === data.data.page.key ? data.data.page : x));
  showPage();
  showAdminToast(data.message || 'Page saved.', 'success');
}
