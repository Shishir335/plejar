/**
 * Every route the running server answers, grouped into categories, with who may call it.
 * Built from Express's own route table, so it never goes out of date. Who may call a route
 * comes from labels on the security checks (authController.protect / restrictTo,
 * agencyController.requireAgent / requireOwner).
 */

// Checked in order: the first rule whose test matches a path decides its category
const CATEGORIES = [
  { key: 'admin-dashboard', name: 'Admin: dashboard', description: 'Numbers for the master admin dashboard.', test: p => /^\/api\/v1\/admin\/(dashboard|stats)/.test(p) },
  { key: 'admin-users', name: 'Admin: users', description: 'Accounts, verification, complaints, reviews, sign-ins and activity.', test: p => /^\/api\/v1\/admin\/(users|activity|logins|complaints|reviews|wallet)/.test(p) },
  { key: 'admin-applications', name: 'Admin: membership applications', description: 'Reviewing agencies that applied on the website.', test: p => p.startsWith('/api/v1/admin/applications') },
  { key: 'admin-vendors', name: 'Admin: vendors', description: 'Vendors, their teams, passwords, verification, contracts, categories, reports.', test: p => /^\/api\/v1\/admin\/(vendors|agencies|vendor-categories)/.test(p) },
  { key: 'admin-money', name: 'Admin: bookings and payouts', description: 'Every booking, payouts to vendors and the commission setting.', test: p => /^\/api\/v1\/admin\/(bookings|payouts|settings)/.test(p) },
  { key: 'admin-destinations', name: 'Admin: destinations', description: 'Managing destinations, photos, featured and trending places, categories.', test: p => /^\/api\/v1\/admin\/(destinations|destination-categories)/.test(p) },
  { key: 'admin-social', name: 'Admin: posts and reports', description: 'Moderating traveler posts and comments from the app, and the reports on them.', test: p => /^\/api\/v1\/admin\/(posts|comments|social-reports)/.test(p) },
  { key: 'admin-system', name: 'Admin: system', description: 'Technical tools for the admin panel, such as this list of endpoints.', test: p => p.startsWith('/api/v1/admin') },
  { key: 'vendor', name: 'Vendor panel', description: 'What a signed-in tour agency can do in its own panel.', test: p => p.startsWith('/api/v1/agency') },
  { key: 'users', name: 'Users and sign-in', description: 'Sign up, sign in, passwords, profiles and account management.', test: p => p.startsWith('/api/v1/users') },
  { key: 'destinations', name: 'Destinations (app)', description: 'Published destinations and categories for the app and website.', test: p => /^\/api\/v1\/(destinations|destination-categories)/.test(p) },
  { key: 'events', name: 'Tour events and announcements (app)', description: 'Published tour events with their plans, and vendor announcements.', test: p => /^\/api\/v1\/(events|announcements)/.test(p) },
  { key: 'app-auth', name: 'Sign-in (app)', description: 'Traveler sign-up with email or phone, log in, Google, forgot password with a code, profile step.', test: p => p.startsWith('/api/v1/auth') },
  { key: 'app-feed', name: 'Home feed and posts (app)', description: 'The Home tab: feed, posts with photos and videos, reactions, shares, comments and replies.', test: p => /^\/api\/v1\/(feed|posts|comments)/.test(p) },
  { key: 'app-people', name: 'People (app)', description: 'Traveler profiles, following, blocking and reporting people.', test: p => p.startsWith('/api/v1/people') },
  { key: 'app-agents', name: 'Agents tab (app)', description: 'Browsing tour agencies, their tours and reviews, and following them.', test: p => p.startsWith('/api/v1/agencies') },
  { key: 'app-settings', name: 'Settings tab (app)', description: "The signed-in traveler's own profile, privacy and notification settings, saved posts.", test: p => p.startsWith('/api/v1/me') },
  { key: 'app-config', name: 'App config and live streaming', description: 'Tabs and features the app should show, and the live streaming placeholder.', test: p => p.startsWith('/api/v1/app') },
  { key: 'bookings', name: 'Bookings (travelers)', description: 'Registering for tour events and managing your own bookings.', test: p => p.startsWith('/api/v1/bookings') },
  { key: 'notifications', name: 'Notifications (travelers)', description: "A traveler's in-app notifications.", test: p => p.startsWith('/api/v1/notifications') },
  { key: 'reviews', name: 'Reviews and complaints', description: 'Travelers rating trips and reporting problems.', test: p => /^\/api\/v1\/(reviews|complaints)/.test(p) },
  { key: 'applications', name: 'Membership applications (website)', description: 'Agencies applying to join, and checking their application.', test: p => p.startsWith('/api/v1/applications') },
  { key: 'newsletter', name: 'Newsletter', description: 'Email sign-ups from the website.', test: p => p.startsWith('/api/v1/subscribers') },
  { key: 'system', name: 'System', description: 'Health checks and other technical endpoints.', test: p => p.startsWith('/api/') },
  { key: 'pages', name: 'Web pages', description: 'Pages the server sends to browsers.', test: () => true }
];

// '/api/v1/users' from Express's mount regexp (^\/api\/v1\/users\/?(?=\/|$))
const mountPath = layer => {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  const src = layer.regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
  return /[()[\]|*+?]/.test(src) ? '' : src;
};

const tagOf = fn => {
  if (!fn) return null;
  if (Array.isArray(fn.roles)) return { roles: fn.roles };
  if (fn.access) return { access: fn.access };
  return null;
};

const walk = (stack, prefix, inherited, out) => {
  const active = [...inherited];
  stack.forEach(layer => {
    if (layer.route) {
      [].concat(layer.route.path).forEach(p => {
        const path = `${prefix}${p}`.replace(/\/+$/, '') || '/';
        Object.keys(layer.route.methods).filter(m => m !== '_all').forEach(method => {
          // Only the checks attached to this method (route('/x').get(a).delete(adminOnly, b) guards DELETE only)
          const own = layer.route.stack.filter(l => !l.method || l.method === method).map(l => tagOf(l.handle)).filter(Boolean);
          out.push({ method: method.toUpperCase(), path, tags: [...active.filter(t => path.startsWith(t.path)), ...own] });
        });
      });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const full = `${prefix}${mountPath(layer)}`;
      walk(layer.handle.stack, full, active.filter(t => full.startsWith(t.path)), out);
    } else {
      const tag = tagOf(layer.handle);
      if (tag) active.push({ ...tag, path: `${prefix}${mountPath(layer)}` });
    }
  });
};

// The strictest combination of the checks a route passes through
const accessFor = tags => {
  const roleLists = tags.filter(t => t.roles).map(t => t.roles);
  if (roleLists.length) {
    const roles = roleLists.reduce((a, b) => a.filter(r => b.includes(r)));
    if (roles.includes('manager')) return { access: 'admin-team', label: 'Admin team', roles };
    if (roles.includes('admin')) return { access: 'administrators', label: 'Administrators only', roles };
    return { access: 'roles', label: roles.join(', '), roles };
  }
  if (tags.some(t => t.access === 'vendor-owner')) return { access: 'vendor-owner', label: 'Vendor owner' };
  if (tags.some(t => t.access === 'vendor')) return { access: 'vendor', label: 'Vendor team' };
  if (tags.some(t => t.access === 'signed-in')) return { access: 'signed-in', label: 'Signed in' };
  return { access: 'public', label: 'Public' };
};

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const buildCatalog = app => {
  const raw = [];
  walk(app._router.stack, '', [], raw);

  // A path can appear twice (a rate limit registered before its router); merge them
  const byKey = new Map();
  raw.forEach(r => {
    const key = `${r.method} ${r.path}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, tags: [...prev.tags, ...r.tags] } : r);
  });

  const endpoints = [...byKey.values()]
    .filter(r => r.path !== '*' && r.method !== 'OPTIONS')
    .map(r => ({ method: r.method, path: r.path, ...accessFor(r.tags) }));

  const categories = CATEGORIES.map(c => ({
    key: c.key,
    name: c.name,
    description: c.description,
    endpoints: endpoints
      .filter(e => CATEGORIES.find(x => x.test(e.path)).key === c.key)
      .sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method))
  })).filter(c => c.endpoints.length);

  return { total: endpoints.length, generatedAt: new Date().toISOString(), categories };
};

module.exports = { buildCatalog };
