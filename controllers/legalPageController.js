const path = require('path');
const pug = require('pug');
const Page = require('../models/pageModel');
const catchAsync = require('../utils/catchAsync');
const defaults = require('../data/legalPages');

// Public web pages: plejar.com/about, /privacy, /terms (linked from Google Play and the
// App Store) and /delete-account. The admin's published text wins; until then, the same
// text the app ships with is shown.

const VIEWS = path.join(__dirname, '..', 'views', 'legal');
const TITLES = { about: 'About Us', privacy: 'Privacy Policy', terms: 'Terms of Use' };
const TAGLINES = {
  about: 'Travel Bangladesh, made simple',
  privacy: 'Your data, your choice',
  terms: 'The rules for using Plejar'
};

/** Paragraphs → an intro and titled sections, as in the app */
const sectionsOf = paragraphs => {
  const intro = [];
  const sections = [];
  for (const p of paragraphs) {
    if (p.startsWith('## ')) sections.push({ title: p.slice(3).trim(), lines: [] });
    else (sections.length ? sections[sections.length - 1].lines : intro).push(p);
  }
  const line = text => (/^[•-] /.test(text) ? { point: true, text: text.slice(2).trim() } : { point: false, text });
  return {
    intro: intro.map(line),
    sections: sections.map((s, i) => ({ ...s, id: `section-${i + 1}`, number: String(i + 1).padStart(2, '0'), lines: s.lines.map(line) }))
  };
};

const render = (res, view, locals) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(pug.renderFile(path.join(VIEWS, `${view}.pug`), { year: new Date().getFullYear(), ...locals }));
};

exports.page = key => catchAsync(async (req, res) => {
  const page = await Page.findOne({ key }).lean();
  const published = page && page.published && page.body;
  const paragraphs = published ? page.body.split(/\n+/).map(p => p.trim()).filter(Boolean) : defaults[key];
  const words = paragraphs.join(' ').split(/\s+/).length;
  render(res, 'page', {
    key,
    title: (published && page.title) || TITLES[key],
    tagline: TAGLINES[key],
    minutes: Math.max(1, Math.ceil(words / 200)),
    updatedAt: published && page.publishedAt ? new Date(page.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null,
    ...sectionsOf(paragraphs)
  });
});

exports.deleteAccount = (req, res) => render(res, 'deleteAccount', { key: 'delete', title: 'Delete your account' });
