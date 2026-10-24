/**
 * Plezar membership application (/apply) and application status (/apply/status)
 * Uses escapeHTML, showToast, serverText, BD_PHONE and EMAIL from app.js, and t() from i18n.js.
 */

const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_DOC_SIZE = 5 * 1024 * 1024;

const DISTRICTS = ['Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur', 'Chapai Nawabganj', 'Chattogram', 'Chuadanga', "Cox's Bazar", 'Cumilla', 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni', 'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore', 'Jhalokathi', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna', 'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura', 'Manikganj', 'Meherpur', 'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi', 'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali', 'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira', 'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon'];

const isStatusPage = location.pathname.replace(/\/+$/, '') === '/apply/status';

const fileSize = bytes => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Problems with a picked file, in the visitor's language (null when the file is fine)
function fileProblem(file) {
  if (!DOC_TYPES.includes(file.type)) return t('errFileType');
  if (file.size > MAX_DOC_SIZE) return t('errFileSize');
  return null;
}

function showFormError(boxId, message, field) {
  const box = document.getElementById(boxId);
  document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  if (field) {
    if (field.classList && (field.classList.contains('doc') || field.classList.contains('agree'))) {
      field.classList.add('is-invalid');
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }
  box.textContent = message;
  box.hidden = false;
}

function clearFormError(boxId) {
  const box = document.getElementById(boxId);
  if (box) box.hidden = true;
  document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

// ---------- Apply ----------

const picked = { trade_license: [], nid: [], tourism_license: [], other: [] };

function renderDoc(doc) {
  const kind = doc.dataset.kind;
  const max = Number(doc.dataset.max);
  doc.querySelector('.doc-files').innerHTML = picked[kind].map((file, i) => `
    <li><span class="name">${escapeHTML(file.name)}</span><span class="size">${fileSize(file.size)}</span>
    <button type="button" data-remove="${i}" aria-label="${escapeHTML(t('removeFile'))} ${escapeHTML(file.name)}">${escapeHTML(t('removeFile'))}</button></li>`).join('');
  doc.classList.toggle('has-files', picked[kind].length > 0);
  doc.classList.toggle('is-full', picked[kind].length >= max);
  if (picked[kind].length) doc.classList.remove('is-invalid');
}

function addFiles(doc, files) {
  const kind = doc.dataset.kind;
  const max = Number(doc.dataset.max);
  for (const file of files) {
    if (picked[kind].length >= max) break;
    const problem = fileProblem(file);
    if (problem) {
      showToast(`${file.name}: ${problem}`, 'error');
      continue;
    }
    picked[kind].push(file);
  }
  renderDoc(doc);
}

function setupDocs() {
  document.querySelectorAll('#applyForm .doc').forEach(doc => {
    const input = doc.querySelector('input[type="file"]');
    if (Number(doc.dataset.max) > 1) input.multiple = true;
    input.addEventListener('change', () => {
      addFiles(doc, input.files);
      input.value = '';
    });
    doc.addEventListener('click', e => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      picked[doc.dataset.kind].splice(Number(btn.dataset.remove), 1);
      renderDoc(doc);
    });
    ['dragenter', 'dragover'].forEach(type => doc.addEventListener(type, e => {
      e.preventDefault();
      doc.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach(type => doc.addEventListener(type, () => doc.classList.remove('is-dragover')));
    doc.addEventListener('drop', e => {
      e.preventDefault();
      addFiles(doc, e.dataTransfer.files);
    });
  });
}

// The member card fills in as the visitor types
function updateCard() {
  const form = document.getElementById('applyForm');
  const name = document.getElementById('mcName');
  const value = form.agencyName.value.trim();
  name.textContent = value || name.dataset.empty;
  name.classList.toggle('is-empty', !value);
  const place = [form.district.value.trim(), form.regions.value.trim()].filter(Boolean);
  document.getElementById('mcPlace').textContent = place.join(', ');
  const year = form.yearStarted.value.trim();
  document.getElementById('mcSince').textContent = /^\d{4}$/.test(year) ? year : '—';
}

async function loadCategories() {
  try {
    const res = await fetch('/api/v1/applications/categories');
    const data = await res.json();
    const categories = (data.data && data.data.categories) || [];
    if (!categories.length) return;
    document.getElementById('categoryPicks').innerHTML = categories.map(c => `
      <label class="chip-pick" title="${escapeHTML(c.description || '')}"><input type="checkbox" name="categories" value="${escapeHTML(c._id)}"><span>${escapeHTML(c.name)}</span></label>`).join('');
    document.getElementById('categoryField').hidden = false;
  } catch (e) {
    // Without categories the form still works; the field just stays hidden
  }
}

async function handleApply(e) {
  e.preventDefault();
  const form = e.target;
  const submit = document.getElementById('applySubmit');
  const get = name => form[name].value.trim();
  const phone = get('phone').replace(/[\s-]/g, '');
  const year = get('yearStarted');

  if (!get('agencyName')) return showFormError('applyError', t('errAgency'), form.agencyName);
  if (!get('tradeLicenseNumber')) return showFormError('applyError', t('errLicenseNo'), form.tradeLicenseNumber);
  if (year && !/^(19[5-9]\d|20\d\d)$/.test(year)) return showFormError('applyError', t('errYear'), form.yearStarted);
  if (!get('contactName')) return showFormError('applyError', t('errName'), form.contactName);
  if (!BD_PHONE.test(phone)) return showFormError('applyError', t('errPhone'), form.phone);
  if (!EMAIL.test(get('email'))) return showFormError('applyError', t('errEmail'), form.email);
  if (!picked.trade_license.length) return showFormError('applyError', t('errLicenseFile'), form.querySelector('[data-kind="trade_license"]'));
  if (!picked.nid.length) return showFormError('applyError', t('errNidFile'), form.querySelector('[data-kind="nid"]'));
  if (!form.agreedToTerms.checked) return showFormError('applyError', t('errAgree'), form.querySelector('.agree'));
  clearFormError('applyError');

  const body = new FormData();
  ['agencyName', 'tradeLicenseNumber', 'yearStarted', 'teamSize', 'district', 'officeAddress', 'regions', 'website', 'about', 'contactName', 'contactRole', 'email', 'message']
    .forEach(name => body.append(name, get(name)));
  body.append('phone', phone);
  body.append('agreedToTerms', 'true');
  form.querySelectorAll('input[name="categories"]:checked').forEach(box => body.append('categories', box.value));
  Object.entries(picked).forEach(([kind, files]) => files.forEach(file => body.append(kind, file, file.name)));

  submit.disabled = true;
  submit.textContent = t('sendingApplication');
  try {
    const res = await fetch('/api/v1/applications', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const key = res.status === 409 ? 'errDuplicate' : res.status === 429 ? 'errTooMany' : 'errApplyFailed';
      return showFormError('applyError', serverText(data, key));
    }
    showSent(data.data, get('email'));
  } catch (err) {
    showFormError('applyError', t('offline'));
  } finally {
    submit.disabled = false;
    submit.textContent = t('applySubmit');
  }
}

function showSent(result, email) {
  const view = document.getElementById('applyView');
  const card = document.getElementById('memberCard');
  document.getElementById('mcRef').textContent = result.reference;
  document.querySelector('#mcStamp span').textContent = t('stampSent');
  card.classList.add('is-sent');
  view.classList.add('is-done');

  document.getElementById('doneRef').textContent = result.reference;
  document.getElementById('doneApplyText').textContent = result.emailSent
    ? t('doneEmailed').replace('{email}', email)
    : t('doneNoEmail');
  document.getElementById('doneStatusLink').href = `/apply/status?ref=${encodeURIComponent(result.reference)}`;
  try { sessionStorage.setItem('plezar_apply_email', email); } catch (e) { /* storage blocked */ }

  const done = document.getElementById('applyDone');
  done.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  done.focus({ preventScroll: true });
}

function initApply() {
  document.getElementById('applyView').hidden = false;
  document.getElementById('districtList').innerHTML = DISTRICTS.map(d => `<option value="${escapeHTML(d)}">`).join('');
  const form = document.getElementById('applyForm');
  form.addEventListener('submit', handleApply);
  ['agencyName', 'district', 'regions', 'yearStarted'].forEach(name => form[name].addEventListener('input', updateCard));
  form.agreedToTerms.addEventListener('change', () => form.querySelector('.agree').classList.remove('is-invalid'));
  setupDocs();
  loadCategories();
  updateCard();
}

// ---------- Status ----------

const status = { reference: '', email: '', replyFiles: [] };

const fmtDate = value => (value ? new Date(value).toLocaleDateString(i18n.lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function timeline(app) {
  const s = app.status;
  const steps = [
    { cls: 'done', title: t('stepReceived'), note: fmtDate(app.submittedAt) },
    { cls: s === 'new' ? 'current' : 'done', title: t('stepReview'), note: s === 'new' ? t('stepReviewSoon') : '' }
  ];
  if (s === 'needs_info' || app.messages.length) {
    steps.push({ cls: s === 'needs_info' ? 'current' : 'done', title: t('stepInfo'), note: s === 'needs_info' ? t('stepInfoNow') : '' });
  }
  if (s === 'approved') steps.push({ cls: 'done', title: t('stepApproved'), note: fmtDate(app.decidedAt) });
  else if (s === 'rejected') steps.push({ cls: 'bad', title: t('stepRejected'), note: fmtDate(app.decidedAt) });
  else steps.push({ cls: '', title: t('stepDecision'), note: t('stepDecisionNote') });
  return `<ol class="timeline">${steps.map(step => `<li class="${step.cls}"><strong>${escapeHTML(step.title)}</strong>${step.note ? `<small>${escapeHTML(step.note)}</small>` : ''}</li>`).join('')}</ol>`;
}

function banner(app) {
  const s = app.status;
  if (s === 'approved') return `<div class="sr-banner is-good"><strong>${escapeHTML(t('bannerApproved'))}</strong>${escapeHTML(t('bannerApprovedText'))}</div>`;
  if (s === 'rejected') return `<div class="sr-banner is-bad"><strong>${escapeHTML(t('bannerRejected'))}</strong>${escapeHTML(app.rejectedReason || '')}<br>${escapeHTML(t('bannerRejectedText'))}</div>`;
  if (s === 'needs_info') return `<div class="sr-banner is-warn"><strong>${escapeHTML(t('bannerInfo'))}</strong>${escapeHTML(t('bannerInfoText'))}</div>`;
  if (s === 'archived') return `<div class="sr-banner"><strong>${escapeHTML(t('bannerClosed'))}</strong>${escapeHTML(t('bannerClosedText'))}</div>`;
  return `<div class="sr-banner"><strong>${escapeHTML(t('bannerReview'))}</strong>${escapeHTML(t('bannerReviewText'))}</div>`;
}

const DOC_LABEL_KEYS = { trade_license: 'kindLicense', nid: 'kindNid', tourism_license: 'kindTourism', other: 'kindOther' };

function renderStatus(app) {
  status.app = app;
  const box = document.getElementById('statusResult');
  const thread = app.messages.length ? `
    <div class="sr-section">
      <h3>${escapeHTML(t('threadTitle'))}</h3>
      <ul class="thread">${app.messages.map(m => `
        <li class="from-${m.from}"><div class="who">${escapeHTML(m.from === 'admin' ? t('fromTeam') : t('fromYou'))}, ${escapeHTML(fmtDate(m.at))}</div><p>${escapeHTML(m.text)}</p></li>`).join('')}
      </ul>
    </div>` : '';

  const reply = app.canReply ? `
    <form class="reply-form" id="replyForm" novalidate>
      <div class="field">
        <label for="replyText">${escapeHTML(t('replyLabel'))}</label>
        <textarea id="replyText" rows="4" maxlength="2000"></textarea>
      </div>
      <div class="reply-files">
        <div class="field" style="margin:0;flex:1 1 200px">
          <label for="replyKind" class="sr-only">${escapeHTML(t('replyKind'))}</label>
          <select id="replyKind">
            ${Object.entries(DOC_LABEL_KEYS).map(([kind, key]) => `<option value="${kind}">${escapeHTML(t(key))}</option>`).join('')}
          </select>
        </div>
        <label class="btn btn-outline doc-pick"><span>${escapeHTML(t('replyAddFile'))}</span><input type="file" id="replyFile" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>
        <ul class="doc-files" id="replyFileList"></ul>
      </div>
      <p class="form-error" id="replyError" role="alert" hidden></p>
      <button type="submit" class="btn btn-dark" id="replySubmit">${escapeHTML(t('replySubmit'))}</button>
    </form>` : '';

  box.innerHTML = `
    <div class="sr-head">
      <h2>${escapeHTML(app.agencyName)}</h2>
      <p>${escapeHTML(t('cardRefLower'))} ${escapeHTML(app.reference)}</p>
    </div>
    ${banner(app)}
    ${timeline(app)}
    ${thread}
    ${reply}
    <div class="sr-section">
      <h3>${escapeHTML(t('docsTitle'))}</h3>
      <ul class="sr-docs">${app.documents.map(d => `<li>${escapeHTML(t(DOC_LABEL_KEYS[d.kind] || 'kindOther'))}</li>`).join('') || `<li>${escapeHTML(t('noDocs'))}</li>`}</ul>
    </div>`;
  box.hidden = false;

  if (app.canReply) setupReply();
}

function renderReplyFiles() {
  document.getElementById('replyFileList').innerHTML = status.replyFiles.map((item, i) => `
    <li><span class="name">${escapeHTML(t(DOC_LABEL_KEYS[item.kind]))}: ${escapeHTML(item.file.name)}</span><span class="size">${fileSize(item.file.size)}</span>
    <button type="button" data-remove="${i}">${escapeHTML(t('removeFile'))}</button></li>`).join('');
}

function setupReply() {
  status.replyFiles = [];
  const input = document.getElementById('replyFile');
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) return showToast(`${file.name}: ${problem}`, 'error');
    if (status.replyFiles.length >= 4) return showToast(t('errTooManyFiles'), 'error');
    status.replyFiles.push({ kind: document.getElementById('replyKind').value, file });
    renderReplyFiles();
  });
  document.getElementById('replyFileList').addEventListener('click', e => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    status.replyFiles.splice(Number(btn.dataset.remove), 1);
    renderReplyFiles();
  });
  document.getElementById('replyForm').addEventListener('submit', handleReply);
}

async function handleReply(e) {
  e.preventDefault();
  const text = document.getElementById('replyText');
  const submit = document.getElementById('replySubmit');
  if (!text.value.trim() && !status.replyFiles.length) return showFormError('replyError', t('errReplyEmpty'), text);

  // The server takes at most two files of each kind (one licence, one tourism licence)
  const counts = {};
  for (const { kind } of status.replyFiles) {
    counts[kind] = (counts[kind] || 0) + 1;
    const limit = kind === 'nid' || kind === 'other' ? 2 : 1;
    if (counts[kind] > limit) return showFormError('replyError', t('errReplyKindLimit'));
  }
  clearFormError('replyError');

  const body = new FormData();
  body.append('reference', status.reference);
  body.append('email', status.email);
  body.append('message', text.value.trim());
  status.replyFiles.forEach(({ kind, file }) => body.append(kind, file, file.name));

  submit.disabled = true;
  submit.textContent = t('sending');
  try {
    const res = await fetch('/api/v1/applications/reply', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showFormError('replyError', serverText(data, res.status === 429 ? 'errTooMany' : 'errReplyFailed'));
    showToast(t('replySent'), 'success');
    renderStatus(data.data.application);
  } catch (err) {
    showFormError('replyError', t('offline'));
  } finally {
    if (document.body.contains(submit)) {
      submit.disabled = false;
      submit.textContent = t('replySubmit');
    }
  }
}

async function lookUp(reference, email) {
  const res = await fetch('/api/v1/applications/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, email })
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function handleStatus(e) {
  e.preventDefault();
  const form = e.target;
  const submit = form.querySelector('button[type="submit"]');
  const reference = form.reference.value.trim().toUpperCase();
  const email = form.email.value.trim();
  if (!/^PLZ-[A-Z0-9]{6}$/.test(reference)) return showFormError('statusError', t('errRef'), form.reference);
  if (!EMAIL.test(email)) return showFormError('statusError', t('errEmail'), form.email);
  clearFormError('statusError');

  submit.disabled = true;
  submit.textContent = t('looking');
  try {
    const { res, data } = await lookUp(reference, email);
    if (!res.ok) {
      document.getElementById('statusResult').hidden = true;
      return showFormError('statusError', serverText(data, res.status === 429 ? 'errTooMany' : 'errNotFound'));
    }
    status.reference = reference;
    status.email = email;
    try { sessionStorage.setItem('plezar_apply_email', email); } catch (err) { /* storage blocked */ }
    renderStatus(data.data.application);
    document.getElementById('statusResult').focus({ preventScroll: window.innerWidth > 1000 });
  } catch (err) {
    showFormError('statusError', t('offline'));
  } finally {
    submit.disabled = false;
    submit.textContent = t('statusSubmit');
  }
}

function initStatus() {
  document.getElementById('statusView').hidden = false;
  const title = 'Check your application — Plezar';
  document.body.dataset.titleKey = 'statusMetaTitle';
  if (i18n.original.has(document)) i18n.original.get(document).title = title;
  document.title = i18n.lang === 'bn' ? BN.statusMetaTitle : title;
  const nav = document.getElementById('navSwitch');
  nav.href = '/apply';
  nav.setAttribute('data-i18n', 'applyNavApply');
  nav.textContent = 'Apply for membership';
  i18n.original.delete(nav);
  if (i18n.lang === 'bn') applyLang('bn');

  const form = document.getElementById('statusForm');
  form.addEventListener('submit', handleStatus);
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) form.reference.value = ref.toUpperCase();
  try {
    const saved = sessionStorage.getItem('plezar_apply_email');
    if (saved) form.email.value = saved;
  } catch (e) { /* storage blocked */ }
  if (ref && form.email.value) form.requestSubmit();
  else (ref ? form.email : form.reference).focus();
}

// Re-draw the parts built in JavaScript when the visitor switches language
document.addEventListener('langchange', () => {
  if (isStatusPage) {
    if (status.app && !document.getElementById('statusResult').hidden) renderStatus(status.app);
  } else {
    updateCard();
    document.querySelectorAll('#applyForm .doc').forEach(renderDoc);
  }
});

if (isStatusPage) initStatus();
else initApply();
