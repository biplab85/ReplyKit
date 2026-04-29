// ReplyKit popup — handles templates, categories, search, edit, drag, import/export

const DEFAULT_CATEGORIES = ['general', 'sales', 'support', 'thanks'];
const SAMPLE_TEMPLATES = [
    { text: 'Hi {firstName}, thanks so much for the kind words! ❤️', category: 'thanks' },
    { text: 'Appreciate the support! Hope you have a wonderful {date}.', category: 'thanks' },
    { text: 'Great question — we just sent the details to your inbox.', category: 'support' },
    { text: 'Sorry about the trouble! Could you DM us your order number so we can take a look?', category: 'support' },
    { text: 'You can grab it here: {clipboard}', category: 'sales' },
    { text: 'Limited spots left — DM us "INFO" to get the link.', category: 'sales' }
];

const state = {
    templates: [],
    categories: [...DEFAULT_CATEGORIES],
    activeCategory: 'all',
    search: '',
    settings: { theme: 'auto' },
    editingId: null
};

// ============ DOM ============
const $ = sel => document.querySelector(sel);
const els = {
    list: $('#templateList'),
    empty: $('#emptyState'),
    listTitle: $('#listTitle'),
    listCount: $('#listCount'),
    search: $('#searchInput'),
    tabs: $('#tabs'),
    addBtn: $('#addBtn'),
    addCategoryBtn: $('#addCategoryBtn'),
    newTemplate: $('#newTemplate'),
    newCategory: $('#newCategory'),
    themeBtn: $('#themeBtn'),
    menuBtn: $('#menuBtn'),
    menu: $('#menu'),
    importFile: $('#importFile'),
    toast: $('#toast'),
    varHint: $('#varHint')
};

// ============ Storage ============
function load() {
    return new Promise(resolve => {
        chrome.storage.sync.get(['templates', 'categories', 'settings'], result => {
            let templates = result.templates || [];
            // Migrate legacy string-array shape
            if (templates.length && typeof templates[0] === 'string') {
                templates = templates.map(text => makeTemplate(text, 'general'));
            }
            state.templates = templates;
            state.categories = result.categories && result.categories.length
                ? result.categories
                : [...DEFAULT_CATEGORIES];
            state.settings = Object.assign({ theme: 'auto' }, result.settings || {});
            resolve();
        });
    });
}

function persist() {
    chrome.storage.sync.set({
        templates: state.templates,
        categories: state.categories,
        settings: state.settings
    });
}

function makeTemplate(text, category = 'general') {
    return {
        id: 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        text,
        category,
        uses: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

// ============ Theme ============
function applyTheme() {
    const t = state.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
function cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const cur = state.settings.theme || 'auto';
    state.settings.theme = order[(order.indexOf(cur) + 1) % order.length];
    applyTheme();
    persist();
    toast(`Theme: ${state.settings.theme}`);
}

// ============ Render ============
function fuzzyScore(haystack, needle) {
    if (!needle) return 1;
    const h = haystack.toLowerCase();
    const n = needle.toLowerCase();
    if (h.includes(n)) return 2;
    let i = 0, score = 0;
    for (const ch of h) {
        if (ch === n[i]) { i++; score++; if (i === n.length) return 1 + score / h.length; }
    }
    return 0;
}

function highlight(text, needle) {
    if (!needle) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx))
        + '<mark>' + escapeHtml(text.slice(idx, idx + needle.length)) + '</mark>'
        + escapeHtml(text.slice(idx + needle.length));
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderTabs() {
    const counts = { all: state.templates.length };
    state.categories.forEach(c => { counts[c] = state.templates.filter(t => t.category === c).length; });

    const tabs = [
        { id: 'all', label: 'All' },
        ...state.categories.map(c => ({ id: c, label: cap(c) }))
    ];

    els.tabs.innerHTML = tabs.map(t => `
        <button class="tab ${state.activeCategory === t.id ? 'active' : ''}" data-cat="${t.id}">
            ${t.label}
            <span class="tab-count">${counts[t.id] || 0}</span>
        </button>
    `).join('');

    // Sync category dropdown
    els.newCategory.innerHTML = state.categories
        .map(c => `<option value="${c}">${cap(c)}</option>`).join('');
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderList() {
    const search = state.search.trim();
    let items = state.templates;

    if (state.activeCategory !== 'all') {
        items = items.filter(t => t.category === state.activeCategory);
    }

    if (search) {
        items = items
            .map(t => ({ t, score: fuzzyScore(t.text, search) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(x => x.t);
    }

    els.listCount.textContent = items.length;
    els.listTitle.textContent = state.activeCategory === 'all'
        ? (search ? `Results for "${search}"` : 'All replies')
        : `${cap(state.activeCategory)} replies`;

    if (items.length === 0) {
        els.list.innerHTML = '';
        els.empty.hidden = false;
        return;
    }
    els.empty.hidden = true;

    els.list.innerHTML = items.map(t => {
        if (state.editingId === t.id) {
            return `
                <li class="t-item editing" data-id="${t.id}">
                    <div class="t-edit-area" style="flex:1">
                        <textarea class="t-edit-text">${escapeHtml(t.text)}</textarea>
                        <div class="t-edit-actions">
                            <button data-act="cancel">Cancel</button>
                            <button class="save" data-act="save">Save</button>
                        </div>
                    </div>
                </li>
            `;
        }
        return `
            <li class="t-item" data-id="${t.id}" draggable="true">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                <div class="t-body">
                    <div class="t-text">${highlight(t.text, search)}</div>
                    <div class="t-meta">
                        <span class="t-cat-pill">${escapeHtml(t.category)}</span>
                        <span class="t-uses" title="Times used">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>
                            ${t.uses || 0}
                        </span>
                    </div>
                </div>
                <div class="t-actions">
                    <button data-act="copy" title="Copy">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                    </button>
                    <button data-act="edit" title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                    </button>
                    <button data-act="delete" class="del" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </li>
        `;
    }).join('');
}

function render() {
    renderTabs();
    renderList();
}

// ============ Actions ============
function addTemplate() {
    const text = els.newTemplate.value.trim();
    if (!text) return;
    const category = els.newCategory.value || 'general';
    state.templates.unshift(makeTemplate(text, category));
    persist();
    els.newTemplate.value = '';
    render();
    toast('Reply saved');
}

function deleteTemplate(id) {
    state.templates = state.templates.filter(t => t.id !== id);
    persist();
    render();
    toast('Deleted');
}

function startEdit(id) {
    state.editingId = id;
    renderList();
    const ta = els.list.querySelector('.t-edit-text');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveEdit(id) {
    const ta = els.list.querySelector(`[data-id="${id}"] .t-edit-text`);
    if (!ta) return;
    const text = ta.value.trim();
    if (text) {
        const t = state.templates.find(x => x.id === id);
        if (t) { t.text = text; t.updatedAt = Date.now(); }
    }
    state.editingId = null;
    persist();
    renderList();
    toast('Updated');
}

function cancelEdit() { state.editingId = null; renderList(); }

async function copyTemplate(id) {
    const t = state.templates.find(x => x.id === id);
    if (!t) return;
    try {
        await navigator.clipboard.writeText(t.text);
        toast('Copied to clipboard');
    } catch {
        toast('Could not copy');
    }
}

function addCategory() {
    const name = prompt('New category name (lowercase, no spaces):');
    if (!name) return;
    const clean = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20);
    if (!clean) return;
    if (state.categories.includes(clean)) { toast('Category already exists'); return; }
    state.categories.push(clean);
    persist();
    render();
    els.newCategory.value = clean;
    toast(`Category "${clean}" added`);
}

// ============ Import / Export / Reset ============
function exportData() {
    const blob = new Blob([JSON.stringify({
        templates: state.templates,
        categories: state.categories,
        exportedAt: new Date().toISOString(),
        version: 2
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replykit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported');
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            const incoming = (data.templates || []).map(t => {
                if (typeof t === 'string') return makeTemplate(t);
                return Object.assign(makeTemplate(t.text || ''), t, { id: makeTemplate('').id });
            }).filter(t => t.text);
            state.templates = incoming.concat(state.templates);
            if (data.categories && Array.isArray(data.categories)) {
                data.categories.forEach(c => { if (!state.categories.includes(c)) state.categories.push(c); });
            }
            persist();
            render();
            toast(`Imported ${incoming.length} replies`);
        } catch (err) {
            toast('Invalid JSON file');
        }
    };
    reader.readAsText(file);
}

function loadSamples() {
    SAMPLE_TEMPLATES.forEach(s => state.templates.unshift(makeTemplate(s.text, s.category)));
    persist();
    render();
    toast('Samples loaded');
}

function resetAll() {
    if (!confirm('Delete ALL replies and categories? This cannot be undone.')) return;
    state.templates = [];
    state.categories = [...DEFAULT_CATEGORIES];
    state.activeCategory = 'all';
    persist();
    render();
    toast('Reset complete');
}

// ============ Drag & drop ============
let dragId = null;
function onDragStart(e) {
    const li = e.target.closest('.t-item');
    if (!li) return;
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
    e.preventDefault();
    const li = e.target.closest('.t-item');
    if (!li || li.dataset.id === dragId) return;
    document.querySelectorAll('.drag-over').forEach(n => n.classList.remove('drag-over'));
    li.classList.add('drag-over');
}
function onDrop(e) {
    e.preventDefault();
    const li = e.target.closest('.t-item');
    if (!li || !dragId || li.dataset.id === dragId) return cleanupDrag();
    const fromIdx = state.templates.findIndex(t => t.id === dragId);
    const toIdx = state.templates.findIndex(t => t.id === li.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return cleanupDrag();
    const [moved] = state.templates.splice(fromIdx, 1);
    state.templates.splice(toIdx, 0, moved);
    persist();
    cleanupDrag();
    renderList();
}
function cleanupDrag() {
    document.querySelectorAll('.dragging,.drag-over').forEach(n => n.classList.remove('dragging','drag-over'));
    dragId = null;
}

// ============ Toast ============
let toastTimer = null;
function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1800);
}

// ============ Wire up ============
function bind() {
    els.addBtn.addEventListener('click', addTemplate);
    els.newTemplate.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addTemplate(); }
    });
    els.addCategoryBtn.addEventListener('click', addCategory);

    els.search.addEventListener('input', e => {
        state.search = e.target.value;
        renderList();
    });

    els.tabs.addEventListener('click', e => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        state.activeCategory = tab.dataset.cat;
        render();
    });

    els.list.addEventListener('click', e => {
        const li = e.target.closest('.t-item');
        if (!li) return;
        const id = li.dataset.id;
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'delete') deleteTemplate(id);
        else if (act === 'edit') startEdit(id);
        else if (act === 'copy') copyTemplate(id);
        else if (act === 'save') saveEdit(id);
        else if (act === 'cancel') cancelEdit();
    });

    els.list.addEventListener('dragstart', onDragStart);
    els.list.addEventListener('dragover', onDragOver);
    els.list.addEventListener('drop', onDrop);
    els.list.addEventListener('dragend', cleanupDrag);

    els.themeBtn.addEventListener('click', cycleTheme);

    els.menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        els.menu.hidden = !els.menu.hidden;
    });
    document.addEventListener('click', e => {
        if (!els.menu.hidden && !els.menu.contains(e.target) && e.target !== els.menuBtn) {
            els.menu.hidden = true;
        }
    });

    els.menu.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const a = btn.dataset.action;
        if (a === 'export') exportData();
        else if (a === 'import') els.importFile.click();
        else if (a === 'seed') loadSamples();
        else if (a === 'reset') resetAll();
        els.menu.hidden = true;
    });

    els.importFile.addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) importData(f);
        e.target.value = '';
    });

    els.varHint.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const v = chip.dataset.var;
        const ta = els.newTemplate;
        const start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + v + ta.value.slice(end);
        ta.focus();
        ta.setSelectionRange(start + v.length, start + v.length);
    });

    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            els.search.focus();
            els.search.select();
        }
        if (e.key === 'Escape' && state.editingId) cancelEdit();
    });

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (state.settings.theme === 'auto') applyTheme();
        });
    }
}

(async function init() {
    await load();
    applyTheme();
    bind();
    render();
})();
