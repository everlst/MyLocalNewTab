function generateHighResIconMeta(urlString) {
    try {
        const urlObj = typeof urlString === 'string' ? new URL(urlString) : urlString;
        const hostname = encodeURIComponent(urlObj.hostname);
        const origin = urlObj.origin;
        const encodedOrigin = encodeURIComponent(origin);

        const candidates = [
            `https://www.google.com/s2/favicons?domain=${hostname}&sz=256`,
            `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`,
            `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedOrigin}&size=256`,
            `${origin}/favicon.ico`
        ];

        return {
            icon: candidates[0],
            iconFallbacks: candidates.slice(1)
        };
    } catch (error) {
        return {
            icon: 'icons/default.svg',
            iconFallbacks: []
        };
    }
}

function createDefaultBookmark(id, title, url) {
    const iconMeta = generateHighResIconMeta(url);
    return {
        id,
        title,
        url,
        iconType: 'favicon',
        icon: iconMeta.icon,
        iconFallbacks: iconMeta.iconFallbacks
    };
}

const STORAGE_MODES = {
    BROWSER: 'browser',
    SYNC: 'sync'
};

const STORAGE_KEYS = {
    DATA: 'edgeTabData',
    SETTINGS: 'edgeTabSettings'
};

const DEFAULT_SETTINGS = {
    storageMode: STORAGE_MODES.BROWSER
};

// 默认数据
const DEFAULT_DATA = {
    categories: [
        { 
            id: 'cat_default', 
            name: '常用', 
            bookmarks: [
                createDefaultBookmark('bm_1', 'Google', 'https://www.google.com'),
                createDefaultBookmark('bm_2', 'Bilibili', 'https://www.bilibili.com'),
                createDefaultBookmark('bm_3', 'GitHub', 'https://github.com')
            ] 
        }
    ],
    activeCategory: 'cat_default'
};

let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
let appSettings = { ...DEFAULT_SETTINGS };
let editingBookmarkId = null; // 用于标记正在编辑的书签 ID
let editingBookmarkOriginalCategory = null;
let autoIconCandidates = [];
let selectedAutoIcon = null;
let pendingAutoIconSelectionSrc = null;
let lastAutoIconUrl = '';
let isFetchingAutoIcons = false;
const DRAG_LONG_PRESS_MS = 220;
const dragState = {
    timerId: null,
    draggingId: null,
    placeholder: null
};

// DOM 元素
const els = {
    searchInput: document.getElementById('searchInput'),
    categoryList: document.getElementById('categoryList'),
    addCategoryBtn: document.getElementById('addCategoryBtn'),
    bookmarkGrid: document.getElementById('bookmarkGrid'),
    
    // Modals
    bookmarkModal: document.getElementById('bookmarkModal'),
    categoryModal: document.getElementById('categoryModal'),
    settingsModal: document.getElementById('settingsModal'),
    
    // Forms
    bookmarkForm: document.getElementById('bookmarkForm'),
    categoryForm: document.getElementById('categoryForm'),
    
    // Form Inputs
    bookmarkUrl: document.getElementById('bookmarkUrl'),
    bookmarkTitle: document.getElementById('bookmarkTitle'),
    bookmarkCategory: document.getElementById('bookmarkCategory'),
    iconPreview: document.getElementById('iconPreview'),
    customIconInput: document.getElementById('customIconInput'),
    autoIconResults: document.getElementById('autoIconResults'),
    iconResultsGrid: document.getElementById('iconResultsGrid'),
    refreshIconsBtn: document.getElementById('refreshIconsBtn'),
    autoIconControls: document.getElementById('autoIconControls'),
    categoryName: document.getElementById('categoryName'),
    modalTitle: document.getElementById('modalTitle'),
    
    // Buttons
    cancelBookmarkBtn: document.getElementById('cancelBookmarkBtn'),
    cancelCategoryBtn: document.getElementById('cancelCategoryBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    
    // Radio
    iconTypeRadios: document.getElementsByName('iconType'),
    storageModeRadios: document.getElementsByName('storageMode'),

    // Inputs
    importDataInput: document.getElementById('importDataInput'),

    // Info blocks
    browserStorageInfo: document.getElementById('browserStorageInfo'),
    syncStorageInfo: document.getElementById('syncStorageInfo')
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    await loadSettings();
    await loadData();
    renderApp();
    setupEventListeners();
}

// --- 数据操作 ---

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
            if (result[STORAGE_KEYS.SETTINGS]) {
                appSettings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
            } else {
                appSettings = { ...DEFAULT_SETTINGS };
                saveSettings();
            }
            resolve();
        });
    });
}

function saveSettings() {
    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: appSettings });
}

async function loadData() {
    const storageArea = getActiveStorageArea();
    return new Promise((resolve) => {
        storageArea.get([STORAGE_KEYS.DATA], (result) => {
            if (result[STORAGE_KEYS.DATA]) {
                appData = result[STORAGE_KEYS.DATA];
                ensureActiveCategory();
            } else {
                appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
                saveData();
            }
            const normalized = normalizeDataStructure();
            if (normalized && result[STORAGE_KEYS.DATA]) {
                saveData();
            }
            resolve();
        });
    });
}

function saveData() {
    const storageArea = getActiveStorageArea();
    persistDataToArea(storageArea, appData);
}

function persistDataToArea(area, data) {
    return new Promise((resolve) => {
        area.set({ [STORAGE_KEYS.DATA]: data }, () => resolve());
    });
}

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function ensureActiveCategory() {
    if (!appData || !Array.isArray(appData.categories)) return;
    const exists = appData.categories.find(c => c.id === appData.activeCategory);
    if (!exists && appData.categories.length > 0) {
        appData.activeCategory = appData.categories[0].id;
    }
}

function getActiveStorageArea(mode = appSettings.storageMode) {
    return mode === STORAGE_MODES.SYNC ? chrome.storage.sync : chrome.storage.local;
}

function normalizeDataStructure() {
    if (!appData || !Array.isArray(appData.categories)) return false;
    let changed = false;
    appData.categories.forEach(cat => {
        if (!Array.isArray(cat.bookmarks)) return;
        cat.bookmarks.forEach(bm => {
            if (!Array.isArray(bm.iconFallbacks)) {
                bm.iconFallbacks = [];
                changed = true;
            }
            // Only fill missing favicon data; do not overwrite user-chosen icon/fallbacks.
            if (bm.iconType === 'favicon' && (!bm.icon || bm.iconFallbacks.length === 0)) {
                const meta = generateHighResIconMeta(bm.url);
                bm.icon = bm.icon || meta.icon;
                bm.iconFallbacks = bm.iconFallbacks.length ? bm.iconFallbacks : meta.iconFallbacks;
                changed = true;
            }
        });
    });
    return changed;
}

// --- 渲染逻辑 ---

function renderApp() {
    renderCategories();
    renderBookmarks();
}

function renderCategories() {
    els.categoryList.innerHTML = '';
    
    // 填充书签模态框中的分类选择
    els.bookmarkCategory.innerHTML = '';

    appData.categories.forEach(cat => {
        // 侧边栏列表
        const li = document.createElement('li');
        li.textContent = cat.name;
        li.dataset.id = cat.id;
        if (cat.id === appData.activeCategory) {
            li.classList.add('active');
        }
        
        // 删除按钮 (只有当分类多于1个时才显示)
        if (appData.categories.length > 1) {
            const delBtn = document.createElement('span');
            delBtn.className = 'delete-cat';
            delBtn.textContent = '×';
            delBtn.title = '删除分类';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
            };
            li.appendChild(delBtn);
        }

        li.onclick = () => {
            appData.activeCategory = cat.id;
            saveData();
            renderApp();
        };
        els.categoryList.appendChild(li);

        // 模态框下拉选项
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        els.bookmarkCategory.appendChild(option);
    });
}

function renderBookmarks() {
    ensureBookmarkGridDropzone();
    // 清空 Grid，保留添加按钮
    // 注意：这里我们先清空所有 .bookmark-card，然后重新插入
    // 为了保持顺序，我们先清空 innerHTML，然后重建
    els.bookmarkGrid.innerHTML = '';
    
    const currentCat = appData.categories.find(c => c.id === appData.activeCategory);
    if (!currentCat) return;

    currentCat.bookmarks.forEach(bm => {
        const card = document.createElement('a');
        card.className = 'bookmark-card';
        card.dataset.id = bm.id;
        card.href = bm.url;
        
        // 图标
        const img = document.createElement('img');
        img.className = 'bookmark-icon';
        img.src = bm.icon || 'icons/default.svg';
        attachIconFallback(img, bm);
        
        // 标题
        const title = document.createElement('div');
        title.className = 'bookmark-title';
        title.textContent = bm.title;

        // 操作按钮容器
        const actions = document.createElement('div');
        actions.className = 'card-actions';

        // 编辑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit';
        editBtn.innerHTML = '✎';
        editBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openEditBookmarkModal(bm);
        };

        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn delete';
        delBtn.innerHTML = '×';
        delBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteBookmark(bm.id);
        };

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        card.appendChild(img);
        card.appendChild(title);
        card.appendChild(actions);
        
        setupBookmarkCardDrag(card, bm.id);
        els.bookmarkGrid.appendChild(card);
    });

    // 最后添加“添加按钮”
    // 由于我们每次都清空 innerHTML，所以需要重新把 addBookmarkBtn 加上去
    // 或者我们在 HTML 里不写 addBookmarkBtn，完全由 JS 生成。
    // 这里为了方便，我们克隆一个或者动态创建
    // 更好的方式是：HTML 里保留 addBookmarkBtn，但是它不在 bookmarkGrid 里？
    // 不，它应该在 Grid 里。
    // 让我们动态创建它
    const addBtn = document.createElement('div');
    addBtn.className = 'add-bookmark-card';
    addBtn.innerHTML = '<span class="plus">+</span><span>添加网址</span>';
    addBtn.onclick = () => openAddBookmarkModal();
    els.bookmarkGrid.appendChild(addBtn);
}

function attachIconFallback(imgElement, bookmark) {
    const fallbackQueue = Array.isArray(bookmark.iconFallbacks) ? [...bookmark.iconFallbacks] : [];
    imgElement.onerror = () => {
        if (fallbackQueue.length) {
            const nextSrc = fallbackQueue.shift();
            imgElement.src = nextSrc;
        } else {
            imgElement.onerror = null;
            imgElement.src = 'icons/default.svg';
        }
    };
}

function getDragPlaceholder() {
    if (!dragState.placeholder) {
        const ph = document.createElement('div');
        ph.className = 'bookmark-placeholder';
        dragState.placeholder = ph;
    }
    return dragState.placeholder;
}

function removeDragPlaceholder() {
    if (dragState.placeholder && dragState.placeholder.parentNode) {
        dragState.placeholder.parentNode.removeChild(dragState.placeholder);
    }
}

function positionPlaceholderNearCard(card, dropBefore = true) {
    const placeholder = getDragPlaceholder();
    const parent = card.parentNode;
    if (!parent) return;
    const referenceNode = dropBefore ? card : card.nextSibling;
    if (referenceNode === placeholder) return;
    parent.insertBefore(placeholder, referenceNode);
}

function positionPlaceholderAtEnd() {
    const placeholder = getDragPlaceholder();
    if (!els.bookmarkGrid) return;
    const addBtn = els.bookmarkGrid.querySelector('.add-bookmark-card');
    if (addBtn) {
        if (placeholder.nextSibling === addBtn && placeholder.parentNode === els.bookmarkGrid) return;
        els.bookmarkGrid.insertBefore(placeholder, addBtn);
    } else {
        if (placeholder.parentNode === els.bookmarkGrid && placeholder.nextSibling === null) return;
        els.bookmarkGrid.appendChild(placeholder);
    }
}

function computeInsertIndexFromPlaceholder() {
    if (!els.bookmarkGrid || !dragState.placeholder || !dragState.placeholder.parentNode) return -1;
    let index = 0;
    const children = Array.from(els.bookmarkGrid.children);
    for (const child of children) {
        if (child === dragState.placeholder) {
            return index;
        }
        if (child.classList.contains('bookmark-card')) {
            index += 1;
        }
    }
    return -1;
}

function ensureBookmarkGridDropzone() {
    if (!els.bookmarkGrid || els.bookmarkGrid.dataset.dropSetup === '1') return;
    els.bookmarkGrid.addEventListener('dragover', (e) => {
        if (dragState.draggingId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const targetCard = e.target.closest('.bookmark-card');
            if (dragState.placeholder && e.target === dragState.placeholder) return;
            if (targetCard) {
                const rect = targetCard.getBoundingClientRect();
                const dropBefore = e.clientY < rect.top + rect.height / 2;
                positionPlaceholderNearCard(targetCard, dropBefore);
            } else {
                positionPlaceholderAtEnd();
            }
        }
    });
    els.bookmarkGrid.addEventListener('drop', handleGridDrop);
    els.bookmarkGrid.dataset.dropSetup = '1';
}

function handleGridDrop(event) {
    event.preventDefault();
    if (!dragState.draggingId) return;
    applyReorderFromPlaceholder();
    removeDragPlaceholder();
}

function setupBookmarkCardDrag(card, bookmarkId) {
    const clearLongPress = () => {
        if (dragState.timerId) {
            clearTimeout(dragState.timerId);
            dragState.timerId = null;
        }
        card.classList.remove('drag-ready');
        card.draggable = false;
    };

    const startLongPress = (event) => {
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('.action-btn')) {
            return;
        }
        clearLongPress();
        dragState.timerId = setTimeout(() => {
            card.draggable = true;
            card.classList.add('drag-ready');
        }, DRAG_LONG_PRESS_MS);
    };

    card.addEventListener('pointerdown', startLongPress);
    card.addEventListener('pointerup', clearLongPress);
    card.addEventListener('pointerleave', clearLongPress);
    card.addEventListener('pointercancel', clearLongPress);

    card.addEventListener('dragstart', (e) => {
        if (!card.draggable) {
            e.preventDefault();
            return;
        }
        dragState.draggingId = bookmarkId;
        card.dataset.dragActive = '1';
        card.classList.add('dragging');
        // place a placeholder right after the dragged card to avoid layout jump
        if (card.parentNode) {
            const placeholder = getDragPlaceholder();
            card.parentNode.insertBefore(placeholder, card.nextSibling);
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bookmarkId);
    });

    card.addEventListener('dragover', (e) => {
        if (!dragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = card.getBoundingClientRect();
        const dropBefore = e.clientY < rect.top + rect.height / 2;
        positionPlaceholderNearCard(card, dropBefore);
    });

    card.addEventListener('drop', (e) => {
        handleBookmarkDrop(e, bookmarkId);
    });

    card.addEventListener('dragend', () => {
        dragState.draggingId = null;
        card.dataset.dragActive = '0';
        card.classList.remove('dragging', 'drag-ready');
        card.draggable = false;
        removeDragPlaceholder();
        clearLongPress();
    });

    card.addEventListener('click', (e) => {
        if (card.dataset.dragActive === '1') {
            e.preventDefault();
            card.dataset.dragActive = '0';
        }
    });
}

function handleBookmarkDrop(event, targetBookmarkId) {
    event.preventDefault();
    const draggingId = dragState.draggingId;
    if (!draggingId || draggingId === targetBookmarkId) return;
    const currentCat = appData.categories.find(c => c.id === appData.activeCategory);
    if (!currentCat || !Array.isArray(currentCat.bookmarks)) return;
    const placeholderIndex = computeInsertIndexFromPlaceholder();
    if (placeholderIndex >= 0) {
        reorderBookmark(currentCat, draggingId, placeholderIndex);
        return;
    }
    const fromIndex = currentCat.bookmarks.findIndex(b => b.id === draggingId);
    const toIndex = currentCat.bookmarks.findIndex(b => b.id === targetBookmarkId);
    if (fromIndex === -1 || toIndex === -1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dropBefore = event.clientY < rect.top + rect.height / 2;
    const insertIndex = dropBefore ? toIndex : toIndex + 1;
    reorderBookmark(currentCat, draggingId, insertIndex);
    removeDragPlaceholder();
}

function applyReorderFromPlaceholder() {
    const currentCat = appData.categories.find(c => c.id === appData.activeCategory);
    if (!currentCat || !Array.isArray(currentCat.bookmarks)) return;
    const insertIndex = computeInsertIndexFromPlaceholder();
    if (insertIndex < 0 || !dragState.draggingId) return;
    reorderBookmark(currentCat, dragState.draggingId, insertIndex);
}

function reorderBookmark(category, bookmarkId, insertIndex) {
    const fromIndex = category.bookmarks.findIndex(b => b.id === bookmarkId);
    if (fromIndex === -1) return;
    let targetIndex = Math.max(0, Math.min(insertIndex, category.bookmarks.length));
    if (fromIndex < targetIndex) {
        targetIndex -= 1;
    }
    if (fromIndex === targetIndex) return;
    const [moved] = category.bookmarks.splice(fromIndex, 1);
    category.bookmarks.splice(targetIndex, 0, moved);
    removeDragPlaceholder();
    saveData();
    renderBookmarks();
}
// --- 业务逻辑 ---

function deleteCategory(id) {
    if (!confirm('确定要删除这个分类及其所有书签吗？')) return;
    
    appData.categories = appData.categories.filter(c => c.id !== id);
    // 如果删除了当前激活的分类，切换到第一个
    if (appData.activeCategory === id) {
        appData.activeCategory = appData.categories[0].id;
    }
    saveData();
    renderApp();
}

function deleteBookmark(id) {
    if (!confirm('确定删除此书签？')) return;
    
    const cat = appData.categories.find(c => c.id === appData.activeCategory);
    if (cat) {
        cat.bookmarks = cat.bookmarks.filter(b => b.id !== id);
        saveData();
        renderBookmarks();
    }
}

// --- 模态框与表单 ---

function openAddBookmarkModal() {
    editingBookmarkId = null;
    editingBookmarkOriginalCategory = null;
    pendingAutoIconSelectionSrc = null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: false });
    els.modalTitle.textContent = '添加网址';
    els.bookmarkForm.reset();
    els.bookmarkCategory.value = appData.activeCategory;
    setIconPreviewSource('');
    toggleIconInput('favicon');
    els.bookmarkModal.classList.remove('hidden');
}

function openEditBookmarkModal(bm) {
    editingBookmarkId = bm.id;
    const containingCategory = appData.categories.find(cat => Array.isArray(cat.bookmarks) && cat.bookmarks.some(b => b.id === bm.id));
    editingBookmarkOriginalCategory = containingCategory ? containingCategory.id : appData.activeCategory;
    pendingAutoIconSelectionSrc = bm.iconType === 'favicon' ? bm.icon : null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: bm.iconType !== 'favicon' });
    els.modalTitle.textContent = '编辑网址';
    els.bookmarkUrl.value = bm.url;
    els.bookmarkTitle.value = bm.title;
    els.bookmarkCategory.value = editingBookmarkOriginalCategory || appData.activeCategory; // 优先绑定到原分类
    
    // 设置图标状态
    if (bm.iconType === 'custom') {
        document.querySelector('input[name="iconType"][value="custom"]').checked = true;
        toggleIconInput('custom');
        setIconPreviewSource(bm.icon);
    } else {
        document.querySelector('input[name="iconType"][value="favicon"]').checked = true;
        toggleIconInput('favicon');
        loadAutoIconsForUrl(bm.url, { desiredSrc: bm.icon, force: true });
    }

    els.bookmarkModal.classList.remove('hidden');
}

function closeModals() {
    els.bookmarkModal.classList.add('hidden');
    els.categoryModal.classList.add('hidden');
    closeSettingsModal();
    resetAutoIconSelection({ hideContainers: true });
    editingBookmarkId = null;
    editingBookmarkOriginalCategory = null;
    pendingAutoIconSelectionSrc = null;
    selectedAutoIcon = null;
    setIconPreviewSource('');
}

function toggleIconInput(type) {
    if (type === 'custom') {
        els.customIconInput.classList.remove('hidden');
        resetAutoIconSelection({ hideContainers: true });
        setIconPreviewSource('');
    } else {
        els.customIconInput.classList.add('hidden');
        ensureAutoIconContainersVisible();
        if (els.bookmarkUrl.value.trim()) {
            loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                desiredSrc: pendingAutoIconSelectionSrc,
                force: true
            });
        } else {
            setIconPreviewSource('');
            setAutoIconStatus('请输入网址以获取图标。');
        }
    }
}

function setIconPreviewSource(src, { enableAutoFallbacks = false } = {}) {
    if (!els.iconPreview) return;
    // reset previous error handler to avoid stale fallbacks
    els.iconPreview.onerror = null;
    if (src) {
        // When previewing auto-fetched icons (especially SVG), reuse the same fallback chain
        // as bookmark cards so broken candidates gracefully downgrade instead of showing a
        // broken image placeholder in the modal.
        if (enableAutoFallbacks) {
            const fallbacks = autoIconCandidates
                .filter(candidate => candidate && candidate.src && candidate.src !== src)
                .map(candidate => candidate.src);
            attachIconFallback(els.iconPreview, { iconFallbacks: fallbacks });
        }
        els.iconPreview.src = src;
        els.iconPreview.classList.remove('hidden');
    } else {
        els.iconPreview.src = '';
        els.iconPreview.classList.add('hidden');
    }
}

function resetAutoIconSelection({ hideContainers = false } = {}) {
    autoIconCandidates = [];
    selectedAutoIcon = null;
    if (els.iconResultsGrid) {
        els.iconResultsGrid.innerHTML = '';
    }
    if (hideContainers) {
        if (els.autoIconResults) {
            els.autoIconResults.classList.add('hidden');
        }
        if (els.autoIconControls) {
            els.autoIconControls.classList.add('hidden');
        }
    }
}

function ensureAutoIconContainersVisible() {
    if (els.autoIconResults) {
        els.autoIconResults.classList.remove('hidden');
    }
    if (els.autoIconControls) {
        els.autoIconControls.classList.remove('hidden');
    }
}

function setAutoIconStatus(message) {
    if (!els.iconResultsGrid) return;
    els.iconResultsGrid.innerHTML = `<div class="icon-result-placeholder">${message}</div>`;
}

function renderAutoIconCandidates() {
    if (!els.iconResultsGrid) return;
    if (!autoIconCandidates.length) {
        setAutoIconStatus('暂时没有可用的图标。');
        return;
    }
    els.iconResultsGrid.innerHTML = '';
    autoIconCandidates.forEach((candidate, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-result-item';
        if (selectedAutoIcon && selectedAutoIcon.src === candidate.src) {
            button.classList.add('selected');
        }

        const img = document.createElement('img');
        img.alt = candidate.label || 'icon candidate';
        // Use a fallback chain for thumbnails too, so broken SVGs auto-downgrade instead of showing a broken icon.
        const thumbnailFallbacks = autoIconCandidates
            .filter(c => c && c.src && c.src !== candidate.src)
            .map(c => c.src);
        attachIconFallback(img, { iconFallbacks: thumbnailFallbacks });
        img.src = candidate.src;

        const meta = document.createElement('div');
        meta.className = 'meta';

        const label = document.createElement('span');
        label.textContent = candidate.label || '候选图标';

        const source = document.createElement('span');
        source.className = 'source';
        const sourceLabel = candidate.source || '未知来源';
        source.textContent = `${candidate.isSvg ? 'SVG · ' : ''}${sourceLabel}`;

        meta.appendChild(label);
        meta.appendChild(source);

        button.appendChild(img);
        button.appendChild(meta);
        button.onclick = () => selectAutoIcon(candidate.src);
        els.iconResultsGrid.appendChild(button);
    });
}

function selectAutoIcon(identifier) {
    if (!autoIconCandidates.length) return;
    let candidate = null;
    if (typeof identifier === 'number') {
        candidate = autoIconCandidates[identifier];
    } else if (typeof identifier === 'string') {
        candidate = autoIconCandidates.find(c => c.src === identifier);
    }
    if (!candidate) {
        candidate = autoIconCandidates[0];
    }
    selectedAutoIcon = candidate;
    pendingAutoIconSelectionSrc = candidate.src;
    setIconPreviewSource(candidate.src, { enableAutoFallbacks: true });
    renderAutoIconCandidates();
}

async function loadAutoIconsForUrl(inputUrl, { desiredSrc = null, force = false } = {}) {
    const normalizedUrl = normalizeUrlInput(inputUrl);
    if (!normalizedUrl) {
        setAutoIconStatus('网址无效，无法获取图标。');
        return;
    }
    if (isFetchingAutoIcons && !force) {
        return;
    }
    if (!force && normalizedUrl === lastAutoIconUrl && autoIconCandidates.length) {
        if (desiredSrc) {
            selectAutoIcon(desiredSrc);
        }
        return;
    }
    lastAutoIconUrl = normalizedUrl;
    isFetchingAutoIcons = true;
    ensureAutoIconContainersVisible();
    setAutoIconStatus('正在获取图标...');
    try {
        const urlObj = new URL(normalizedUrl);
        const candidates = await fetchIconCandidates(urlObj);
        if (!candidates.length) {
            autoIconCandidates = [];
            selectedAutoIcon = null;
            setIconPreviewSource('');
            setAutoIconStatus('未找到图标，请尝试自定义上传。');
            return;
        }
        autoIconCandidates = prioritizeSvgCandidates(candidates);
        renderAutoIconCandidates();
        if (desiredSrc && autoIconCandidates.some(c => c.src === desiredSrc)) {
            selectAutoIcon(desiredSrc);
        } else {
            selectAutoIcon(0);
        }
    } catch (error) {
        console.error('获取图标失败', error);
        autoIconCandidates = [];
        selectedAutoIcon = null;
        setIconPreviewSource('');
        setAutoIconStatus('获取图标失败，请稍后重试或改用自定义图片。');
    } finally {
        isFetchingAutoIcons = false;
    }
}

function normalizeUrlInput(input) {
    if (!input) return '';
    try {
        return new URL(input).href;
    } catch (error) {
        try {
            return new URL(`https://${input}`).href;
        } catch (err) {
            return '';
        }
    }
}

async function fetchIconCandidates(urlObj) {
    const staticCandidates = buildStaticIconCandidates(urlObj);
    let bestIconCandidates = [];
    try {
        bestIconCandidates = await fetchIconsFromBesticon(urlObj);
    } catch (error) {
        console.warn('BestIcon 服务不可用，使用静态候选列表', error);
    }
    const combined = [...staticCandidates, ...bestIconCandidates];
    const seen = new Set();
    const deduped = [];
    combined.forEach(candidate => {
        if (!candidate || !candidate.src) return;
        if (seen.has(candidate.src)) return;
        seen.add(candidate.src);
        deduped.push(candidate);
    });
    return deduped;
}

function buildStaticIconCandidates(urlObj) {
    const hostname = urlObj.hostname;
    const origin = urlObj.origin;
    const encodedHostname = encodeURIComponent(hostname);
    const encodedOrigin = encodeURIComponent(origin);
    return [
        {
            src: `https://logo.clearbit.com/${hostname}?format=svg`,
            label: 'Clearbit SVG',
            source: 'Clearbit',
            isSvg: true,
            priority: 5
        },
        {
            src: `https://logo.clearbit.com/${hostname}?size=256`,
            label: 'Clearbit 256px',
            source: 'Clearbit',
            priority: 4
        },
        {
            src: `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=256`,
            label: 'Google S2 256px',
            source: 'Google S2',
            priority: 3
        },
        {
            src: `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=128`,
            label: 'Google S2 128px',
            source: 'Google S2',
            priority: 2
        },
        {
            src: `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedOrigin}&size=256`,
            label: 'GStatic 256px',
            source: 'GStatic',
            priority: 2
        },
        {
            src: `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
            label: 'DuckDuckGo ICO',
            source: 'DuckDuckGo',
            priority: 1
        },
        {
            src: `${origin}/favicon.svg`,
            label: '站点 favicon.svg',
            source: '站点',
            isSvg: true,
            priority: 4
        },
        {
            src: `${origin}/favicon.ico`,
            label: '站点 favicon.ico',
            source: '站点',
            priority: 1
        }
    ];
}

async function fetchIconsFromBesticon(urlObj) {
    const endpoint = `https://besticon-demo.herokuapp.com/allicons.json?url=${encodeURIComponent(urlObj.origin)}`;
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('BestIcon 请求失败');
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.icons)) {
        return [];
    }
    return data.icons.slice(0, 12).map(icon => ({
        src: icon.url,
        label: `${icon.width || icon.height || ''}px ${icon.format ? icon.format.toUpperCase() : ''}`.trim(),
        source: 'BestIcon',
        isSvg: icon.format?.toLowerCase() === 'svg',
        priority: icon.width || icon.height || 0
    }));
}

function prioritizeSvgCandidates(list) {
    return [...list].sort((a, b) => {
        const svgDelta = (b.isSvg === true) - (a.isSvg === true);
        if (svgDelta !== 0) return svgDelta;
        const priorityDelta = (b.priority || 0) - (a.priority || 0);
        return priorityDelta;
    });
}

function openSettingsModal() {
    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.checked = radio.value === appSettings.storageMode;
    });
    updateStorageInfoVisibility(appSettings.storageMode);
    if (els.settingsModal) {
        els.settingsModal.classList.remove('hidden');
    }
}

function closeSettingsModal() {
    if (els.settingsModal) {
        els.settingsModal.classList.add('hidden');
    }
}

async function handleStorageModeChange(mode) {
    if (mode === appSettings.storageMode) return;
    updateStorageInfoVisibility(mode);
    await switchStorageMode(mode);
}

async function switchStorageMode(targetMode) {
    const snapshot = JSON.parse(JSON.stringify(appData));
    const targetArea = getActiveStorageArea(targetMode);
    await persistDataToArea(targetArea, snapshot);
    appSettings.storageMode = targetMode;
    saveSettings();
    await loadData();
    renderApp();
}

function exportDataAsFile() {
    const dataStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `edgeTab-data-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleImportDataFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (!parsed || !Array.isArray(parsed.categories)) {
                alert('导入失败：文件格式不正确');
                return;
            }
            appData = parsed;
            ensureActiveCategory();
            normalizeDataStructure();
            saveData();
            renderApp();
            alert('导入成功');
            closeSettingsModal();
        } catch (err) {
            console.error('导入数据失败', err);
            alert('导入失败：无法解析文件');
        }
    };
    reader.readAsText(file, 'utf-8');
}

function updateStorageInfoVisibility(mode) {
    if (!els.browserStorageInfo || !els.syncStorageInfo) return;
    if (mode === STORAGE_MODES.SYNC) {
        els.browserStorageInfo.classList.add('hidden');
        els.syncStorageInfo.classList.remove('hidden');
    } else {
        els.browserStorageInfo.classList.remove('hidden');
        els.syncStorageInfo.classList.add('hidden');
    }
}

// --- 事件监听 ---

function setupEventListeners() {
    // 搜索
    els.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = els.searchInput.value;
            if (query) {
                window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            }
        }
    });

    // 模态框关闭
    els.cancelBookmarkBtn.onclick = closeModals;
    els.cancelCategoryBtn.onclick = closeModals;
    if (els.closeSettingsBtn) {
        els.closeSettingsBtn.onclick = closeSettingsModal;
    }
    if (els.settingsBtn) {
        els.settingsBtn.onclick = openSettingsModal;
    }
    
    // 点击模态框背景关闭
    window.onclick = (e) => {
        if (e.target === els.bookmarkModal || e.target === els.categoryModal || e.target === els.settingsModal) {
            closeModals();
        }
    };

    // 添加分类
    els.addCategoryBtn.onclick = () => {
        els.categoryForm.reset();
        els.categoryModal.classList.remove('hidden');
    };

    els.categoryForm.onsubmit = (e) => {
        e.preventDefault();
        const name = els.categoryName.value.trim();
        if (name) {
            appData.categories.push({
                id: generateId('cat'),
                name: name,
                bookmarks: []
            });
            saveData();
            renderCategories(); // 重新渲染分类列表
            closeModals();
        }
    };

    // 图标类型切换
    Array.from(els.iconTypeRadios).forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleIconInput(e.target.value);
        });
    });

    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                await handleStorageModeChange(e.target.value);
            }
        });
    });

    // 自定义图标预览
    els.customIconInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setIconPreviewSource(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });

    // 自动填充标题 (简单的优化)
    els.bookmarkUrl.addEventListener('blur', () => {
        if (!els.bookmarkTitle.value && els.bookmarkUrl.value) {
            try {
                const url = new URL(els.bookmarkUrl.value);
                els.bookmarkTitle.value = url.hostname;
            } catch (e) {
                // ignore invalid url
            }
        }
        const activeIconType = document.querySelector('input[name="iconType"]:checked');
        if (activeIconType && activeIconType.value === 'favicon' && els.bookmarkUrl.value.trim()) {
            loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                desiredSrc: pendingAutoIconSelectionSrc
            });
        }
    });

    // 保存书签
    els.bookmarkForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const url = els.bookmarkUrl.value.trim();
        const title = els.bookmarkTitle.value.trim();
        const categoryId = els.bookmarkCategory.value;
        const iconType = document.querySelector('input[name="iconType"]:checked').value;
        
        let iconUrl = '';
        let iconFallbacks = [];

        if (iconType === 'custom') {
            // 如果有新上传的文件
            if (els.customIconInput.files.length > 0) {
                iconUrl = await readFileAsDataURL(els.customIconInput.files[0]);
            } else if (editingBookmarkId) {
                // 如果是编辑且没上传新文件，保持原样
                // 需要找到原来的 icon
                // 这里简化处理：如果预览图有 src，就用预览图的（可能是之前的 base64）
                iconUrl = els.iconPreview.src;
            }
            iconFallbacks = [];
        } else {
            if (selectedAutoIcon) {
                iconUrl = selectedAutoIcon.src;
                iconFallbacks = autoIconCandidates
                    .filter(candidate => candidate.src !== selectedAutoIcon.src)
                    .map(candidate => candidate.src);
            } else {
                const iconMeta = generateHighResIconMeta(url);
                iconUrl = iconMeta.icon;
                iconFallbacks = iconMeta.iconFallbacks;
            }
        }

        const bookmarkData = {
            id: editingBookmarkId || generateId('bm'),
            title,
            url,
            icon: iconUrl,
            iconType,
            iconFallbacks
        };

        if (editingBookmarkId) {
            const sourceCat = appData.categories.find(c => Array.isArray(c.bookmarks) && c.bookmarks.some(b => b.id === editingBookmarkId));
            let removedFromSource = false;
            let sourceIndex = -1;
            if (sourceCat) {
                sourceIndex = sourceCat.bookmarks.findIndex(b => b.id === editingBookmarkId);
                if (sourceIndex >= 0) {
                    sourceCat.bookmarks.splice(sourceIndex, 1);
                    removedFromSource = true;
                }
            }
            const targetCat = appData.categories.find(c => c.id === categoryId);
            if (targetCat) {
                if (targetCat.id === editingBookmarkOriginalCategory && removedFromSource && sourceIndex >= 0) {
                    targetCat.bookmarks.splice(sourceIndex, 0, bookmarkData);
                } else {
                    targetCat.bookmarks.push(bookmarkData);
                }
            }
        } else {
            // 新增模式
            const targetCat = appData.categories.find(c => c.id === categoryId);
            if (targetCat) {
                targetCat.bookmarks.push(bookmarkData);
            }
        }

        saveData();
        renderApp();
        closeModals();
    };

    if (els.exportDataBtn) {
        els.exportDataBtn.addEventListener('click', exportDataAsFile);
    }
    if (els.importDataInput) {
        els.importDataInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleImportDataFile(e.target.files[0]);
            }
            e.target.value = '';
        });
    }
    if (els.refreshIconsBtn) {
        els.refreshIconsBtn.addEventListener('click', () => {
            if (els.bookmarkUrl.value.trim()) {
                loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                    desiredSrc: pendingAutoIconSelectionSrc,
                    force: true
                });
            } else {
                ensureAutoIconContainersVisible();
                setAutoIconStatus('请输入网址以获取图标。');
            }
        });
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
