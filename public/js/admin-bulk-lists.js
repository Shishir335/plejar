/* What can be done to many rows at once, list by list (the engine is js/admin-bulk.js).
 * Every action calls the same endpoint as that row's own button. Each list also gets Export CSV of what is ticked.
 * Lists that only record things (sign-ins, activity, broadcasts) have selection and export only.
 */
(() => {
  const api = '/api/v1/admin';
  const adminOnly = () => isMoneyAdmin();
  const notStaff = u => !rolesOf(u).some(r => ['admin', 'manager', 'dev'].includes(r));

  // ---------- Users ----------
  bulkTable('users', {
    tbody: 'usersTableBody', noun: ['account', 'accounts'], file: 'accounts', id: u => u.id,
    reload: () => loadUsers(U.page),
    actions: [
      {
        label: 'Suspend', style: 'danger', done: 'Suspended',
        when: u => !u.deleted && u.status === 'active' && notStaff(u),
        reason: { lead: 'They are signed out and cannot sign in until you reactivate them. Each one sees this reason when they try.', label: 'Reason (they see this)', confirmLabel: 'Suspend' },
        run: (u, reason) => bulkSend(`${api}/users/${u.id}/status`, 'POST', { status: 'suspended', reason })
      },
      {
        label: 'Deactivate', style: 'danger', done: 'Deactivated',
        when: u => !u.deleted && u.status === 'active' && notStaff(u),
        reason: { lead: 'The accounts are switched off until you reactivate them.', label: 'Reason (they see this)', confirmLabel: 'Deactivate' },
        run: (u, reason) => bulkSend(`${api}/users/${u.id}/status`, 'POST', { status: 'deactivated', reason })
      },
      {
        label: 'Reactivate', style: 'primary', done: 'Reactivated',
        when: u => !u.deleted && u.status !== 'active',
        confirm: 'They can sign in again.',
        run: u => bulkSend(`${api}/users/${u.id}/status`, 'POST', { status: 'active' })
      },
      {
        label: 'Delete', style: 'danger', done: 'Deleted',
        when: u => !u.deleted && notStaff(u),
        reason: { lead: 'The accounts are hidden and can no longer sign in. Bookings, reviews and history are kept, and you can restore them from the Deleted filter.', label: 'Reason for deleting', confirmLabel: 'Delete accounts' },
        run: (u, reason) => bulkSend(`${api}/users/${u.id}`, 'DELETE', { reason })
      },
      {
        label: 'Restore', style: 'primary', done: 'Restored',
        when: u => u.deleted,
        confirm: 'They can sign in again.',
        run: u => bulkSend(`${api}/users/${u.id}/restore`, 'POST')
      }
    ]
  });

  bulkTable('verify', {
    tbody: 'verifyTableBody', noun: ['person', 'people'], file: 'identity-checks', id: u => u.id,
    reload: () => loadVerificationQueue(),
    actions: [
      {
        label: 'Approve identity', style: 'primary', done: 'Verified',
        when: u => u.verification && u.verification.status !== 'approved',
        confirm: 'Only approve documents you have opened and checked.',
        run: u => bulkSend(`${api}/users/${u.id}/verify`, 'POST', { decision: 'approve' })
      },
      {
        label: 'Reject', style: 'danger', done: 'Rejected',
        when: u => u.verification && u.verification.status !== 'rejected',
        reason: { lead: 'Each person sees this note and can upload again.', label: 'What to fix (they see this)', confirmLabel: 'Reject' },
        run: (u, note) => bulkSend(`${api}/users/${u.id}/verify`, 'POST', { decision: 'reject', note })
      }
    ]
  });

  const complaintStatus = (status, label, extra = {}) => ({
    label, done: label,
    when: c => c.status !== status,
    ...extra,
    run: (c, resolution) => bulkSend(`${api}/complaints/${c._id}`, 'PATCH', { status, ...(resolution ? { resolution } : {}) })
  });
  bulkTable('complaints', {
    tbody: 'complaintsTableBody', noun: ['complaint', 'complaints'], file: 'complaints',
    reload: () => loadComplaints(),
    actions: [
      complaintStatus('in_review', 'Mark in review', { confirm: false }),
      complaintStatus('resolved', 'Resolve', { style: 'primary', reason: { lead: 'Every traveler who complained sees this resolution.', label: 'Resolution (shown to the traveler)', confirmLabel: 'Resolve', danger: false, maxLength: 1000 } }),
      complaintStatus('dismissed', 'Dismiss', { reason: { lead: 'Every traveler who complained sees this note.', label: 'Why (shown to the traveler)', confirmLabel: 'Dismiss', maxLength: 1000 } }),
      ...['high', 'normal', 'low'].map(priority => ({
        label: `Priority: ${priority}`, done: `Priority set to ${priority}`, confirm: false,
        when: c => c.priority !== priority,
        run: c => bulkSend(`${api}/complaints/${c._id}`, 'PATCH', { priority })
      }))
    ]
  });

  bulkTable('reviews', {
    tbody: 'reviewsTableBody', noun: ['review', 'reviews'], file: 'reviews',
    reload: () => loadReviews(),
    actions: [
      {
        label: 'Hide', style: 'danger', done: 'Hidden',
        when: r => r.status !== 'hidden',
        reason: { lead: 'Hidden reviews no longer count towards the rating or show to travelers.', label: 'Reason', confirmLabel: 'Hide reviews' },
        run: (r, reason) => bulkSend(`${api}/reviews/${r._id}`, 'PATCH', { hidden: true, reason })
      },
      {
        label: 'Make visible', style: 'primary', done: 'Made visible', confirm: false,
        when: r => r.status === 'hidden',
        run: r => bulkSend(`${api}/reviews/${r._id}`, 'PATCH', { hidden: false })
      }
    ]
  });

  bulkTable('logins', { tbody: 'loginsTableBody', noun: ['sign-in', 'sign-ins'], file: 'sign-ins' });
  bulkTable('activity', { tbody: 'activityTableBody', noun: ['entry', 'entries'], file: 'activity' });

  // ---------- Social (reports and posts share one table) ----------
  const isReport = x => 'reason' in x && 'targetType' in x;
  bulkTable('social', {
    tbody: 'socialTableBody', noun: ['item', 'items'], file: 'social',
    scope: () => val('sView'),
    reload: () => loadSocial(),
    actions: [
      {
        label: 'Hide reported items', style: 'danger', done: 'Hidden',
        when: x => isReport(x) && x.status === 'open' && x.targetType !== 'user',
        reason: { lead: 'Each item disappears from the app and its author is told why. Every open report on it is closed.', label: 'Reason (the author sees this)', confirmLabel: 'Hide and close', maxLength: 300 },
        run: (r, resolution) => bulkSend(`${api}/social-reports/${r._id}`, 'PATCH', { status: 'action_taken', resolution, hideTarget: true, restrictUser: false })
      },
      {
        label: 'Dismiss reports', done: 'Dismissed',
        when: x => isReport(x) && x.status === 'open',
        reason: { lead: 'Nothing changes in the app. Every open report on the same items is closed.', label: 'Note for the team', confirmLabel: 'Dismiss', danger: false, maxLength: 300 },
        run: (r, resolution) => bulkSend(`${api}/social-reports/${r._id}`, 'PATCH', { status: 'dismissed', resolution })
      },
      {
        label: 'Hide posts', style: 'danger', done: 'Hidden',
        when: x => !isReport(x) && x.status === 'active',
        reason: { lead: 'The posts disappear from the app and each author is told why. You can show them again later.', label: 'Reason (the author sees this)', confirmLabel: 'Hide posts', maxLength: 300 },
        run: (p, note) => bulkSend(`${api}/posts/${p._id}`, 'PATCH', { action: 'hide', note })
      },
      {
        label: 'Show again', style: 'primary', done: 'Shown again', confirm: false,
        when: x => !isReport(x) && x.status === 'hidden',
        run: p => bulkSend(`${api}/posts/${p._id}`, 'PATCH', { action: 'unhide', note: '' })
      },
      {
        label: 'Remove posts', style: 'danger', done: 'Removed',
        when: x => !isReport(x) && x.status !== 'removed',
        reason: { lead: 'The posts are removed for good and each author is told why.', label: 'Reason (the author sees this)', confirmLabel: 'Remove posts', maxLength: 300 },
        run: (p, note) => bulkSend(`${api}/posts/${p._id}`, 'PATCH', { action: 'remove', note })
      }
    ]
  });

  // ---------- Vendors ----------
  bulkTable('vendors', {
    tbody: 'vendorsTableBody', noun: ['vendor', 'vendors'], file: 'vendors', id: v => v.id,
    scope: () => V.kind,
    reload: () => { loadVendors(V.page); loadVendorSummary(); },
    actions: [
      {
        label: 'Suspend', style: 'danger', done: 'Suspended',
        when: v => v.status === 'active',
        reason: { lead: 'Their teams are signed out and travelers cannot book them until you reactivate them.', label: 'Reason (they see this)', confirmLabel: 'Suspend' },
        run: (v, reason) => bulkSend(`${api}/vendors/${v.id}/status`, 'POST', { status: 'suspended', reason })
      },
      {
        label: 'Deactivate', style: 'danger', done: 'Deactivated',
        when: v => v.status === 'active',
        reason: { lead: 'Switched off, for example a closed business. You can reactivate them later.', label: 'Reason (they see this)', confirmLabel: 'Deactivate' },
        run: (v, reason) => bulkSend(`${api}/vendors/${v.id}/status`, 'POST', { status: 'deactivated', reason })
      },
      {
        label: 'Reactivate', style: 'primary', done: 'Reactivated',
        when: v => v.status && v.status !== 'active',
        confirm: 'Their teams can use their panels again and travelers can book them.',
        run: v => bulkSend(`${api}/vendors/${v.id}/status`, 'POST', { status: 'active' })
      }
    ]
  });

  bulkTable('packages', {
    tbody: 'packagesTableBody', noun: ['tour event', 'tour events'], file: 'tour-events',
    reload: () => loadPackages(V.pkPage),
    actions: [
      {
        label: 'Hide', style: 'danger', done: 'Hidden',
        when: p => p.agency && p.agency._id && p.status !== 'cancelled' && !p.hiddenByAdmin,
        confirm: 'Their vendors cannot publish them again until you allow them.',
        run: p => bulkSend(`${api}/agencies/${p.agency._id}/packages/${p._id}`, 'PATCH', { hidden: true })
      },
      {
        label: 'Allow again', style: 'primary', done: 'Allowed again', confirm: false,
        when: p => p.agency && p.agency._id && p.status !== 'cancelled' && p.hiddenByAdmin,
        run: p => bulkSend(`${api}/agencies/${p.agency._id}/packages/${p._id}`, 'PATCH', { hidden: false })
      }
    ]
  });

  bulkTable('categories', {
    tbody: 'categoriesTableBody', noun: ['category', 'categories'], file: 'tour-categories',
    reload: () => loadCategories(),
    actions: [
      { label: 'Switch on', style: 'primary', done: 'Switched on', confirm: false, allowed: adminOnly, when: c => !c.active, run: c => bulkSend(`${api}/vendor-categories/${c._id}`, 'PATCH', { active: true }) },
      { label: 'Switch off', done: 'Switched off', allowed: adminOnly, when: c => c.active, confirm: 'Vendors can no longer pick them.', run: c => bulkSend(`${api}/vendor-categories/${c._id}`, 'PATCH', { active: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "This can't be undone.", run: c => bulkSend(`${api}/vendor-categories/${c._id}`, 'DELETE') }
    ]
  });

  const bookingStep = (to, label, extra = {}) => ({
    label, done: label === 'Confirm' ? 'Confirmed' : label === 'Mark completed' ? 'Completed' : 'Cancelled',
    when: b => (BOOKING_NEXT[b.status] || []).includes(to),
    ...extra,
    run: (b, reason) => bulkSend(`${api}/bookings/${b._id}`, 'PATCH', { status: to, ...(reason ? { reason } : {}) })
  });
  bulkTable('bookings', {
    tbody: 'bookingsTableBody', noun: ['booking', 'bookings'], file: 'bookings',
    reload: () => loadBookings(),
    actions: [
      bookingStep('confirmed', 'Confirm', { style: 'primary', confirm: 'Each traveler is told their booking is confirmed.' }),
      bookingStep('completed', 'Mark completed', { confirm: 'Only for trips and stays that have happened.' }),
      bookingStep('cancelled', 'Cancel', { style: 'danger', reason: { lead: 'Each traveler and vendor sees this reason. Refunds are not sent automatically: settle any payment separately.', label: 'Reason for cancelling', confirmLabel: 'Cancel bookings' } })
    ]
  });

  bulkTable('payouts', {
    tbody: 'payoutsTableBody', noun: ['payout', 'payouts'], file: 'payouts',
    reload: () => loadPayouts(),
    actions: [
      {
        label: 'Reject', style: 'danger', done: 'Rejected', allowed: adminOnly,
        when: p => p.status === 'pending',
        reason: { lead: 'Each vendor sees this reason. The money stays in their balance.', label: 'Reason (the vendor sees this)', confirmLabel: 'Reject payouts' },
        run: (p, reason) => bulkSend(`${api}/payouts/${p._id}`, 'PATCH', { action: 'reject', reason })
      }
    ]
  });

  bulkTable('commission', { tbody: 'commissionTableBody', noun: ['vendor', 'vendors'], file: 'commission', id: v => v.id });
  bulkTable('vendorActivity', { tbody: 'vendorActivityBody', noun: ['entry', 'entries'], file: 'vendor-activity' });
  bulkTable('pendingReview', { tbody: 'pendingReviewBody', noun: ['vendor', 'vendors'], file: 'documents-to-review', id: a => a.id });
  bulkTable('pendingInvite', {
    tbody: 'pendingInviteBody', noun: ['vendor', 'vendors'], file: 'invites-pending', id: a => a.id,
    reload: () => loadPendingAgencies(),
    actions: [{
      label: 'Resend invite', style: 'primary', done: 'Invites sent',
      when: a => a.owner && a.owner.id,
      confirm: 'Each owner gets a new invite email. Older links stop working.',
      run: a => bulkSend(`${api}/agencies/${a.id}/members/${a.owner.id}/resend`, 'POST')
    }]
  });

  const undecided = r => !['approved', 'rejected'].includes(r.status);
  bulkTable('applications', {
    tbody: 'applicationsTableBody', noun: ['application', 'applications'], file: 'applications',
    scope: () => `${V.kind}:${AP.status}`,
    reload: () => { loadApplications(); loadVendorSummary(); },
    actions: [
      { label: 'Mark as reviewing', done: 'Marked as reviewing', confirm: false, when: r => r.status === 'new', run: r => bulkSend(`${api}/applications/${r._id}`, 'PATCH', { status: 'reviewing' }) },
      {
        label: 'Ask for more', done: 'Asked for more',
        when: r => undecided(r) && r.status !== 'archived',
        reason: { lead: 'Each applicant gets this by email and replies on their application page. Be specific about what is missing.', label: 'What do you need?', confirmLabel: 'Send request', danger: false, maxLength: 2000 },
        run: (r, message) => bulkSend(`${api}/applications/${r._id}/request-info`, 'POST', { message })
      },
      {
        label: 'Reject', style: 'danger', done: 'Rejected',
        when: undecided,
        reason: { lead: 'Each applicant sees this reason in the email and on their application page. They can apply again later.', label: 'Reason', confirmLabel: 'Reject applications', maxLength: 1000 },
        run: (r, reason) => bulkSend(`${api}/applications/${r._id}/reject`, 'POST', { reason })
      },
      { label: 'Archive', done: 'Archived', when: r => undecided(r) && r.status !== 'archived', confirm: 'They are put away without a decision. You can reopen them.', run: r => bulkSend(`${api}/applications/${r._id}`, 'PATCH', { status: 'archived' }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "Their documents are deleted too. This can't be undone.", run: r => bulkSend(`${api}/applications/${r._id}`, 'DELETE') }
    ]
  });

  // ---------- Content ----------
  bulkTable('banners', {
    tbody: 'bannersTableBody', noun: ['banner', 'banners'], file: 'banners',
    reload: () => loadBanners(),
    actions: [
      { label: 'Turn on', style: 'primary', done: 'Turned on', confirm: false, when: b => b.active === false, run: b => bulkSend(`${api}/promotions/${b._id}`, 'PATCH', { active: true }) },
      { label: 'Turn off', done: 'Turned off', confirm: 'They stop showing on the Tours screen.', when: b => b.active !== false, run: b => bulkSend(`${api}/promotions/${b._id}`, 'PATCH', { active: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "This can't be undone.", run: b => bulkSend(`${api}/promotions/${b._id}`, 'DELETE') }
    ]
  });

  bulkTable('adRequests', {
    tbody: 'adRequestsTableBody', noun: ['ad', 'ads'], file: 'ad-requests',
    scope: () => C.adStatus,
    reload: () => loadAdRequests(),
    actions: [
      { label: 'Accept', style: 'primary', done: 'Accepted', when: a => a.state === 'pending', confirm: "They show on the app's Tours screen during their dates.", run: a => bulkSend(`${api}/ad-requests/${a._id}/approve`, 'POST', {}) },
      {
        label: 'Reject', style: 'danger', done: 'Rejected', when: a => a.state === 'pending',
        reason: { lead: 'Each vendor sees this note and can send the ad again.', label: 'Note to the vendors', confirmLabel: 'Reject ads', maxLength: 500 },
        run: (a, reason) => bulkSend(`${api}/ad-requests/${a._id}/reject`, 'POST', { reason })
      }
    ]
  });

  bulkTable('adPayments', {
    tbody: 'adPaymentsTableBody', noun: ['payment', 'payments'], file: 'payments',
    scope: () => C.paymentStatus,
    reload: () => loadAdPayments(),
    actions: [{
      label: 'Try refund again', style: 'primary', done: 'Refunds asked again', allowed: adminOnly,
      when: p => p.status === 'refund_failed',
      confirm: 'The payment gateway is asked again to refund each one.',
      run: p => bulkSend(`${api}/ad-payments/${p._id}/refund`, 'POST', {})
    }]
  });

  bulkTable('hotels', {
    tbody: 'hotelsTableBody', noun: ['listing', 'listings'], file: 'hotel-listings',
    reload: () => loadHotels(),
    actions: [
      { label: 'Publish', style: 'primary', done: 'Published', when: h => h.status !== 'published', confirm: 'Travelers see them in the app.', run: h => bulkSend(`${api}/hotels/${h._id}`, 'PATCH', { status: 'published' }) },
      { label: 'Move to draft', done: 'Moved to draft', when: h => h.status !== 'draft', confirm: "Travelers won't see them until they are published.", run: h => bulkSend(`${api}/hotels/${h._id}`, 'PATCH', { status: 'draft' }) },
      { label: 'Hide', done: 'Hidden', when: h => h.status !== 'hidden', confirm: 'They are hidden from travelers.', run: h => bulkSend(`${api}/hotels/${h._id}`, 'PATCH', { status: 'hidden' }) },
      { label: 'Feature', done: 'Featured', confirm: false, when: h => !h.featured, run: h => bulkSend(`${api}/hotels/${h._id}`, 'PATCH', { featured: true }) },
      { label: 'Unfeature', done: 'Unfeatured', confirm: false, when: h => h.featured, run: h => bulkSend(`${api}/hotels/${h._id}`, 'PATCH', { featured: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "Their photos are deleted too. This can't be undone.", run: h => bulkSend(`${api}/hotels/${h._id}`, 'DELETE') }
    ]
  });

  bulkTable('vouchers', {
    tbody: 'vouchersTableBody', noun: ['voucher', 'vouchers'], file: 'vouchers',
    reload: () => loadVouchers(),
    actions: [
      { label: 'Turn on', style: 'primary', done: 'Turned on', confirm: false, when: v => v.active === false, run: v => bulkSend(`${api}/vouchers/${v._id}`, 'PATCH', { active: true }) },
      { label: 'Turn off', done: 'Turned off', when: v => v.active !== false, confirm: "Travelers can't redeem them. Codes already redeemed keep working.", run: v => bulkSend(`${api}/vouchers/${v._id}`, 'PATCH', { active: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: 'Vouchers travelers already redeemed are switched off instead, so their codes keep working.', run: v => bulkSend(`${api}/vouchers/${v._id}`, 'DELETE') }
    ]
  });

  bulkTable('help', {
    tbody: 'helpTableBody', noun: ['question', 'questions'], file: 'help-center',
    reload: () => loadHelp(),
    actions: [
      { label: 'Publish', style: 'primary', done: 'Published', confirm: false, when: a => !a.published, run: a => bulkSend(`${api}/help/articles/${a._id}`, 'PATCH', { published: true }) },
      { label: 'Hide', done: 'Hidden', confirm: false, when: a => a.published, run: a => bulkSend(`${api}/help/articles/${a._id}`, 'PATCH', { published: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "This can't be undone.", run: a => bulkSend(`${api}/help/articles/${a._id}`, 'DELETE') }
    ]
  });

  bulkTable('destinationCategories', {
    tbody: 'destinationCategoriesBody', noun: ['category', 'categories'], file: 'place-categories',
    reload: () => loadDestinationCategories(),
    actions: [
      { label: 'Switch on', style: 'primary', done: 'Switched on', confirm: false, when: c => !c.active, run: c => bulkSend(`${api}/destination-categories/${c._id}`, 'PATCH', { active: true }) },
      { label: 'Switch off', done: 'Switched off', when: c => c.active, confirm: 'They stop showing as filters.', run: c => bulkSend(`${api}/destination-categories/${c._id}`, 'PATCH', { active: false }) },
      { label: 'Delete', style: 'danger', done: 'Deleted', allowed: adminOnly, confirm: "This can't be undone.", run: c => bulkSend(`${api}/destination-categories/${c._id}`, 'DELETE') }
    ]
  });

  // ---------- Subscribers and notifications ----------
  bulkTable('subscribers', {
    tbody: 'subscribersTableBody', noun: ['subscriber', 'subscribers'], file: 'subscribers',
    reload: () => loadSubscribers(),
    actions: [{ label: 'Remove', style: 'danger', done: 'Removed', confirm: 'They stop getting the newsletter.', run: s => bulkSend(`/api/v1/subscribers/${s._id}`, 'DELETE') }]
  });

  bulkTable('broadcasts', { tbody: 'adminBroadcastHistoryBody', noun: ['notification', 'notifications'], file: 'broadcasts' });
})();
