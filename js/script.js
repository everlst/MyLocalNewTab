function generateHighResIconMeta(urlString) {
    try {
        const urlObj = typeof urlString === 'string' ? new URL(urlString) : urlString;
        const hostname = urlObj.hostname;
        const encodedHostname = encodeURIComponent(hostname);
        const origin = urlObj.origin;
        const encodedOrigin = encodeURIComponent(origin);

        const candidates = [
            `https://logo.clearbit.com/${hostname}?size=256`,
            `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=256`,
            `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedOrigin}&size=256`,
            `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=128`,
            `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
            `${origin}/favicon.ico`,
            `https://logo.clearbit.com/${hostname}?format=svg`,
            `${origin}/favicon.svg`
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
    SYNC: 'sync',
    WEBDAV: 'webdav',
    GIST: 'gist'
};

const STORAGE_KEYS = {
    DATA: 'edgeTabData',
    SETTINGS: 'edgeTabSettings'
};

const DEFAULT_SETTINGS = {
    storageMode: STORAGE_MODES.BROWSER,
    webdav: {
        endpoint: '',
        username: '',
        password: ''
    },
    gist: {
        token: '',
        gistId: '',
        filename: 'edgeTab-data.json'
    }
};

const DEFAULT_SWATCH_COLOR = '#4ac55c';
const DEFAULT_REMOTE_FILENAME = 'edgeTab-data.json';
const REMOTE_FETCH_TIMEOUT = 12000;

const IMPORT_SOURCES = {
    EDGE_TAB: 'edgeTab',
    WETAB: 'wetab'
};

const IMPORT_MODES = {
    MERGE: 'merge',
    OVERWRITE: 'overwrite'
};

const CACHE_KEYS = {
    ICONS: 'edgeTabIconCache'
};

const MAX_CACHED_ICON_BYTES = 500 * 1024;

function mergeSettingsWithDefaults(raw = {}) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
        ...DEFAULT_SETTINGS,
        ...base,
        webdav: { ...DEFAULT_SETTINGS.webdav, ...(base.webdav || {}) },
        gist: { ...DEFAULT_SETTINGS.gist, ...(base.gist || {}) }
    };
}

function isRemoteMode(mode) {
    return mode === STORAGE_MODES.WEBDAV || mode === STORAGE_MODES.GIST;
}

const syncWarningState = {
    webdav: false,
    gist: false
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
let iconCache = {};
let autoIconCandidates = [];
let selectedAutoIcon = null;
let selectedCustomIconSrc = '';
let customIconMode = 'upload';
let pendingAutoIconSelectionSrc = null;
let lastAutoIconUrl = '';
let isFetchingAutoIcons = false;
const DRAG_LONG_PRESS_MS = 90; // 调优为 90ms，提供更灵敏的选中体验
const dragState = {
    timerId: null,
    draggingId: null,
    sourceCategoryId: null,
    sourceFolderId: null,
    placeholder: null,
    activeContainer: null,
    hoverTargetId: null,
    hoverStartTs: 0,
    mergeIntent: false,
    lastPosition: { x: 0, y: 0 }
};
const modalState = {
    editingId: null,
    type: 'link',
    originCategoryId: null,
    originFolderId: null,
    originIndex: -1,
    targetCategoryId: null,
    targetFolderId: null,
    lockType: false
};
let openFolderId = null;
let openFolderCategoryId = null;

function walkBookmarkNode(node, visitor) {
    if (!node) return;
    visitor(node);
    if (node.type === 'folder' && Array.isArray(node.children)) {
        node.children.forEach(child => walkBookmarkNode(child, visitor));
    }
}

function walkCategoryBookmarks(category, visitor) {
    if (!category || !Array.isArray(category.bookmarks)) return;
    category.bookmarks.forEach(bm => walkBookmarkNode(bm, visitor));
}

function normalizeFolderChildTitles(folderTitle, children, { clone = false } = {}) {
    if (!Array.isArray(children)) {
        return clone ? [] : false;
    }
    const prefix = folderTitle ? `${folderTitle} / ` : '';
    let changed = false;
    const target = clone ? children.map(child => child ? { ...child } : child) : children;
    if (prefix) {
        target.forEach(child => {
            if (!child || !child.title) return;
            if (child.title.startsWith(prefix)) {
                child.title = child.title.slice(prefix.length);
                changed = true;
            }
        });
    }
    return clone ? target : changed;
}

function measureOverlapRect(rectA, rectB) {
    const x1 = Math.max(rectA.left, rectB.left);
    const y1 = Math.max(rectA.top, rectB.top);
    const x2 = Math.min(rectA.right, rectB.right);
    const y2 = Math.min(rectA.bottom, rectB.bottom);
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    return { width, height, area: width * height };
}

function shrinkRect(rect, ratio = 0.7) {
    const w = rect.width * ratio;
    const h = rect.height * ratio;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return {
        left: cx - w / 2,
        right: cx + w / 2,
        top: cy - h / 2,
        bottom: cy + h / 2,
        width: w,
        height: h
    };
}

function isPointInsideRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function getCategoryById(categoryId) {
    if (!appData || !Array.isArray(appData.categories)) return null;
    return appData.categories.find(cat => cat.id === categoryId);
}

function getActiveCategory() {
    return getCategoryById(appData.activeCategory);
}

function findBookmarkLocation(bookmarkId, data = appData) {
    if (!bookmarkId || !data || !Array.isArray(data.categories)) return null;
    for (const cat of data.categories) {
        const result = findInList(cat.bookmarks, bookmarkId, null);
        if (result) {
            return { ...result, category: cat, categoryId: cat.id };
        }
    }
    return null;

    function findInList(list, id, parentFolder) {
        if (!Array.isArray(list)) return null;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item) continue;
            if (item.id === id) {
                return {
                    bookmark: item,
                    index: i,
                    listRef: list,
                    parentFolder,
                    parentFolderId: parentFolder ? parentFolder.id : null
                };
            }
            if (item.type === 'folder') {
                const nested = findInList(item.children, id, item);
                if (nested) return nested;
            }
        }
        return null;
    }
}

function getFolderDepth(folderId) {
    if (!folderId) return 0;
    let depth = 1;
    let loc = findBookmarkLocation(folderId);
    while (loc && loc.parentFolderId) {
        depth++;
        loc = findBookmarkLocation(loc.parentFolderId);
    }
    return depth;
}

function getBookmarkList(categoryId, folderId = null) {
    const cat = getCategoryById(categoryId);
    if (!cat) return null;
    if (!folderId) return cat.bookmarks;
    const folderLoc = findBookmarkLocation(folderId);
    if (folderLoc && folderLoc.categoryId === categoryId && folderLoc.bookmark.type === 'folder') {
        folderLoc.bookmark.children = Array.isArray(folderLoc.bookmark.children) ? folderLoc.bookmark.children : [];
        return folderLoc.bookmark.children;
    }
    return null;
}

function removeBookmarkAtLocation(location) {
    if (!location || !Array.isArray(location.listRef)) return null;
    const idx = location.listRef.findIndex(item => item && item.id === location.bookmark.id);
    if (idx === -1) return null;
    const [removed] = location.listRef.splice(idx, 1);
    return removed;
}

function removeBookmarkById(bookmarkId) {
    const loc = findBookmarkLocation(bookmarkId);
    if (!loc) return null;
    const removed = removeBookmarkAtLocation(loc);
    if (!removed) return null;
    return {
        bookmark: removed,
        categoryId: loc.categoryId,
        parentFolderId: loc.parentFolderId
    };
}

function insertBookmarkToList(list, index, bookmark) {
    if (!Array.isArray(list) || !bookmark) return false;
    const safeIndex = Math.max(0, Math.min(index ?? list.length, list.length));
    list.splice(safeIndex, 0, bookmark);
    return true;
}

function moveBookmarkTo(bookmarkId, targetCategoryId, targetFolderId = null, targetIndex = null) {
    const removed = removeBookmarkById(bookmarkId);
    if (!removed) return false;
    const targetList = getBookmarkList(targetCategoryId, targetFolderId);
    if (!targetList) return false;
    const insertIndex = targetIndex === null || targetIndex === undefined ? targetList.length : targetIndex;
    insertBookmarkToList(targetList, insertIndex, removed.bookmark);
    saveData();
    // 拖拽操作统一跳过全局刷新动画，仅在同列表时尝试 DOM 重用
    const isSameList = removed.categoryId === targetCategoryId && removed.parentFolderId === targetFolderId;
    renderApp({ skipAnimation: true, reorder: isSameList });
    refreshOpenFolderView({ skipAnimation: true, reorder: isSameList });
    return true;
}

let pendingStorageMode = STORAGE_MODES.BROWSER;
let remoteActionsEnabled = false;
let pointerDownOutsideModal = false;

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
    bookmarkTypeSwitch: document.getElementById('bookmarkTypeSwitch'),
    bookmarkTypeButtons: document.querySelectorAll('#bookmarkTypeSwitch .type-chip'),
    typeSections: document.querySelectorAll('.type-section'),
    bookmarkUrl: document.getElementById('bookmarkUrl'),
    bookmarkTitle: document.getElementById('bookmarkTitle'),
    bookmarkCategory: document.getElementById('bookmarkCategory'),
    categoryFormGroup: document.getElementById('categoryFormGroup'),
    iconPreview: document.getElementById('iconPreview'),
    customIconInput: document.getElementById('customIconInput'),
    customIconControls: document.getElementById('customIconControls'),
    customIconTabs: document.querySelectorAll('.custom-icon-tab'),
    customIconPanels: document.querySelectorAll('.custom-icon-panel'),
    swatchColor: document.getElementById('swatchColor'),
    swatchText: document.getElementById('swatchText'),
    swatchApplyBtn: document.getElementById('swatchApplyBtn'),
    folderModal: document.getElementById('folderModal'),
    folderModalTitle: document.getElementById('folderModalTitle'),
    folderContent: document.getElementById('folderContent'),
    folderAddBtn: document.getElementById('folderAddBtn'),
    folderRenameBtn: document.getElementById('folderRenameBtn'),
    folderExitZone: document.getElementById('folderExitZone'),
    closeFolderBtn: document.getElementById('closeFolderBtn'),
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
    applySettingsBtn: document.getElementById('applySettingsBtn'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    remotePushBtn: document.getElementById('remotePushBtn'),
    remoteMergeBtn: document.getElementById('remoteMergeBtn'),
    remotePullBtn: document.getElementById('remotePullBtn'),
    
    // Radio
    iconTypeRadios: document.getElementsByName('iconType'),
    storageModeRadios: document.getElementsByName('storageMode'),

    // Inputs
    importDataInput: document.getElementById('importDataInput'),
    importSourceSelect: document.getElementById('importSource'),
    importModeSelect: document.getElementById('importMode'),
    webdavEndpoint: document.getElementById('webdavEndpoint'),
    webdavUsername: document.getElementById('webdavUsername'),
    webdavPassword: document.getElementById('webdavPassword'),
    gistToken: document.getElementById('gistToken'),
    gistId: document.getElementById('gistId'),
    gistFilename: document.getElementById('gistFilename'),

    // Info blocks
    browserStorageInfo: document.getElementById('browserStorageInfo'),
    syncStorageInfo: document.getElementById('syncStorageInfo'),
    webdavStorageInfo: document.getElementById('webdavStorageInfo'),
    gistStorageInfo: document.getElementById('gistStorageInfo'),
    webdavConfig: document.getElementById('webdavConfig'),
    gistConfig: document.getElementById('gistConfig'),
    remoteActions: document.getElementById('remoteActions')
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    // 优化：一次性并行读取所有本地数据，减少 IPC 调用延迟
    const localResult = await new Promise(resolve => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS, CACHE_KEYS.ICONS, STORAGE_KEYS.DATA], resolve);
    });

    // 1. 初始化设置
    if (localResult[STORAGE_KEYS.SETTINGS]) {
        appSettings = mergeSettingsWithDefaults(localResult[STORAGE_KEYS.SETTINGS]);
    } else {
        appSettings = mergeSettingsWithDefaults();
        saveSettings();
    }
    pendingStorageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    remoteActionsEnabled = isRemoteMode(pendingStorageMode);

    // 2. 初始化图标缓存
    iconCache = localResult[CACHE_KEYS.ICONS] || {};

    // 3. 初始化数据
    await loadData({ localSnapshot: localResult[STORAGE_KEYS.DATA] });

    // 渲染与事件绑定
    renderApp();
    setupEventListeners();
    warmIconCacheForBookmarks();
}

// --- 数据操作 ---

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS], (result) => {
            if (result[STORAGE_KEYS.SETTINGS]) {
                appSettings = mergeSettingsWithDefaults(result[STORAGE_KEYS.SETTINGS]);
            } else {
                appSettings = mergeSettingsWithDefaults();
                saveSettings();
            }
            resolve();
        });
    });
}

function saveSettings() {
    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: appSettings });
}

async function loadIconCache() {
    return new Promise((resolve) => {
        chrome.storage.local.get([CACHE_KEYS.ICONS], (result) => {
            iconCache = result[CACHE_KEYS.ICONS] || {};
            resolve();
        });
    });
}

function saveIconCache() {
    try {
        chrome.storage.local.set({ [CACHE_KEYS.ICONS]: iconCache }, () => {
            if (chrome.runtime.lastError) {
                console.warn('保存图标缓存失败 (可能是配额已满):', chrome.runtime.lastError);
                // 简单的清理策略：如果保存失败，尝试清理一半的缓存（这里简单地清空，实际应用可以更智能）
                // 为了防止无限循环，这里只做一次尝试或者仅仅是警告
                // 考虑到用户体验，如果满了，我们可能需要提示用户或者自动清理旧的
            }
        });
    } catch (e) {
        console.error('保存图标缓存异常:', e);
    }
}

async function loadData(options = {}) {
    const mode = options.mode || appSettings.storageMode || STORAGE_MODES.BROWSER;
    const localSnapshot = options.localSnapshot !== undefined
        ? options.localSnapshot
        : await readLocalDataSnapshot();
    const fallback = localSnapshot || JSON.parse(JSON.stringify(DEFAULT_DATA));

    if (mode === STORAGE_MODES.SYNC) {
        await new Promise((resolve) => {
            chrome.storage.sync.get([STORAGE_KEYS.DATA], (syncResult) => {
                if (syncResult[STORAGE_KEYS.DATA]) {
                    appData = syncResult[STORAGE_KEYS.DATA];
                } else {
                    appData = fallback;
                    persistDataToArea(chrome.storage.sync, appData);
                }
                resolve();
            });
        });
    } else if (mode === STORAGE_MODES.WEBDAV) {
        appData = await loadDataFromWebDAV({
            localFallback: fallback,
            notifyOnError: options.notifyOnError
        });
    } else if (mode === STORAGE_MODES.GIST) {
        appData = await loadDataFromGist({
            localFallback: fallback,
            notifyOnError: options.notifyOnError
        });
    } else {
        appData = fallback;
        if (!localSnapshot) {
            await persistDataToArea(chrome.storage.local, appData);
        }
    }

    ensureActiveCategory();
    const normalized = normalizeDataStructure();
    if (normalized) {
        await persistAppData(appData, { mode, notifyOnError: false });
    } else if (isRemoteMode(mode)) {
        await persistDataToArea(chrome.storage.local, appData);
    }
    purgeUnusedCachedIcons();
}

async function readLocalDataSnapshot() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.DATA], (result) => {
            resolve(result[STORAGE_KEYS.DATA] || null);
        });
    });
}

async function loadFolderFromLocalSnapshot(folderId) {
    if (!folderId) return null;
    try {
        const snapshot = await readLocalDataSnapshot();
        if (!snapshot || !Array.isArray(snapshot.categories)) return null;
        const loc = findBookmarkLocation(folderId, snapshot);
        if (!loc || loc.bookmark.type !== 'folder') return null;
        return { bookmark: loc.bookmark, categoryId: loc.categoryId, fullData: snapshot };
    } catch (error) {
        console.warn('读取本地快照时出错', error);
        return null;
    }
}

async function saveData(options = {}) {
    try {
        await persistAppData(appData, options);
    } catch (error) {
        console.error('保存数据失败:', error);
    }
}

async function persistAppData(data, { mode = appSettings.storageMode, notifyOnError = false } = {}) {
    const targetMode = mode || STORAGE_MODES.BROWSER;
    if (targetMode === STORAGE_MODES.WEBDAV) {
        await persistDataToArea(chrome.storage.local, data);
        try {
            await saveDataToWebDAV(data);
        } catch (error) {
            handleRemoteError(`保存到 WebDAV 失败：${error.message}`, notifyOnError, 'webdav');
        }
        return;
    }
    if (targetMode === STORAGE_MODES.GIST) {
        await persistDataToArea(chrome.storage.local, data);
        try {
            await saveDataToGist(data);
        } catch (error) {
            handleRemoteError(`保存到 Gist 失败：${error.message}`, notifyOnError, 'gist');
        }
        return;
    }
    if (targetMode === STORAGE_MODES.SYNC) {
        await Promise.all([
            persistDataToArea(chrome.storage.sync, data),
            persistDataToArea(chrome.storage.local, data)
        ]);
        return;
    }
    await persistDataToArea(chrome.storage.local, data);
}

function persistDataToArea(area, data) {
    return new Promise((resolve) => {
        if (!area || typeof area.set !== 'function') {
            resolve();
            return;
        }
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

function normalizeRemoteFilename(name = '') {
    const trimmed = (name || '').trim();
    return trimmed || DEFAULT_REMOTE_FILENAME;
}

function parseRemoteDataPayload(payload) {
    try {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (parsed && Array.isArray(parsed.categories)) {
            return parsed;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function normalizeWebdavConfig(config = {}) {
    const base = config && typeof config === 'object' ? config : {};
    return {
        endpoint: (base.endpoint || '').trim(),
        username: (base.username || '').trim(),
        password: base.password || ''
    };
}

function buildWebdavHeaders(config) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.username || config.password) {
        const token = btoa(`${config.username || ''}:${config.password || ''}`);
        headers.Authorization = `Basic ${token}`;
    }
    return headers;
}

async function loadDataFromWebDAV({ localFallback, notifyOnError = false } = {}) {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    const fallback = localFallback || JSON.parse(JSON.stringify(DEFAULT_DATA));
    if (!cfg.endpoint) {
        handleRemoteError('WebDAV 未填写文件地址，已使用本地数据。', notifyOnError, 'webdav');
        await persistDataToArea(chrome.storage.local, fallback);
        return fallback;
    }
    try {
        const response = await fetchWithTimeout(cfg.endpoint, {
            method: 'GET',
            headers: buildWebdavHeaders(cfg),
            cache: 'no-store'
        }, REMOTE_FETCH_TIMEOUT);
        if (response.status === 404) {
            handleRemoteError('WebDAV 上暂未找到数据文件，保存时会自动新建。', notifyOnError, 'webdav');
            await persistDataToArea(chrome.storage.local, fallback);
            return fallback;
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        const parsed = parseRemoteDataPayload(text);
        if (!parsed) {
            throw new Error('远程数据格式不正确');
        }
        await persistDataToArea(chrome.storage.local, parsed);
        return parsed;
    } catch (error) {
        console.warn('加载 WebDAV 数据失败', error);
        handleRemoteError(`读取 WebDAV 失败，已使用本地数据。${error.message}`, notifyOnError, 'webdav');
        await persistDataToArea(chrome.storage.local, fallback);
        return fallback;
    }
}

async function saveDataToWebDAV(data) {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    if (!cfg.endpoint) {
        throw new Error('未填写 WebDAV 文件地址');
    }
    const payload = JSON.stringify(data, null, 2);
    const response = await fetchWithTimeout(cfg.endpoint, {
        method: 'PUT',
        headers: buildWebdavHeaders(cfg),
        body: payload
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

function normalizeGistConfig(config = {}) {
    const base = config && typeof config === 'object' ? config : {};
    return {
        token: (base.token || '').trim(),
        gistId: (base.gistId || '').trim(),
        filename: normalizeRemoteFilename(base.filename || DEFAULT_REMOTE_FILENAME)
    };
}

function buildGistHeaders(token) {
    const headers = {
        Accept: 'application/vnd.github+json'
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function loadDataFromGist({ localFallback, notifyOnError = false } = {}) {
    const cfg = normalizeGistConfig(appSettings.gist);
    const fallback = localFallback || JSON.parse(JSON.stringify(DEFAULT_DATA));
    if (!cfg.token) {
        handleRemoteError('未填写 Gist Token，已使用本地数据。', notifyOnError, 'gist');
        await persistDataToArea(chrome.storage.local, fallback);
        return fallback;
    }
    if (!cfg.gistId) {
        handleRemoteError('未填写 Gist ID，已使用本地数据。保存时会自动创建新的私有 Gist。', notifyOnError, 'gist');
        await persistDataToArea(chrome.storage.local, fallback);
        return fallback;
    }
    try {
        const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
            method: 'GET',
            headers: buildGistHeaders(cfg.token),
            cache: 'no-store'
        }, REMOTE_FETCH_TIMEOUT);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const gist = await response.json();
        const fileMeta = gist?.files?.[cfg.filename];
        if (!fileMeta) {
            handleRemoteError('远程 Gist 中尚未找到数据文件，已使用本地数据。', notifyOnError, 'gist');
            await persistDataToArea(chrome.storage.local, fallback);
            return fallback;
        }
        let content = fileMeta.content || '';
        if (fileMeta.truncated && fileMeta.raw_url) {
            const rawResp = await fetchWithTimeout(fileMeta.raw_url, {
                headers: buildGistHeaders(cfg.token),
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
            if (rawResp.ok) {
                content = await rawResp.text();
            }
        }
        const parsed = parseRemoteDataPayload(content);
        if (!parsed) {
            throw new Error('远程数据格式不正确');
        }
        await persistDataToArea(chrome.storage.local, parsed);
        return parsed;
    } catch (error) {
        console.warn('加载 Gist 数据失败', error);
        handleRemoteError(`读取 Gist 失败，已使用本地数据。${error.message}`, notifyOnError, 'gist');
        await persistDataToArea(chrome.storage.local, fallback);
        return fallback;
    }
}

async function saveDataToGist(data) {
    const cfg = normalizeGistConfig(appSettings.gist);
    if (!cfg.token) {
        throw new Error('未填写 Gist Token');
    }
    const payload = JSON.stringify(data, null, 2);
    const filename = normalizeRemoteFilename(cfg.filename);

    if (!cfg.gistId) {
        const newId = await createGist(cfg.token, filename, payload);
        appSettings.gist.gistId = newId;
        saveSettings();
        if (els.gistId) {
            els.gistId.value = newId;
        }
        return;
    }

    const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
        method: 'PATCH',
        headers: buildGistHeaders(cfg.token),
        body: JSON.stringify({
            files: {
                [filename]: { content: payload }
            }
        })
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

async function createGist(token, filename, content) {
    const response = await fetchWithTimeout('https://api.github.com/gists', {
        method: 'POST',
        headers: buildGistHeaders(token),
        body: JSON.stringify({
            description: 'EdgeTab 数据同步',
            public: false,
            files: {
                [filename]: { content }
            }
        })
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data?.id) {
        throw new Error('创建 Gist 失败');
    }
    return data.id;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REMOTE_FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function handleRemoteError(message, notify = false, key = '') {
    console.warn(message);
    if (!notify) return;
    if (key) {
        if (syncWarningState[key]) return;
        syncWarningState[key] = true;
        setTimeout(() => {
            syncWarningState[key] = false;
        }, 8000);
    }
    alert(message);
}

async function testRemoteConnectivity(mode) {
    if (mode === STORAGE_MODES.WEBDAV) {
        return testWebdavConnectivity();
    }
    if (mode === STORAGE_MODES.GIST) {
        return testGistConnectivity();
    }
    return true;
}

async function testWebdavConnectivity() {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    if (!cfg.endpoint) return false;
    try {
        const response = await fetchWithTimeout(cfg.endpoint, {
            method: 'GET',
            headers: buildWebdavHeaders(cfg),
            cache: 'no-store'
        }, REMOTE_FETCH_TIMEOUT);
        return response.ok || response.status === 404;
    } catch (error) {
        console.warn('WebDAV 配置检测失败', error);
        return false;
    }
}

async function testGistConnectivity() {
    const cfg = normalizeGistConfig(appSettings.gist);
    if (!cfg.token) return false;
    try {
        if (cfg.gistId) {
            const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
                method: 'GET',
                headers: buildGistHeaders(cfg.token),
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
            return response.ok;
        }
        const response = await fetchWithTimeout('https://api.github.com/gists?per_page=1', {
            method: 'GET',
            headers: buildGistHeaders(cfg.token),
            cache: 'no-store'
        }, REMOTE_FETCH_TIMEOUT);
        return response.ok;
    } catch (error) {
        console.warn('Gist 配置检测失败', error);
        return false;
    }
}

async function fetchRemoteSnapshot(mode) {
    if (mode === STORAGE_MODES.WEBDAV) {
        return fetchWebdavSnapshot();
    }
    if (mode === STORAGE_MODES.GIST) {
        return fetchGistSnapshot();
    }
    return null;
}

async function fetchWebdavSnapshot() {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    if (!cfg.endpoint) {
        throw new Error('未填写 WebDAV 文件地址');
    }
    const response = await fetchWithTimeout(cfg.endpoint, {
        method: 'GET',
        headers: buildWebdavHeaders(cfg),
        cache: 'no-store'
    }, REMOTE_FETCH_TIMEOUT);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const parsed = parseRemoteDataPayload(text);
    if (!parsed) {
        throw new Error('远程数据格式不正确');
    }
    return parsed;
}

async function fetchGistSnapshot() {
    const cfg = normalizeGistConfig(appSettings.gist);
    if (!cfg.token) {
        throw new Error('未填写 Gist Token');
    }
    if (!cfg.gistId) {
        throw new Error('未填写 Gist ID');
    }
    const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
        method: 'GET',
        headers: buildGistHeaders(cfg.token),
        cache: 'no-store'
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const gist = await response.json();
    const fileMeta = gist?.files?.[normalizeRemoteFilename(cfg.filename)];
    if (!fileMeta) {
        return null;
    }
    let content = fileMeta.content || '';
    if (fileMeta.truncated && fileMeta.raw_url) {
        const rawResp = await fetchWithTimeout(fileMeta.raw_url, {
            headers: buildGistHeaders(cfg.token),
            cache: 'no-store'
        }, REMOTE_FETCH_TIMEOUT);
        if (rawResp.ok) {
            content = await rawResp.text();
        }
    }
    const parsed = parseRemoteDataPayload(content);
    if (!parsed) {
        throw new Error('远程数据格式不正确');
    }
    return parsed;
}

async function handleRemoteSyncAction(action) {
    if (!remoteActionsEnabled || !isRemoteMode(pendingStorageMode)) {
        alert('请先点击“应用配置”验证远程设置。');
        return;
    }
    const mode = pendingStorageMode;
    syncSettingsFromUI();
    saveSettings();

    try {
        if (action === 'push') {
            appSettings.storageMode = mode;
            saveSettings();
            await persistAppData(appData, { mode, notifyOnError: true });
            alert('已将本地数据覆盖上传，并切换到远程模式。');
            return;
        }

        const remoteData = await fetchRemoteSnapshot(mode);
        if (action === 'pull') {
            if (!remoteData) {
                alert('云端暂无数据可覆盖。');
                return;
            }
            appData = remoteData;
        } else if (action === 'merge') {
            const merged = remoteData ? mergeImportedData(appData, remoteData) : appData;
            appData = merged;
        }

        ensureActiveCategory();
        normalizeDataStructure();
        appSettings.storageMode = mode;
        saveSettings();
        await persistAppData(appData, { mode, notifyOnError: true });
        renderApp();
        warmIconCacheForBookmarks();
        alert(action === 'merge' ? '合并并上传完成，已生效。' : '已用云端数据覆盖本地并生效。');
    } catch (error) {
        console.error('远程同步失败', error);
        alert(`同步失败：${error.message}`);
    }
}

function normalizeDataStructure() {
    if (!appData || !Array.isArray(appData.categories)) return false;
    let changed = false;
    appData.categories.forEach(cat => {
        walkCategoryBookmarks(cat, (bm) => {
            if (bm.type === 'folder') {
                bm.children = Array.isArray(bm.children) ? bm.children : [];
                if (normalizeFolderChildTitles(bm.title, bm.children)) {
                    changed = true;
                }
            }
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

function resolveCachedIconSrc(src) {
    if (!src) return '';
    return (iconCache && iconCache[src]) || src;
}

function dedupeIconList(primary, list) {
    const result = [];
    const seen = new Set();
    list.forEach(item => {
        if (!item || item === primary || seen.has(item)) return;
        seen.add(item);
        result.push(item);
    });
    return result;
}

function resolveBookmarkIconSource(bookmark) {
    const primarySrc = resolveCachedIconSrc(bookmark.icon) || 'icons/default.svg';
    const fallbackList = dedupeIconList(
        primarySrc,
        (bookmark.iconFallbacks || []).map(resolveCachedIconSrc)
    );
    return { primarySrc, fallbackList };
}

async function cacheIconIfNeeded(src) {
    const isLocalAsset = src.startsWith('icons/') || src.startsWith('chrome-extension://') || src.startsWith('moz-extension://') || src.startsWith('/');
    if (!src || src.startsWith('data:') || isLocalAsset || (iconCache && iconCache[src])) {
        return false;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时

        const response = await fetch(src, { 
            mode: 'cors', 
            cache: 'force-cache',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok || response.type === 'opaque') {
            // 不抛出错误，只是返回 false
            return false;
        }
        const blob = await response.blob();
        if (!blob || blob.size > MAX_CACHED_ICON_BYTES) {
            return false;
        }
        const dataUrl = await blobToDataURL(blob);
        if (dataUrl) {
            iconCache[src] = dataUrl;
            saveIconCache();
            return true;
        }
    } catch (error) {
        console.warn('缓存图标失败', src, error);
    }
    return false;
}

async function cacheBookmarkIcons(primary, fallbacks = []) {
    const targets = Array.from(new Set([primary, ...fallbacks].filter(Boolean)));
    // 并发处理
    const results = await Promise.all(targets.map(target => cacheIconIfNeeded(target)));
    return results.some(Boolean);
}

function purgeUnusedCachedIcons() {
    if (!iconCache || typeof iconCache !== 'object') return;
    const used = new Set();
    if (appData && Array.isArray(appData.categories)) {
        appData.categories.forEach(cat => {
            walkCategoryBookmarks(cat, (bm) => {
                [bm.icon, ...(bm.iconFallbacks || [])].forEach(url => {
                    if (url) used.add(url);
                });
            });
        });
    }
    let changed = false;
    Object.keys(iconCache).forEach(key => {
        if (!used.has(key)) {
            delete iconCache[key];
            changed = true;
        }
    });
    if (changed) {
        saveIconCache();
    }
}

async function warmIconCacheForBookmarks() {
    if (!appData || !Array.isArray(appData.categories)) return;
    const targets = new Set();
    appData.categories.forEach(cat => {
        walkCategoryBookmarks(cat, (bm) => {
            [bm.icon, ...(bm.iconFallbacks || [])].forEach(url => {
                if (url && !url.startsWith('data:') && !(iconCache && iconCache[url])) {
                    targets.add(url);
                }
            });
        });
    });
    if (!targets.size) return;
    
    // 并发预热，限制并发数以防浏览器限制
    const urls = Array.from(targets);
    const BATCH_SIZE = 5;
    let cachedAny = false;

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(url => cacheIconIfNeeded(url)));
        if (results.some(Boolean)) {
            cachedAny = true;
        }
    }

    if (cachedAny) {
        renderBookmarks();
        refreshOpenFolderView();
    }
}

// --- 渲染逻辑 ---

function renderApp(options = {}) {
    renderCategories(options);
    renderBookmarks(options);
    refreshOpenFolderView();
}

function renderCategories(options = {}) {
    els.categoryList.innerHTML = '';
    
    // 填充书签模态框中的分类选择
    els.bookmarkCategory.innerHTML = '';

    appData.categories.forEach((cat, index) => {
        // 侧边栏列表
        const li = document.createElement('li');
        li.textContent = cat.name;
        li.dataset.id = cat.id;
        if (!options.skipAnimation) {
            li.style.animation = `slideInRight 0.4s ease-out ${index * 0.05 + 0.2}s backwards`; // Staggered animation
        } else {
            li.classList.add('no-animation');
        }
        
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
            if (openFolderCategoryId && openFolderCategoryId !== cat.id) {
                closeFolderModal();
            }
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

function renderBookmarks(options = {}) {
    const currentCat = getActiveCategory();
    els.bookmarkGrid.innerHTML = '';
    if (!currentCat) return;
    ensureGridDropzone(els.bookmarkGrid, { categoryId: currentCat.id, folderId: null });
    renderBookmarkCollection(currentCat.bookmarks, els.bookmarkGrid, { categoryId: currentCat.id, folderId: null, skipAnimation: options.skipAnimation });
}

function renderBookmarkCollection(bookmarks, container, context = {}) {
    if (!container) return;
    const items = Array.isArray(bookmarks) ? bookmarks : [];

    // 尝试重用 DOM 节点进行排序，避免重新加载图标
    if (context.reorder) {
        const existingCards = Array.from(container.children).filter(el => el.classList.contains('bookmark-card'));
        const cardMap = new Map();
        existingCards.forEach(card => {
            if (card.dataset.id) cardMap.set(card.dataset.id, card);
        });

        // 检查是否所有新列表中的 ID 都在当前 DOM 中存在（且数量一致，忽略占位符）
        // 如果有新增或删除，则回退到全量渲染
        const allExist = items.every(bm => cardMap.has(bm.id));
        if (allExist && existingCards.length === items.length) {
            // 执行重排序
            items.forEach(bm => {
                const card = cardMap.get(bm.id);
                if (card) {
                    container.appendChild(card); // 移动到末尾，实现排序
                    if (context.skipAnimation) {
                        card.classList.add('no-animation');
                        // 强制重绘后移除类，以便下次动画生效？不，这里保持 no-animation 即可，下次交互会重置
                    }
                }
            });
            // 确保添加按钮在最后
            const addCard = container.querySelector('.add-bookmark-card');
            if (addCard) {
                container.appendChild(addCard);
            }
            return;
        }
    }

    container.innerHTML = '';
    
    // 如果正在拖拽的元素在容器内，将其暂时移到 body 以免被销毁，从而保持拖拽状态
    const draggingEl = document.querySelector('.bookmark-card.dragging');
    if (draggingEl && container.contains(draggingEl)) {
        document.body.appendChild(draggingEl);
    }

    if (!items.length && context.scope === 'folder') {
        const empty = document.createElement('div');
        empty.textContent = '文件夹内暂无网站';
        empty.className = 'folder-empty';
        if (!context.skipAnimation) {
            empty.style.animation = 'fadeIn 0.5s ease-out';
        }
        container.appendChild(empty);
    }
    items.forEach((bm, index) => {
        const card = createBookmarkCard(bm, { ...context, container });
        if (context.skipAnimation) {
            card.classList.add('no-animation');
        } else if (context.scope === 'folder') {
            // 仅在文件夹内保留波浪式动画
            card.style.animationDelay = `${index * 0.04}s`;
        }
        container.appendChild(card);
    });
    
    const addCard = createAddCard(context);
    if (context.skipAnimation) {
        addCard.classList.add('no-animation');
    } else if (context.scope === 'folder') {
        addCard.style.animationDelay = `${items.length * 0.04}s`;
    }
    container.appendChild(addCard);
}

function createAddCard(context = {}) {
    const addCard = document.createElement('div');
    addCard.className = 'add-bookmark-card';
    const inner = document.createElement('div');
    inner.className = 'add-card-inner';
    const label = document.createElement('span');
    label.textContent = '添加';
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+';
    inner.appendChild(plus);
    inner.appendChild(label);
    addCard.appendChild(inner);
    addCard.onclick = () => {
        openAddBookmarkModal({
            type: context.folderId ? 'link' : 'link',
            categoryId: context.categoryId || appData.activeCategory,
            folderId: context.folderId || null
        });
    };
    return addCard;
}

function createBookmarkCard(bm, context = {}) {
    const isFolder = bm.type === 'folder';
    const card = document.createElement('a');
    card.className = isFolder ? 'bookmark-card folder-card' : 'bookmark-card';
    card.dataset.id = bm.id;
    card.dataset.categoryId = context.categoryId || '';
    card.dataset.folderId = context.folderId || '';
    card.href = isFolder ? '#' : bm.url;

    if (isFolder) {
        const grid = createFolderIconGrid(bm);
        card.appendChild(grid);
    } else {
        const img = document.createElement('img');
        img.className = 'bookmark-icon';
        const resolvedIcon = resolveBookmarkIconSource(bm);
        img.src = resolvedIcon.primarySrc || 'icons/default.svg';
        attachIconFallback(img, { iconFallbacks: resolvedIcon.fallbackList });
        card.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'bookmark-title';
    title.textContent = bm.title;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn edit';
    editBtn.innerHTML = '✎';
    editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEditBookmarkModal(bm, context);
    };

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

    card.appendChild(title);
    card.appendChild(actions);

    if (isFolder) {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            openFolderModal(bm.id);
        });
    }

    setupBookmarkCardDrag(card, bm.id, {
        container: context.container || card.parentNode,
        categoryId: context.categoryId || appData.activeCategory,
        folderId: context.folderId || null
    });
    card.addEventListener('drop', (e) => handleBookmarkDrop(e, bm.id, card, context));
    card.addEventListener('dragenter', () => {
        if (dragState.draggingId && isFolder) {
            card.classList.add('folder-drop-ready');
        }
    });
    card.addEventListener('dragleave', () => card.classList.remove('folder-drop-ready'));
    return card;
}

async function openFolderModal(folderBookmark) {
    if (!els.folderModal || !els.folderContent) return;
    const folderId = typeof folderBookmark === 'string' ? folderBookmark : folderBookmark?.id;
    if (!folderId) return;
    try {
        let loc = findBookmarkLocation(folderId);
        // 移除快照回滚逻辑，防止在创建文件夹（合并项目）时因快照滞后导致数据回滚
        /*
        const snapshotFolder = await loadFolderFromLocalSnapshot(folderId);
        if (snapshotFolder) {
            const currentChildrenCount = Array.isArray(loc?.bookmark?.children) ? loc.bookmark.children.length : -1;
            const snapshotChildrenCount = Array.isArray(snapshotFolder.bookmark.children) ? snapshotFolder.bookmark.children.length : -1;
            if (!loc || snapshotChildrenCount > currentChildrenCount) {
                appData = snapshotFolder.fullData;
                ensureActiveCategory();
                normalizeDataStructure();
                loc = findBookmarkLocation(folderId);
            }
        }
        */
        if (!loc || loc.bookmark.type !== 'folder') return;
        openFolderId = loc.bookmark.id;
        openFolderCategoryId = loc.categoryId;
        els.folderModalTitle.textContent = loc.bookmark.title || '文件夹';
        updateFolderModalButton(loc);
        renderFolderContent(loc.bookmark.id, loc.categoryId);
        els.folderModal.classList.remove('hidden');
    } catch (error) {
        console.error('打开文件夹失败', error);
    }
}

function renderFolderContent(folderId, fallbackCategoryId, options = {}) {
    if (!els.folderContent || !folderId) return;
    const loc = findBookmarkLocation(folderId);
    if (!loc || loc.bookmark.type !== 'folder') return;
    const categoryId = loc.categoryId || fallbackCategoryId || appData.activeCategory;
    const folderBookmark = loc.bookmark;
    ensureGridDropzone(els.folderContent, { categoryId, folderId: folderBookmark.id });
    renderBookmarkCollection(folderBookmark.children || [], els.folderContent, {
        categoryId,
        folderId: folderBookmark.id,
        scope: 'folder',
        ...options
    });
}

function refreshOpenFolderView(options = {}) {
    if (!openFolderId || !els.folderModal || els.folderModal.classList.contains('hidden')) return;
    const loc = findBookmarkLocation(openFolderId);
    if (!loc || loc.bookmark.type !== 'folder') {
        closeFolderModal();
        return;
    }
    openFolderCategoryId = loc.categoryId;
    els.folderModalTitle.textContent = loc.bookmark.title || '文件夹';
    updateFolderModalButton(loc);
    renderFolderContent(loc.bookmark.id, loc.categoryId, options);
}

function updateFolderModalButton(loc) {
    if (!els.closeFolderBtn) return;
    if (loc && loc.parentFolderId) {
        els.closeFolderBtn.textContent = '返回';
    } else {
        els.closeFolderBtn.textContent = '关闭';
    }
}

function closeFolderModal() {
    if (els.folderModal) {
        els.folderModal.classList.add('hidden');
    }
    openFolderId = null;
    openFolderCategoryId = null;
    if (els.folderExitZone) {
        els.folderExitZone.classList.remove('dragover');
    }
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

function createFolderIconGrid(folderBookmark) {
    const grid = document.createElement('div');
    grid.className = 'folder-icon-grid';
    const children = Array.isArray(folderBookmark.children) ? folderBookmark.children.slice(0, 4) : [];
    if (!children.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'folder-icon-placeholder';
        placeholder.textContent = '📂';
        grid.appendChild(placeholder);
        return grid;
    }
    children.forEach(child => {
        const cell = document.createElement('div');
        cell.className = 'folder-icon-cell';
        const img = document.createElement('img');
        const resolved = resolveBookmarkIconSource(child);
        img.src = resolved.primarySrc || 'icons/default.svg';
        attachIconFallback(img, { iconFallbacks: resolved.fallbackList });
        cell.appendChild(img);
        grid.appendChild(cell);
    });
    return grid;
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

function positionPlaceholderAtEnd(container) {
    const placeholder = getDragPlaceholder();
    if (!container) return;
    const addBtn = container.querySelector('.add-bookmark-card');
    if (addBtn) {
        if (placeholder.nextSibling === addBtn && placeholder.parentNode === container) return;
        container.insertBefore(placeholder, addBtn);
    } else {
        if (placeholder.parentNode === container && placeholder.nextSibling === null) return;
        container.appendChild(placeholder);
    }
}

function computeInsertIndexFromPlaceholder(container) {
    if (!container || !dragState.placeholder || !dragState.placeholder.parentNode) return -1;
    let index = 0;
    const children = Array.from(container.children);
    for (const child of children) {
        if (child === dragState.placeholder) {
            return index;
        }
        // 忽略正在拖拽的元素，因为它即将被移除，不应占用索引位置
        if (child.classList.contains('bookmark-card') && !child.classList.contains('dragging')) {
            index += 1;
        }
    }
    return -1;
}

function ensureGridDropzone(container, context = {}) {
    if (!container) return;
    container.dataset.categoryId = context.categoryId || '';
    container.dataset.folderId = context.folderId || '';
    if (container.dataset.dropSetup === '1') return;
    container.addEventListener('dragover', (e) => {
        if (!dragState.draggingId) return;
        dragState.activeContainer = container;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetCard = e.target.closest('.bookmark-card');
        if (dragState.placeholder && e.target === dragState.placeholder) return;
        if (targetCard && targetCard.parentNode === container) {
            const rect = targetCard.getBoundingClientRect();
            // Grid 布局中，基于 X 轴中点判断插入位置更符合直觉
            const dropBefore = e.clientX < rect.left + rect.width / 2;
            positionPlaceholderNearCard(targetCard, dropBefore);
        } else {
            positionPlaceholderAtEnd(container);
        }
    });
    container.addEventListener('drop', (e) => handleGridDrop(e, container));
    container.dataset.dropSetup = '1';
}

function handleGridDrop(event, container) {
    event.preventDefault();
    if (!dragState.draggingId) return;
    const targetCategoryId = (container && container.dataset.categoryId) || appData.activeCategory;
    const targetFolderId = (container && container.dataset.folderId) || null;
    const draggingLoc = findBookmarkLocation(dragState.draggingId);
    
    // 移除对文件夹内排序文件夹的限制
    /*
    if (draggingLoc && draggingLoc.bookmark && draggingLoc.bookmark.type === 'folder' && targetFolderId) {
        removeDragPlaceholder();
        return;
    }
    */

    const insertIndex = computeInsertIndexFromPlaceholder(container);
    if (insertIndex >= 0) {
        moveBookmarkTo(dragState.draggingId, targetCategoryId, targetFolderId || null, insertIndex);
    }
    removeDragPlaceholder();
}

function setupBookmarkCardDrag(card, bookmarkId, context = {}) {
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
        dragState.sourceCategoryId = context.categoryId || appData.activeCategory;
        dragState.sourceFolderId = context.folderId || null;
        dragState.activeContainer = context.container || card.parentNode;
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        dragState.mergeIntent = false;
        dragState.lastPosition = { x: e.clientX, y: e.clientY };
        card.dataset.dragActive = '1';
        card.classList.add('dragging');
        
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bookmarkId);

        // Move DOM manipulation to setTimeout to avoid interfering with drag start / drag image
        setTimeout(() => {
            card.classList.add('invisible-drag-source');
            // place a placeholder right after the dragged card to avoid layout jump
            if (card.parentNode) {
                const placeholder = getDragPlaceholder();
                card.parentNode.insertBefore(placeholder, card.nextSibling);
            }
        }, 0);
    });

    card.addEventListener('dragover', (e) => {
        if (!dragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dragState.activeContainer = card.parentNode;
        updateHoverState(e, card);
        if (!dragState.mergeIntent) {
            const rect = card.getBoundingClientRect();
            // Grid 布局中，基于 X 轴中点判断插入位置更符合直觉
            const dropBefore = e.clientX < rect.left + rect.width / 2;
            positionPlaceholderNearCard(card, dropBefore);
        }
    });

    card.addEventListener('drop', (e) => handleBookmarkDrop(e, bookmarkId, card, context));

    card.addEventListener('dragleave', () => {
        card.classList.remove('folder-drop-ready');
        if (card.dataset.id === dragState.hoverTargetId) {
            dragState.hoverTargetId = null;
            dragState.hoverStartTs = 0;
            dragState.mergeIntent = false;
        }
    });

    card.addEventListener('dragend', () => {
        dragState.draggingId = null;
        dragState.sourceCategoryId = null;
        dragState.sourceFolderId = null;
        dragState.activeContainer = null;
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        dragState.mergeIntent = false;
        card.dataset.dragActive = '0';
        card.classList.remove('dragging', 'drag-ready', 'invisible-drag-source');
        card.draggable = false;
        document.querySelectorAll('.folder-drop-ready').forEach(el => el.classList.remove('folder-drop-ready'));
        if (els.folderExitZone) {
            els.folderExitZone.classList.remove('dragover');
        }
        removeDragPlaceholder();
        clearLongPress();
        
        // 清理可能被移到 body 的拖拽元素
        if (card.parentNode === document.body) {
            document.body.removeChild(card);
        }
    });

    card.addEventListener('click', (e) => {
        if (card.dataset.dragActive === '1') {
            e.preventDefault();
            card.dataset.dragActive = '0';
        }
    });
}

function isDescendant(ancestorId, descendantId) {
    if (ancestorId === descendantId) return true;
    const loc = findBookmarkLocation(descendantId);
    if (!loc) return false;
    let current = loc.parentFolderId;
    while (current) {
        if (current === ancestorId) return true;
        const parentLoc = findBookmarkLocation(current);
        current = parentLoc ? parentLoc.parentFolderId : null;
    }
    return false;
}

function handleBookmarkDrop(event, targetBookmarkId, card, context = {}) {
    event.preventDefault();
    event.stopPropagation();
    const draggingId = dragState.draggingId;
    if (!draggingId || draggingId === targetBookmarkId) return;
    const targetLoc = findBookmarkLocation(targetBookmarkId);
    const draggingLoc = findBookmarkLocation(draggingId);
    if (!targetLoc || !draggingLoc) return;
    const targetBookmark = targetLoc.bookmark;
    const container = context.container || card?.parentNode || dragState.activeContainer;
    const dropCategoryId = (container && container.dataset.categoryId) || context.categoryId || targetLoc.categoryId || appData.activeCategory;
    const dropFolderId = (container && container.dataset.folderId) || context.folderId || targetLoc.parentFolderId || null;
    const canCreateFolderHere = true;

    if (dragState.mergeIntent && targetBookmark.id !== draggingId && targetBookmark.type !== 'folder' && canCreateFolderHere) {
        const newFolder = createFolderFromPair(targetLoc, draggingLoc);
        removeDragPlaceholder();
        if (newFolder) {
            openFolderModal(newFolder.id);
        }
        return;
    }

    if (targetBookmark.type === 'folder' && targetBookmark.id !== draggingId) {
        if (isDescendant(draggingId, targetBookmark.id)) {
            removeDragPlaceholder();
            return;
        }
        const moved = moveBookmarkIntoFolder(draggingId, targetBookmark.id);
        removeDragPlaceholder();
        if (moved) {
            openFolderModal(targetBookmark.id);
        }
        return;
    }

    if (canCreateFolderHere && shouldCreateFolder(event, card) && targetBookmark.type !== 'folder') {
        const newFolder = createFolderFromPair(targetLoc, draggingLoc);
        removeDragPlaceholder();
        if (newFolder) {
            openFolderModal(newFolder.id);
        }
        return;
    }

    if (dropFolderId && draggingLoc.bookmark.type === 'folder') {
        // Allow nesting, but check for circular dependency
        if (isDescendant(draggingId, dropFolderId)) {
            removeDragPlaceholder();
            return;
        }
    }

    const placeholderIndex = computeInsertIndexFromPlaceholder(container);
    if (placeholderIndex >= 0) {
        moveBookmarkTo(draggingId, dropCategoryId, dropFolderId || null, placeholderIndex);
    } else {
        // 如果找不到占位符（例如快速拖动导致），默认添加到列表末尾
        // 修复了此前引用不存在的 'card' 变量导致的崩溃问题
        const targetList = getBookmarkList(dropCategoryId, dropFolderId);
        const insertIndex = targetList ? targetList.length : 0;
        moveBookmarkTo(draggingId, dropCategoryId, dropFolderId || null, insertIndex);
    }
    removeDragPlaceholder();
}

function isFolderHoverZone(event, card, paddingRatio = 0.28) {
    if (!card || !event) return false;
    const rect = card.getBoundingClientRect();
    const padX = rect.width * paddingRatio;
    const padY = rect.height * paddingRatio;
    const insideX = event.clientX > rect.left + padX && event.clientX < rect.right - padX;
    const insideY = event.clientY > rect.top + padY && event.clientY < rect.bottom - padY;
    return insideX && insideY;
}

function updateHoverState(event, card) {
    if (!card || !dragState.draggingId) return;
    const targetId = card.dataset.id;
    if (!targetId || targetId === dragState.draggingId) {
        dragState.mergeIntent = false;
        card.classList.remove('folder-drop-ready');
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        return;
    }
    const isCenter = isFolderHoverZone(event, card, 0.32);
    const now = performance.now();
    if (dragState.hoverTargetId !== targetId) {
        dragState.hoverTargetId = targetId;
        dragState.hoverStartTs = now;
        dragState.mergeIntent = false;
    }
    const dwellMs = now - dragState.hoverStartTs;
    dragState.mergeIntent = isCenter && dwellMs >= 120;
    if (dragState.mergeIntent) {
        card.classList.add('folder-drop-ready');
        removeDragPlaceholder();
    } else {
        card.classList.remove('folder-drop-ready');
    }
}

function shouldCreateFolder(event, card) {
    if (!card) return false;
    return isFolderHoverZone(event, card, 0.28);
}

function createFolderFromPair(targetLoc, draggingLoc) {
    if (!targetLoc || !draggingLoc) return null;
    
    // 检查文件夹深度限制
    if (getFolderDepth(targetLoc.parentFolderId) >= 3) {
        return null;
    }

    const targetList = getBookmarkList(targetLoc.categoryId, targetLoc.parentFolderId);
    if (!targetList) return null;
    let insertIndex = targetLoc.index;
    if (draggingLoc.categoryId === targetLoc.categoryId && draggingLoc.parentFolderId === targetLoc.parentFolderId && draggingLoc.index < targetLoc.index) {
        insertIndex -= 1;
    }
    const removedTarget = removeBookmarkById(targetLoc.bookmark.id);
    const removedDragging = removeBookmarkById(draggingLoc.bookmark.id);
    const children = [];
    if (removedTarget?.bookmark) children.push(removedTarget.bookmark);
    if (removedDragging?.bookmark) children.push(removedDragging.bookmark);
    if (children.length < 2) return null;
    const folderTitle = targetLoc.bookmark.title || '新建文件夹';
    const folderBookmark = {
        id: generateId('folder'),
        title: folderTitle,
        type: 'folder',
        url: '#',
        iconType: 'custom',
        icon: targetLoc.bookmark.icon || 'icons/default.svg',
        iconFallbacks: [],
        children
    };
    normalizeFolderChildTitles(folderTitle, folderBookmark.children);
    insertBookmarkToList(targetList, Math.max(0, insertIndex), folderBookmark);
    saveData();
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
    return folderBookmark;
}

function moveBookmarkIntoFolder(bookmarkId, folderId) {
    if (isDescendant(bookmarkId, folderId)) return false;
    const folderLoc = findBookmarkLocation(folderId);
    if (!folderLoc || folderLoc.bookmark.type !== 'folder') return false;

    // 检查文件夹深度限制
    const sourceLoc = findBookmarkLocation(bookmarkId);
    if (sourceLoc && sourceLoc.bookmark.type === 'folder') {
        if (getFolderDepth(folderId) >= 3) {
            return false;
        }
    }

    const removal = removeBookmarkById(bookmarkId);
    if (!removal || removal.bookmark.id === folderId) return false;
    if (removal.parentFolderId === folderId) return false;
    // Removed restriction: if (removal.bookmark.type === 'folder') return false;
    folderLoc.bookmark.children = Array.isArray(folderLoc.bookmark.children) ? folderLoc.bookmark.children : [];
    insertBookmarkToList(folderLoc.bookmark.children, folderLoc.bookmark.children.length, removal.bookmark);
    normalizeFolderChildTitles(folderLoc.bookmark.title, folderLoc.bookmark.children);
    saveData();
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
    return true;
}

function bindFolderExitDropzone() {
    if (els.folderModal) {
        const contentEl = els.folderModal.querySelector('.modal-content');
        els.folderModal.addEventListener('dragover', (e) => {
            if (!dragState.draggingId) return;
            if (contentEl && contentEl.contains(e.target)) return;
            e.preventDefault();
        });
        els.folderModal.addEventListener('drop', (e) => {
            if (!dragState.draggingId) return;
            if (contentEl && contentEl.contains(e.target)) return;
            e.preventDefault();
            // 暂时禁用拖拽到遮罩层移出文件夹的功能，防止误触导致图标“掉出去”
            /*
            if (openFolderCategoryId) {
                moveBookmarkTo(dragState.draggingId, openFolderCategoryId, null);
                removeDragPlaceholder();
            }
            */
        });
    }
}
// --- 业务逻辑 ---

function deleteCategory(id) {
    if (!confirm('确定要删除这个分类及其所有书签吗？')) return;
    
    appData.categories = appData.categories.filter(c => c.id !== id);
    // 如果删除了当前激活的分类，切换到第一个
    if (appData.activeCategory === id) {
        appData.activeCategory = appData.categories[0].id;
    }
    if (openFolderCategoryId === id) {
        closeFolderModal();
    }
    saveData();
    renderApp();
}

function deleteBookmark(id) {
    const loc = findBookmarkLocation(id);
    if (!loc) return;
    const name = loc.bookmark.title || '此项目';
    if (!confirm(`确定删除“${name}”？`)) return;
    removeBookmarkById(id);
    saveData();
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
}

// --- 模态框与表单 ---

function resetModalState() {
    modalState.editingId = null;
    modalState.type = 'link';
    modalState.originCategoryId = null;
    modalState.originFolderId = null;
    modalState.originIndex = -1;
    modalState.targetCategoryId = appData.activeCategory;
    modalState.targetFolderId = null;
    modalState.lockType = false;
}

function setModalType(type, { lock = false, disableFolder = false } = {}) {
    const nextType = type === 'folder' ? 'folder' : 'link';
    modalState.type = nextType;
    modalState.lockType = lock;
    Array.from(els.bookmarkTypeButtons || []).forEach(btn => {
        const isFolderBtn = btn.dataset.type === 'folder';
        const isActive = btn.dataset.type === nextType;
        btn.classList.toggle('active', isActive);
        
        if (isFolderBtn && disableFolder) {
            btn.disabled = true;
            btn.title = '文件夹最多只能创建三级';
        } else {
            btn.disabled = lock && !isActive;
            btn.title = '';
        }
    });
    Array.from(els.typeSections || []).forEach(section => {
        const isLinkSection = section.classList.contains('type-link');
        const isFolderSection = section.classList.contains('type-folder');
        const shouldShow = nextType === 'link' ? isLinkSection : isFolderSection;
        section.classList.toggle('hidden', !shouldShow);
    });
    if (els.bookmarkUrl) {
        els.bookmarkUrl.required = nextType === 'link';
        if (nextType === 'folder') {
            els.bookmarkUrl.value = '';
        }
    }
    if (nextType === 'folder') {
        resetAutoIconSelection({ hideContainers: true });
        showCustomIconControls(false);
        setIconPreviewSource('');
    } else {
        ensureAutoIconContainersVisible();
        const activeIconType = document.querySelector('input[name="iconType"]:checked');
        toggleIconInput(activeIconType ? activeIconType.value : 'favicon');
    }
    updateModalTitle();
}

function updateModalTitle() {
    if (!els.modalTitle) return;
    const isEdit = !!modalState.editingId;
    if (modalState.type === 'folder') {
        els.modalTitle.textContent = isEdit ? '编辑文件夹' : '新建文件夹';
    } else {
        els.modalTitle.textContent = isEdit ? '编辑网址' : '添加网址';
    }
}

function updateCategoryFieldVisibility(isInsideFolder) {
    if (els.categoryFormGroup) {
        els.categoryFormGroup.classList.toggle('hidden', isInsideFolder);
    }
}

function openAddBookmarkModal(options = {}) {
    resetModalState();
    modalState.type = options.type === 'folder' ? 'folder' : 'link';
    modalState.targetCategoryId = options.categoryId || appData.activeCategory;
    modalState.targetFolderId = options.folderId || null;
    pendingAutoIconSelectionSrc = null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: modalState.type !== 'link' });
    resetCustomIconState();
    els.bookmarkForm.reset();
    els.bookmarkCategory.value = modalState.targetCategoryId;
    
    const depth = getFolderDepth(modalState.targetFolderId);
    const disableFolder = depth >= 3;
    if (modalState.type === 'folder' && disableFolder) {
        modalState.type = 'link';
    }

    setModalType(modalState.type, { lock: false, disableFolder });
    updateModalTitle();
    updateCategoryFieldVisibility(!!modalState.targetFolderId);
    if (modalState.type === 'link') {
        setIconPreviewSource('');
    }
    els.bookmarkModal.classList.remove('hidden');
}

function openEditBookmarkModal(bm, context = {}) {
    resetModalState();
    modalState.editingId = bm.id;
    modalState.type = bm.type === 'folder' ? 'folder' : 'link';
    modalState.lockType = true;
    const loc = findBookmarkLocation(bm.id);
    modalState.originCategoryId = loc?.categoryId || context.categoryId || appData.activeCategory;
    modalState.originFolderId = loc?.parentFolderId || context.folderId || null;
    modalState.originIndex = loc?.index ?? -1;
    modalState.targetCategoryId = modalState.originCategoryId;
    modalState.targetFolderId = modalState.originFolderId;
    pendingAutoIconSelectionSrc = bm.iconType === 'favicon' ? bm.icon : null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: modalState.type !== 'link' });
    resetCustomIconState();
    els.bookmarkTitle.value = bm.title || '';
    els.bookmarkCategory.value = modalState.targetCategoryId;
    
    const depth = getFolderDepth(modalState.targetFolderId);
    const disableFolder = depth >= 3;
    setModalType(modalState.type, { lock: modalState.lockType, disableFolder });

    updateCategoryFieldVisibility(!!modalState.targetFolderId);
    if (modalState.type === 'link') {
        els.bookmarkUrl.value = bm.url;
        // 设置图标状态
        if (bm.iconType === 'custom') {
            document.querySelector('input[name="iconType"][value="custom"]').checked = true;
            toggleIconInput('custom');
            selectedCustomIconSrc = bm.icon || '';
            customIconMode = inferCustomIconMode(bm.icon);
            activateCustomIconTab(customIconMode);
            setIconPreviewSource(bm.icon);
        } else {
            document.querySelector('input[name="iconType"][value="favicon"]').checked = true;
            toggleIconInput('favicon');
            loadAutoIconsForUrl(bm.url, { desiredSrc: bm.icon, force: true });
        }
    }

    updateModalTitle();
    els.bookmarkModal.classList.remove('hidden');
}

function closeModals(options = {}) {
    const keepFolderOpen = options.keepFolderOpen === true;
    els.bookmarkModal.classList.add('hidden');
    els.categoryModal.classList.add('hidden');
    closeSettingsModal();
    if (!keepFolderOpen) {
        closeFolderModal();
    }
    resetAutoIconSelection({ hideContainers: true });
    resetCustomIconState();
    resetModalState();
    pendingAutoIconSelectionSrc = null;
    selectedAutoIcon = null;
    setIconPreviewSource('');
    if (!keepFolderOpen && els.folderExitZone) {
        els.folderExitZone.classList.remove('dragover');
    }
}

function toggleIconInput(type) {
    if (modalState.type === 'folder') return;
    if (type === 'custom') {
        showCustomIconControls(true);
        resetAutoIconSelection({ hideContainers: true });
        if (selectedCustomIconSrc) {
            setIconPreviewSource(selectedCustomIconSrc);
        } else if (customIconMode === 'swatch') {
            applySwatchIcon();
        } else {
            setIconPreviewSource('');
        }
    } else {
        showCustomIconControls(false);
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

function persistFolderFromForm(title, categoryId, targetFolderId, options = {}) {
    const keepFolderOpen = options.keepFolderOpen === true;
    
    // 检查文件夹深度限制
    if (getFolderDepth(targetFolderId) >= 3) {
        return;
    }

    const targetList = getBookmarkList(categoryId, targetFolderId);
    if (!targetList) {
        alert('未找到目标分类，保存失败');
        return;
    }
    let folderBookmark = null;
    let insertIndex = targetList.length;
    if (modalState.editingId) {
        const existingLoc = findBookmarkLocation(modalState.editingId);
        if (existingLoc && existingLoc.bookmark.type === 'folder') {
            folderBookmark = {
                ...existingLoc.bookmark,
                title,
                type: 'folder',
                url: '#',
                iconType: existingLoc.bookmark.iconType || 'custom',
                icon: existingLoc.bookmark.icon || 'icons/default.svg',
                iconFallbacks: existingLoc.bookmark.iconFallbacks || [],
                children: Array.isArray(existingLoc.bookmark.children) ? existingLoc.bookmark.children : []
            };
            const sameContainer = existingLoc.categoryId === categoryId && (existingLoc.parentFolderId || null) === targetFolderId;
            if (sameContainer) {
                insertIndex = Math.min(existingLoc.index, targetList.length);
            }
            removeBookmarkAtLocation(existingLoc);
        }
    }
    if (!folderBookmark) {
        folderBookmark = {
            id: modalState.editingId || generateId('folder'),
            title,
            type: 'folder',
            url: '#',
            iconType: 'custom',
            icon: 'icons/default.svg',
            iconFallbacks: [],
            children: []
        };
    }
    normalizeFolderChildTitles(folderBookmark.title, folderBookmark.children);
    insertBookmarkToList(targetList, insertIndex, folderBookmark);
    saveData();
    renderApp();
    refreshOpenFolderView();
    closeModals({ keepFolderOpen });
}

function setIconPreviewSource(src, { enableAutoFallbacks = false } = {}) {
    if (!els.iconPreview) return;
    // reset previous error handler to avoid stale fallbacks
    els.iconPreview.onerror = null;
    const resolvedSrc = resolveCachedIconSrc(src);
    if (resolvedSrc) {
        // When previewing auto-fetched icons (especially SVG), reuse the same fallback chain
        // as bookmark cards so broken candidates gracefully downgrade instead of showing a
        // broken image placeholder in the modal.
        if (enableAutoFallbacks) {
            const fallbacks = autoIconCandidates
                .filter(candidate => candidate && candidate.src && candidate.src !== src)
                .map(candidate => resolveCachedIconSrc(candidate.src));
            attachIconFallback(els.iconPreview, { iconFallbacks: dedupeIconList(resolvedSrc, fallbacks) });
        }
        els.iconPreview.src = resolvedSrc;
        els.iconPreview.classList.remove('hidden');
    } else {
        els.iconPreview.src = '';
        els.iconPreview.classList.add('hidden');
    }
}

function showCustomIconControls(show) {
    if (!els.customIconControls) return;
    if (show) {
        els.customIconControls.classList.remove('hidden');
        activateCustomIconTab(customIconMode || 'upload');
    } else {
        els.customIconControls.classList.add('hidden');
    }
}

function activateCustomIconTab(mode) {
    customIconMode = mode === 'swatch' ? 'swatch' : 'upload';
    Array.from(els.customIconTabs || []).forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === customIconMode);
    });
    Array.from(els.customIconPanels || []).forEach(panel => {
        const isActive = panel.dataset.mode === customIconMode;
        panel.classList.toggle('hidden', !isActive);
    });
}

function bindCustomSwatchEvents() {
    Array.from(els.customIconTabs || []).forEach(tab => {
        tab.addEventListener('click', () => {
            activateCustomIconTab(tab.dataset.mode);
            if (customIconMode === 'swatch' && !selectedCustomIconSrc) {
                applySwatchIcon();
            }
        });
    });
    if (els.swatchApplyBtn) {
        els.swatchApplyBtn.addEventListener('click', () => {
            applySwatchIcon();
        });
    }
}

function applySwatchIcon() {
    const color = (els.swatchColor && els.swatchColor.value) || DEFAULT_SWATCH_COLOR;
    let text = deriveSwatchText();
    const icon = buildColorSwatchDataUrl(color, text);
    selectedCustomIconSrc = icon;
    customIconMode = 'swatch';
    activateCustomIconTab('swatch');
    setIconPreviewSource(icon);
}

function deriveSwatchText() {
    const manual = (els.swatchText && els.swatchText.value || '').trim();
    if (manual) return manual.slice(0, 4);
    const title = (els.bookmarkTitle && els.bookmarkTitle.value || '').trim();
    if (title) return title.slice(0, 2);
    const urlVal = (els.bookmarkUrl && els.bookmarkUrl.value || '').trim();
    if (urlVal) {
        try {
            const host = new URL(normalizeUrlInput(urlVal)).hostname.replace(/^www\./, '');
            if (host) return host.slice(0, 2);
        } catch (e) {
            // ignore
        }
    }
    return '';
}

function resetCustomIconState() {
    selectedCustomIconSrc = '';
    customIconMode = 'upload';
    if (els.customIconInput) {
        els.customIconInput.value = '';
    }
    if (els.swatchColor) {
        els.swatchColor.value = DEFAULT_SWATCH_COLOR;
    }
    if (els.swatchText) {
        els.swatchText.value = '';
    }
    activateCustomIconTab('upload');
}

function inferCustomIconMode(src) {
    if (src && src.startsWith('data:image/svg+xml')) {
        return 'swatch';
    }
    return 'upload';
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
            .map(c => resolveCachedIconSrc(c.src));
        const resolvedThumbSrc = resolveCachedIconSrc(candidate.src);
        attachIconFallback(img, { iconFallbacks: dedupeIconList(resolvedThumbSrc, thumbnailFallbacks) });
        img.src = resolvedThumbSrc;

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
    cacheIconIfNeeded(candidate.src);
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
        autoIconCandidates = prioritizeIconCandidates(candidates);
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
            src: `https://logo.clearbit.com/${hostname}?size=256`,
            label: 'Clearbit 256px',
            source: 'Clearbit',
            priority: 6
        },
        {
            src: `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=256`,
            label: 'Google S2 256px',
            source: 'Google S2',
            priority: 5
        },
        {
            src: `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=128`,
            label: 'Google S2 128px',
            source: 'Google S2',
            priority: 3
        },
        {
            src: `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedOrigin}&size=256`,
            label: 'GStatic 256px',
            source: 'GStatic',
            priority: 4
        },
        {
            src: `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
            label: 'DuckDuckGo ICO',
            source: 'DuckDuckGo',
            priority: 2
        },
        {
            src: `${origin}/favicon.ico`,
            label: '站点 favicon.ico',
            source: '站点',
            priority: 2
        },
        {
            src: `https://logo.clearbit.com/${hostname}?format=svg`,
            label: 'Clearbit SVG',
            source: 'Clearbit',
            isSvg: true,
            priority: 1
        },
        {
            src: `${origin}/favicon.svg`,
            label: '站点 favicon.svg',
            source: '站点',
            isSvg: true,
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

function prioritizeIconCandidates(list) {
    return [...list].sort((a, b) => {
        const priorityDelta = (b.priority || 0) - (a.priority || 0);
        if (priorityDelta !== 0) return priorityDelta;
        // 当分辨率相同，优先非 SVG，保证默认选到 png/ico
        const svgPenalty = (a.isSvg === true) - (b.isSvg === true);
        if (svgPenalty !== 0) return svgPenalty;
        return 0;
    });
}

function openSettingsModal() {
    pendingStorageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    remoteActionsEnabled = isRemoteMode(pendingStorageMode);
    populateSettingsForm();
    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.checked = radio.value === appSettings.storageMode;
    });
    updateStorageInfoVisibility(pendingStorageMode);
    showRemoteActionsSection(remoteActionsEnabled && isRemoteMode(pendingStorageMode));
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
    pendingStorageMode = mode;
    remoteActionsEnabled = false;
    updateStorageInfoVisibility(mode);
    showRemoteActionsSection(false);
}

async function switchStorageMode(targetMode) {
    const snapshot = JSON.parse(JSON.stringify(appData));
    appSettings.storageMode = targetMode;
    saveSettings();
    await persistAppData(snapshot, { mode: targetMode, notifyOnError: true });
    await loadData({ mode: targetMode, notifyOnError: true });
    renderApp();
    warmIconCacheForBookmarks();
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

function handleImportDataFile(file, source = IMPORT_SOURCES.EDGE_TAB, mode = IMPORT_MODES.MERGE) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            const normalized = parseImportedData(parsed, source);
            if (!normalized) {
                alert('导入失败：文件格式不正确或不支持的数据来源');
                return;
            }
            appData = mode === IMPORT_MODES.OVERWRITE
                ? normalized
                : mergeImportedData(appData, normalized);
            ensureActiveCategory();
            normalizeDataStructure();
            saveData();
            renderApp();
            warmIconCacheForBookmarks();
            alert('导入成功');
            closeSettingsModal();
        } catch (err) {
            console.error('导入数据失败', err);
            alert('导入失败：无法解析文件');
        }
    };
    reader.readAsText(file, 'utf-8');
}

function parseImportedData(raw, source) {
    if (source === IMPORT_SOURCES.WETAB) {
        return parseWeTabData(raw);
    }
    return parseEdgeTabData(raw);
}

function parseEdgeTabData(raw) {
    if (!raw || !Array.isArray(raw.categories)) return null;
    const categories = raw.categories.map((cat, index) => {
        if (!cat) return null;
        const catId = cat.id || generateId('cat');
        const catName = cat.name || `分类${index + 1}`;
        const bookmarks = Array.isArray(cat.bookmarks)
            ? cat.bookmarks.map(normalizeNativeBookmark).filter(Boolean)
            : [];
        return {
            id: catId,
            name: catName,
            bookmarks
        };
    }).filter(Boolean);

    if (!categories.length) return null;
    const activeCategory = categories.some(c => c.id === raw.activeCategory)
        ? raw.activeCategory
        : categories[0].id;
    return { categories, activeCategory };
}

function normalizeNativeBookmark(bm) {
    if (!bm) return null;
    const url = normalizeUrlInput(bm.url || bm.target);
    if (!url) return null;
    const meta = generateHighResIconMeta(url);
    const iconType = bm.iconType === 'custom' ? 'custom' : 'favicon';
    const bookmark = {
        id: bm.id || generateId('bm'),
        title: bm.title || bm.name || url,
        url,
        iconType,
        icon: bm.icon || (iconType === 'favicon' ? meta.icon : ''),
        iconFallbacks: Array.isArray(bm.iconFallbacks) ? bm.iconFallbacks : []
    };

    if (bookmark.iconType === 'favicon') {
        bookmark.iconFallbacks = bookmark.iconFallbacks.length ? bookmark.iconFallbacks : meta.iconFallbacks;
        bookmark.icon = bookmark.icon || meta.icon;
    } else {
        bookmark.iconFallbacks = [];
        bookmark.icon = bookmark.icon || 'icons/default.svg';
    }
    return bookmark;
}

function mergeImportedData(current, incoming) {
    const base = current && Array.isArray(current.categories) ? JSON.parse(JSON.stringify(current)) : { categories: [], activeCategory: null };
    const result = base;
    result.categories = Array.isArray(result.categories) ? result.categories : [];

    const idMap = new Map();
    const nameMap = new Map();
    result.categories.forEach(cat => {
        if (cat.id) idMap.set(cat.id, cat);
        if (cat.name) nameMap.set(normalizeNameKey(cat.name), cat);
        cat.bookmarks = Array.isArray(cat.bookmarks) ? cat.bookmarks : [];
    });

    const incomingCategories = incoming && Array.isArray(incoming.categories) ? incoming.categories : [];
    incomingCategories.forEach(cat => {
        if (!cat) return;
        const nameKey = normalizeNameKey(cat.name);
        const target = (cat.id && idMap.get(cat.id)) || nameMap.get(nameKey);
        if (target) {
            mergeBookmarksIntoCategory(target, cat.bookmarks || []);
        } else {
            const newCat = {
                id: cat.id || generateId('cat'),
                name: cat.name || '未命名分类',
                bookmarks: Array.isArray(cat.bookmarks) ? [...cat.bookmarks] : []
            };
            result.categories.push(newCat);
            if (newCat.id) idMap.set(newCat.id, newCat);
            if (newCat.name) nameMap.set(normalizeNameKey(newCat.name), newCat);
        }
    });

    const incomingActive = incoming?.activeCategory;
    const activeExists = result.categories.some(c => c.id === result.activeCategory);
    if (!activeExists) {
        const incomingExists = result.categories.some(c => c.id === incomingActive);
        result.activeCategory = incomingExists ? incomingActive : (result.categories[0]?.id || null);
    }

    return result;
}

function mergeBookmarksIntoCategory(targetCat, bookmarks) {
    if (!targetCat || !Array.isArray(bookmarks)) return;
    const existingUrls = new Set();
    walkCategoryBookmarks(targetCat, (bm) => {
        if (bm.type === 'folder') return;
        const u = normalizeUrlInput(bm.url || bm.target);
        if (u) existingUrls.add(u);
    });
    const nextBookmarks = Array.isArray(targetCat.bookmarks) ? targetCat.bookmarks : [];
    bookmarks.forEach(bm => {
        if (!bm) return;
        if (bm.type === 'folder') {
            nextBookmarks.push({
                ...bm,
                id: bm.id || generateId('folder')
            });
            return;
        }
        const url = normalizeUrlInput(bm.url || bm.target);
        if (!url || existingUrls.has(url)) return;
        existingUrls.add(url);
        nextBookmarks.push({
            ...bm,
            id: bm.id || generateId('bm'),
            url
        });
    });
    targetCat.bookmarks = nextBookmarks;
}

function normalizeNameKey(name = '') {
    return name.trim().toLowerCase();
}

function parseWeTabData(raw) {
    const icons = raw?.data?.['store-icon']?.icons || raw?.icons;
    if (!Array.isArray(icons)) return null;
    const categories = [];

    icons.forEach((section, index) => {
        if (!section) return;
        const catId = section.id || generateId('cat');
        const catName = section.name || section.iconClass || `WeTab 分类 ${index + 1}`;
        const bookmarks = [];
        const children = Array.isArray(section.children) ? section.children : [];

        children.forEach(child => collectWeTabSites(child, bookmarks));

        if (bookmarks.length) {
            categories.push({
                id: catId,
                name: catName,
                bookmarks
            });
        }
    });

    if (!categories.length) return null;
    return {
        activeCategory: categories[0].id,
        categories
    };
}

function collectWeTabSites(node, bookmarks, folderName = '') {
    if (!node) return;
    if (node.type === 'folder-icon' && Array.isArray(node.children)) {
        const nextFolder = node.name || folderName;
        const folderChildren = [];
        node.children.forEach(child => collectWeTabSites(child, folderChildren, nextFolder));
        if (folderChildren.length) {
            const folderBookmark = buildFolderBookmark(node, folderChildren, nextFolder);
            bookmarks.push(folderBookmark);
        }
        return;
    }
    if (node.type && node.type !== 'site') {
        return;
    }
    const url = normalizeUrlInput(node.target || node.url);
    if (!url) return;
    const baseTitle = node.name || node.title || url;
    const title = baseTitle;
    const iconMeta = deriveWeTabIcon(node, url);
    bookmarks.push({
        id: generateId('bm'),
        title,
        url,
        iconType: iconMeta.iconType,
        icon: iconMeta.icon,
        iconFallbacks: iconMeta.iconFallbacks
    });
}

function buildFolderBookmark(folderNode, children, folderName = '') {
    const title = folderName || folderNode.name || '文件夹';
    const normalizedChildren = normalizeFolderChildTitles(title, children, { clone: true });
    let iconSrc = resolveWeTabImage(folderNode.bgImage);
    if (!iconSrc && folderNode.bgType === 'color' && folderNode.bgColor) {
        iconSrc = buildColorSwatchDataUrl(folderNode.bgColor, title.slice(0, 2));
    }
    if (!iconSrc && children.length) {
        iconSrc = children[0].icon || '';
    }
    if (!iconSrc) {
        const firstUrl = children[0]?.url;
        const meta = firstUrl ? generateHighResIconMeta(firstUrl) : null;
        iconSrc = meta?.icon || 'icons/default.svg';
    }
    return {
        id: folderNode.id || generateId('folder'),
        title,
        url: '#',
        type: 'folder',
        iconType: 'custom',
        icon: iconSrc,
        iconFallbacks: [],
        children: normalizedChildren
    };
}

function deriveWeTabIcon(entry, url) {
    const bgType = (entry.bgType || '').toLowerCase();
    if (bgType === 'image') {
        const imageSrc = resolveWeTabImage(entry.bgImage);
        if (imageSrc) {
            return {
                iconType: 'custom',
                icon: imageSrc,
                iconFallbacks: []
            };
        }
    }
    if (bgType === 'color' && entry.bgColor) {
        return {
            iconType: 'custom',
            icon: buildColorSwatchDataUrl(entry.bgColor, entry.bgText || entry.name),
            iconFallbacks: []
        };
    }
    const meta = generateHighResIconMeta(url);
    return {
        iconType: 'favicon',
        icon: meta.icon,
        iconFallbacks: meta.iconFallbacks
    };
}

function resolveWeTabImage(bgImage) {
    if (!bgImage) return '';
    if (typeof bgImage === 'string') return bgImage;
    if (typeof bgImage === 'object') {
        const preferredKeys = ['large', 'medium', 'small', 'url', 'src'];
        for (const key of preferredKeys) {
            if (bgImage[key]) {
                return bgImage[key];
            }
        }
    }
    return '';
}

function buildColorSwatchDataUrl(color, label = '') {
    const safeColor = typeof color === 'string' && color.trim() ? color.replace(/["']/g, '').trim() : '#888';
    const text = (label || '').trim().slice(0, 2);
    const textMarkup = text
        ? `<text x="32" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.92)" font-weight="700">${escapeForSvg(text)}</text>`
        : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${safeColor}"/>${textMarkup}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeForSvg(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return char;
        }
    });
}

function updateStorageInfoVisibility(mode) {
    const current = mode || STORAGE_MODES.BROWSER;
    toggleSettingsSection(els.browserStorageInfo, current === STORAGE_MODES.BROWSER);
    toggleSettingsSection(els.syncStorageInfo, current === STORAGE_MODES.SYNC);
    toggleSettingsSection(els.webdavStorageInfo, current === STORAGE_MODES.WEBDAV);
    toggleSettingsSection(els.gistStorageInfo, current === STORAGE_MODES.GIST);
    toggleSettingsSection(els.webdavConfig, current === STORAGE_MODES.WEBDAV);
    toggleSettingsSection(els.gistConfig, current === STORAGE_MODES.GIST);
    if (!isRemoteMode(current)) {
        remoteActionsEnabled = false;
        showRemoteActionsSection(false);
    }
}

function toggleSettingsSection(el, show) {
    if (!el) return;
    el.classList.toggle('hidden', !show);
}

function populateSettingsForm() {
    if (els.webdavEndpoint) {
        els.webdavEndpoint.value = appSettings.webdav?.endpoint || '';
    }
    if (els.webdavUsername) {
        els.webdavUsername.value = appSettings.webdav?.username || '';
    }
    if (els.webdavPassword) {
        els.webdavPassword.value = appSettings.webdav?.password || '';
    }
    if (els.gistToken) {
        els.gistToken.value = appSettings.gist?.token || '';
    }
    if (els.gistId) {
        els.gistId.value = appSettings.gist?.gistId || '';
    }
    if (els.gistFilename) {
        els.gistFilename.value = normalizeRemoteFilename(appSettings.gist?.filename);
    }
}

function syncSettingsFromUI() {
    appSettings = mergeSettingsWithDefaults({
        ...appSettings,
        webdav: {
            ...appSettings.webdav,
            endpoint: (els.webdavEndpoint?.value || '').trim(),
            username: (els.webdavUsername?.value || '').trim(),
            password: els.webdavPassword?.value || ''
        },
        gist: {
            ...appSettings.gist,
            token: (els.gistToken?.value || '').trim(),
            gistId: (els.gistId?.value || '').trim(),
            filename: normalizeRemoteFilename(els.gistFilename?.value || appSettings.gist?.filename)
        }
    });
}

function bindSettingsInputListeners() {
    const inputs = [
        els.webdavEndpoint,
        els.webdavUsername,
        els.webdavPassword,
        els.gistToken,
        els.gistId,
        els.gistFilename
    ];
    inputs.forEach(input => {
        if (!input) return;
        input.addEventListener('change', handleSettingsFieldChange);
        input.addEventListener('blur', handleSettingsFieldChange);
    });
}

function handleSettingsFieldChange() {
    syncSettingsFromUI();
    saveSettings();
    if (isRemoteMode(pendingStorageMode)) {
        remoteActionsEnabled = false;
        showRemoteActionsSection(false);
    }
}

function getSelectedStorageMode() {
    const selected = Array.from(els.storageModeRadios || []).find(r => r.checked);
    return selected ? selected.value : appSettings.storageMode || STORAGE_MODES.BROWSER;
}

async function applyStorageConfig() {
    syncSettingsFromUI();
    const selectedMode = getSelectedStorageMode();
    pendingStorageMode = selectedMode;
    if (isRemoteMode(selectedMode)) {
        const valid = await testRemoteConnectivity(selectedMode);
        if (!valid) {
            remoteActionsEnabled = false;
            showRemoteActionsSection(false);
            alert('配置未能连接，请检查地址/凭证后重试。');
            return;
        }
        saveSettings();
        remoteActionsEnabled = true;
        showRemoteActionsSection(true);
        alert('配置已验证，请选择同步操作。');
        return;
    }
    remoteActionsEnabled = false;
    showRemoteActionsSection(false);
    await switchStorageMode(selectedMode);
    alert('配置已应用。');
    closeSettingsModal();
}

function showRemoteActionsSection(show) {
    toggleSettingsSection(els.remoteActions, !!show);
    const disabled = !show;
    [els.remotePushBtn, els.remoteMergeBtn, els.remotePullBtn].forEach(btn => {
        if (btn) btn.disabled = disabled;
    });
}

function isPointerOutsideOpenModals(target) {
    const modals = [els.bookmarkModal, els.categoryModal, els.settingsModal, els.folderModal].filter(m => m && !m.classList.contains('hidden'));
    if (!modals.length) return false;
    return modals.every(modal => {
        const content = modal.querySelector('.modal-content');
        return content ? !content.contains(target) : true;
    });
}

// --- 事件监听 ---

function setupEventListeners() {
    bindSettingsInputListeners();
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
    els.cancelBookmarkBtn.onclick = () => {
        const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));
        closeModals({ keepFolderOpen });
    };
    els.cancelCategoryBtn.onclick = closeModals;
    if (els.closeSettingsBtn) {
        els.closeSettingsBtn.onclick = () => {
            syncSettingsFromUI();
            saveSettings();
            closeSettingsModal();
        };
    }
    if (els.settingsBtn) {
        els.settingsBtn.onclick = openSettingsModal;
    }
    if (els.closeFolderBtn) {
        els.closeFolderBtn.onclick = () => {
            if (openFolderId) {
                const loc = findBookmarkLocation(openFolderId);
                if (loc && loc.parentFolderId) {
                    openFolderModal(loc.parentFolderId);
                    return;
                }
            }
            closeFolderModal();
        };
    }
    if (els.applySettingsBtn) {
        els.applySettingsBtn.onclick = () => {
            applyStorageConfig();
        };
    }
    window.addEventListener('pointerdown', (e) => {
        pointerDownOutsideModal = isPointerOutsideOpenModals(e.target);
    });
    window.addEventListener('pointerup', (e) => {
        const pointerUpOutside = isPointerOutsideOpenModals(e.target);
        if (pointerDownOutsideModal && pointerUpOutside) {
            closeModals();
        }
        pointerDownOutsideModal = false;
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));
            closeModals({ keepFolderOpen });
        }
    });

    if (els.folderAddBtn) {
        els.folderAddBtn.onclick = () => {
            openAddBookmarkModal({
                type: 'link',
                categoryId: openFolderCategoryId || appData.activeCategory,
                folderId: openFolderId || null
            });
        };
    }
    if (els.folderModalTitle) {
        els.folderModalTitle.style.cursor = 'pointer';
        els.folderModalTitle.title = '点击重命名';
        els.folderModalTitle.onclick = () => {
            enableFolderTitleEditing();
        };
    }

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

    // 添加类型切换
    Array.from(els.bookmarkTypeButtons || []).forEach(btn => {
        btn.addEventListener('click', () => {
            if (modalState.lockType && btn.dataset.type !== modalState.type) return;
            setModalType(btn.dataset.type || 'link', { lock: modalState.lockType });
        });
    });

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
                selectedCustomIconSrc = e.target.result;
                customIconMode = 'upload';
                activateCustomIconTab('upload');
                setIconPreviewSource(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });
    bindCustomSwatchEvents();
    bindFolderExitDropzone();
    setupDragNavigation();

    // 自动填充标题 (简单的优化)
    els.bookmarkUrl.addEventListener('blur', () => {
        if (modalState.type === 'folder') return;
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

    if (els.bookmarkCategory) {
        els.bookmarkCategory.addEventListener('change', () => {
            modalState.targetCategoryId = els.bookmarkCategory.value;
            modalState.targetFolderId = null;
        });
    }

    // 保存书签/文件夹
    els.bookmarkForm.onsubmit = async (e) => {
        e.preventDefault();
        const title = (els.bookmarkTitle.value || '').trim();
        if (!title) {
            alert('请输入名称');
            return;
        }
        const categoryId = els.bookmarkCategory.value || modalState.targetCategoryId || appData.activeCategory;
        modalState.targetCategoryId = categoryId;
        const targetFolderId = (() => {
            if (!modalState.targetFolderId) return null;
            const loc = findBookmarkLocation(modalState.targetFolderId);
            return loc && loc.categoryId === categoryId ? modalState.targetFolderId : null;
        })();
        modalState.targetFolderId = targetFolderId;
        const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));

        if (modalState.type === 'folder') {
            persistFolderFromForm(title, categoryId, targetFolderId, { keepFolderOpen });
            return;
        }

        const normalizedUrl = normalizeUrlInput(els.bookmarkUrl.value.trim());
        if (!normalizedUrl) {
            alert('请输入有效网址');
            return;
        }
        const iconTypeEl = document.querySelector('input[name="iconType"]:checked');
        const iconType = iconTypeEl ? iconTypeEl.value : 'favicon';
        
        let iconUrl = '';
        let iconFallbacks = [];

        if (iconType === 'custom') {
            if (selectedCustomIconSrc) {
                iconUrl = selectedCustomIconSrc;
            } else if (els.customIconInput.files.length > 0) {
                iconUrl = await readFileAsDataURL(els.customIconInput.files[0]);
            } else if (customIconMode === 'swatch') {
                iconUrl = buildColorSwatchDataUrl(
                    (els.swatchColor && els.swatchColor.value) || DEFAULT_SWATCH_COLOR,
                    deriveSwatchText()
                );
                selectedCustomIconSrc = iconUrl;
            } else if (modalState.editingId && els.iconPreview?.src) {
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
                const iconMeta = generateHighResIconMeta(normalizedUrl);
                iconUrl = iconMeta.icon;
                iconFallbacks = iconMeta.iconFallbacks;
            }
        }

        if (iconType === 'favicon') {
            await cacheBookmarkIcons(iconUrl, iconFallbacks);
        }

        const bookmarkData = {
            id: modalState.editingId || generateId('bm'),
            title,
            url: normalizedUrl,
            icon: iconUrl,
            iconType,
            iconFallbacks
        };

        const targetList = getBookmarkList(categoryId, targetFolderId);
        if (!targetList) {
            alert('未找到目标分类，保存失败');
            return;
        }
        let insertIndex = targetList.length;

        if (modalState.editingId) {
            const existingLoc = findBookmarkLocation(modalState.editingId);
            if (existingLoc) {
                const sameContainer = existingLoc.categoryId === categoryId && (existingLoc.parentFolderId || null) === targetFolderId;
                if (sameContainer) {
                    insertIndex = Math.min(existingLoc.index, targetList.length);
                }
                removeBookmarkAtLocation(existingLoc);
            }
        }

        insertBookmarkToList(targetList, insertIndex, bookmarkData);
        saveData();
        renderApp();
        refreshOpenFolderView();
        closeModals({ keepFolderOpen });
    };

    if (els.exportDataBtn) {
        els.exportDataBtn.addEventListener('click', exportDataAsFile);
    }
    if (els.importDataInput) {
        els.importDataInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const selectedSource = (els.importSourceSelect && els.importSourceSelect.value) || IMPORT_SOURCES.EDGE_TAB;
                const selectedMode = (els.importModeSelect && els.importModeSelect.value) || IMPORT_MODES.MERGE;
                handleImportDataFile(e.target.files[0], selectedSource, selectedMode);
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
    if (els.remotePushBtn) {
        els.remotePushBtn.addEventListener('click', () => handleRemoteSyncAction('push'));
    }
    if (els.remoteMergeBtn) {
        els.remoteMergeBtn.addEventListener('click', () => handleRemoteSyncAction('merge'));
    }
    if (els.remotePullBtn) {
        els.remotePullBtn.addEventListener('click', () => handleRemoteSyncAction('pull'));
    }
}

function enableFolderTitleEditing() {
    if (!openFolderId || !els.folderModalTitle) return;
    const loc = findBookmarkLocation(openFolderId);
    if (!loc) return;

    const currentTitle = loc.bookmark.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'folder-title-input';
    
    // Replace title with input
    els.folderModalTitle.style.display = 'none';
    els.folderModalTitle.parentNode.insertBefore(input, els.folderModalTitle);
    
    input.focus();
    input.select();

    const save = () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
            loc.bookmark.title = newTitle;
            saveData();
            renderApp(); // Update main grid to show new title
            // Update modal title text
            els.folderModalTitle.textContent = newTitle;
        }
        cleanup();
    };

    const cleanup = () => {
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        els.folderModalTitle.style.display = '';
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            save();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    });
}

function readFileAsDataURL(file) {
    return blobToDataURL(file);
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

let navTimer = null;
function scheduleNavigation(action) {
    if (navTimer) return; // 如果已有计时器，不再重复调度，保持当前的计时
    navTimer = setTimeout(() => {
        action();
        navTimer = null; // 执行完毕后重置，允许下一次触发（实现连续导航）
    }, 600);
}
function cancelNavigation() {
    if (navTimer) {
        clearTimeout(navTimer);
        navTimer = null;
    }
}

function setupDragNavigation() {
    // 1. 拖拽到“返回/关闭”按钮进行导航
    if (els.closeFolderBtn) {
        els.closeFolderBtn.addEventListener('dragover', (e) => {
            if (!dragState.draggingId) return;
            e.preventDefault();
            e.stopPropagation();
            scheduleNavigation(() => {
                if (openFolderId) {
                    const loc = findBookmarkLocation(openFolderId);
                    if (loc && loc.parentFolderId) {
                        openFolderModal(loc.parentFolderId);
                    } else {
                        closeFolderModal();
                        // 文件夹关闭后，立即将占位符移动到主网格，防止松手时位置判定失效
                        if (els.bookmarkGrid) {
                            positionPlaceholderAtEnd(els.bookmarkGrid);
                        }
                    }
                }
            });
        });
        els.closeFolderBtn.addEventListener('dragleave', (e) => {
            cancelNavigation();
        });
        els.closeFolderBtn.addEventListener('drop', (e) => {
             e.preventDefault();
             cancelNavigation();
             if (openFolderId) {
                const loc = findBookmarkLocation(openFolderId);
                if (loc && loc.parentFolderId) {
                    openFolderModal(loc.parentFolderId);
                } else {
                    closeFolderModal();
                    if (els.bookmarkGrid) {
                        positionPlaceholderAtEnd(els.bookmarkGrid);
                    }
                }
            }
        });
    }

    // 2. 拖拽到文件夹外部区域（遮罩层）关闭文件夹
    if (els.folderModal) {
        els.folderModal.addEventListener('dragover', (e) => {
             if (!dragState.draggingId) return;
             e.preventDefault();
             if (e.target === els.folderModal) {
                 scheduleNavigation(() => {
                     closeFolderModal();
                     // 文件夹关闭后，立即将占位符移动到主网格
                     if (els.bookmarkGrid) {
                         positionPlaceholderAtEnd(els.bookmarkGrid);
                     }
                 });
             } else {
                 if (e.target.closest('.modal-content')) {
                    cancelNavigation();
                 }
             }
        });
        els.folderModal.addEventListener('dragleave', (e) => {
             if (e.target === els.folderModal) {
                 cancelNavigation();
             }
        });
    }
}
