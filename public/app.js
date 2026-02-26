const state = {
  sources: [],
  selectedSourceId: '',
  articleQuery: '',
  categoryPages: {}
};

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Request failed: ${res.status}`);
  }
  return res.json();
}

function esc(value) {
  return String(value || '').replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[ch]);
}

function toISODate(value) {
  const num = Number(value);
  const date = Number.isFinite(num) ? new Date(num * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

async function loadSources() {
  state.sources = await api('/api/sources');
  const list = document.getElementById('sourceList');
  list.innerHTML = state.sources.map((s) => `
    <li>
      <strong>${esc(s.name)}</strong><br />
      <small>${esc(s.wechat_id || s.alias || '')}</small><br />
      <button data-pick="${s.id}">View</button>
      <button data-sync="${s.id}">Sync</button>
    </li>
  `).join('');
}

async function searchSource() {
  const q = document.getElementById('sourceSearchInput').value.trim();
  if (!q) return;
  const results = await api(`/api/sources/search?q=${encodeURIComponent(q)}`);
  const el = document.getElementById('searchResults');
  el.innerHTML = results.map((s) => `
    <div class="item">
      <strong>${esc(s.name)}</strong>
      <p>${esc(s.description || '')}</p>
      <small>${esc(s.wechat_id || s.alias || '')}</small><br />
      <button data-add="${encodeURIComponent(JSON.stringify(s))}">Add to SOURCE LIST</button>
    </div>
  `).join('');
}

async function addSource(payload) {
  await api('/api/sources', { method: 'POST', body: JSON.stringify(payload) });
  await loadSources();
}

async function renderCategories() {
  const sourceParam = state.selectedSourceId ? `&sourceId=${encodeURIComponent(state.selectedSourceId)}` : '';
  const categories = await api(`/api/categories?q=${encodeURIComponent(state.articleQuery)}${sourceParam}`);

  const warning = document.getElementById('warning');
  warning.classList.toggle('hidden', Boolean(categories.length));

  const wrapper = document.getElementById('categories');
  wrapper.innerHTML = categories.map((c) => {
    const category = c.category || 'others';
    return `
      <details class="category" data-category="${esc(category)}">
        <summary>${esc(category)} (${c.count})</summary>
        <div class="gallery"></div>
        <div class="pagination"></div>
      </details>
    `;
  }).join('');
}

async function renderCategoryPage(category) {
  const page = state.categoryPages[category] || 1;
  const params = new URLSearchParams({ category, page: String(page) });
  if (state.selectedSourceId) params.set('sourceId', state.selectedSourceId);
  if (state.articleQuery) params.set('q', state.articleQuery);

  const data = await api(`/api/articles?${params.toString()}`);
  const details = [...document.querySelectorAll('.category')].find((e) => e.dataset.category === category);
  if (!details) return;

  details.querySelector('.gallery').innerHTML = data.items.map((a) => `
    <a class="card" href="${esc(a.link)}" target="_blank" rel="noreferrer">
      <h4>${esc(a.title)}</h4>
      <p>${esc(a.digest || '')}</p>
      <div class="meta">${esc(a.source_name || a.author_name || '')}</div>
      <div class="meta">${toISODate(a.update_time)}</div>
    </a>
  `).join('');

  details.querySelector('.pagination').innerHTML = `
    <span>Page ${data.page} / ${data.totalPages}</span>
    <button ${data.page <= 1 ? 'disabled' : ''} data-prev="${esc(category)}">Prev</button>
    <button ${data.page >= data.totalPages ? 'disabled' : ''} data-next="${esc(category)}">Next</button>
  `;
}

document.getElementById('sourceSearchBtn').addEventListener('click', () => {
  searchSource().catch((e) => alert(e.message));
});

document.getElementById('syncAllBtn').addEventListener('click', async () => {
  const res = await api('/api/sync', { method: 'POST', body: '{}' });
  alert(`Sync completed: ${JSON.stringify(res.results)}`);
  await renderCategories();
});

document.getElementById('articleSearchBtn').addEventListener('click', async () => {
  state.articleQuery = document.getElementById('articleSearchInput').value.trim();
  state.categoryPages = {};
  await renderCategories();
});

document.body.addEventListener('click', async (e) => {
  const addBtn = e.target.closest('[data-add]');
  if (addBtn) await addSource(JSON.parse(decodeURIComponent(addBtn.dataset.add)));

  const pickBtn = e.target.closest('[data-pick]');
  if (pickBtn) {
    state.selectedSourceId = pickBtn.dataset.pick;
    state.categoryPages = {};
    await renderCategories();
  }

  const syncBtn = e.target.closest('[data-sync]');
  if (syncBtn) {
    await api('/api/sync', { method: 'POST', body: JSON.stringify({ sourceId: syncBtn.dataset.sync }) });
    await renderCategories();
  }

  const prev = e.target.closest('[data-prev]');
  if (prev) {
    const category = prev.dataset.prev;
    state.categoryPages[category] = Math.max(1, (state.categoryPages[category] || 1) - 1);
    await renderCategoryPage(category);
  }

  const next = e.target.closest('[data-next]');
  if (next) {
    const category = next.dataset.next;
    state.categoryPages[category] = (state.categoryPages[category] || 1) + 1;
    await renderCategoryPage(category);
  }
});

document.body.addEventListener('toggle', (e) => {
  const details = e.target.closest('.category');
  if (details && details.open) renderCategoryPage(details.dataset.category).catch(console.error);
}, true);

(async function init() {
  await loadSources();
  await renderCategories();
})();
