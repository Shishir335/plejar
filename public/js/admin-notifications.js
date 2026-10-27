// Master Admin Notifications & Broadcast Management

let adminNotifState = {
  stats: null,
  history: [],
  page: 1,
  totalPages: 1,
  scopeFilter: 'all'
};

/**
 * Initializes and loads notification statistics and history.
 */
async function loadAdminNotifications(forceRefresh = false) {
  setupAdminNotificationListeners();
  await Promise.all([
    fetchAdminNotificationStats(),
    fetchAdminBroadcastHistory(1, adminNotifState.scopeFilter)
  ]);
}

/**
 * Fetches audience counts and FCM token statistics.
 */
async function fetchAdminNotificationStats() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/notifications/stats');
    if (!ok || !data) return;

    const stats = (data && data.data) ? data.data : data;
    adminNotifState.stats = stats;

    const nf = new Intl.NumberFormat('en-US');
    const elTravelers = document.getElementById('notifTravelersCount');
    const elTravelersWithFcm = document.getElementById('notifTravelersWithFcm');
    const elVendors = document.getElementById('notifVendorsCount');
    const elVendorsWithFcm = document.getElementById('notifVendorsWithFcm');
    const elTotalTokens = document.getElementById('notifTotalTokens');

    if (elTravelers) elTravelers.textContent = nf.format(stats.travelersCount || 0);
    if (elTravelersWithFcm) elTravelersWithFcm.textContent = `${nf.format(stats.travelersWithFcm || 0)} with active device tokens`;
    if (elVendors) elVendors.textContent = nf.format(stats.vendorsCount || 0);
    if (elVendorsWithFcm) elVendorsWithFcm.textContent = `${nf.format(stats.vendorsWithFcm || 0)} with active device tokens`;
    if (elTotalTokens) elTotalTokens.textContent = nf.format(stats.totalTokens || 0);

    const rUsers = document.getElementById('radioCountUsers');
    const rVendors = document.getElementById('radioCountVendors');
    const rAll = document.getElementById('radioCountAll');

    if (rUsers) rUsers.textContent = `(${nf.format(stats.travelersCount || 0)} accounts)`;
    if (rVendors) rVendors.textContent = `(${nf.format(stats.vendorsCount || 0)} accounts)`;
    if (rAll) rAll.textContent = `(${nf.format(stats.totalUsers || 0)} total)`;
  } catch (err) {
    console.warn('[Admin Notifications] Failed to fetch stats:', err);
  }
}

/**
 * Sets up character counters and audience change listeners.
 */
function setupAdminNotificationListeners() {
  const titleInput = document.getElementById('adminNotifTitle');
  const bodyInput = document.getElementById('adminNotifBody');
  const titleCount = document.getElementById('adminTitleCount');
  const bodyCount = document.getElementById('adminBodyCount');

  if (titleInput && titleCount && !titleInput.dataset.hasListener) {
    titleInput.dataset.hasListener = 'true';
    titleInput.addEventListener('input', () => {
      titleCount.textContent = `${titleInput.value.length} / 120`;
    });
  }

  if (bodyInput && bodyCount && !bodyInput.dataset.hasListener) {
    bodyInput.dataset.hasListener = 'true';
    bodyInput.addEventListener('input', () => {
      bodyCount.textContent = `${bodyInput.value.length} / 1000`;
    });
  }
}

/**
 * Toggles test email input depending on selected audience.
 */
function toggleAdminAudienceFields() {
  const selected = document.querySelector('input[name="adminAudience"]:checked');
  const testGroup = document.getElementById('adminTestEmailGroup');
  const testInput = document.getElementById('adminTestEmail');

  if (!selected || !testGroup) return;

  if (selected.value === 'test') {
    testGroup.style.display = 'block';
    if (testInput) testInput.required = true;
  } else {
    testGroup.style.display = 'none';
    if (testInput) testInput.required = false;
  }
}

/**
 * Resets the broadcast form fields and feedback.
 */
function resetAdminBroadcastForm() {
  const form = document.getElementById('adminBroadcastForm');
  if (form) form.reset();

  const titleCount = document.getElementById('adminTitleCount');
  const bodyCount = document.getElementById('adminBodyCount');
  if (titleCount) titleCount.textContent = '0 / 120';
  if (bodyCount) bodyCount.textContent = '0 / 1000';

  toggleAdminAudienceFields();
  setAdminNotifFeedback('', 'clear');
}

/**
 * Displays status feedback inside the composer.
 */
function setAdminNotifFeedback(msg, type = 'error') {
  const fb = document.getElementById('adminNotifFeedback');
  if (!fb) return;

  if (!msg || type === 'clear') {
    fb.style.display = 'none';
    fb.textContent = '';
    return;
  }

  fb.style.display = 'block';
  fb.textContent = msg;

  if (type === 'error') {
    fb.style.background = 'rgba(239, 68, 68, 0.15)';
    fb.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    fb.style.color = '#ef4444';
  } else if (type === 'success') {
    fb.style.background = 'rgba(34, 197, 94, 0.15)';
    fb.style.border = '1px solid rgba(34, 197, 94, 0.4)';
    fb.style.color = '#22c55e';
  } else {
    fb.style.background = 'rgba(59, 130, 246, 0.15)';
    fb.style.border = '1px solid rgba(59, 130, 246, 0.4)';
    fb.style.color = '#60a5fa';
  }
}

/**
 * Handles sending a broadcast notification from the Master Admin.
 */
async function handleSendAdminBroadcast(event) {
  event.preventDefault();
  setAdminNotifFeedback('', 'clear');

  const audienceEl = document.querySelector('input[name="adminAudience"]:checked');
  const audience = audienceEl ? audienceEl.value : 'users';
  const title = (document.getElementById('adminNotifTitle')?.value || '').trim();
  const body = (document.getElementById('adminNotifBody')?.value || '').trim();
  const route = (document.getElementById('adminNotifRoute')?.value || '/notifications').trim();
  const imageUrl = (document.getElementById('adminNotifImageUrl')?.value || '').trim();
  const testEmail = (document.getElementById('adminTestEmail')?.value || '').trim();

  if (!title) {
    return setAdminNotifFeedback('Please enter a notification title.', 'error');
  }
  if (!body) {
    return setAdminNotifFeedback('Please enter a notification message.', 'error');
  }
  if (audience === 'test' && !testEmail) {
    return setAdminNotifFeedback('Please enter the target user email for test mode.', 'error');
  }

  let audName = 'All App Travelers';
  if (audience === 'vendors') audName = 'All Tour Vendors';
  else if (audience === 'all') audName = 'Everyone (All Accounts)';
  else if (audience === 'test') audName = `Test Account (${testEmail})`;

  if (!window.confirm(`Are you sure you want to broadcast "${title}" to ${audName}?\n\nThis will send instant push notifications to their mobile devices.`)) {
    return;
  }

  const submitBtn = document.getElementById('adminNotifSubmitBtn');
  const originalText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '⏳ Broadcasting...';

  try {
    const payload = { audience, title, body, route, imageUrl, testEmail };
    const { ok, data, error } = await adminFetch('/api/v1/admin/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!ok) {
      throw new Error(error || (data && data.message) || 'Failed to send broadcast notification.');
    }

    const resData = (data && data.data) ? data.data : data;
    const pushSent = resData?.pushStats?.sent ?? 0;
    const recipients = resData?.recipientsCount ?? resData?.broadcast?.recipientCount ?? 0;
    const successMsg = `Successfully sent "${title}" to ${recipients} recipient${recipients === 1 ? '' : 's'}. (${pushSent} mobile push notifications delivered).`;

    setAdminNotifFeedback(successMsg, 'success');
    showAdminToast(successMsg, 'success');

    // Reset inputs
    document.getElementById('adminNotifTitle').value = '';
    document.getElementById('adminNotifBody').value = '';
    document.getElementById('adminTitleCount').textContent = '0 / 120';
    document.getElementById('adminBodyCount').textContent = '0 / 1000';

    // Refresh history and stats
    await Promise.all([
      fetchAdminNotificationStats(),
      fetchAdminBroadcastHistory(1, adminNotifState.scopeFilter)
    ]);
  } catch (err) {
    setAdminNotifFeedback(err.message, 'error');
    showAdminToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

/**
 * Filter broadcast history by scope ('all', 'admin', 'agency').
 */
function filterBroadcastHistory(scope) {
  adminNotifState.scopeFilter = scope;

  const btnAll = document.getElementById('btnFilterAllBroadcasts');
  const btnAdmin = document.getElementById('btnFilterAdminBroadcasts');
  const btnVendor = document.getElementById('btnFilterVendorBroadcasts');

  [btnAll, btnAdmin, btnVendor].forEach(b => {
    if (b) {
      b.classList.remove('btn-primary');
      b.classList.add('btn-secondary');
    }
  });

  if (scope === 'admin' && btnAdmin) {
    btnAdmin.classList.add('btn-primary');
    btnAdmin.classList.remove('btn-secondary');
  } else if (scope === 'agency' && btnVendor) {
    btnVendor.classList.add('btn-primary');
    btnVendor.classList.remove('btn-secondary');
  } else if (btnAll) {
    btnAll.classList.add('btn-primary');
    btnAll.classList.remove('btn-secondary');
  }

  fetchAdminBroadcastHistory(1, scope);
}

/**
 * Fetches and displays broadcast history.
 */
async function fetchAdminBroadcastHistory(page = 1, scope = 'all') {
  const tbody = document.getElementById('adminBroadcastHistoryBody');
  if (!tbody) return;

  try {
    let url = `/api/v1/admin/notifications/history?page=${page}&limit=20`;
    if (scope && scope !== 'all') url += `&scope=${scope}`;

    const { ok, data } = await adminFetch(url);
    if (!ok || !data) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">Failed to load history.</td></tr>';
      return;
    }

    const pagedData = (data && data.data) ? data.data : data;
    const broadcasts = pagedData.broadcasts || [];
    if (!broadcasts.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No broadcast notifications sent yet.</td></tr>';
      renderBroadcastPagination(pagedData);
      return;
    }

    tbody.innerHTML = broadcasts.map(b => {
      const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      }) : '-';

      const scopeBadge = b.scope === 'admin'
        ? '<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">ADMIN</span>'
        : '<span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">VENDOR</span>';

      let audienceDesc = b.audience;
      if (b.audience === 'users') audienceDesc = 'App Travelers';
      else if (b.audience === 'vendors') audienceDesc = 'Tour Vendors';
      else if (b.audience === 'all') audienceDesc = 'Everyone';
      else if (b.audience === 'followers') audienceDesc = 'Agency Followers';
      else if (b.audience === 'all_users') audienceDesc = 'All Travelers';
      else if (b.audience === 'event') audienceDesc = `Event (${escapeAdminHtml(b.eventTitle || 'Tour')})`;
      else if (b.audience === 'travelers') audienceDesc = 'Previous Travelers';
      else if (b.audience === 'test') audienceDesc = 'Single Test Account';

      const senderName = b.sentByName || (b.sentBy && b.sentBy.name) || (b.agency && b.agency.name) || 'System';
      const senderAgency = b.agency ? ` (${escapeAdminHtml(b.agency.name)})` : '';

      const pushSent = b.pushStats?.sent || 0;
      const pushFailed = b.pushStats?.failed || 0;
      const pushTotal = b.pushStats?.totalTokens || (pushSent + pushFailed);

      let pushResultBadge = '<span style="color: var(--text-muted); font-size: 0.85rem;">-</span>';
      if (pushTotal > 0) {
        pushResultBadge = `<span style="font-size: 0.85rem;"><strong style="color: #22c55e;">${pushSent}</strong> sent${pushFailed > 0 ? `, <span style="color: #ef4444;">${pushFailed} failed</span>` : ''}</span>`;
      }

      return `
        <tr>
          <td style="white-space: nowrap; font-size: 0.82rem; color: var(--text-muted);">${dateStr}</td>
          <td>
            <div style="font-weight: 600; font-size: 0.92rem; margin-bottom: 2px;">${escapeAdminHtml(b.title)}</div>
            <div style="font-size: 0.83rem; color: var(--text-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeAdminHtml(b.body || '')}</div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
              ${scopeBadge}
              <span style="font-size: 0.84rem; font-weight: 500;">${audienceDesc}</span>
            </div>
          </td>
          <td style="font-size: 0.85rem;">
            <div>${escapeAdminHtml(senderName)}${senderAgency}</div>
          </td>
          <td style="font-size: 0.88rem; font-weight: 600;">${b.recipientCount || 0}</td>
          <td>${pushResultBadge}</td>
        </tr>
      `;
    }).join('');

    renderBroadcastPagination(data);
  } catch (err) {
    console.warn('[Admin Notifications] History error:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">${escapeAdminHtml(err.message)}</td></tr>`;
  }
}

/**
 * Renders pagination controls for broadcast history.
 */
function renderBroadcastPagination(pagedData) {
  const container = document.getElementById('adminBroadcastHistoryPagination');
  if (!container) return;

  const current = pagedData.page || 1;
  const totalPages = pagedData.totalPages || 1;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <button class="btn btn-secondary btn-sm" ${current <= 1 ? 'disabled' : ''} onclick="fetchAdminBroadcastHistory(${current - 1}, '${adminNotifState.scopeFilter}')">&larr; Previous</button>
    <span style="font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; padding: 0 8px;">Page ${current} of ${totalPages}</span>
    <button class="btn btn-secondary btn-sm" ${current >= totalPages ? 'disabled' : ''} onclick="fetchAdminBroadcastHistory(${current + 1}, '${adminNotifState.scopeFilter}')">Next &rarr;</button>
  `;
}

function escapeAdminHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
