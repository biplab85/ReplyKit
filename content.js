// ReplyKit content script — floating panel injected on Facebook

(function () {
    if (window.__replyKitInjected) return;
    window.__replyKitInjected = true;

    const state = {
        templates: [],
        categories: [],
        activeCategory: 'all',
        search: '',
        lastFocused: null,
        open: false
    };

    // Track the last editable element so we can insert even after panel steals focus
    document.addEventListener('focusin', e => {
        const el = e.target;
        if (isEditable(el) && !el.closest('#rk-root')) state.lastFocused = el;
    }, true);

    function isEditable(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return true;
        if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
        return false;
    }

    // ============ Variable substitution ============
    async function resolveVariables(text) {
        let out = text;
        const now = new Date();

        if (out.includes('{firstName}')) {
            out = out.replace(/\{firstName\}/g, guessFirstName());
        }
        if (out.includes('{date}')) {
            out = out.replace(/\{date\}/g,
                now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }));
        }
        if (out.includes('{time}')) {
            out = out.replace(/\{time\}/g,
                now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        }
        if (out.includes('{clipboard}')) {
            try {
                const clip = await navigator.clipboard.readText();
                out = out.replace(/\{clipboard\}/g, clip || '');
            } catch {
                out = out.replace(/\{clipboard\}/g, '');
            }
        }
        return out;
    }

    function guessFirstName() {
        // Try to find the comment author near the focused box
        const ctx = state.lastFocused;
        if (ctx) {
            const article = ctx.closest('[role="article"], [data-pagelet]');
            if (article) {
                const link = article.querySelector('a[role="link"] strong, a[role="link"] span[dir="auto"]');
                if (link && link.textContent) {
                    const first = link.textContent.trim().split(/\s+/)[0];
                    if (first && first.length < 30) return first;
                }
            }
        }
        return 'there';
    }

    // ============ Insert ============
    async function insertText(rawText, ev) {
        const target = state.lastFocused && document.contains(state.lastFocused)
            ? state.lastFocused
            : findVisibleEditable();

        if (!target) {
            flash('Click a comment box first', ev);
            return;
        }

        const text = await resolveVariables(rawText);

        target.focus();
        let inserted = false;
        try {
            inserted = document.execCommand('insertText', false, text);
        } catch {}

        if (!inserted) {
            // Fallback for inputs/textareas
            if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                const start = target.selectionStart || 0;
                const end = target.selectionEnd || 0;
                target.value = target.value.slice(0, start) + text + target.value.slice(end);
                target.selectionStart = target.selectionEnd = start + text.length;
                target.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (target.isContentEditable) {
                const sel = window.getSelection();
                if (sel.rangeCount) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false);
                    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                }
            }
        }

        flash('Inserted', ev);
    }

    function findVisibleEditable() {
        const candidates = document.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea');
        for (const c of candidates) {
            const r = c.getBoundingClientRect();
            if (r.width > 60 && r.height > 16 && r.top < window.innerHeight && r.bottom > 0) return c;
        }
        return null;
    }

    function flash(msg, ev) {
        const el = document.createElement('div');
        el.className = 'rk-flash';
        el.textContent = msg;
        let x, y;
        if (ev && ev.clientX) { x = ev.clientX; y = ev.clientY; }
        else { x = window.innerWidth - 80; y = window.innerHeight - 80; }
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1100);
    }

    // ============ Storage ============
    function load() {
        return new Promise(resolve => {
            chrome.storage.sync.get(['templates', 'categories'], result => {
                let templates = result.templates || [];
                if (templates.length && typeof templates[0] === 'string') {
                    templates = templates.map(text => ({ id: 't_' + Math.random().toString(36).slice(2), text, category: 'general', uses: 0 }));
                }
                state.templates = templates;
                state.categories = result.categories && result.categories.length
                    ? result.categories
                    : ['general'];
                resolve();
            });
        });
    }

    function bumpUses(id) {
        const t = state.templates.find(x => x.id === id);
        if (!t) return;
        t.uses = (t.uses || 0) + 1;
        chrome.storage.sync.set({ templates: state.templates });
    }

    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns !== 'sync') return;
        if (changes.templates) state.templates = changes.templates.newValue || [];
        if (changes.categories) state.categories = changes.categories.newValue || ['general'];
        if (state.open) renderList();
        renderCats();
    });

    // ============ UI ============
    let root, panel, listEl, searchEl, catsEl, badgeEl;

    function buildUI() {
        if (document.getElementById('rk-root')) return;

        root = document.createElement('div');
        root.id = 'rk-root';
        root.innerHTML = `
            <div id="rk-toggle" title="ReplyKit (Ctrl+Shift+R)" aria-label="Open ReplyKit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 4.5h11a4.5 4.5 0 0 1 4.5 4.5v4.2a4.5 4.5 0 0 1-4.5 4.5h-3.4l-3.7 3a.6.6 0 0 1-1-.5v-2.5H8a4.5 4.5 0 0 1-4.5-4.5V8.7"/>
                    <circle cx="9" cy="11" r="1" fill="currentColor"/>
                    <circle cx="13" cy="11" r="1" fill="currentColor"/>
                    <circle cx="17" cy="11" r="1" fill="currentColor"/>
                </svg>
                <span class="rk-badge" id="rk-badge" hidden>0</span>
            </div>
            <div id="rk-panel" class="rk-hidden" role="dialog" aria-label="ReplyKit panel">
                <div id="rk-header">
                    <div class="rk-logo">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 4.5h11a4.5 4.5 0 0 1 4.5 4.5v4.2a4.5 4.5 0 0 1-4.5 4.5h-3.4l-3.7 3a.6.6 0 0 1-1-.5v-2.5H8a4.5 4.5 0 0 1-4.5-4.5V8.7"/>
                            <circle cx="9" cy="11" r="1" fill="white"/>
                            <circle cx="13" cy="11" r="1" fill="white"/>
                            <circle cx="17" cy="11" r="1" fill="white"/>
                        </svg>
                    </div>
                    <div class="rk-title">
                        <strong>ReplyKit</strong>
                        <span>Quick Replies</span>
                    </div>
                    <button class="rk-close" aria-label="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <div class="rk-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                    <input type="text" id="rk-search" placeholder="Search replies…" autocomplete="off">
                </div>
                <div class="rk-cats" id="rk-cats"></div>
                <ul class="rk-list" id="rk-list"></ul>
                <div class="rk-foot">
                    <span>Click to insert</span>
                    <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>R</kbd>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        panel = root.querySelector('#rk-panel');
        listEl = root.querySelector('#rk-list');
        searchEl = root.querySelector('#rk-search');
        catsEl = root.querySelector('#rk-cats');
        badgeEl = root.querySelector('#rk-badge');

        root.querySelector('#rk-toggle').addEventListener('click', togglePanel);
        root.querySelector('.rk-close').addEventListener('click', closePanel);
        root.querySelector('#rk-header').addEventListener('mousedown', startDrag);

        searchEl.addEventListener('input', e => {
            state.search = e.target.value;
            renderList();
        });
        searchEl.addEventListener('mousedown', e => e.stopPropagation());

        catsEl.addEventListener('click', e => {
            const c = e.target.closest('.rk-cat');
            if (!c) return;
            state.activeCategory = c.dataset.cat;
            renderCats();
            renderList();
        });

        listEl.addEventListener('mousedown', e => {
            const it = e.target.closest('.rk-item');
            if (!it) return;
            e.preventDefault(); // keep focus on the comment box
            const id = it.dataset.id;
            const t = state.templates.find(x => x.id === id);
            if (!t) return;
            insertText(t.text, e);
            bumpUses(id);
            closePanel();
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && state.open) closePanel();
        });
    }

    function togglePanel() { state.open ? closePanel() : openPanel(); }
    function openPanel() {
        state.open = true;
        panel.classList.remove('rk-hidden');
        renderCats();
        renderList();
        setTimeout(() => searchEl && searchEl.focus(), 50);
    }
    function closePanel() {
        state.open = false;
        panel.classList.add('rk-hidden');
        state.search = '';
        if (searchEl) searchEl.value = '';
    }

    // ============ Render ============
    function renderCats() {
        if (!catsEl) return;
        const counts = { all: state.templates.length };
        state.categories.forEach(c => { counts[c] = state.templates.filter(t => t.category === c).length; });
        const tabs = [{ id: 'all', label: 'All' }, ...state.categories.map(c => ({ id: c, label: cap(c) }))];
        catsEl.innerHTML = tabs.map(t => `
            <button class="rk-cat ${state.activeCategory === t.id ? 'rk-active' : ''}" data-cat="${t.id}">
                ${t.label} ${counts[t.id] || 0}
            </button>
        `).join('');
        if (badgeEl) {
            const total = state.templates.length;
            badgeEl.textContent = total > 99 ? '99+' : total;
            badgeEl.hidden = total === 0;
        }
    }

    function renderList() {
        if (!listEl) return;
        const search = (state.search || '').trim();
        let items = state.templates;
        if (state.activeCategory !== 'all') {
            items = items.filter(t => t.category === state.activeCategory);
        }
        if (search) {
            const ranked = items.map(t => ({ t, score: fuzzyScore(t.text, search) }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score);
            items = ranked.map(x => x.t);
        } else {
            // Sort by usage, then recency
            items = [...items].sort((a, b) => (b.uses || 0) - (a.uses || 0));
        }

        if (!items.length) {
            listEl.innerHTML = `
                <div class="rk-empty">
                    <strong>${search ? 'No matches' : 'No replies yet'}</strong>
                    ${search ? 'Try a different search.' : 'Open the extension popup to add some.'}
                </div>`;
            return;
        }

        listEl.innerHTML = items.map(t => `
            <li class="rk-item" data-id="${t.id}">
                <div class="rk-item-text">${highlight(t.text, search)}</div>
                <div class="rk-item-meta">
                    <span class="rk-item-cat">${escapeHtml(t.category)}</span>
                    ${t.uses ? `<span>${t.uses}×</span>` : ''}
                </div>
            </li>
        `).join('');
    }

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
        return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // ============ Drag the panel ============
    let drag = null;
    function startDrag(e) {
        if (e.target.closest('.rk-close')) return;
        const r = root.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        e.currentTarget.classList.add('rk-grabbing');
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
    }
    function onDrag(e) {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        const left = Math.max(8, Math.min(window.innerWidth - 60, drag.left + dx));
        const top = Math.max(8, Math.min(window.innerHeight - 60, drag.top + dy));
        root.style.left = left + 'px';
        root.style.top = top + 'px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
    }
    function endDrag() {
        drag = null;
        document.querySelector('#rk-header')?.classList.remove('rk-grabbing');
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', endDrag);
    }

    // ============ Init ============
    (async function init() {
        await load();
        buildUI();
        renderCats();
    })();
})();
