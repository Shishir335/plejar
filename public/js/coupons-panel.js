/**
 * Coupons screen, shared by the admin console, the agency panel and the hotel panel.
 *
 *   CouponsPanel.mount(container, {
 *     mode: 'admin' | 'agency' | 'hotel',
 *     base: '/api/v1/admin/coupons',          // list and create; :id for edit and delete
 *     request: (method, path, body) => data,  // the page's own API helper; throws Error(message)
 *     canEdit: true,                          // vendor panels: only the owner manages coupons
 *     buttons: { primary: 'btn btn-primary', quiet: 'btn btn-quiet' }
 *   })
 *
 * Plejar's coupons are paid by Plejar; an agency's or hotel's own coupons are paid by them.
 */
(function () {
  const KIND_LABEL = { tour: 'Tours', guide: 'Guides', hotel: 'Hotel stays' };
  const STATE = {
    active: ['Live', 'cpn-pill-live'],
    paused: ['Paused', 'cpn-pill-muted'],
    ended: ['Ended', 'cpn-pill-muted'],
    scheduled: ['Starts later', 'cpn-pill-info'],
    used_up: ['All used', 'cpn-pill-muted'],
    blocked: ['Stopped by Plejar', 'cpn-pill-warn']
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const taka = n => `৳${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
  const day = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '');
  // A stored date as YYYY-MM-DD in Bangladesh time, for a date input
  const inputDay = d => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(d)) : '');

  function injectStyles() {
    if (document.getElementById('cpn-styles')) return;
    const css = `
.cpn { display: grid; gap: 14px; }
.cpn-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.cpn-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cpn-chip { border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: .85rem; cursor: pointer; }
.cpn-chip[aria-pressed="true"] { background: rgba(127,127,127,.18); border-color: currentColor; font-weight: 700; }
.cpn-search { min-width: 200px; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; }
.cpn-totals { font-size: .9rem; opacity: .8; }
.cpn-note { font-size: .88rem; opacity: .8; margin: 0; }
.cpn-list { display: grid; gap: 10px; }
.cpn-card { border: 1px solid rgba(127,127,127,.25); border-radius: 12px; padding: 14px 16px; display: grid; gap: 8px; }
.cpn-top { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.cpn-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; letter-spacing: .04em; padding: 3px 8px; border-radius: 6px; border: 1px dashed rgba(127,127,127,.6); }
.cpn-offer { font-weight: 700; }
.cpn-title { opacity: .85; }
.cpn-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: .85rem; opacity: .75; }
.cpn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cpn-actions button { font-size: .85rem; }
.cpn-pill { font-size: .75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.cpn-pill-live { background: rgba(34,160,90,.15); color: #1f8a4c; }
.cpn-pill-muted { background: rgba(127,127,127,.15); }
.cpn-pill-info { background: rgba(60,120,220,.15); color: #2f62b8; }
.cpn-pill-warn { background: rgba(220,120,30,.18); color: #b45a10; }
.cpn-pill-plejar { background: rgba(105,166,249,.18); color: #3c7fd6; }
.cpn-reason { font-size: .85rem; color: #b45a10; }
.cpn-empty { padding: 28px 16px; text-align: center; opacity: .75; border: 1px dashed rgba(127,127,127,.35); border-radius: 12px; }
.cpn-dialog { position: fixed; inset: 0; margin: auto; border: none; border-radius: 14px; padding: 0; width: min(560px, calc(100vw - 32px)); height: fit-content; max-height: calc(100vh - 32px); overflow: auto; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.cpn-dialog::backdrop { background: rgba(0,0,0,.45); }
.cpn-form { display: grid; gap: 12px; padding: 20px; }
.cpn-form h2 { margin: 0; font-size: 1.2rem; }
.cpn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cpn-field { display: grid; gap: 4px; font-size: .88rem; }
.cpn-field > span { font-weight: 600; }
.cpn-field small { opacity: .7; font-size: .8rem; }
.cpn-field input, .cpn-field select, .cpn-field textarea { padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.4); font: inherit; background: transparent; color: inherit; }
.cpn-field select[multiple] { min-height: 110px; }
.cpn-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .9rem; }
.cpn-checks label { display: inline-flex; gap: 6px; align-items: center; }
.cpn-error { color: #c0392b; font-size: .88rem; min-height: 1em; margin: 0; }
.cpn-foot { display: flex; justify-content: flex-end; gap: 8px; }
.cpn-uses { display: grid; gap: 6px; padding: 20px; }
.cpn-uses table { width: 100%; border-collapse: collapse; font-size: .85rem; }
.cpn-uses th, .cpn-uses td { text-align: left; padding: 6px 4px; border-bottom: 1px solid rgba(127,127,127,.2); }
@media (max-width: 560px) { .cpn-row { grid-template-columns: 1fr; } .cpn-search { min-width: 0; width: 100%; } }
`;
    const style = document.createElement('style');
    style.id = 'cpn-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Dialogs take the page's own colours (the panels have their own light and dark themes)
  function paint(dialog) {
    const page = getComputedStyle(document.body);
    const transparent = c => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    let bg = page.backgroundColor;
    if (transparent(bg)) bg = getComputedStyle(document.documentElement).backgroundColor;
    dialog.style.background = transparent(bg) ? '#fff' : bg;
    dialog.style.color = page.color;
  }

  function mount(root, options) {
    injectStyles();
    const o = { canEdit: true, buttons: { primary: 'btn btn-primary', quiet: 'btn btn-quiet' }, ...options };
    const isAdmin = o.mode === 'admin';
    const kinds = isAdmin ? ['tour', 'guide', 'hotel'] : o.mode === 'hotel' ? ['hotel'] : ['tour', 'guide'];
    const st = { coupons: [], tours: [], source: '', search: '', totals: null, editing: null };

    const who = isAdmin
      ? "Plejar's coupons: Plejar pays the discount, and vendors still get their full share. Vendors' own coupons are listed too; you can stop one that breaks the rules."
      : `Coupons travelers can use in the Plejar app on your ${o.mode === 'hotel' ? 'hotel stays' : 'tours and guides'}. ${o.mode === 'hotel' ? 'Guests pay you the lower price' : 'The discount comes out of your earnings'}, so you pay for your own coupons.`;

    root.innerHTML = `
      <div class="cpn">
        <p class="cpn-note">${esc(who)}</p>
        <div class="cpn-bar">
          <div class="cpn-filters">
            ${isAdmin ? `
              <button type="button" class="cpn-chip" data-src="" aria-pressed="true"><span>All</span></button>
              <button type="button" class="cpn-chip" data-src="plejar" aria-pressed="false"><span>Plejar's</span></button>
              <button type="button" class="cpn-chip" data-src="vendor" aria-pressed="false"><span>Vendors'</span></button>
              <input type="search" class="cpn-search" placeholder="Search code or title" aria-label="Search coupons">` : ''}
          </div>
          ${o.canEdit ? `<button type="button" class="${esc(o.buttons.primary)}" data-cpn="new">New coupon</button>` : ''}
        </div>
        <div class="cpn-totals" data-cpn-totals></div>
        <div class="cpn-list" data-cpn-list><div class="cpn-empty">Loading…</div></div>
      </div>
      <dialog class="cpn-dialog" data-cpn-dialog></dialog>
      <dialog class="cpn-dialog" data-cpn-uses></dialog>`;

    const list = root.querySelector('[data-cpn-list]');
    const dialog = root.querySelector('[data-cpn-dialog]');
    const usesDialog = root.querySelector('[data-cpn-uses]');

    async function load() {
      try {
        const params = new URLSearchParams();
        if (st.source) params.set('source', st.source);
        if (st.search) params.set('search', st.search);
        if (isAdmin) params.set('limit', '100');
        const data = await o.request('GET', `${o.base}${params.toString() ? `?${params}` : ''}`);
        st.coupons = data.data.coupons || [];
        st.tours = data.data.tours || [];
        st.totals = data.data.totals || null;
        render();
      } catch (err) {
        list.innerHTML = `<div class="cpn-empty">${esc(err.message || 'Could not load coupons.')}</div>`;
      }
    }

    function render() {
      const totals = root.querySelector('[data-cpn-totals]');
      if (isAdmin && st.totals) {
        totals.textContent = `Plejar has paid ${taka(st.totals.plejar.discount)} on ${st.totals.plejar.uses} use${st.totals.plejar.uses === 1 ? '' : 's'} of its coupons. Vendors' coupons: ${taka(st.totals.vendor.discount)} on ${st.totals.vendor.uses} use${st.totals.vendor.uses === 1 ? '' : 's'}.`;
      } else {
        totals.textContent = '';
      }
      if (!st.coupons.length) {
        list.innerHTML = `<div class="cpn-empty">${o.canEdit ? 'No coupons yet. Make one with New coupon.' : 'No coupons yet. The owner can make them.'}</div>`;
        return;
      }
      list.innerHTML = st.coupons.map(card).join('');
    }

    function card(c) {
      const [label, cls] = STATE[c.state] || STATE.active;
      const mine = !isAdmin || c.fundedBy === 'plejar';
      const dates = c.startsAt || c.endsAt ? `${c.startsAt ? `From ${day(c.startsAt)}` : ''}${c.startsAt && c.endsAt ? ' · ' : ''}${c.endsAt ? `Until ${day(c.endsAt)}` : ''}` : 'No end date';
      const uses = `${c.usedCount}${c.usageLimit ? ` of ${c.usageLimit}` : ''} used`;
      const tours = (c.packages || []).map(p => p.title).filter(Boolean);
      const actions = [];
      if (mine && o.canEdit) {
        actions.push(`<button type="button" class="${esc(o.buttons.quiet)}" data-cpn="edit" data-id="${c._id}">Edit</button>`);
        if (c.state !== 'blocked') actions.push(`<button type="button" class="${esc(o.buttons.quiet)}" data-cpn="toggle" data-id="${c._id}">${c.status === 'paused' ? 'Turn on' : 'Pause'}</button>`);
        if (!c.everUsed) actions.push(`<button type="button" class="${esc(o.buttons.quiet)}" data-cpn="delete" data-id="${c._id}">Delete</button>`);
      }
      if (isAdmin && c.fundedBy === 'vendor') {
        actions.push(`<button type="button" class="${esc(o.buttons.quiet)}" data-cpn="block" data-id="${c._id}">${c.blockedByAdmin ? 'Allow again' : 'Stop coupon'}</button>`);
      }
      if (isAdmin) actions.push(`<button type="button" class="${esc(o.buttons.quiet)}" data-cpn="uses" data-id="${c._id}">See uses</button>`);
      return `
        <article class="cpn-card">
          <div class="cpn-top">
            <span class="cpn-code">${esc(c.code)}</span>
            <span class="cpn-offer">${esc(c.label)}</span>
            <span class="cpn-pill ${cls}">${label}</span>
            ${isAdmin ? (c.fundedBy === 'plejar' ? '<span class="cpn-pill cpn-pill-plejar">Plejar pays</span>' : `<span class="cpn-pill cpn-pill-muted">${esc((c.vendor && c.vendor.name) || 'Vendor')} pays</span>`) : ''}
            ${c.visible ? '' : '<span class="cpn-pill cpn-pill-muted">Code only</span>'}
          </div>
          <div class="cpn-title">${esc(c.title)}${c.description ? ` — ${esc(c.description)}` : ''}</div>
          <div class="cpn-meta">
            <span>${(c.appliesTo || []).map(k => KIND_LABEL[k]).join(', ')}${tours.length ? `: ${esc(tours.join(', '))}` : ''}${isAdmin && c.fundedBy === 'plejar' && c.vendor ? ` of ${esc(c.vendor.name)}` : ''}</span>
            ${c.minSpend ? `<span>Minimum ${taka(c.minSpend)}</span>` : ''}
            <span>${esc(dates)}</span>
            <span>${uses}${c.perUserLimit > 1 ? ` · ${c.perUserLimit} per traveler` : ' · once per traveler'}</span>
            <span>${taka(c.discountGiven)} given</span>
          </div>
          ${c.blockedByAdmin && c.blockedReason ? `<div class="cpn-reason">Stopped by Plejar: ${esc(c.blockedReason)}</div>` : ''}
          ${actions.length ? `<div class="cpn-actions">${actions.join('')}</div>` : ''}
        </article>`;
    }

    function openForm(c) {
      st.editing = c || null;
      const used = Boolean(c && c.everUsed);
      const v = c || { discountType: 'percent', appliesTo: kinds, perUserLimit: 1, visible: true, status: 'active', packages: [] };
      const chosen = new Set((v.packages || []).map(p => String(p._id || p)));
      dialog.innerHTML = `
        <form class="cpn-form" novalidate>
          <h2>${c ? `Edit ${esc(c.code)}` : 'New coupon'}</h2>
          <div class="cpn-row">
            <label class="cpn-field"><span>Code</span><input name="code" required maxlength="20" value="${esc(v.code || '')}" placeholder="EID500" ${used ? 'readonly title="Used coupons keep their code"' : ''} style="text-transform:uppercase"><small>${used ? 'Used already, so the code stays.' : '3-20 letters, numbers or dashes.'}</small></label>
            <label class="cpn-field"><span>Title</span><input name="title" required maxlength="80" value="${esc(v.title || '')}" placeholder="Eid special"></label>
          </div>
          <label class="cpn-field"><span>Description <small>(optional)</small></span><textarea name="description" rows="2" maxlength="500">${esc(v.description || '')}</textarea></label>
          <div class="cpn-row">
            <label class="cpn-field"><span>Discount</span>
              <select name="discountType"><option value="percent" ${v.discountType === 'percent' ? 'selected' : ''}>Percentage off</option><option value="amount" ${v.discountType === 'amount' ? 'selected' : ''}>Fixed amount off (৳)</option></select></label>
            <label class="cpn-field"><span data-cpn-value-label>${v.discountType === 'amount' ? 'Amount (৳)' : 'Percent'}</span><input name="value" type="number" min="1" step="1" required value="${esc(v.value || '')}"></label>
          </div>
          <div class="cpn-row">
            <label class="cpn-field" data-cpn-max ${v.discountType === 'amount' ? 'hidden' : ''}><span>Most it takes off (৳) <small>(optional)</small></span><input name="maxDiscount" type="number" min="1" step="1" value="${esc(v.maxDiscount || '')}"></label>
            <label class="cpn-field"><span>Minimum booking (৳) <small>(optional)</small></span><input name="minSpend" type="number" min="0" step="1" value="${esc(v.minSpend || '')}"></label>
          </div>
          ${kinds.length > 1 ? `<div class="cpn-field"><span>Can be used on</span><div class="cpn-checks">${kinds.map(k => `<label><input type="checkbox" name="appliesTo" value="${k}" ${(v.appliesTo || []).includes(k) ? 'checked' : ''}> ${KIND_LABEL[k]}</label>`).join('')}</div></div>` : ''}
          ${o.mode === 'agency' && st.tours.length ? `<label class="cpn-field"><span>Only these tours <small>(optional; none chosen = all your tours)</small></span><select name="packages" multiple>${st.tours.map(t => `<option value="${t._id}" ${chosen.has(String(t._id)) ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select><small>Hold Ctrl or ⌘ to choose several.</small></label>` : ''}
          <div class="cpn-row">
            <label class="cpn-field"><span>Starts <small>(optional)</small></span><input name="startsAt" type="date" value="${inputDay(v.startsAt)}"></label>
            <label class="cpn-field"><span>Ends <small>(optional, last day)</small></span><input name="endsAt" type="date" value="${inputDay(v.endsAt)}"></label>
          </div>
          <div class="cpn-row">
            <label class="cpn-field"><span>Total uses <small>(optional)</small></span><input name="usageLimit" type="number" min="1" step="1" value="${esc(v.usageLimit || '')}" placeholder="No limit"></label>
            <label class="cpn-field"><span>Uses per traveler</span><input name="perUserLimit" type="number" min="1" max="20" step="1" value="${esc(v.perUserLimit || 1)}"></label>
          </div>
          <div class="cpn-checks">
            <label><input type="checkbox" name="visible" ${v.visible !== false ? 'checked' : ''}> Show it on the booking screen in the app</label>
            <label><input type="checkbox" name="active" ${v.status !== 'paused' ? 'checked' : ''}> Turned on</label>
          </div>
          <p class="cpn-note">${isAdmin ? 'Plejar pays this discount.' : 'You pay this discount: it comes out of what the traveler pays you.'} Changes apply to new bookings only.</p>
          <p class="cpn-error" data-cpn-error role="alert"></p>
          <div class="cpn-foot">
            <button type="button" class="${esc(o.buttons.quiet)}" data-cpn="close">Cancel</button>
            <button type="submit" class="${esc(o.buttons.primary)}">${c ? 'Save' : 'Create coupon'}</button>
          </div>
        </form>`;
      const form = dialog.querySelector('form');
      form.discountType.addEventListener('change', () => {
        const amount = form.discountType.value === 'amount';
        dialog.querySelector('[data-cpn-value-label]').textContent = amount ? 'Amount (৳)' : 'Percent';
        dialog.querySelector('[data-cpn-max]').hidden = amount;
      });
      form.addEventListener('submit', submit);
      paint(dialog);
      dialog.showModal();
    }

    async function submit(e) {
      e.preventDefault();
      const form = e.target;
      const error = dialog.querySelector('[data-cpn-error]');
      const body = {
        title: form.title.value,
        description: form.description.value,
        discountType: form.discountType.value,
        value: form.value.value,
        maxDiscount: form.discountType.value === 'percent' ? form.maxDiscount.value : '',
        minSpend: form.minSpend.value,
        startsAt: form.startsAt.value,
        endsAt: form.endsAt.value,
        usageLimit: form.usageLimit.value,
        perUserLimit: form.perUserLimit.value,
        visible: form.visible.checked,
        status: form.active.checked ? 'active' : 'paused'
      };
      if (!form.code.readOnly) body.code = form.code.value;
      if (kinds.length > 1) body.appliesTo = [...form.querySelectorAll('input[name="appliesTo"]:checked')].map(i => i.value);
      if (form.packages) body.packages = [...form.packages.selectedOptions].map(op => op.value);
      if (!form.title.value.trim()) { error.textContent = 'Give the coupon a title.'; return; }
      if (!form.value.value) { error.textContent = 'Enter how much it takes off.'; return; }
      if (body.appliesTo && !body.appliesTo.length) { error.textContent = 'Choose what the coupon can be used on.'; return; }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      error.textContent = '';
      try {
        if (st.editing) await o.request('PATCH', `${o.base}/${st.editing._id}`, body);
        else await o.request('POST', o.base, body);
        dialog.close();
        load();
      } catch (err) {
        error.textContent = err.message || 'Could not save the coupon.';
      } finally {
        button.disabled = false;
      }
    }

    async function showUses(c) {
      usesDialog.innerHTML = `<div class="cpn-uses"><h2 style="margin:0;font-size:1.15rem;">Uses of ${esc(c.code)}</h2><p class="cpn-note">Loading…</p></div>`;
      paint(usesDialog);
      usesDialog.showModal();
      try {
        const data = await o.request('GET', `${o.base}/${c._id}/redemptions?limit=100`);
        const rows = data.data.redemptions || [];
        const what = r => (r.booking ? `${esc(r.booking.packageTitle)} (${esc(r.booking.reference)}, ${esc(r.booking.status)})` : r.stayRequest ? `Stay: ${esc(r.stayRequest.roomName)} (${esc(r.stayRequest.status)})` : esc(r.kind));
        usesDialog.querySelector('.cpn-uses').innerHTML = `
          <h2 style="margin:0;font-size:1.15rem;">Uses of ${esc(c.code)}</h2>
          ${rows.length ? `<table><thead><tr><th>When</th><th>Traveler</th><th>On</th><th>Off</th><th></th></tr></thead><tbody>${rows.map(r => `
            <tr><td>${day(r.createdAt)}</td><td>${esc((r.user && (r.user.name || r.user.email)) || '')}</td><td>${what(r)}${r.vendor ? `<br><small>${esc(r.vendor.name)}</small>` : ''}</td><td>${taka(r.discount)}</td><td>${r.status === 'released' ? 'Given back' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="cpn-note">Nobody has used it yet.</p>'}
          <div class="cpn-foot"><button type="button" class="${esc(o.buttons.quiet)}" data-cpn="close-uses">Close</button></div>`;
      } catch (err) {
        usesDialog.querySelector('.cpn-note').textContent = err.message;
      }
    }

    root.addEventListener('click', async e => {
      const chip = e.target.closest('[data-src]');
      if (chip) {
        st.source = chip.dataset.src;
        root.querySelectorAll('[data-src]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
        load();
        return;
      }
      const btn = e.target.closest('[data-cpn]');
      if (!btn) return;
      const c = st.coupons.find(x => x._id === btn.dataset.id);
      const act = btn.dataset.cpn;
      if (act === 'new') openForm(null);
      else if (act === 'edit' && c) openForm(c);
      else if (act === 'close') dialog.close();
      else if (act === 'close-uses') usesDialog.close();
      else if (act === 'uses' && c) showUses(c);
      else if (act === 'toggle' && c) {
        try { await o.request('PATCH', `${o.base}/${c._id}`, { status: c.status === 'paused' ? 'active' : 'paused' }); load(); } catch (err) { alert(err.message); }
      } else if (act === 'delete' && c) {
        if (!confirm(`Delete ${c.code}? Nobody has used it, so nothing else changes.`)) return;
        try { await o.request('DELETE', `${o.base}/${c._id}`); load(); } catch (err) { alert(err.message); }
      } else if (act === 'block' && c) {
        let body = { blocked: false };
        if (!c.blockedByAdmin) {
          const reason = prompt(`Why is ${c.code} stopped? ${(c.vendor && c.vendor.name) || 'The vendor'} sees this.`);
          if (!reason || !reason.trim()) return;
          body = { blocked: true, reason };
        }
        try { await o.request('PATCH', `${o.base}/${c._id}`, body); load(); } catch (err) { alert(err.message); }
      }
    });

    let timer;
    const search = root.querySelector('.cpn-search');
    if (search) search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.search = search.value.trim(); load(); }, 300); });

    load();
    return { reload: load };
  }

  window.CouponsPanel = { mount };
}());
