/* ============================================================
   RentAI v2 - MLP Fusion Model Frontend
   ============================================================ */

const API = '';

// State
let page = 1;
let filters = {};
let searchQuery = '';
let activeTab = 'explore';
let uploadedFile = null;

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Tab nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            switchTab(link.dataset.tab);
        });
    });

    // Search on Enter
    document.getElementById('searchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
    });

    // Image upload handling
    const fileInput = document.getElementById('imageUpload');
    const dropArea = document.getElementById('uploadArea');

    fileInput.addEventListener('change', e => {
        if (e.target.files[0]) handleImageFile(e.target.files[0]);
    });

    dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
    dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
    });

    // Multi-modal indicator updates
    ['mmText', 'mmType', 'mmBeds', 'mmMinPrice', 'mmMaxPrice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateModalityIndicators);
    });
    updateModalityIndicators();

    loadRentals();
});

// ── Tabs ──────────────────────────────────────────────
function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`.nav-link[data-tab="${tab}"]`)?.classList.add('active');

    document.getElementById('exploreTab').style.display = tab === 'explore' ? '' : 'none';
    document.getElementById('recommendationsTab').style.display = tab === 'recommendations' ? '' : 'none';
    document.getElementById('statsTab').style.display = tab === 'stats' ? '' : 'none';

    if (tab === 'stats') loadStats();
}

// ── Image helpers ─────────────────────────────────────
function imgUrl(listing) {
    if (listing.listing_id) return `/images/${listing.listing_id}.jpg`;
    return '';
}

function imgTag(src, alt, cls) {
    if (!src) return `<div class="no-img"><i class="fas fa-image"></i></div>`;
    return `<img src="${src}" alt="${alt || ''}" class="${cls || ''}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'no-img\\'><i class=\\'fas fa-image\\'></i></div>'" />`;
}

// ── Rentals list ──────────────────────────────────────
async function loadRentals(p) {
    if (p != null) page = p;
    const grid = document.getElementById('resultsGrid');
    const spin = document.getElementById('loadingSpinner');
    const countEl = document.getElementById('resultsCount');
    const titleEl = document.getElementById('resultsTitle');

    spin.style.display = '';
    grid.innerHTML = '';
    document.getElementById('pagination').innerHTML = '';

    const params = new URLSearchParams({ page, limit: 20 });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

    let endpoint = '/rentals';
    if (searchQuery) {
        params.set('q', searchQuery);
        endpoint = '/search';
    }

    try {
        const res = await fetch(`${API}${endpoint}?${params}`);
        const data = await res.json();
        spin.style.display = 'none';

        if (!data.success || !data.data?.length) {
            grid.innerHTML = emptyHTML('No rentals found', 'Try adjusting your search or filters.');
            countEl.textContent = '0 results';
            return;
        }

        titleEl.textContent = searchQuery ? `Results for "${searchQuery}"` : 'Available Rentals';
        countEl.textContent = `${data.total.toLocaleString()} results`;
        grid.innerHTML = data.data.map(l => cardHTML(l)).join('');
        renderPages(data.page, data.total_pages);
    } catch (err) {
        spin.style.display = 'none';
        grid.innerHTML = errorHTML(err.message);
    }
}

// ── Card rendering ────────────────────────────────────
function cardHTML(listing, rank, score) {
    const src = imgUrl(listing);
    const name = esc(listing.name || 'Untitled');
    const price = listing.price != null ? `$${listing.price}` : 'N/A';
    const loc = [listing.address?.market, listing.address?.country].filter(Boolean).join(', ') || 'Unknown';
    const ptype = listing.property_type || '';
    const rtype = listing.room_type || '';
    const beds = listing.bedrooms != null ? `${listing.bedrooms} bed` : '';
    const bath = listing.bathrooms != null ? `${listing.bathrooms} bath` : '';
    const details = [beds, bath].filter(Boolean).join(' &middot; ');
    const rating = listing.review_scores_rating;
    const superhost = listing.host?.host_is_superhost;
    const lid = listing.listing_id;

    let badges = '';
    if (rank != null) badges += `<span class="badge badge-rank">#${rank}</span>`;
    if (score != null) badges += `<span class="badge badge-score">${(score * 100).toFixed(1)}%</span>`;
    if (superhost) badges += `<span class="badge badge-super"><i class="fas fa-star"></i> Superhost</span>`;

    return `
    <div class="card" onclick="showDetail(${lid})">
        <div class="card-img">
            ${imgTag(src, name)}
            <div class="card-badges">${badges}</div>
        </div>
        <div class="card-body">
            <h3 class="card-title">${name}</h3>
            <p class="card-loc"><i class="fas fa-map-marker-alt"></i> ${esc(loc)}</p>
            <div class="card-meta">
                <span>${esc(ptype)}${rtype ? ' &middot; ' + esc(rtype) : ''}</span>
                ${details ? `<span>${details}</span>` : ''}
            </div>
            <div class="card-foot">
                <span class="card-price">${price}<small>/night</small></span>
                ${rating ? `<span class="card-rating"><i class="fas fa-star"></i> ${rating}</span>` : ''}
            </div>
        </div>
    </div>`;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Pagination ────────────────────────────────────────
function renderPages(cur, total) {
    const el = document.getElementById('pagination');
    if (total <= 1) { el.innerHTML = ''; return; }
    let h = '';
    if (cur > 1) h += `<button class="pg-btn" onclick="loadRentals(${cur - 1})"><i class="fas fa-chevron-left"></i></button>`;
    const lo = Math.max(1, cur - 2), hi = Math.min(total, cur + 2);
    for (let i = lo; i <= hi; i++) {
        h += `<button class="pg-btn${i === cur ? ' active' : ''}" onclick="loadRentals(${i})">${i}</button>`;
    }
    if (cur < total) h += `<button class="pg-btn" onclick="loadRentals(${cur + 1})"><i class="fas fa-chevron-right"></i></button>`;
    h += `<span class="pg-info">Page ${cur} of ${total}</span>`;
    el.innerHTML = h;
}

// ── Search ────────────────────────────────────────────
function doSearch() {
    searchQuery = document.getElementById('searchInput').value.trim();
    gatherFilters();
    page = 1;
    updateChips();
    loadRentals();
}

// ── Filters ───────────────────────────────────────────
function gatherFilters() {
    const f = {};
    const t = document.getElementById('filterType').value;
    const mn = document.getElementById('filterMinPrice').value;
    const mx = document.getElementById('filterMaxPrice').value;
    const b = document.getElementById('filterBeds').value;
    const s = document.getElementById('filterSort').value;
    if (t) f.property_type = t;
    if (mn) f.min_price = mn;
    if (mx) f.max_price = mx;
    if (b) f.bedrooms = b;
    if (s) f.sort = s;
    filters = f;
}

function applyFilters() {
    gatherFilters();
    page = 1;
    updateChips();
    loadRentals();
}

function resetAll() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterMinPrice').value = '';
    document.getElementById('filterMaxPrice').value = '';
    document.getElementById('filterBeds').value = '';
    document.getElementById('filterSort').value = 'price_asc';
    searchQuery = '';
    filters = {};
    page = 1;
    updateChips();
    loadRentals();
}

function removeChip(key) {
    if (key === 'q') {
        searchQuery = '';
        document.getElementById('searchInput').value = '';
    } else {
        delete filters[key];
        const fieldMap = { property_type: 'filterType', min_price: 'filterMinPrice', max_price: 'filterMaxPrice', bedrooms: 'filterBeds', sort: 'filterSort' };
        const el = document.getElementById(fieldMap[key]);
        if (el) el.value = key === 'sort' ? 'price_asc' : '';
    }
    page = 1;
    updateChips();
    loadRentals();
}

function updateChips() {
    const box = document.getElementById('activeChips');
    const chips = [];
    if (searchQuery) chips.push({ key: 'q', label: `Search: "${searchQuery}"` });
    if (filters.property_type) chips.push({ key: 'property_type', label: `Type: ${filters.property_type}` });
    if (filters.min_price) chips.push({ key: 'min_price', label: `Min: $${filters.min_price}` });
    if (filters.max_price) chips.push({ key: 'max_price', label: `Max: $${filters.max_price}` });
    if (filters.bedrooms) chips.push({ key: 'bedrooms', label: `Beds: ${filters.bedrooms}+` });

    if (!chips.length) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    box.innerHTML = chips.map(c =>
        `<span class="chip">${c.label} <button onclick="removeChip('${c.key}')">&times;</button></span>`
    ).join('') + `<button class="chip chip-clear" onclick="resetAll()">Clear all</button>`;
}

// ── Recommendations ───────────────────────────────────
async function loadRecommendations() {
    const userId = document.getElementById('recUserId').value.trim();
    if (!userId) { alert('Please enter a User ID'); return; }

    const topK = document.getElementById('recTopK').value;
    const grid = document.getElementById('recResultsGrid');
    const loading = document.getElementById('recLoading');
    const meta = document.getElementById('recMeta');
    const hist = document.getElementById('userHistoryPanel');
    const arch = document.getElementById('archCard');

    arch.style.display = 'none';
    loading.style.display = '';
    grid.innerHTML = '';
    meta.style.display = 'none';
    hist.style.display = 'none';

    try {
        const [recRes, userRes] = await Promise.all([
            fetch(`${API}/recommendations/${encodeURIComponent(userId)}?top_k=${topK}`),
            fetch(`${API}/users/${encodeURIComponent(userId)}`),
        ]);
        const recData = await recRes.json();
        loading.style.display = 'none';

        // Show history
        if (userRes.ok) {
            const ud = await userRes.json();
            if (ud.success && ud.history?.length) {
                hist.style.display = '';
                document.getElementById('userHistoryGrid').innerHTML = ud.history.map(h => `
                    <div class="hist-item" onclick="showDetail(${h.listing_id})">
                        ${imgTag(h.listing_id ? `/images/${h.listing_id}.jpg` : '', h.name, 'hist-img')}
                        <div class="hist-info">
                            <span class="hist-name">${esc(h.name)}</span>
                            <span class="hist-detail">${esc(h.property_type)} &middot; $${h.price || 'N/A'}</span>
                        </div>
                    </div>
                `).join('');
            }
        }

        if (!recData.success || !recData.data?.length) {
            grid.innerHTML = emptyHTML('No recommendations available', recData.message || 'Try a different user ID.');
            return;
        }

        meta.style.display = '';
        meta.innerHTML = `
            <span><strong>Model:</strong> ${recData.model}</span>
            <span><strong>Source:</strong> ${recData.source}</span>
            <span><strong>User:</strong> ${recData.user_id || userId}</span>
            ${recData.interactions != null ? `<span><strong>History:</strong> ${recData.interactions} interactions</span>` : ''}
            ${recData.message ? `<span class="meta-warn"><i class="fas fa-info-circle"></i> ${recData.message}</span>` : ''}
        `;

        grid.innerHTML = recData.data.map(item => {
            const listing = item.listing || item;
            return cardHTML(listing, item.rank, item.score);
        }).join('');

    } catch (err) {
        loading.style.display = 'none';
        grid.innerHTML = errorHTML(err.message);
    }
}

// ── Image Upload ──────────────────────────────────────
function handleImageFile(file) {
    if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
    uploadedFile = file;

    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('previewImg').src = e.target.result;
        document.getElementById('uploadPlaceholder').style.display = 'none';
        document.getElementById('uploadPreview').style.display = '';
    };
    reader.readAsDataURL(file);
    updateModalityIndicators();
}

function clearUpload() {
    uploadedFile = null;
    document.getElementById('imageUpload').value = '';
    document.getElementById('uploadPlaceholder').style.display = '';
    document.getElementById('uploadPreview').style.display = 'none';
    updateModalityIndicators();
}

function clearMultimodal() {
    clearUpload();
    document.getElementById('mmText').value = '';
    document.getElementById('mmType').value = '';
    document.getElementById('mmBeds').value = '';
    document.getElementById('mmMinPrice').value = '';
    document.getElementById('mmMaxPrice').value = '';
    updateModalityIndicators();
}

function updateModalityIndicators() {
    const el = document.getElementById('mmIndicators');
    const hasImage = !!uploadedFile;
    const hasText = !!(document.getElementById('mmText')?.value?.trim());
    const hasStruct = !!(document.getElementById('mmType')?.value ||
                         document.getElementById('mmBeds')?.value ||
                         document.getElementById('mmMinPrice')?.value ||
                         document.getElementById('mmMaxPrice')?.value);

    const mods = [];
    mods.push(`<span class="mm-ind ${hasImage ? 'active' : ''}"><i class="fas fa-image"></i> Image</span>`);
    mods.push(`<span class="mm-ind ${hasText ? 'active' : ''}"><i class="fas fa-font"></i> Text</span>`);
    mods.push(`<span class="mm-ind ${hasStruct ? 'active' : ''}"><i class="fas fa-table"></i> Struct</span>`);
    mods.push(`<span class="mm-ind active"><i class="fas fa-brain"></i> MLP</span>`);
    el.innerHTML = mods.join('');
}

async function searchMultimodal() {
    const text = document.getElementById('mmText').value.trim();
    const ptype = document.getElementById('mmType').value;
    const beds = document.getElementById('mmBeds').value;
    const minP = document.getElementById('mmMinPrice').value;
    const maxP = document.getElementById('mmMaxPrice').value;

    if (!uploadedFile && !text && !ptype && !beds && !minP && !maxP) {
        alert('Provide at least one input — image, text description, or structural filter.');
        return;
    }

    const topK = document.getElementById('uploadTopK').value;
    const grid = document.getElementById('recResultsGrid');
    const loading = document.getElementById('recLoading');
    const meta = document.getElementById('recMeta');
    const arch = document.getElementById('archCard');
    const hist = document.getElementById('userHistoryPanel');

    arch.style.display = 'none';
    hist.style.display = 'none';
    loading.style.display = '';
    grid.innerHTML = '';
    meta.style.display = 'none';

    const formData = new FormData();
    if (uploadedFile) formData.append('image', uploadedFile);
    if (text) formData.append('text', text);
    if (ptype) formData.append('property_type', ptype);
    if (beds) formData.append('bedrooms', beds);
    if (minP) formData.append('min_price', minP);
    if (maxP) formData.append('max_price', maxP);
    formData.append('top_k', topK);

    try {
        const res = await fetch(`${API}/upload-search`, { method: 'POST', body: formData });
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success || !data.data?.length) {
            grid.innerHTML = emptyHTML('No results found', data.error || 'Try adjusting your inputs.');
            return;
        }

        const mods = data.modalities_used || [];
        const modLabels = { image: 'Image (CLIP)', text: 'Text (TF-IDF)', struct: 'Structural', mlp: 'MLP Fusion' };
        meta.style.display = '';
        meta.innerHTML = `
            <span><strong>Model:</strong> ${data.model}</span>
            <span><strong>Modalities:</strong> ${mods.map(m => modLabels[m] || m).join(' + ')}</span>
            <span><strong>Results:</strong> ${data.total} listings</span>
        `;

        grid.innerHTML = data.data.map(item => {
            const listing = item.listing || item;
            return cardHTML(listing, item.rank, item.score);
        }).join('');

    } catch (err) {
        loading.style.display = 'none';
        grid.innerHTML = errorHTML(err.message);
    }
}

// ── Stats ─────────────────────────────────────────────
async function loadStats() {
    const el = document.getElementById('statsContent');
    el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading statistics...</p></div>';

    try {
        const res = await fetch(`${API}/stats`);
        const d = await res.json();

        el.innerHTML = `
        <div class="stats-cards">
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-building"></i></div><div class="stat-val">${d.total_listings?.toLocaleString()}</div><div class="stat-label">Listings</div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-users"></i></div><div class="stat-val">${d.total_users?.toLocaleString()}</div><div class="stat-label">Users</div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-handshake"></i></div><div class="stat-val">${d.total_interactions?.toLocaleString()}</div><div class="stat-label">Interactions</div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-brain"></i></div><div class="stat-val">${d.listings_with_embeddings?.toLocaleString()}</div><div class="stat-label">Embeddings</div></div>
        </div>
        <div class="stats-panels">
            <div class="panel">
                <h3><i class="fas fa-dollar-sign"></i> Price Statistics</h3>
                <table><tr><td>Minimum</td><td>$${d.price_stats?.min}</td></tr><tr><td>Maximum</td><td>$${d.price_stats?.max}</td></tr><tr><td>Average</td><td>$${d.price_stats?.avg}</td></tr><tr><td>Median</td><td>$${d.price_stats?.median}</td></tr></table>
            </div>
            <div class="panel">
                <h3><i class="fas fa-brain"></i> Model</h3>
                <table><tr><td>Name</td><td>${d.model?.name}</td></tr><tr><td>Type</td><td>${d.model?.type}</td></tr><tr><td>Input Dim</td><td>${d.model?.input_dim}</td></tr><tr><td>Architecture</td><td>${d.model?.architecture}</td></tr></table>
            </div>
            <div class="panel">
                <h3><i class="fas fa-home"></i> Property Types</h3>
                <table>${Object.entries(d.property_types || {}).slice(0, 10).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
            </div>
            <div class="panel">
                <h3><i class="fas fa-globe"></i> Top Markets</h3>
                <table>${Object.entries(d.markets || {}).slice(0, 10).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
            </div>
        </div>`;
    } catch (err) {
        el.innerHTML = errorHTML(err.message);
    }
}

// ── Detail Modal ──────────────────────────────────────
async function showDetail(listingId) {
    const modal = document.getElementById('rentalModal');
    const body = document.getElementById('modalBody');
    modal.style.display = '';
    body.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading...</p></div>';

    try {
        const res = await fetch(`${API}/rentals/${listingId}`);
        const data = await res.json();
        if (!data.success) { body.innerHTML = '<p>Listing not found.</p>'; return; }

        const l = data.data;
        const src = imgUrl(l);
        const loc = [l.address?.market, l.address?.country].filter(Boolean).join(', ');
        const amenities = (l.amenities || []).slice(0, 20);

        body.innerHTML = `
        <div class="detail-top">
            ${src ? `<img src="${src}" alt="${esc(l.name)}" class="detail-img" onerror="this.onerror=null;this.style.display='none'" />` : ''}
            <div class="detail-info">
                <h2>${esc(l.name || 'Untitled')}</h2>
                <p class="detail-loc"><i class="fas fa-map-marker-alt"></i> ${esc(loc || 'Unknown')}</p>
                <div class="detail-price">$${l.price || 'N/A'}<small>/night</small></div>
            </div>
        </div>
        <div class="detail-body">
            <div class="detail-section">
                <h3>Property Details</h3>
                <div class="tags">
                    <span class="tag"><i class="fas fa-home"></i> ${esc(l.property_type || 'N/A')}</span>
                    <span class="tag"><i class="fas fa-door-open"></i> ${esc(l.room_type || 'N/A')}</span>
                    <span class="tag"><i class="fas fa-bed"></i> ${l.bedrooms || 0} bed</span>
                    <span class="tag"><i class="fas fa-bath"></i> ${l.bathrooms || 0} bath</span>
                    <span class="tag"><i class="fas fa-users"></i> ${l.accommodates || 0} guests</span>
                </div>
            </div>
            ${l.summary ? `<div class="detail-section"><h3>Summary</h3><p>${esc(l.summary)}</p></div>` : ''}
            ${l.description ? `<div class="detail-section"><h3>Description</h3><p>${esc(l.description.substring(0, 800))}${l.description.length > 800 ? '...' : ''}</p></div>` : ''}
            ${amenities.length ? `<div class="detail-section"><h3>Amenities</h3><div class="tags">${amenities.map(a => `<span class="tag tag-amenity">${esc(a)}</span>`).join('')}${(l.amenities.length > 20) ? `<span class="tag tag-more">+${l.amenities.length - 20} more</span>` : ''}</div></div>` : ''}
            ${l.host?.host_name ? `<div class="detail-section"><h3>Host</h3><p><strong>${esc(l.host.host_name)}</strong> ${l.host.host_is_superhost ? '<span class="badge badge-super"><i class="fas fa-star"></i> Superhost</span>' : ''}</p>${l.host.host_location ? `<p><i class="fas fa-map-marker-alt"></i> ${esc(l.host.host_location)}</p>` : ''}</div>` : ''}
            <div class="detail-section">
                <h3>Booking</h3>
                <div class="tags">
                    <span class="tag"><i class="fas fa-calendar"></i> Min ${l.minimum_nights || 1} nights</span>
                    <span class="tag"><i class="fas fa-calendar"></i> Max ${l.maximum_nights || 'N/A'} nights</span>
                    <span class="tag"><i class="fas fa-ban"></i> ${esc(l.cancellation_policy || 'N/A')}</span>
                </div>
            </div>
            <div class="detail-actions">
                <button class="btn btn-primary" onclick="findSimilar(${l.listing_id})"><i class="fas fa-search"></i> Find Similar Listings</button>
                ${l.listing_url ? `<a href="${l.listing_url}" target="_blank" rel="noopener noreferrer" class="btn btn-outline"><i class="fas fa-external-link-alt"></i> View on Airbnb</a>` : ''}
            </div>
        </div>`;
    } catch (err) {
        body.innerHTML = `<p>Error: ${esc(err.message)}</p>`;
    }
}

// ── Find Similar ──────────────────────────────────────
async function findSimilar(listingId) {
    closeModal();
    switchTab('recommendations');

    const grid = document.getElementById('recResultsGrid');
    const loading = document.getElementById('recLoading');
    const meta = document.getElementById('recMeta');
    const arch = document.getElementById('archCard');
    const hist = document.getElementById('userHistoryPanel');

    arch.style.display = 'none';
    hist.style.display = 'none';
    loading.style.display = '';
    grid.innerHTML = '';
    meta.style.display = 'none';

    try {
        const res = await fetch(`${API}/similar/${listingId}?top_k=10`);
        const data = await res.json();
        loading.style.display = 'none';

        if (!data.success || !data.data?.length) {
            grid.innerHTML = emptyHTML('No similar listings found');
            return;
        }

        meta.style.display = '';
        meta.innerHTML = `
            <span><strong>Model:</strong> ${data.model}</span>
            <span><strong>Source:</strong> Cosine Similarity</span>
            <span><strong>Reference:</strong> Listing #${data.reference_listing}</span>
            <span><strong>Results:</strong> ${data.total}</span>
        `;

        grid.innerHTML = data.data.map(item => {
            const listing = item.listing || item;
            return cardHTML(listing, item.rank, item.score);
        }).join('');

    } catch (err) {
        loading.style.display = 'none';
        grid.innerHTML = errorHTML(err.message);
    }
}

function closeModal() {
    document.getElementById('rentalModal').style.display = 'none';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Helpers ───────────────────────────────────────────
function emptyHTML(title, sub) {
    return `<div class="empty"><i class="fas fa-search"></i><h3>${title || 'Nothing found'}</h3>${sub ? `<p>${sub}</p>` : ''}</div>`;
}
function errorHTML(msg) {
    return `<div class="empty error"><i class="fas fa-exclamation-triangle"></i><p>${msg}</p></div>`;
}
