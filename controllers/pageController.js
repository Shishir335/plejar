const Page = require('../models/pageModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { logActivity } = require('../utils/activity');

// About App, Privacy Policy and Terms & Conditions: read in the app (/api/v1/pages), edited by the admin

const known = key => Page.PAGES.find(p => p.key === key);

const pageView = (meta, page) => {
  const body = page && page.published ? page.body : '';
  return {
    key: meta.key,
    title: (page && page.title) || meta.title,
    published: Boolean(page && page.published),
    body,
    // The same text split at line breaks, for apps that lay paragraphs out one by one
    paragraphs: body ? body.split(/\n+/).map(p => p.trim()).filter(Boolean) : [],
    version: page && page.published ? page.version : 0,
    updatedAt: page && page.published ? page.publishedAt : null
  };
};

// GET /pages — the three pages and whether each one is written yet
exports.listPages = catchAsync(async (req, res) => {
  const rows = await Page.find().lean();
  const byKey = new Map(rows.map(p => [p.key, p]));
  res.status(200).json({
    status: 'success',
    data: {
      pages: Page.PAGES.map(meta => {
        const page = pageView(meta, byKey.get(meta.key));
        return { key: page.key, title: page.title, published: page.published, version: page.version, updatedAt: page.updatedAt, api: `/api/v1/pages/${meta.key}` };
      })
    }
  });
});

// GET /pages/:key (about | privacy | terms)
exports.getPage = catchAsync(async (req, res, next) => {
  const meta = known(req.params.key);
  if (!meta) return next(new AppError('No page with that name. Use about, privacy or terms.', 404));
  const page = await Page.findOne({ key: meta.key }).lean();
  res.status(200).json({ status: 'success', data: { page: pageView(meta, page) } });
});

// ---------- Admin ----------

const adminView = (meta, page) => ({
  key: meta.key,
  title: (page && page.title) || meta.title,
  body: (page && page.body) || '',
  published: Boolean(page && page.published),
  version: (page && page.version) || 0,
  publishedAt: (page && page.publishedAt) || null,
  updatedAt: (page && page.updatedAt) || null
});

exports.adminList = catchAsync(async (req, res) => {
  const rows = await Page.find().lean();
  const byKey = new Map(rows.map(p => [p.key, p]));
  res.status(200).json({ status: 'success', data: { pages: Page.PAGES.map(meta => adminView(meta, byKey.get(meta.key))) } });
});

// PATCH /admin/pages/:key { title, body, published }
exports.adminUpdate = catchAsync(async (req, res, next) => {
  const meta = known(req.params.key);
  if (!meta) return next(new AppError('No page with that name.', 404));
  const page = (await Page.findOne({ key: meta.key })) || new Page({ key: meta.key, title: meta.title });
  const b = req.body;
  const before = page.body;
  if (b.title !== undefined) page.title = String(b.title).trim().slice(0, 80) || meta.title;
  if (b.body !== undefined) page.body = String(b.body).replace(/\r\n/g, '\n').trim();
  if (b.published !== undefined) page.published = b.published === true || b.published === 'true';
  if (page.published && !page.body) return next(new AppError('Write the page before publishing it.', 400));
  if (page.published && (page.body !== before || !page.publishedAt)) {
    page.version += 1;
    page.publishedAt = new Date();
  }
  page.updatedBy = req.user._id;
  await page.save();
  await logActivity(req, { action: 'page.updated', summary: `${page.published ? 'Published' : 'Saved a draft of'} the ${page.title} page` });
  res.status(200).json({ status: 'success', message: page.published ? 'Page published.' : 'Draft saved. Travelers see it once you publish.', data: { page: adminView(meta, page.toObject()) } });
});
