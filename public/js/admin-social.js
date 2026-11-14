/**
 * Plejar admin - Users > Posts & reports: what travelers post in the app, and the reports on it.
 * Depends on helpers from admin.js and admin-users.js (adminFetch, E, askReason, renderPager...).
 */

const S = { page: 1 };

const debouncedSocial = makeDebounce(() => loadSocial(1));

const REASON_LABELS = {
  spam: 'Spam', harassment: 'Harassment', hate: 'Hate speech', nudity: 'Nudity', violence: 'Violence',
  false_information: 'False information', scam: 'Scam', other: 'Other'
};

const userLink = u => (u ? `<a href="#" onclick="event.preventDefault(); openUser('${E(u._id)}')">${E(u.name)}</a><span class="lead-sub">${E(u.email || '')}</span>` : '—');
const statusPill = st => (st && st !== 'active' ? ` <span class="badge badge-inactive">${E(st)}</span>` : '');

async function loadSocialSummary() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/posts/summary');
    if (!ok) return;
    const s = data.data;
    const n = v => new Intl.NumberFormat('en-US').format(v);
    document.getElementById('socialSummary').textContent = `${n(s.posts)} posts (${n(s.postsToday)} in the last day) · ${n(s.comments)} comments · ${n(s.openReports)} open reports · ${n(s.hidden)} hidden posts · ${n(s.restricted)} people who can't post`;
    const badge = document.getElementById('subSocialCount');
    if (badge) { badge.textContent = s.openReports; badge.hidden = !s.openReports; }
  } catch (e) { /* the summary line is optional */ }
}

function loadSocial(page = S.page) {
  S.page = page;
  const view = val('sView');
  const isReports = view === 'reports' || view === 'closed';
  document.getElementById('sTarget').hidden = !isReports;
  document.getElementById('sSearchWrap').hidden = isReports;
  loadSocialSummary();
  return isReports ? loadSocialReports(page, view === 'closed') : loadSocialPosts(page, view);
}

// ---------- Reports ----------

function reportTarget(r) {
  const t = r.targetSummary || {};
  if (t.missing) return '<span class="lead-sub">No longer exists</span>';
  if (r.targetType === 'user') return `Person: ${userLink({ _id: r.target, name: t.name, email: t.email })}${statusPill(t.status)}`;
  const label = r.targetType === 'post' ? 'Post' : 'Comment';
  const open = r.targetType === 'post' ? r.target : t.post;
  return `<strong>${label}</strong>${statusPill(t.status)}<div class="lead-message">${E(t.text) || (t.photos ? `${t.photos} photo(s)` : '—')}</div>
    ${open ? `<a href="#" class="lead-sub" onclick="event.preventDefault(); openSocialPost('${E(open)}')">Open post</a>` : ''}`;
}

async function loadSocialReports(page, closed) {
  document.getElementById('socialTableHead').innerHTML = '<tr><th>Reported</th><th>By</th><th>Reason</th><th>Author</th><th>Date</th><th style="text-align: right;">Actions</th></tr>';
  tableMessage('socialTableBody', 6, 'Loading...');
  const q = queryString({ status: closed ? 'action_taken' : 'open', targetType: val('sTarget'), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/social-reports?${q}`);
    if (!ok) return tableMessage('socialTableBody', 6, data.message || 'Could not load reports.', true);
    renderPager('socialPager', data.data, 'loadSocial');
    if (!data.data.reports.length) return tableMessage('socialTableBody', 6, closed ? 'No closed reports yet.' : 'No open reports. Nothing needs a look right now.');
    bulkRows('social', data.data.reports);
    document.getElementById('socialTableBody').innerHTML = data.data.reports.map(r => `
      <tr data-bulk-id="${E(r._id)}">
        <td>${reportTarget(r)}</td>
        <td>${userLink(r.reporter)}</td>
        <td>${E(REASON_LABELS[r.reason] || r.reason)}${r.note ? `<span class="lead-sub">${E(r.note)}</span>` : ''}${r.openReportsOnTarget > 1 ? `<span class="lead-sub">${r.openReportsOnTarget} people reported this</span>` : ''}</td>
        <td>${userLink(r.targetUser)}</td>
        <td style="white-space: nowrap;">${E(fmtDate(r.createdAt))}</td>
        <td style="text-align: right;">${r.status === 'open' ? `
          ${r.targetType !== 'user' ? `<button class="btn btn-danger btn-sm" onclick="resolveSocialReport('${E(r._id)}', 'hide')">Hide it</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="resolveSocialReport('${E(r._id)}', 'restrict')">${r.targetType === 'user' ? 'Stop posting' : 'Hide + stop posting'}</button>
          <button class="btn btn-secondary btn-sm" onclick="resolveSocialReport('${E(r._id)}', 'dismiss')">Dismiss</button>`
          : `<span class="lead-sub">${E(r.resolution || '')}${r.resolvedBy ? ` · ${E(r.resolvedBy.name)}` : ''}</span>`}</td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('socialTableBody', 6, 'Failed to load reports.', true);
  }
}

function resolveSocialReport(id, how) {
  const copy = {
    hide: { title: 'Hide the reported item', lead: 'It disappears from the app. The author is told why. Every open report on it is closed.', confirm: 'Hide and close' },
    restrict: { title: 'Hide it and stop this person posting', lead: "The item is hidden and the author can't post, comment or share until you lift the restriction in their profile.", confirm: 'Hide and restrict' },
    dismiss: { title: 'Dismiss the report', lead: 'Nothing changes in the app. Every open report on the same item is closed.', confirm: 'Dismiss', danger: false }
  }[how];
  askReason({
    title: copy.title, lead: copy.lead, label: how === 'dismiss' ? 'Note for the team' : 'Reason (the author sees this)', confirmLabel: copy.confirm, danger: copy.danger !== false, maxLength: 300,
    onSubmit: async resolution => {
      const body = how === 'dismiss'
        ? { status: 'dismissed', resolution }
        : { status: 'action_taken', resolution, hideTarget: true, restrictUser: how === 'restrict' };
      const { ok, data } = await adminFetch(`/api/v1/admin/social-reports/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (!ok) throw new Error(data.message || 'Could not close the report.');
      showAdminToast(data.message || 'Report closed.', 'success');
      loadSocial();
    }
  });
}

// ---------- Posts ----------

const mediaLine = p => {
  const photos = (p.media || []).filter(m => m.type === 'image').length;
  const videos = (p.media || []).filter(m => m.type === 'video').length;
  return [photos && `${photos} photo${photos > 1 ? 's' : ''}`, videos && 'video', p.kind === 'share' && 'shared post', p.placeName && `at ${p.placeName}`].filter(Boolean).join(' · ');
};

const postActions = p => {
  if (p.status === 'removed') return '<span class="lead-sub">Removed</span>';
  const id = E(p._id);
  return `${p.status === 'hidden'
    ? `<button class="btn btn-secondary btn-sm" onclick="moderateSocialPost('${id}', 'unhide')">Show again</button>`
    : `<button class="btn btn-danger btn-sm" onclick="moderateSocialPost('${id}', 'hide')">Hide</button>`}
    <button class="btn btn-danger btn-sm" onclick="moderateSocialPost('${id}', 'remove')">Remove</button>`;
};

async function loadSocialPosts(page, view) {
  document.getElementById('socialTableHead').innerHTML = '<tr><th>Author</th><th>Post</th><th>Who sees it</th><th>Activity</th><th>Date</th><th style="text-align: right;">Actions</th></tr>';
  tableMessage('socialTableBody', 6, 'Loading...');
  const q = queryString({ reported: view === 'reported' ? 'true' : '', status: view === 'hidden' ? 'hidden' : '', search: val('sSearch').trim(), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/posts?${q}`);
    if (!ok) return tableMessage('socialTableBody', 6, data.message || 'Could not load posts.', true);
    renderPager('socialPager', data.data, 'loadSocial');
    if (!data.data.posts.length) return tableMessage('socialTableBody', 6, 'No posts match.');
    bulkRows('social', data.data.posts);
    document.getElementById('socialTableBody').innerHTML = data.data.posts.map(p => `
      <tr class="${p.status !== 'active' ? 'row-muted' : ''}" data-bulk-id="${E(p._id)}">
        <td>${userLink(p.author)}</td>
        <td><a href="#" onclick="event.preventDefault(); openSocialPost('${E(p._id)}')" class="lead-message" style="display:block">${E(p.text) || '<em>No text</em>'}</a>
          <span class="lead-sub">${E(mediaLine(p))}</span>${p.moderationNote ? `<span class="lead-sub">${E(p.status)}: ${E(p.moderationNote)}</span>` : ''}</td>
        <td>${E({ public: 'Everyone', followers: 'Followers', private: 'Only the author' }[p.audience] || p.audience)}</td>
        <td style="white-space: nowrap;">♥ ${p.counts.reactions} · 💬 ${p.counts.comments} · ↗ ${p.counts.shares}${p.counts.reports ? `<span class="lead-sub" style="color: var(--color-danger)">${p.counts.reports} report(s)</span>` : ''}</td>
        <td style="white-space: nowrap;">${E(fmtDateTime(p.createdAt))}</td>
        <td style="text-align: right;">${postActions(p)}</td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('socialTableBody', 6, 'Failed to load posts.', true);
  }
}

async function moderateSocialPost(id, action) {
  const send = async note => {
    const { ok, data } = await adminFetch(`/api/v1/admin/posts/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note }) });
    if (!ok) throw new Error(data.message || 'Could not update the post.');
    showAdminToast({ hide: 'Post hidden.', remove: 'Post removed.', unhide: 'Post is visible again.' }[action], 'success');
    if (document.getElementById('socialPostModal')) closeSocialPost();
    loadSocial();
  };
  if (action === 'unhide') {
    try { await send(''); } catch (e) { showAdminToast(e.message, 'error'); }
    return;
  }
  askReason({
    title: action === 'remove' ? 'Remove this post' : 'Hide this post',
    lead: action === 'remove' ? 'Removed posts are gone from the app for good, including for the author.' : 'Hidden posts disappear from feeds. You can show them again later.',
    label: 'Reason (the author sees this)', confirmLabel: action === 'remove' ? 'Remove post' : 'Hide post', maxLength: 300,
    onSubmit: send
  });
}

// ---------- One post with its comments and reports ----------

function closeSocialPost() {
  const el = document.getElementById('socialPostModal');
  if (el) el.remove();
}

async function openSocialPost(id) {
  const { ok, data } = await adminFetch(`/api/v1/admin/posts/${id}`);
  if (!ok) return showAdminToast(data.message || 'Could not open the post.', 'error');
  const { post: p, comments, reports } = data.data;
  closeSocialPost();
  const media = (p.media || []).map(m => (m.type === 'image'
    ? `<a href="${E(m.url)}" target="_blank" rel="noopener"><img src="${E(m.url)}" alt="" style="width: 96px; height: 96px; object-fit: cover; border-radius: 8px;"></a>`
    : `<video src="${E(m.url)}" controls style="width: 200px; border-radius: 8px;"></video>`)).join('');
  const commentRows = comments.map(c => `
    <li style="padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee); ${c.parent ? 'margin-left: 24px;' : ''} ${c.status !== 'active' ? 'opacity: .55;' : ''}">
      <strong>${E(c.author ? c.author.name : 'Deleted')}</strong>${statusPill(c.status)} ${c.reportCount ? `<span class="lead-sub" style="display:inline; color: var(--color-danger)">${c.reportCount} report(s)</span>` : ''}
      <div>${E(c.text)}</div>
      ${c.status === 'active' ? `<button class="btn btn-danger btn-sm" onclick="moderateSocialComment('${E(c._id)}', 'hide', '${E(p._id)}')">Hide</button>` : ''}
      ${c.status === 'hidden' ? `<button class="btn btn-secondary btn-sm" onclick="moderateSocialComment('${E(c._id)}', 'unhide', '${E(p._id)}')">Show again</button>` : ''}
    </li>`).join('');
  const wrap = document.createElement('div');
  wrap.id = 'socialPostModal';
  wrap.className = 'modal-overlay active';
  wrap.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="socialPostTitle" style="max-width: 640px; max-height: 88vh; overflow-y: auto;">
      <div class="modal-head"><h3 id="socialPostTitle">Post by ${E(p.author ? p.author.name : 'unknown')}${statusPill(p.status)}</h3>
        <button class="modal-x" onclick="closeSocialPost()" aria-label="Close">&times;</button></div>
      <p style="white-space: pre-wrap;">${E(p.text) || '<em>No text</em>'}</p>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;">${media}</div>
      <p class="lead-sub">${E([mediaLine(p), fmtDateTime(p.createdAt)].filter(Boolean).join(' · '))} · ♥ ${p.counts.reactions} · 💬 ${p.counts.comments} · ↗ ${p.counts.shares}</p>
      ${p.moderationNote ? `<p class="lead-sub">Moderation note: ${E(p.moderationNote)}</p>` : ''}
      <div style="margin: 12px 0;">${postActions(p)}</div>
      ${reports.length ? `<h4>Reports (${reports.length})</h4><ul>${reports.map(r => `<li>${E(REASON_LABELS[r.reason] || r.reason)} by ${E(r.reporter ? r.reporter.name : '—')} · ${E(r.status.replace('_', ' '))}${r.note ? `: ${E(r.note)}` : ''}</li>`).join('')}</ul>` : ''}
      <h4>Comments (${comments.length})</h4>
      <ul style="list-style: none; padding: 0;">${commentRows || '<li class="lead-sub">No comments.</li>'}</ul>
    </div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeSocialPost(); });
  // Before the reason dialog, so hiding something from here opens that dialog on top
  document.getElementById('reasonModal').before(wrap);
}

async function moderateSocialComment(id, action, postId) {
  const send = async note => {
    const { ok, data } = await adminFetch(`/api/v1/admin/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note }) });
    if (!ok) throw new Error(data.message || 'Could not update the comment.');
    showAdminToast(action === 'hide' ? 'Comment hidden.' : 'Comment is visible again.', 'success');
    openSocialPost(postId);
  };
  if (action === 'unhide') {
    try { await send(''); } catch (e) { showAdminToast(e.message, 'error'); }
    return;
  }
  askReason({ title: 'Hide this comment', lead: 'Hidden comments disappear from the post in the app.', label: 'Reason', confirmLabel: 'Hide comment', maxLength: 300, onSubmit: send });
}

SUB_LOADERS.social = () => loadSocial(1);
