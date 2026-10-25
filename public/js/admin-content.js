/**
 * Plezar admin - App content: banners on the app's Tours screen, and hotels for "Hotels Near You".
 * Depends on admin.js, admin-users.js (E, fmtDate, renderPager, tableMessage, formError, makeDebounce,
 * queryString, val), admin-vendors.js (adminForm) and admin-destinations.js (ensureDestinationOptions).
 */

const C = { sub: 'banners', banners: [], hotels: [], editingBanner: null, editingHotel: null, page: 1, removePhotos: new Set() };

const TARGET_TEXT = {
  sale_tours: 'Tours on sale', tours: 'Chosen tours', destination: 'Tours at a destination', agency: "A vendor's tours", tour_type: 'One type of tour'
};
const STATE_BADGE = { live: 'badge-active', scheduled: 'badge-manager', ended: 'badge-inactive', off: 'badge-inactive' };
const HOTEL_BADGE = { published: 'badge-active', draft: 'badge-manager', hidden: 'badge-inactive' };
const taka = n => `৳${new Intl.NumberFormat('en-US').format(Number(n) || 0)}`;
const dayInput = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

function switchContentSub(name) {
  C.sub = name;
  document.querySelectorAll('#tab-content .subtab').forEach(b => {
    const on = b.dataset.csub === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#tab-content .subpane').forEach(p => p.classList.toggle('active', p.id === `csub-${name}`));
  if (name === 'hotels') loadHotels(1);
  else loadBanners();
}

document.querySelectorAll('#tab-content .subtab').forEach(btn => btn.addEventListener('click', () => switchContentSub(btn.dataset.csub)));

function loadContent() {
  switchContentSub(C.sub);
}

// ---------- Banners ----------

async function loadBanners() {
  tableMessage('bannersTableBody', 6, 'Loading...');
  const { ok, data } = await adminFetch('/api/v1/admin/promotions');
  if (!ok) return tableMessage('bannersTableBody', 6, data.message || 'Could not load banners.', true);
  C.banners = data.data.promotions;
  if (!C.banners.length) return tableMessage('bannersTableBody', 6, 'No banners yet. Add one to show it on the Tours screen.');
  document.getElementById('bannersTableBody').innerHTML = C.banners.map(b => {
    const opens = {
      sale_tours: `${TARGET_TEXT.sale_tours}${b.minDiscount ? `, ${b.minDiscount}%+ off` : ''}`,
      tours: `${(b.tours || []).length} chosen tour(s)`,
      destination: `Tours at ${E((b.destination && b.destination.name) || 'a destination')}`,
      agency: `${E((b.agency && b.agency.name) || 'A vendor')}'s tours`,
      tour_type: `${E(b.tourType)} tours`
    }[b.target];
    return `
      <tr class="${b.live ? '' : 'row-muted'}">
        <td><div style="display:flex; gap:10px; align-items:center;">
          ${b.image ? `<img src="${E(b.image)}" alt="" style="width:72px; height:40px; object-fit:cover; border-radius:6px;">` : ''}
          <div><strong>${E(b.title)}</strong><span class="lead-sub">${E(b.subtitle || '')}</span></div></div></td>
        <td>${opens}</td>
        <td style="white-space:nowrap;">${b.startsAt ? E(fmtDate(b.startsAt)) : 'Now'} to ${b.endsAt ? E(fmtDate(b.endsAt)) : 'no end'}</td>
        <td>${Number(b.clicks || 0)}</td>
        <td><span class="badge ${STATE_BADGE[b.state]}">${E(b.state)}</span></td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-secondary btn-sm" onclick="openBanner('${E(b._id)}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBanner('${E(b._id)}')">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

function showBannerTarget() {
  const target = val('bnTarget');
  document.querySelectorAll('[data-bn-target]').forEach(el => { el.hidden = el.dataset.bnTarget !== target; });
}

async function fillBannerChoices(banner) {
  const [options, tours, vendors] = await Promise.all([
    ensureDestinationOptions(),
    adminFetch('/api/v1/tours?limit=100&sort=soonest&remember=false'),
    adminFetch('/api/v1/admin/vendors?limit=100&status=active')
  ]);
  document.getElementById('bnDestination').innerHTML = '<option value="">Choose a destination</option>' + options
    .filter(o => o.status === 'published')
    .map(o => `<option value="${E(o._id)}">${E([...o.path, o.name].join(' › '))}</option>`).join('');
  const chosen = new Set((banner && banner.tours || []).map(t => String(t._id || t)));
  const list = tours.ok ? tours.data.data.tours : [];
  document.getElementById('bnTours').innerHTML = list.length
    ? list.map(t => `<label class="check" style="display:flex; gap:8px; align-items:center;"><input type="checkbox" value="${E(t._id)}" ${chosen.has(String(t._id)) ? 'checked' : ''}> ${E(t.title)} <span class="lead-sub" style="display:inline;">${E(t.location || '')}, ${E(fmtDate(t.startDate))}</span></label>`).join('')
    : '<p class="lead-sub">No bookable tours right now.</p>';
  const rows = vendors.ok ? vendors.data.data.vendors : [];
  document.getElementById('bnAgency').innerHTML = '<option value="">Choose a vendor</option>' + rows.map(v => `<option value="${E(v._id || v.id)}">${E(v.name)}</option>`).join('');
}

async function openBanner(id) {
  const b = id ? C.banners.find(x => x._id === id) : null;
  C.editingBanner = b;
  document.getElementById('bannerForm').reset();
  formError('bannerError');
  document.getElementById('bannerModalTitle').textContent = b ? 'Edit banner' : 'Add banner';
  await fillBannerChoices(b);
  const set = (fid, v) => { document.getElementById(fid).value = v == null ? '' : v; };
  set('bnTitle', b && b.title);
  set('bnSubtitle', b && b.subtitle);
  set('bnHighlight', b && b.highlight);
  set('bnCta', b ? b.ctaLabel : 'Explore Now');
  set('bnTarget', b ? b.target : 'sale_tours');
  set('bnMinDiscount', b && b.minDiscount);
  set('bnDestination', b && b.destination && (b.destination._id || b.destination));
  set('bnAgency', b && b.agency && (b.agency._id || b.agency));
  set('bnTourType', (b && b.tourType) || 'group');
  set('bnStarts', b && dayInput(b.startsAt));
  set('bnEnds', b && dayInput(b.endsAt));
  set('bnOrder', b ? b.order : 0);
  document.getElementById('bnActive').checked = b ? b.active : true;
  document.getElementById('bnImageNow').textContent = b && b.image ? 'Choose a file to replace the current image.' : 'Wide images work best, for example 1600 × 640.';
  showBannerTarget();
  openModal('bannerModal');
}

async function saveBanner(e) {
  e.preventDefault();
  if (!val('bnTitle').trim()) return formError('bannerError', 'Give the banner a title.');
  const fd = new FormData();
  const add = (k, v) => fd.append(k, v == null ? '' : v);
  add('title', val('bnTitle').trim());
  add('subtitle', val('bnSubtitle').trim());
  add('highlight', val('bnHighlight').trim());
  add('ctaLabel', val('bnCta').trim());
  add('target', val('bnTarget'));
  add('minDiscount', val('bnMinDiscount'));
  add('destination', val('bnTarget') === 'destination' ? val('bnDestination') : '');
  add('agency', val('bnTarget') === 'agency' ? val('bnAgency') : '');
  add('tourType', val('bnTarget') === 'tour_type' ? val('bnTourType') : '');
  add('tours', [...document.querySelectorAll('#bnTours input:checked')].map(i => i.value).join(','));
  add('startsAt', val('bnStarts'));
  add('endsAt', val('bnEnds') ? `${val('bnEnds')}T23:59:59+06:00` : '');
  add('order', val('bnOrder') || 0);
  add('active', document.getElementById('bnActive').checked);
  const file = document.getElementById('bnImage').files[0];
  if (file) fd.append('image', file);
  const btn = document.getElementById('bannerSubmit');
  btn.disabled = true;
  const editing = C.editingBanner;
  const { ok, data } = await adminForm(editing ? `/api/v1/admin/promotions/${editing._id}` : '/api/v1/admin/promotions', editing ? 'PATCH' : 'POST', fd);
  btn.disabled = false;
  if (!ok) return formError('bannerError', data.message || 'Could not save the banner.');
  closeModal('bannerModal');
  showAdminToast(editing ? 'Banner saved.' : 'Banner added.', 'success');
  loadBanners();
}

function deleteBanner(id) {
  const b = C.banners.find(x => x._id === id);
  askReason({
    title: 'Delete this banner', lead: `"${b ? b.title : 'This banner'}" disappears from the app. Type a short note to confirm.`, label: 'Note', confirmLabel: 'Delete banner', maxLength: 200,
    onSubmit: async () => {
      const { ok, data } = await adminFetch(`/api/v1/admin/promotions/${id}`, { method: 'DELETE' });
      if (!ok) throw new Error(data.message || 'Could not delete the banner.');
      showAdminToast('Banner deleted.', 'info');
      loadBanners();
    }
  });
}

// ---------- Hotels ----------

const debouncedHotels = makeDebounce(() => loadHotels(1));

async function loadHotels(page = C.page) {
  C.page = page;
  tableMessage('hotelsTableBody', 6, 'Loading...');
  const q = queryString({ search: val('hSearch').trim(), status: val('hStatusF'), page, limit: 20 });
  const { ok, data } = await adminFetch(`/api/v1/admin/hotels?${q}`);
  if (!ok) return tableMessage('hotelsTableBody', 6, data.message || 'Could not load hotels.', true);
  C.hotels = data.data.hotels;
  renderPager('hotelsPager', data.data, 'loadHotels');
  if (!C.hotels.length) return tableMessage('hotelsTableBody', 6, 'No hotels yet. Add one to show it in "Hotels Near You".');
  document.getElementById('hotelsTableBody').innerHTML = C.hotels.map(h => `
    <tr class="${h.status === 'published' ? '' : 'row-muted'}">
      <td><div style="display:flex; gap:10px; align-items:center;">
        ${h.photo ? `<img src="${E(h.photo)}" alt="" style="width:56px; height:42px; object-fit:cover; border-radius:6px;">` : ''}
        <div><strong>${E(h.name)}</strong>${h.featured ? ' <span class="badge badge-manager">Featured</span>' : ''}<span class="lead-sub">${E(h.type.replace('_', ' '))}${h.starRating ? `, ${'★'.repeat(h.starRating)}` : ''}</span></div></div></td>
      <td>${E(h.location || '—')}${h.coordinates ? '' : '<span class="lead-sub" style="color: var(--color-danger)">No map position</span>'}</td>
      <td style="white-space:nowrap;">${taka(h.price.amount)}${h.price.regular ? ` <s class="lead-sub" style="display:inline;">${taka(h.price.regular)}</s>` : ''}</td>
      <td>${h.rating.average != null ? `${h.rating.average} (${h.rating.count})${h.rating.source ? `<span class="lead-sub">${E(h.rating.source)}</span>` : ''}` : '—'}</td>
      <td><span class="badge ${HOTEL_BADGE[h.status]}">${E(h.status)}</span></td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-secondary btn-sm" onclick="openHotel('${E(h._id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteHotel('${E(h._id)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function renderHotelPhotos(h) {
  const box = document.getElementById('htPhotosNow');
  box.innerHTML = (h && h.photos || []).map(p => `
    <label style="position:relative; display:block;">
      <img src="${E(p)}" alt="" style="width:88px; height:66px; object-fit:cover; border-radius:6px; ${C.removePhotos.has(p) ? 'opacity:.35;' : ''}">
      <span class="lead-sub" style="display:flex; gap:4px; align-items:center;"><input type="checkbox" ${C.removePhotos.has(p) ? 'checked' : ''} onchange="toggleHotelPhoto('${E(p)}', this.checked)"> Remove</span>
    </label>`).join('');
}

function toggleHotelPhoto(url, remove) {
  if (remove) C.removePhotos.add(url);
  else C.removePhotos.delete(url);
  renderHotelPhotos(C.editingHotel);
}

async function openHotel(id) {
  const h = id ? C.hotels.find(x => x._id === id) : null;
  C.editingHotel = h;
  C.removePhotos = new Set();
  document.getElementById('hotelForm').reset();
  formError('hotelError');
  document.getElementById('hotelModalTitle').textContent = h ? 'Edit hotel' : 'Add hotel';
  const options = await ensureDestinationOptions();
  document.getElementById('htDestination').innerHTML = '<option value="">Choose a destination</option>' + options
    .map(o => `<option value="${E(o._id)}">${E([...o.path, o.name].join(' › '))}${o.status === 'published' ? '' : ' (not published)'}</option>`).join('');
  const set = (fid, v) => { document.getElementById(fid).value = v == null ? '' : v; };
  set('htName', h && h.name);
  set('htType', (h && h.type) || 'hotel');
  set('htDestination', h && h.destinationId);
  set('htAddress', h && h.address);
  set('htLat', h && h.coordinates && h.coordinates.lat);
  set('htLng', h && h.coordinates && h.coordinates.lng);
  set('htPrice', h && h.pricePerNight);
  set('htRegular', h && h.regularPrice);
  set('htStars', h && h.starRating);
  set('htRating', h && h.rating.average);
  set('htRatingCount', h && h.rating.count);
  set('htRatingSource', h && h.rating.source);
  set('htHighlights', h ? (h.highlights || []).join('\n') : '');
  set('htAmenities', h ? (h.amenities || []).join('\n') : '');
  set('htDescription', h && h.description);
  set('htPhone', h && h.phone);
  set('htWebsite', h && h.website);
  set('htCheckIn', h && h.checkIn);
  set('htCheckOut', h && h.checkOut);
  set('htStatus', (h && h.status) || 'draft');
  document.getElementById('htFeatured').checked = Boolean(h && h.featured);
  renderHotelPhotos(h);
  openModal('hotelModal');
}

async function saveHotel(e) {
  e.preventDefault();
  if (!val('htName').trim()) return formError('hotelError', 'Enter the hotel name.');
  if (val('htPrice') === '') return formError('hotelError', 'Enter the price per night.');
  const fd = new FormData();
  const fields = {
    name: val('htName').trim(), type: val('htType'), destination: val('htDestination'), address: val('htAddress').trim(),
    lat: val('htLat').trim(), lng: val('htLng').trim(), pricePerNight: val('htPrice'), regularPrice: val('htRegular'),
    starRating: val('htStars'), ratingAverage: val('htRating'), ratingCount: val('htRatingCount'), ratingSource: val('htRatingSource').trim(),
    highlights: val('htHighlights'), amenities: val('htAmenities'), description: val('htDescription'),
    phone: val('htPhone').trim(), website: val('htWebsite').trim(), checkIn: val('htCheckIn').trim(), checkOut: val('htCheckOut').trim(),
    status: val('htStatus'), featured: document.getElementById('htFeatured').checked
  };
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (C.removePhotos.size) fd.append('removePhotos', [...C.removePhotos].join(','));
  [...document.getElementById('htPhotos').files].slice(0, 6).forEach(f => fd.append('photos', f));
  const btn = document.getElementById('hotelSubmit');
  btn.disabled = true;
  const editing = C.editingHotel;
  const { ok, data } = await adminForm(editing ? `/api/v1/admin/hotels/${editing._id}` : '/api/v1/admin/hotels', editing ? 'PATCH' : 'POST', fd);
  btn.disabled = false;
  if (!ok) return formError('hotelError', data.message || 'Could not save the hotel.');
  closeModal('hotelModal');
  showAdminToast(editing ? 'Hotel saved.' : 'Hotel added.', 'success');
  loadHotels();
}

function deleteHotel(id) {
  const h = C.hotels.find(x => x._id === id);
  askReason({
    title: 'Delete this hotel', lead: `"${h ? h.name : 'This hotel'}" and its photos are removed for good. Type a short note to confirm.`, label: 'Note', confirmLabel: 'Delete hotel', maxLength: 200,
    onSubmit: async () => {
      const { ok, data } = await adminFetch(`/api/v1/admin/hotels/${id}`, { method: 'DELETE' });
      if (!ok) throw new Error(data.message || 'Could not delete the hotel.');
      showAdminToast('Hotel deleted.', 'info');
      loadHotels();
    }
  });
}
