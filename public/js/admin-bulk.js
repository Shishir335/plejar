/* Bulk selection for the admin lists: a tick box on each row, a bar with what can be done to the ticked rows, and
 * a CSV export of them. Each list registers once (admin-bulk-lists.js) and hands over its rows when it renders:
 *
 *   bulkTable('reviews', { tbody: 'reviewsTableBody', noun: ['review', 'reviews'], reload: () => loadReviews(),
 *     actions: [{ label: 'Hide', style: 'danger', when: r => r.status !== 'hidden', reason: {...}, run: (r, text) => adminFetch(...) }] });
 *   bulkRows('reviews', reviews);   // in the loader; each row's <tr> carries data-bulk-id="<id>"
 *
 * Actions run one row at a time through the same endpoints as the row buttons, so every check, email and
 * activity-log entry still happens. Ticks are kept across pages until the filters change (`scope`).
 */
const BULK = new Map();
const BULK_MAX = 200; // per run, so a big selection can't use up the hourly API limit
const BULK_PARALLEL = 4;

const bulkNum = n => new Intl.NumberFormat('en-US').format(n);
const bulkNoun = (st, n) => (n === 1 ? st.cfg.noun[0] : st.cfg.noun[1]);

function bulkTable(key, cfg) {
  const st = { key, cfg: { noun: ['item', 'items'], actions: [], id: r => r._id || r.id, ...cfg }, rows: new Map(), selected: new Map(), scope: null, busy: false };
  BULK.set(key, st);
  const tbody = document.getElementById(cfg.tbody);
  if (!tbody) return;
  // Re-applies the tick column whenever the list (or a "Loading..." / "No results" line) is drawn
  new MutationObserver(() => bulkDecorate(key)).observe(tbody, { childList: true });
  const thead = tbody.closest('table')?.querySelector('thead');
  if (thead) new MutationObserver(() => bulkDecorate(key)).observe(thead, { childList: true, subtree: true });
}

// The rows a list just loaded
function bulkRows(key, list) {
  const st = BULK.get(key);
  if (!st) return;
  const scope = st.cfg.scope ? st.cfg.scope() : '';
  if (st.scope !== null && scope !== st.scope) st.selected.clear();
  st.scope = scope;
  st.rows = new Map((list || []).map(r => [String(st.cfg.id(r)), r]));
  bulkDecorate(key);
}

function bulkTableEl(st) {
  const tbody = document.getElementById(st.cfg.tbody);
  return tbody ? { tbody, table: tbody.closest('table') } : {};
}

function bulkDecorate(key) {
  const st = BULK.get(key);
  const { tbody, table } = bulkTableEl(st);
  if (!tbody || !table) return;
  const headRow = table.querySelector('thead tr');
  if (headRow && !headRow.querySelector('.sel-col')) {
    const th = document.createElement('th');
    th.className = 'sel-col';
    th.innerHTML = `<input type="checkbox" aria-label="Select every row on this page" onchange="bulkSelectPage('${key}', this.checked)">`;
    headRow.prepend(th);
  }
  const cols = headRow ? headRow.children.length : 0;
  [...tbody.rows].forEach(tr => {
    const id = tr.dataset.bulkId;
    if (!id) {
      // A message line ("Loading...", "No results") spans the extra column too
      const only = tr.cells.length === 1 && tr.cells[0];
      if (only && cols && only.colSpan !== cols) only.colSpan = cols;
      return;
    }
    if (!tr.querySelector('td.sel-col')) {
      const td = document.createElement('td');
      td.className = 'sel-col';
      td.setAttribute('onclick', 'event.stopPropagation()');
      td.innerHTML = `<input type="checkbox" aria-label="Select this row" onchange="bulkSelect('${key}', '${id.replace(/'/g, '')}', this.checked)">`;
      tr.prepend(td);
    }
    const on = st.selected.has(id);
    tr.querySelector('td.sel-col input').checked = on;
    tr.classList.toggle('row-selected', on);
  });
  bulkRenderBar(key);
}

// A cell's text as shown (line breaks between parts), but in its real letter case rather than the
// on-screen capitals some headings and badges use
function bulkCellText(el) {
  const shown = el.innerText.replace(/\s*\n\s*/g, ' · ').trim();
  const real = el.textContent;
  let j = 0;
  return [...shown].map(ch => {
    if (!/\p{L}/u.test(ch)) return ch;
    const k = real.toLowerCase().indexOf(ch.toLowerCase(), j);
    if (k === -1) return ch;
    j = k + 1;
    return real[k];
  }).join('');
}

// What a row says, column by column, for the CSV (without the tick box and the buttons)
function bulkRowCells(st, tr) {
  const cells = [...tr.cells].filter(td => !td.classList.contains('sel-col'));
  if (bulkHasActionsColumn(st)) cells.pop();
  return cells.map(bulkCellText);
}

function bulkHeaders(st) {
  const { table } = bulkTableEl(st);
  const ths = [...(table?.querySelectorAll('thead tr th') || [])].filter(th => !th.classList.contains('sel-col'));
  if (bulkHasActionsColumn(st)) ths.pop();
  return ths.map(bulkCellText);
}

function bulkHasActionsColumn(st) {
  const { table } = bulkTableEl(st);
  const last = table?.querySelector('thead tr th:last-child');
  return !!last && !last.classList.contains('sel-col') && /^(actions?|)$/i.test(last.textContent.trim());
}

function bulkSelect(key, id, on) {
  const st = BULK.get(key);
  if (!st || st.busy) return;
  const tr = document.querySelector(`#${st.cfg.tbody} tr[data-bulk-id="${CSS.escape(id)}"]`);
  if (on && st.rows.has(id)) st.selected.set(id, { row: st.rows.get(id), cells: tr ? bulkRowCells(st, tr) : [] });
  else st.selected.delete(id);
  bulkDecorate(key);
}

function bulkSelectPage(key, on) {
  const st = BULK.get(key);
  if (!st || st.busy) return;
  document.querySelectorAll(`#${st.cfg.tbody} tr[data-bulk-id]`).forEach(tr => {
    const id = tr.dataset.bulkId;
    if (on && st.rows.has(id)) st.selected.set(id, { row: st.rows.get(id), cells: bulkRowCells(st, tr) });
    else if (!on) st.selected.delete(id);
  });
  bulkDecorate(key);
}

function bulkClear(key) {
  const st = BULK.get(key);
  if (!st || st.busy) return;
  st.selected.clear();
  bulkDecorate(key);
}

function bulkBar(st) {
  const { table } = bulkTableEl(st);
  if (!table) return null;
  let bar = document.getElementById(`bulkBar-${st.key}`);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = `bulkBar-${st.key}`;
    bar.className = 'bulk-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Selected rows');
    bar.hidden = true;
    const anchor = table.closest('.table-container') || table;
    anchor.parentNode.insertBefore(bar, anchor);
  }
  return bar;
}

// The actions this person may use, with how many of the ticked rows each applies to
function bulkAvailable(st) {
  const rows = [...st.selected.values()].map(s => s.row);
  return st.cfg.actions
    .map((a, i) => ({ a, i, count: rows.filter(r => !a.when || a.when(r)).length }))
    .filter(({ a, count }) => count > 0 && (!a.allowed || a.allowed()));
}

function bulkRenderBar(key) {
  const st = BULK.get(key);
  const bar = bulkBar(st);
  const { tbody, table } = bulkTableEl(st);
  const ids = [...tbody.querySelectorAll('tr[data-bulk-id]')].map(tr => tr.dataset.bulkId);
  const onPage = ids.filter(id => st.selected.has(id)).length;
  const head = table.querySelector('thead .sel-col input');
  if (head) {
    head.checked = ids.length > 0 && onPage === ids.length;
    head.indeterminate = onPage > 0 && onPage < ids.length;
    head.disabled = !ids.length;
  }
  if (!bar) return;
  const count = st.selected.size;
  bar.hidden = !count;
  if (!count) { bar.innerHTML = ''; return; }
  if (st.busy) return; // the progress line stays until the run ends
  const elsewhere = count - onPage;
  bar.innerHTML = `
    <span class="bulk-count"><strong>${bulkNum(count)}</strong> ${E(bulkNoun(st, count))} selected${elsewhere > 0 ? ` <span class="lead-sub" style="display:inline;">(${bulkNum(elsewhere)} on other pages)</span>` : ''}</span>
    <span class="bulk-actions">
      ${bulkAvailable(st).map(({ a, i, count: n }) => `<button type="button" class="btn btn-${a.style || 'secondary'} btn-sm" onclick="bulkRun('${key}', ${i})"
        title="${n < count ? `Applies to ${bulkNum(n)} of the ${bulkNum(count)} selected` : ''}">${E(a.label)}${n < count ? ` (${bulkNum(n)})` : ''}</button>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" onclick="bulkExport('${key}')">Export CSV</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="bulkClear('${key}')">Clear</button>
    </span>`;
}

function bulkExport(key) {
  const st = BULK.get(key);
  if (!st || !st.selected.size) return;
  const quote = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [bulkHeaders(st), ...[...st.selected.values()].map(s => s.cells)].map(r => r.map(quote).join(','));
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `plejar-${st.cfg.file || key}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showAdminToast(`Exported ${bulkNum(st.selected.size)} ${bulkNoun(st, st.selected.size)}.`, 'success');
}

async function bulkRun(key, index) {
  const st = BULK.get(key);
  const a = st && st.cfg.actions[index];
  if (!a || st.busy) return;
  const targets = [...st.selected.entries()].filter(([, s]) => !a.when || a.when(s.row));
  const n = targets.length;
  if (!n) return;
  if (n > BULK_MAX) return showAdminToast(`Select up to ${BULK_MAX} at a time for this.`, 'error');
  const what = `${bulkNum(n)} ${bulkNoun(st, n)}`;
  const skipped = st.selected.size - n;
  const skipNote = skipped ? `\n\nThe other ${bulkNum(skipped)} selected ${skipped === 1 ? "doesn't" : "don't"} apply and ${skipped === 1 ? 'is' : 'are'} left as ${skipped === 1 ? 'it is' : 'they are'}.` : '';

  const go = async text => {
    st.busy = true;
    const bar = bulkBar(st);
    const progress = done => { if (bar) bar.innerHTML = `<span class="bulk-count"><span class="spinner-inline" aria-hidden="true"></span> ${E(a.label)}: ${bulkNum(done)} of ${bulkNum(n)}…</span>`; };
    progress(0);
    const failures = [];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const [id, s] = targets[next++];
        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await a.run(s.row, text);
          if (res && res.ok === false) failures.push({ id, message: (res.data && res.data.message) || `Failed (${res.status})` });
          else st.selected.delete(id);
        } catch (e) {
          failures.push({ id, message: e.message || 'Could not reach the server.' });
        }
        progress(++done);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, n) }, worker));
    } finally {
      st.busy = false;
    }
    const ok = n - failures.length;
    const verb = a.done || a.label;
    if (!failures.length) showAdminToast(`${verb}: ${what}.`, 'success');
    else {
      const first = failures[0].message;
      showAdminToast(`${verb}: ${bulkNum(ok)} of ${bulkNum(n)}. ${bulkNum(failures.length)} failed${first ? `: ${first}` : ''}. Those stay selected.`, ok ? 'info' : 'error');
    }
    bulkDecorate(key);
    if (ok && st.cfg.reload) await st.cfg.reload();
    if (!ok && a.reason) throw new Error(failures[0].message);
  };

  if (a.reason) {
    const r = typeof a.reason === 'function' ? a.reason(n) : a.reason;
    askReason({ ...r, title: r.title || `${a.label} ${what}?`, lead: `${r.lead || ''}${skipNote}`, onSubmit: go });
    return;
  }
  const question = typeof a.confirm === 'function' ? a.confirm(n, what) : `${a.label} ${what}?${a.confirm ? `\n\n${a.confirm}` : ''}`;
  if (a.confirm !== false && !confirm(`${question}${skipNote}`)) return;
  try { await go(); } catch (_) { /* already shown */ }
}

// The JSON body helper the actions use
const bulkSend = (url, method, body) => adminFetch(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
