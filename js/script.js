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
    SETTINGS: 'edgeTabSettings',
    BACKGROUND_IMAGE: 'edgeTabBgImage'
};

const DEFAULT_BACKGROUND = {
    mode: 'local',
    image: '',
    opacity: 0.7,
    cloud: {
        fileName: 'background',
        downloadUrl: '',
        updatedAt: 0,
        etag: '',
        lastModified: ''
    }
};

const DEFAULT_SETTINGS = {
    storageMode: STORAGE_MODES.BROWSER,
    searchEngine: 'google',
    webdav: {
        endpoint: '',
        username: '',
        password: ''
    },
    gist: {
        token: '',
        gistId: '',
        filename: 'edgeTab-data.json'
    },
    background: JSON.parse(JSON.stringify(DEFAULT_BACKGROUND))
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
const BACKGROUND_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];

function clamp01(value, fallback = 0) {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (!Number.isFinite(num)) return fallback;
    if (num > 1) return 1;
    if (num < 0) return 0;
    return num;
}

function normalizeBackgroundSettings(raw = {}) {
    const merged = { ...DEFAULT_BACKGROUND, ...(raw || {}) };
    const cloud = merged.cloud && typeof merged.cloud === 'object' ? merged.cloud : {};
    const fileName = typeof cloud.fileName === 'string' && cloud.fileName.trim()
        ? cloud.fileName.trim()
        : DEFAULT_BACKGROUND.cloud.fileName;
    const downloadUrl = typeof cloud.downloadUrl === 'string' ? stripCacheBust(cloud.downloadUrl) : '';
    const etag = typeof cloud.etag === 'string' ? cloud.etag : '';
    const lastModified = typeof cloud.lastModified === 'string' ? cloud.lastModified : '';
    return {
        mode: merged.mode === 'cloud' ? 'cloud' : 'local',
        image: typeof merged.image === 'string' ? merged.image : '',
        opacity: clamp01(merged.opacity, DEFAULT_BACKGROUND.opacity),
        cloud: {
            fileName,
            downloadUrl,
            updatedAt: Number.isFinite(cloud.updatedAt) ? cloud.updatedAt : 0,
            etag,
            lastModified
        }
    };
}

function mergeSettingsWithDefaults(raw = {}) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const background = normalizeBackgroundSettings(base.background);
    return {
        ...DEFAULT_SETTINGS,
        ...base,
        webdav: { ...DEFAULT_SETTINGS.webdav, ...(base.webdav || {}) },
        gist: { ...DEFAULT_SETTINGS.gist, ...(base.gist || {}) },
        background
    };
}

function isRemoteMode(mode) {
    return mode === STORAGE_MODES.WEBDAV || mode === STORAGE_MODES.GIST;
}

function getEffectiveStorageMode() {
    const current = appSettings.storageMode || STORAGE_MODES.BROWSER;
    const selected = typeof getSelectedStorageMode === 'function' ? getSelectedStorageMode() : null;
    if (isRemoteMode(current)) return current;
    if (selected && isRemoteMode(selected)) return selected;
    return current;
}

function isRemoteBackgroundReady() {
    const effective = getEffectiveStorageMode();
    if (isRemoteMode(effective)) return true;
    // remoteActionsEnabled 表示已通过“应用配置”验证远程配置
    const selected = typeof getSelectedStorageMode === 'function' ? getSelectedStorageMode() : null;
    return remoteActionsEnabled && isRemoteMode(selected);
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
    activeCategory: 'cat_default',
    background: normalizeBackgroundSettings(DEFAULT_BACKGROUND)
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
let cloudBackgroundRuntime = {
    url: '',
    version: '',
    isObjectUrl: false
};
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
    dropHandled: false,
    lastPlaceholderTargetId: null,
    lastPlaceholderBefore: null,
    lastPlaceholderContainer: null,
    lastPlaceholderMoveTs: 0,
    mergeLockTargetId: null,
    mergeLockUntil: 0,
    lastPosition: { x: 0, y: 0 }
};
const categoryDragState = {
    timerId: null,
    draggingId: null,
    placeholder: null,
    dropHandled: false
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
const modalAnimations = new WeakMap();
const modalAnchors = new WeakMap();
let folderAnchorSnapshot = {
    folderId: null,
    rect: null,
    element: null
};

function syncThemeWithSystem() {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
        document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    applyTheme();
    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', applyTheme);
    } else if (typeof media.addListener === 'function') {
        media.addListener(applyTheme);
    }
}

function escapeForSelector(value) {
    if (window.CSS && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value ? value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') : '';
}

function findBookmarkCardElement(bookmarkId) {
    if (!bookmarkId) return null;
    try {
        const safeId = escapeForSelector(bookmarkId);
        return document.querySelector(`.bookmark-card[data-id="${safeId}"]`);
    } catch (error) {
        return null;
    }
}

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

function checkAndRemoveEmptyFolder(folderId, categoryId) {
    if (!folderId) return;
    const list = getBookmarkList(categoryId, folderId);
    
    if (!list) return;

    if (list.length === 0) {
        removeBookmarkById(folderId);
        if (openFolderId === folderId) {
            closeFolderModal();
        }
    } else if (list.length === 1) {
        const remainingBookmark = list[0];
        // 保留仅包含子文件夹的层级，避免拖入子文件夹后父级被解散导致视图闪退
        if (remainingBookmark && remainingBookmark.type === 'folder') {
            return;
        }
        // 文件夹仅剩一个图标时，自动解散文件夹
        const folderLoc = findBookmarkLocation(folderId);
        
        if (folderLoc && Array.isArray(folderLoc.listRef)) {
            // 移除文件夹
            folderLoc.listRef.splice(folderLoc.index, 1);
            // 将剩余图标插入到原文件夹位置
            folderLoc.listRef.splice(folderLoc.index, 0, remainingBookmark);
            
            if (openFolderId === folderId) {
                closeFolderModal();
            }
        }
    }
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
    
    if (removed.parentFolderId && (removed.parentFolderId !== targetFolderId || removed.categoryId !== targetCategoryId)) {
        checkAndRemoveEmptyFolder(removed.parentFolderId, removed.categoryId);
    }

    saveData();
    // 拖拽操作统一跳过全局刷新动画，仅在同列表时尝试 DOM 重用
    const isSameList = removed.categoryId === targetCategoryId && removed.parentFolderId === targetFolderId;
    
    const updateDOM = () => {
        renderApp({ skipAnimation: true, reorder: isSameList });
        refreshOpenFolderView({ skipAnimation: true, reorder: isSameList });
    };

    if (document.startViewTransition) {
        document.startViewTransition(updateDOM);
    } else {
        updateDOM();
    }
    
    return true;
}

let pendingStorageMode = STORAGE_MODES.BROWSER;
let remoteActionsEnabled = false;
let pointerDownOutsideModal = false;

// DOM 元素
const els = {
    searchInput: document.getElementById('searchInput'),
    searchEngineSelect: document.getElementById('searchEngineSelect'),
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
    toggleBgSettingsBtn: document.getElementById('toggleBgSettingsBtn'),
    bgSettingsPanel: document.getElementById('bgSettingsPanel'),
    bgLocalSection: document.getElementById('bgLocalSection'),
    bgCloudSection: document.getElementById('bgCloudSection'),
    bgModeTabs: document.querySelectorAll('.bg-mode-tab'),
    bgModePanels: document.querySelectorAll('.bg-mode-panel'),
    bgStatusTag: document.getElementById('bgStatusTag'),
    backgroundSourceRadios: document.getElementsByName('backgroundSource'),
    bgSourceTip: document.getElementById('bgSourceTip'),
    cloudBgStatus: document.getElementById('cloudBgStatus'),
    cloudRefreshBtn: document.getElementById('cloudRefreshBtn'),
    cloudUploadBtn: document.getElementById('cloudUploadBtn'),
    backgroundImageInput: document.getElementById('backgroundImageInput'),
    backgroundUrlInput: document.getElementById('backgroundUrlInput'),
    backgroundOpacity: document.getElementById('backgroundOpacity'),
    backgroundOpacityValue: document.getElementById('backgroundOpacityValue'),
    backgroundPreview: document.getElementById('backgroundPreview'),
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
    clearBackgroundBtn: document.getElementById('clearBackgroundBtn'),
    
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
    syncThemeWithSystem();
    
    // 优化：优先加载设置和背景图，尽快渲染背景
    const settingsPromise = new Promise(resolve => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.BACKGROUND_IMAGE], resolve);
    });

    // 并行加载数据和图标缓存
    const dataPromise = new Promise(resolve => {
        chrome.storage.local.get([CACHE_KEYS.ICONS, STORAGE_KEYS.DATA], resolve);
    });

    // 1. 初始化设置与背景
    const settingsResult = await settingsPromise;
    if (settingsResult[STORAGE_KEYS.SETTINGS]) {
        appSettings = mergeSettingsWithDefaults(settingsResult[STORAGE_KEYS.SETTINGS]);
        // 恢复分离存储的背景图
        if (appSettings.background.mode === 'local' && settingsResult[STORAGE_KEYS.BACKGROUND_IMAGE]) {
            if (!appSettings.background.image || appSettings.background.image === 'Check_STORAGE_KEYS_BACKGROUND_IMAGE') {
                appSettings.background.image = settingsResult[STORAGE_KEYS.BACKGROUND_IMAGE];
            }
        }
    } else {
        appSettings = mergeSettingsWithDefaults();
        saveSettings();
    }
    
    pendingStorageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    remoteActionsEnabled = isRemoteMode(pendingStorageMode);
    
    // 立即应用背景，并等待预加载完成（或超时）
    // 这样可以确保背景图准备好后，再渲染内容，实现“先背景后组件”
    await applyBackgroundFromSettings();
    updateBackgroundControlsUI();

    // 2. 等待数据加载完成
    const dataResult = await dataPromise;

    // 3. 初始化图标缓存
    iconCache = dataResult[CACHE_KEYS.ICONS] || {};

    // 4. 初始化数据
    await loadData({ localSnapshot: dataResult[STORAGE_KEYS.DATA] });

    // 每次新建标签页都重置到第一个分类，不记忆上次选择
    if (appData.categories && appData.categories.length > 0) {
        appData.activeCategory = appData.categories[0].id;
    }

    // 渲染与事件绑定
    renderApp();
    if (els.searchEngineSelect) {
        els.searchEngineSelect.value = appSettings.searchEngine || 'google';
        updateSearchPlaceholder(appSettings.searchEngine || 'google');
    }
    setupEventListeners();
    warmIconCacheForBookmarks();
    if (appSettings.background?.mode === 'cloud') {
        refreshCloudBackgroundFromRemote({ notifyWhenMissing: false });
    }

    // 最后显示内容区域，实现淡入效果
    const container = document.querySelector('.container');
    if (container) {
        // 稍微延迟一帧，确保 CSS transition 生效
        requestAnimationFrame(() => {
            container.classList.add('visible');
        });
    }
}

function updateSearchPlaceholder(engine) {
    if (!els.searchInput) return;
    const names = {
        google: 'Google',
        bing: 'Bing',
        baidu: '百度',
        yahoo: 'Yahoo'
    };
    els.searchInput.placeholder = `搜索 ${names[engine] || '...'}`;
}

// --- 数据操作 ---

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.BACKGROUND_IMAGE], (result) => {
            if (result[STORAGE_KEYS.SETTINGS]) {
                appSettings = mergeSettingsWithDefaults(result[STORAGE_KEYS.SETTINGS]);
                // 恢复分离存储的背景图
                if (appSettings.background.mode === 'local' && result[STORAGE_KEYS.BACKGROUND_IMAGE]) {
                    if (!appSettings.background.image || appSettings.background.image === 'Check_STORAGE_KEYS_BACKGROUND_IMAGE') {
                        appSettings.background.image = result[STORAGE_KEYS.BACKGROUND_IMAGE];
                    }
                }
            } else {
                appSettings = mergeSettingsWithDefaults();
                saveSettings();
            }
            applyBackgroundFromSettings();
            updateBackgroundControlsUI();
            resolve();
        });
    });
}

function saveSettings() {
    const settingsToSave = JSON.parse(JSON.stringify(appSettings));
    let bgImageToSave = null;

    // 如果是本地模式且有图片数据，分离存储
    if (settingsToSave.background && settingsToSave.background.mode === 'local') {
        const img = settingsToSave.background.image;
        // 仅当图片数据较大时才分离，避免小图片也分离增加复杂度（虽然这里统一分离逻辑更清晰，但为了兼容性...）
        // 这里选择只要有内容就分离，保持逻辑一致性
        if (img && img.length > 100) { 
            bgImageToSave = img;
            settingsToSave.background.image = 'Check_STORAGE_KEYS_BACKGROUND_IMAGE';
        }
    }

    const updates = {
        [STORAGE_KEYS.SETTINGS]: settingsToSave
    };
    
    if (bgImageToSave !== null) {
        updates[STORAGE_KEYS.BACKGROUND_IMAGE] = bgImageToSave;
    } else if (settingsToSave.background.mode !== 'local') {
        // 如果切换到了云端模式，可以选择清理本地背景图，或者保留以便快速切换回来
        // 这里不做删除操作，以免用户误操作切换模式后丢失本地图片
    }

    chrome.storage.local.set(updates);
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

    maybeSyncBackgroundFromData(appData, { saveSettingsFlag: true });
    attachBackgroundToData(appData);
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
    const dataWithBackground = attachBackgroundToData(data);
    const targetMode = mode || STORAGE_MODES.BROWSER;
    if (targetMode === STORAGE_MODES.WEBDAV) {
        await persistDataToArea(chrome.storage.local, dataWithBackground);
        try {
            await saveDataToWebDAV(dataWithBackground);
        } catch (error) {
            handleRemoteError(`保存到 WebDAV 失败：${error.message}`, notifyOnError, 'webdav');
        }
        return;
    }
    if (targetMode === STORAGE_MODES.GIST) {
        await persistDataToArea(chrome.storage.local, dataWithBackground);
        try {
            await saveDataToGist(dataWithBackground);
        } catch (error) {
            handleRemoteError(`保存到 Gist 失败：${error.message}`, notifyOnError, 'gist');
        }
        return;
    }
    if (targetMode === STORAGE_MODES.SYNC) {
        await Promise.all([
            persistDataToArea(chrome.storage.sync, dataWithBackground),
            persistDataToArea(chrome.storage.local, dataWithBackground)
        ]);
        return;
    }
    await persistDataToArea(chrome.storage.local, dataWithBackground);
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

function buildWebdavHeaders(config, contentType = 'application/json') {
    const headers = {};
    if (contentType) {
        headers['Content-Type'] = contentType;
    }
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
    // 防止配置不完整导致浏览器原生弹窗
    if (!cfg.username && !cfg.password) {
        console.warn('WebDAV 配置不完整（缺少用户名/密码），跳过自动加载以避免浏览器弹窗。');
        if (notifyOnError) {
            alert('WebDAV 配置不完整，请在设置中填写用户名和密码。');
        }
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

        maybeSyncBackgroundFromData(appData, { saveSettingsFlag: true });
        attachBackgroundToData(appData);
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

function getCategoryDragPlaceholder() {
    if (!categoryDragState.placeholder) {
        const ph = document.createElement('li');
        ph.className = 'category-placeholder';
        categoryDragState.placeholder = ph;
    }
    return categoryDragState.placeholder;
}

function removeCategoryDragPlaceholder() {
    if (categoryDragState.placeholder && categoryDragState.placeholder.parentNode) {
        categoryDragState.placeholder.parentNode.removeChild(categoryDragState.placeholder);
    }
    categoryDragState.placeholder = null;
}

function positionCategoryPlaceholder(targetLi, dropBefore = true) {
    if (!targetLi || targetLi.classList.contains('category-placeholder')) return;
    const parent = targetLi.parentNode;
    if (!parent) return;
    const placeholder = getCategoryDragPlaceholder();
    const referenceNode = dropBefore ? targetLi : targetLi.nextSibling;
    if (referenceNode === placeholder) return;
    parent.insertBefore(placeholder, referenceNode);
}

function positionCategoryPlaceholderAtEnd(listEl) {
    const placeholder = getCategoryDragPlaceholder();
    if (!listEl) return;
    if (placeholder.parentNode !== listEl || placeholder.nextSibling) {
        listEl.appendChild(placeholder);
    }
}

function computeCategoryInsertIndex(listEl) {
    if (!listEl) return -1;
    let index = 0;
    const children = Array.from(listEl.children);
    for (const child of children) {
        if (child === categoryDragState.placeholder) {
            return index;
        }
        if (child.dataset && child.dataset.id === categoryDragState.draggingId) {
            continue;
        }
        index += 1;
    }
    return index;
}

function resetCategoryDragState() {
    if (categoryDragState.timerId) {
        clearTimeout(categoryDragState.timerId);
        categoryDragState.timerId = null;
    }
    if (categoryDragState.draggingId && els.categoryList) {
        const draggingEl = els.categoryList.querySelector(`li[data-id="${categoryDragState.draggingId}"]`);
        if (draggingEl) {
            draggingEl.dataset.dragActive = '0';
            draggingEl.classList.remove('dragging', 'drag-ready', 'invisible-drag-source');
            draggingEl.draggable = false;
        }
    }
    categoryDragState.draggingId = null;
    categoryDragState.dropHandled = false;
    removeCategoryDragPlaceholder();
}

function moveCategoryToIndex(categoryId, targetIndex) {
    const fromIndex = appData.categories.findIndex(c => c.id === categoryId);
    if (fromIndex === -1) return;
    const clampedTarget = Math.max(0, Math.min(targetIndex, appData.categories.length - 1));
    if (fromIndex === clampedTarget) return;
    const [cat] = appData.categories.splice(fromIndex, 1);
    appData.categories.splice(clampedTarget, 0, cat);
    saveData();
    renderCategories({ skipAnimation: true });
}

function handleCategoryListDrop(e) {
    if (!categoryDragState.draggingId) return;
    e.preventDefault();
    if (categoryDragState.dropHandled) {
        resetCategoryDragState();
        return;
    }
    categoryDragState.dropHandled = true;
    const targetIndex = computeCategoryInsertIndex(els.categoryList);
    if (targetIndex >= 0) {
        moveCategoryToIndex(categoryDragState.draggingId, targetIndex);
    }
    resetCategoryDragState();
}

function setupCategoryListDropzone() {
    if (!els.categoryList || els.categoryList.dataset.catDropSetup === '1') return;
    const listEl = els.categoryList;
    listEl.addEventListener('dragover', (e) => {
        if (!categoryDragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetItem = e.target.closest('li');
        if (targetItem && targetItem.parentNode === listEl) {
            const rect = targetItem.getBoundingClientRect();
            const dropBefore = e.clientY < rect.top + rect.height / 2;
            positionCategoryPlaceholder(targetItem, dropBefore);
        } else {
            positionCategoryPlaceholderAtEnd(listEl);
        }
    });
    listEl.addEventListener('drop', handleCategoryListDrop);
    listEl.dataset.catDropSetup = '1';
}

function setupCategoryDragHandlers(li, categoryId) {
    li.dataset.dragActive = '0';
    li.draggable = false;
    const clearLongPress = () => {
        if (categoryDragState.timerId) {
            clearTimeout(categoryDragState.timerId);
            categoryDragState.timerId = null;
        }
        li.classList.remove('drag-ready');
        li.draggable = false;
    };
    const startLongPress = (event) => {
        if (appData.categories.length <= 1) return;
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('.delete-cat')) {
            return;
        }
        clearLongPress();
        categoryDragState.timerId = setTimeout(() => {
            li.draggable = true;
            li.classList.add('drag-ready');
        }, DRAG_LONG_PRESS_MS);
    };
    li.addEventListener('pointerdown', startLongPress);
    li.addEventListener('pointerup', clearLongPress);
    li.addEventListener('pointerleave', clearLongPress);
    li.addEventListener('pointercancel', clearLongPress);

    li.addEventListener('dragstart', (e) => {
        if (!li.draggable) {
            e.preventDefault();
            return;
        }
        categoryDragState.draggingId = categoryId;
        categoryDragState.dropHandled = false;
        li.dataset.dragActive = '1';
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', categoryId);
        const placeholder = getCategoryDragPlaceholder();
        if (li.parentNode) {
            li.parentNode.insertBefore(placeholder, li.nextSibling);
        }
        requestAnimationFrame(() => {
            li.classList.add('invisible-drag-source');
        });
    });

    li.addEventListener('dragover', (e) => {
        if (!categoryDragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const dropBefore = e.clientY < rect.top + rect.height / 2;
        positionCategoryPlaceholder(li, dropBefore);
    });

    li.addEventListener('dragend', () => {
        resetCategoryDragState();
    });
}

function renderCategories(options = {}) {
    // 检查分类是否已经渲染过（通过检查是否有子元素）
    const isFirstRender = els.categoryList.children.length === 0;
    if (!categoryDragState.draggingId) {
        removeCategoryDragPlaceholder();
    }
    setupCategoryListDropzone();
    
    els.categoryList.innerHTML = '';
    
    // 填充书签模态框中的分类选择
    els.bookmarkCategory.innerHTML = '';

    appData.categories.forEach((cat, index) => {
        // 侧边栏列表
        const li = document.createElement('li');
        li.textContent = cat.name;
        li.dataset.id = cat.id;
        // 只在首次渲染且未跳过动画时播放动画
        if (!options.skipAnimation && isFirstRender) {
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
            if (li.dataset.dragActive === '1') {
                li.dataset.dragActive = '0';
                return;
            }
            appData.activeCategory = cat.id;
            saveData();
            if (openFolderCategoryId && openFolderCategoryId !== cat.id) {
                closeFolderModal();
            }
            renderApp();
        };
        setupCategoryDragHandlers(li, cat.id);
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
    
    // 为 View Transitions API 设置唯一名称
    if (bm.id) {
        // 确保 ID 格式合法
        const safeId = bm.id.replace(/[^a-zA-Z0-9-_]/g, '');
        card.style.viewTransitionName = `bm-${safeId}`;
    }

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
            const anchorOptions = { anchorElement: card };
            if (openFolderId && document.startViewTransition) {
                document.startViewTransition(() => {
                    openFolderModal(bm.id, anchorOptions);
                });
            } else {
                openFolderModal(bm.id, anchorOptions);
            }
        });
    }

    setupBookmarkCardDrag(card, bm.id, {
        container: context.container || card.parentNode,
        categoryId: context.categoryId || appData.activeCategory,
        folderId: context.folderId || null
    });
    card.addEventListener('dragenter', () => {
        if (dragState.draggingId && isFolder) {
            card.classList.add('folder-drop-ready');
        }
    });
    card.addEventListener('dragleave', () => card.classList.remove('folder-drop-ready'));
    return card;
}

async function openFolderModal(folderBookmark, options = {}) {
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
        const anchorElement = options.anchorElement || findBookmarkCardElement(folderId);
        const anchorRect = options.anchorRect || anchorElement?.getBoundingClientRect() || resolveFolderAnchorRect(folderId);
        rememberFolderAnchor(folderId, anchorElement, anchorRect);
        openFolderId = loc.bookmark.id;
        openFolderCategoryId = loc.categoryId;
        els.folderModalTitle.textContent = loc.bookmark.title || '文件夹';
        updateFolderModalButton(loc);
        renderFolderContent(loc.bookmark.id, loc.categoryId);
        await animateModalVisibility(els.folderModal, { open: true, anchorRect });
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
    const anchorRect = resolveFolderAnchorRect(openFolderId);
    return animateModalVisibility(els.folderModal, {
        open: false,
        anchorRect,
        onHidden: () => {
            openFolderId = null;
            openFolderCategoryId = null;
            if (els.folderExitZone) {
                els.folderExitZone.classList.remove('dragover');
            }
        }
    });
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
    dragState.lastPlaceholderTargetId = null;
    dragState.lastPlaceholderBefore = null;
    dragState.lastPlaceholderContainer = null;
    dragState.lastPlaceholderMoveTs = 0;
    dragState.mergeLockTargetId = null;
    dragState.mergeLockUntil = 0;
}

function positionPlaceholderNearCard(card, dropBefore = true) {
    if (dragState.mergeIntent || (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil)) return;
    const placeholder = getDragPlaceholder();
    const parent = card.parentNode;
    if (!parent) return;
    const now = performance.now();
    if (now - dragState.lastPlaceholderMoveTs < 80) return;
    if (
        dragState.lastPlaceholderContainer === parent &&
        dragState.lastPlaceholderTargetId === card.dataset.id &&
        dragState.lastPlaceholderBefore === dropBefore
    ) {
        return;
    }
    const referenceNode = dropBefore ? card : card.nextSibling;
    if (referenceNode === placeholder) return;
    const beforeRects = captureGridPositions(parent);
    parent.insertBefore(placeholder, referenceNode);
    animateGridShift(parent, beforeRects);
    dragState.lastPlaceholderContainer = parent;
    dragState.lastPlaceholderTargetId = card.dataset.id || null;
    dragState.lastPlaceholderBefore = dropBefore;
    dragState.lastPlaceholderMoveTs = now;
}

function positionPlaceholderAtEnd(container) {
    if (dragState.mergeIntent || (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil)) return;
    const placeholder = getDragPlaceholder();
    if (!container) return;
    const now = performance.now();
    if (now - dragState.lastPlaceholderMoveTs < 80) return;
    if (
        dragState.lastPlaceholderContainer === container &&
        dragState.lastPlaceholderTargetId === '__end' &&
        dragState.lastPlaceholderBefore === false
    ) {
        return;
    }
    const addBtn = container.querySelector('.add-bookmark-card');
    if (addBtn) {
        if (placeholder.nextSibling === addBtn && placeholder.parentNode === container) return;
        const beforeRects = captureGridPositions(container);
        container.insertBefore(placeholder, addBtn);
        animateGridShift(container, beforeRects);
    } else {
        if (placeholder.parentNode === container && placeholder.nextSibling === null) return;
        const beforeRects = captureGridPositions(container);
        container.appendChild(placeholder);
        animateGridShift(container, beforeRects);
    }
    dragState.lastPlaceholderContainer = container;
    dragState.lastPlaceholderTargetId = '__end';
    dragState.lastPlaceholderBefore = false;
    dragState.lastPlaceholderMoveTs = now;
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

function computeDropSide(rect, clientX, targetId) {
    const mid = rect.left + rect.width / 2;
    const hysteresis = rect.width * 0.2; // 加大滞后，避免中心附近抖动
    if (dragState.lastPlaceholderTargetId === targetId) {
        if (dragState.lastPlaceholderBefore) {
            return clientX < mid + hysteresis;
        }
        return clientX < mid - hysteresis;
    }
    return clientX < mid;
}

function captureGridPositions(container) {
    if (!container) return null;
    const map = new Map();
    Array.from(container.children).forEach(child => {
        const isCard = child.classList && (child.classList.contains('bookmark-card') || child.classList.contains('add-bookmark-card'));
        const isPlaceholder = child.classList && child.classList.contains('bookmark-placeholder');
        if (!isCard || isPlaceholder || child.classList.contains('dragging')) return;
        map.set(child, child.getBoundingClientRect());
    });
    return map;
}

// 使用轻量级 FLIP 动画，让占位符移动时邻居看起来被“挤开”
function animateGridShift(container, beforeRects) {
    if (!container || !beforeRects) return;
    const animated = [];
    beforeRects.forEach((prev, el) => {
        if (!el || !el.isConnected) return;
        const now = el.getBoundingClientRect();
        const dx = prev.left - now.left;
        const dy = prev.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        animated.push(el);
        requestAnimationFrame(() => {
            el.style.transition = 'transform 260ms cubic-bezier(0.25, 0.8, 0.25, 1)';
            el.style.transform = 'translate(0, 0)';
        });
    });
    if (!animated.length) return;
    setTimeout(() => {
        animated.forEach(el => {
            if (!el || !el.isConnected) return;
            if (el.style.transition === 'transform 260ms cubic-bezier(0.25, 0.8, 0.25, 1)') {
                el.style.transition = '';
            }
            if (el.style.transform === 'translate(0, 0)') {
                el.style.transform = '';
            }
        });
    }, 330);
}

function findClosestCardInGrid(container, x, y) {
    const cards = Array.from(container.querySelectorAll('.bookmark-card:not(.dragging)'));
    if (!cards.length) return null;

    let closest = null;
    let minDistance = Infinity;

    for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(x - cx, y - cy);
        
        if (dist < minDistance) {
            minDistance = dist;
            closest = card;
        }
    }

    if (closest) {
        const rect = closest.getBoundingClientRect();
        const dropBefore = computeDropSide(rect, x, closest.dataset.id || null);
        return { card: closest, dropBefore };
    }
    return null;
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
        if (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil) return;
        
        if (dragState.placeholder && (e.target === dragState.placeholder || dragState.placeholder.contains(e.target))) return;

        const targetCard = e.target.closest('.bookmark-card');
        if (targetCard && targetCard.parentNode === container) {
            const rect = targetCard.getBoundingClientRect();
            // Grid 布局中，基于 X 轴中点判断插入位置更符合直觉
            const dropBefore = computeDropSide(rect, e.clientX, targetCard.dataset.id || null);
            positionPlaceholderNearCard(targetCard, dropBefore);
        } else {
            const closest = findClosestCardInGrid(container, e.clientX, e.clientY);
            if (closest) {
                positionPlaceholderNearCard(closest.card, closest.dropBefore);
            } else {
                positionPlaceholderAtEnd(container);
            }
        }
    });
    container.addEventListener('drop', (e) => handleGridDrop(e, container));
    container.dataset.dropSetup = '1';
}

function handleGridDrop(event, container) {
    event.preventDefault();
    if (!dragState.draggingId) return;
    if (dragState.dropHandled) {
        removeDragPlaceholder();
        return;
    }
    dragState.dropHandled = true;
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
        dragState.dropHandled = false;
        dragState.lastPlaceholderTargetId = null;
        dragState.lastPlaceholderBefore = null;
        dragState.lastPlaceholderContainer = null;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
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
            const dropBefore = computeDropSide(rect, e.clientX, card.dataset.id || null);
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
            dragState.mergeLockTargetId = null;
            dragState.mergeLockUntil = 0;
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
        dragState.dropHandled = false;
        dragState.lastPlaceholderTargetId = null;
        dragState.lastPlaceholderBefore = null;
        dragState.lastPlaceholderContainer = null;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
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
    if (dragState.dropHandled) return;
    dragState.dropHandled = true;
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
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        return;
    }
    const now = performance.now();
    const lockActive = dragState.mergeLockTargetId === targetId && now < dragState.mergeLockUntil;
    if (lockActive) {
        dragState.mergeIntent = true;
        card.classList.add('folder-drop-ready');
        removeDragPlaceholder();
        return;
    }
    const isCenter = isFolderHoverZone(event, card, 0.34);
    if (dragState.hoverTargetId !== targetId) {
        dragState.hoverTargetId = targetId;
        dragState.hoverStartTs = now;
        dragState.mergeIntent = false;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        dragState.lastPlaceholderMoveTs = 0; // 重新计时，避免在新目标上立即抖动
    }
    const dwellMs = now - dragState.hoverStartTs;
    dragState.mergeIntent = isCenter && dwellMs >= 120;
    if (dragState.mergeIntent) {
        card.classList.add('folder-drop-ready');
        removeDragPlaceholder();
        dragState.mergeLockTargetId = targetId;
        dragState.mergeLockUntil = now + 220;
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
    
    if (removal.parentFolderId && removal.parentFolderId !== folderId) {
        checkAndRemoveEmptyFolder(removal.parentFolderId, removal.categoryId);
    }

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
    animateModalVisibility(els.bookmarkModal, { open: true });
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
    animateModalVisibility(els.bookmarkModal, { open: true });
}

function checkModalOpenState() {
    const modals = [els.bookmarkModal, els.categoryModal, els.settingsModal, els.folderModal];
    const anyOpen = modals.some(m => m && !m.classList.contains('hidden'));
    document.body.classList.toggle('modal-open', anyOpen);
}

function computeTransformFromRect(sourceRect, targetRect) {
    if (!sourceRect || !targetRect) return null;
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const translateX = sourceCenterX - targetCenterX;
    const translateY = sourceCenterY - targetCenterY;
    const scaleX = Math.max(0.35, Math.min(1.1, sourceRect.width / targetRect.width));
    const scaleY = Math.max(0.35, Math.min(1.1, sourceRect.height / targetRect.height));
    return `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
}

function rememberFolderAnchor(folderId, anchorElement, fallbackRect) {
    const rect = anchorElement?.getBoundingClientRect() || fallbackRect || null;
    folderAnchorSnapshot = { folderId, rect, element: anchorElement || null };
    if (els.folderModal && rect) {
        modalAnchors.set(els.folderModal, rect);
    }
}

function resolveFolderAnchorRect(folderId) {
    if (folderAnchorSnapshot.folderId && folderId && folderAnchorSnapshot.folderId === folderId) {
        const liveRect = folderAnchorSnapshot.element?.getBoundingClientRect();
        if (liveRect) return liveRect;
        if (folderAnchorSnapshot.rect) return folderAnchorSnapshot.rect;
    }
    const anchorEl = findBookmarkCardElement(folderId);
    return anchorEl?.getBoundingClientRect() || null;
}

function animateModalVisibility(modal, { open, anchorRect, onHidden } = {}) {
    if (!modal) {
        if (!open && onHidden) onHidden();
        return Promise.resolve();
    }
    const content = modal.querySelector('.modal-content');
    const alreadyClosed = !open && modal.classList.contains('hidden');
    if (alreadyClosed) {
        if (onHidden) onHidden();
        return Promise.resolve();
    }
    if (!content || typeof modal.animate !== 'function') {
        modal.classList.toggle('hidden', !open);
        modal.style.opacity = open ? '1' : '';
        modal.style.visibility = open ? 'visible' : 'hidden';
        checkModalOpenState();
        if (open) document.body.classList.add('modal-open');
        if (!open && onHidden) onHidden();
        return Promise.resolve();
    }

    const wasHidden = modal.classList.contains('hidden');
    if (open) {
        if (anchorRect) {
            modalAnchors.set(modal, anchorRect);
        } else {
            modalAnchors.delete(modal);
        }
    }
    const effectiveAnchor = open ? (anchorRect || null) : (anchorRect || modalAnchors.get(modal) || null);

    const modalStyle = getComputedStyle(modal);
    const contentStyle = getComputedStyle(content);
    const snapshot = {
        modalOpacity: parseFloat(modalStyle.opacity) || 0,
        contentOpacity: parseFloat(contentStyle.opacity) || 0,
        contentTransform: contentStyle.transform === 'none' ? 'translate3d(0,0,0)' : contentStyle.transform
    };

    const existingAnimations = modalAnimations.get(modal);
    if (existingAnimations) {
        existingAnimations.forEach(anim => anim.cancel());
        modalAnimations.delete(modal);
    }

    if (wasHidden) {
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        modal.classList.remove('hidden');
        // Force reflow so we measure the post-layout size before animating
        modal.getBoundingClientRect();
    }

    const targetRect = content.getBoundingClientRect();
    const anchorTransform = computeTransformFromRect(effectiveAnchor, targetRect);
    const fallbackClosedTransform = 'translateY(14px) scale(0.94)';

    const backdropFromOpacity = Number.isFinite(snapshot.modalOpacity) ? Math.min(1, Math.max(0, snapshot.modalOpacity)) : 0;
    const contentFromOpacity = Number.isFinite(snapshot.contentOpacity) ? Math.min(1, Math.max(0, snapshot.contentOpacity)) : 0;

    const fromTransform = open
        ? (wasHidden ? (anchorTransform || fallbackClosedTransform) : snapshot.contentTransform)
        : snapshot.contentTransform;
    const toTransform = open ? 'translate3d(0,0,0) scale(1)' : (anchorTransform || fallbackClosedTransform);
    const startBackdropOpacity = wasHidden ? 0 : backdropFromOpacity;
    const startContentOpacity = wasHidden ? 0 : contentFromOpacity;
    const contentToOpacity = open ? 1 : 0;

    modal.style.visibility = 'visible';
    document.body.classList.add('modal-open');

    const easingOpen = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const easingClose = 'cubic-bezier(0.4, 0, 0.2, 1)';

    const backdropAnimation = modal.animate(
        [
            { opacity: startBackdropOpacity },
            { opacity: open ? 1 : 0 }
        ],
        { duration: open ? 260 : 220, easing: open ? easingOpen : easingClose, fill: 'forwards' }
    );

    const contentAnimation = content.animate(
        [
            { opacity: startContentOpacity, transform: fromTransform },
            { opacity: contentToOpacity, transform: toTransform }
        ],
        { duration: open ? 320 : 260, easing: open ? easingOpen : easingClose, fill: 'forwards' }
    );

    modalAnimations.set(modal, [backdropAnimation, contentAnimation]);

    const finish = () => {
        modalAnimations.delete(modal);
        if (open) {
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
        } else {
            modal.style.opacity = '';
            modal.style.visibility = 'hidden';
            modal.classList.add('hidden');
        }
        content.style.transform = '';
        content.style.opacity = '';
        checkModalOpenState();
        if (!open && onHidden) onHidden();
    };

    return Promise.all([
        backdropAnimation.finished.catch(() => {}),
        contentAnimation.finished.catch(() => {})
    ]).then(finish, finish);
}

function closeModalWithAnimation(modal, onHidden) {
    return animateModalVisibility(modal, { open: false }).then(() => {
        if (onHidden) onHidden();
    });
}

function closeModals(options = {}) {
    const keepFolderOpen = options.keepFolderOpen === true;
    
    const cleanup = () => {
        resetAutoIconSelection({ hideContainers: true });
        resetCustomIconState();
        resetModalState();
        pendingAutoIconSelectionSrc = null;
        selectedAutoIcon = null;
        setIconPreviewSource('');
        if (!keepFolderOpen && els.folderExitZone) {
            els.folderExitZone.classList.remove('dragover');
        }
    };

    const closers = [];
    if (els.bookmarkModal && !els.bookmarkModal.classList.contains('hidden')) {
        closers.push(closeModalWithAnimation(els.bookmarkModal));
    }
    if (els.categoryModal && !els.categoryModal.classList.contains('hidden')) {
        closers.push(closeModalWithAnimation(els.categoryModal));
    }
    if (els.settingsModal && !els.settingsModal.classList.contains('hidden')) {
        closers.push(closeSettingsModal());
    }
    if (!keepFolderOpen && els.folderModal && !els.folderModal.classList.contains('hidden')) {
        closers.push(closeFolderModal());
    }

    if (closers.length === 0) {
        cleanup();
        return;
    }

    Promise.all(closers).then(cleanup);
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
    if (els.bgSettingsPanel) {
        els.bgSettingsPanel.classList.add('hidden');
    }
    if (els.toggleBgSettingsBtn) {
        els.toggleBgSettingsBtn.textContent = '设置背景';
    }
    pendingStorageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    remoteActionsEnabled = isRemoteMode(pendingStorageMode);
    populateSettingsForm();
    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.checked = radio.value === appSettings.storageMode;
    });
    updateStorageInfoVisibility(pendingStorageMode);
    showRemoteActionsSection(remoteActionsEnabled && isRemoteMode(pendingStorageMode));
    if (els.settingsModal) {
        animateModalVisibility(els.settingsModal, { open: true });
    }
}

function closeSettingsModal() {
    return animateModalVisibility(els.settingsModal, { open: false });
}

async function handleStorageModeChange(mode) {
    pendingStorageMode = mode;
    remoteActionsEnabled = false;
    updateStorageInfoVisibility(mode);
    showRemoteActionsSection(false);
}

async function switchStorageMode(targetMode) {
    const snapshot = attachBackgroundToData(JSON.parse(JSON.stringify(appData)));
    appSettings.storageMode = targetMode;
    saveSettings();
    await persistAppData(snapshot, { mode: targetMode, notifyOnError: true });
    await loadData({ mode: targetMode, notifyOnError: true });
    renderApp();
    warmIconCacheForBookmarks();
}

function exportDataAsFile() {
    attachBackgroundToData(appData);
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
            maybeSyncBackgroundFromData(appData, { saveSettingsFlag: true });
            attachBackgroundToData(appData);
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
    const background = extractBackgroundFromData(raw);
    return background ? { categories, activeCategory, background } : { categories, activeCategory };
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

    const incomingBg = extractBackgroundFromData(incoming);
    const baseBg = extractBackgroundFromData(result) || extractBackgroundFromData(current);
    result.background = normalizeBackgroundSettings(incomingBg || baseBg || DEFAULT_SETTINGS.background);

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

function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const meta = parts[0];
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function inferExtFromMime(mime = '') {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/gif': 'gif'
    };
    return map[mime.toLowerCase()] || '';
}

function inferMimeFromExtension(ext = '') {
    const map = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
        gif: 'image/gif'
    };
    const lowered = ext.toLowerCase();
    return map[lowered] || '';
}

function inferMimeFromDataUrl(dataUrl = '') {
    const match = dataUrl.match(/^data:([^;]+);/);
    return match ? match[1] : '';
}

function deriveBackgroundFileName(uploadName, mimeType, fallbackBase = DEFAULT_BACKGROUND.cloud.fileName) {
    const safeName = (uploadName || '').split(/[/\\]/).pop() || '';
    const baseFromName = safeName.replace(/\.[^.]+$/, '') || fallbackBase;
    const extFromName = (safeName.match(/\.([^.]+)$/) || [])[1] || '';
    const extFromMime = inferExtFromMime(mimeType || '');
    const ext = (extFromName || extFromMime || '').toLowerCase();
    if (!ext) return baseFromName;
    const cleanBase = baseFromName.replace(/\.[^.]+$/, '') || fallbackBase;
    return `${cleanBase}.${ext}`;
}

function buildBackgroundCandidates(preferredName = '') {
    const trimmed = (preferredName || '').trim() || DEFAULT_BACKGROUND.cloud.fileName;
    const base = trimmed.replace(/\.[^.]+$/, '');
    const extFromName = (trimmed.match(/\.([^.]+)$/) || [])[1];
    const candidates = [];
    if (extFromName) {
        candidates.push(`${base}.${extFromName}`);
    } else {
        candidates.push(base);
    }
    const extensionVariants = new Set();
    BACKGROUND_EXTENSIONS.forEach(ext => {
        extensionVariants.add(ext);
        extensionVariants.add(ext.toUpperCase());
    });
    // 兼容用户误写的 jepg/JEPG
    extensionVariants.add('jepg');
    extensionVariants.add('JEPG');
    extensionVariants.forEach(ext => {
        candidates.push(`${base}.${ext}`);
    });
    return Array.from(new Set(candidates));
}

function appendCacheBust(url = '', ts = Date.now()) {
    if (!url) return '';
    const separator = url.includes('?') ? '&' : '?';
    const token = encodeURIComponent(ts);
    return `${url}${separator}_=${token}`;
}

function stripCacheBust(url = '') {
    if (!url) return '';
    try {
        const u = new URL(url);
        u.searchParams.delete('_');
        return u.toString();
    } catch (error) {
        const cleaned = url.replace(/([?&])_=[^&]*(&|$)/, (match, sep, tail) => {
            if (sep === '?' && tail) return '?';
            return sep;
        }).replace(/[?&]$/, '');
        return cleaned;
    }
}

function getBackgroundVersionToken(cloud = {}) {
    if (!cloud) return '';
    const parts = [];
    if (cloud.etag) parts.push(cloud.etag);
    if (cloud.lastModified) parts.push(cloud.lastModified);
    if (Number.isFinite(cloud.updatedAt) && cloud.updatedAt > 0) parts.push(cloud.updatedAt);
    if (!parts.length) return '';
    return parts.join('|');
}

function buildBackgroundDisplayUrl(background) {
    if (!background) return '';
    if (background.mode !== 'cloud') {
        return background.image || '';
    }
    const base = background.cloud?.downloadUrl || '';
    if (!base) return '';
    const version = getBackgroundVersionToken(background.cloud);
    return version ? appendCacheBust(base, version) : base;
}

function clearCloudBackgroundRuntime() {
    if (cloudBackgroundRuntime.isObjectUrl && cloudBackgroundRuntime.url) {
        URL.revokeObjectURL(cloudBackgroundRuntime.url);
    }
    cloudBackgroundRuntime = {
        url: '',
        version: '',
        isObjectUrl: false
    };
}

function updateCloudBackgroundRuntime(url, version, isObjectUrl = false) {
    const sameAsCurrent = cloudBackgroundRuntime.url === url
        && cloudBackgroundRuntime.version === version
        && cloudBackgroundRuntime.isObjectUrl === !!isObjectUrl;
    if (sameAsCurrent) return;
    if (cloudBackgroundRuntime.isObjectUrl && cloudBackgroundRuntime.url && cloudBackgroundRuntime.url !== url) {
        URL.revokeObjectURL(cloudBackgroundRuntime.url);
    }
    cloudBackgroundRuntime = {
        url: url || '',
        version: version || '',
        isObjectUrl: !!isObjectUrl
    };
}

// --- IndexedDB Cache for Background Images ---
const DB_NAME = 'EdgeTabDB';
const DB_VERSION = 1;
const BG_STORE_NAME = 'backgrounds';

function openBackgroundDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(BG_STORE_NAME)) {
                db.createObjectStore(BG_STORE_NAME, { keyPath: 'url' });
            }
        };
    });
}

async function getCachedBackground(url) {
    try {
        const db = await openBackgroundDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([BG_STORE_NAME], 'readonly');
            const store = transaction.objectStore(BG_STORE_NAME);
            const request = store.get(url);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return null;
    }
}

async function setCachedBackground(data) {
    try {
        const db = await openBackgroundDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([BG_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(BG_STORE_NAME);
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn('IndexedDB write error', e);
    }
}

async function checkAndRefreshBackgroundCache(displayUrl, storageMode, normalized, cachedData) {
    try {
        const cacheHeaders = {};
        if (cachedData.etag) cacheHeaders['If-None-Match'] = cachedData.etag;
        if (cachedData.lastModified) cacheHeaders['If-Modified-Since'] = cachedData.lastModified;

        let resp;
        if (storageMode === STORAGE_MODES.WEBDAV) {
            const cfg = normalizeWebdavConfig(appSettings.webdav);
            if (!cfg.username && !cfg.password) return;
            resp = await fetchWithTimeout(displayUrl, {
                method: 'GET',
                headers: { ...buildWebdavHeaders(cfg, ''), ...cacheHeaders },
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
        } else if (storageMode === STORAGE_MODES.GIST) {
            const cfg = normalizeGistConfig(appSettings.gist);
            resp = await fetchWithTimeout(displayUrl, {
                method: 'GET',
                headers: { ...buildGistHeaders(cfg.token), ...cacheHeaders },
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
        }

        if (resp && resp.ok) {
            let blob;
            const contentType = (resp.headers.get('content-type') || '').toLowerCase();
            if (storageMode === STORAGE_MODES.GIST && !contentType.startsWith('image/')) {
                 if (contentType.includes('json') || contentType.includes('text')) {
                     return;
                 }
            }
            blob = await resp.blob();
            
            if (blob) {
                await setCachedBackground({
                    url: displayUrl,
                    blob: blob,
                    etag: resp.headers.get('etag'),
                    lastModified: resp.headers.get('last-modified'),
                    timestamp: Date.now()
                });
                console.log('Background image cache updated from cloud.');
            }
        }
    } catch (e) {
        console.warn('Background cache refresh failed', e);
    }
}

async function resolveBackgroundImageUrl(background) {
    const normalized = normalizeBackgroundSettings(background);
    const displayUrl = buildBackgroundDisplayUrl(normalized);

    // 非云端模式：直接使用本地/链接，清空云端缓存
    if (normalized.mode !== 'cloud') {
        clearCloudBackgroundRuntime();
        const url = normalized.image && normalized.image.startsWith('sync:')
            ? normalized.image.substring(5)
            : displayUrl;
        return { url, isObjectUrl: false, version: '' };
    }

    // 云端模式但无可用链接
    if (!displayUrl) {
        clearCloudBackgroundRuntime();
        return { url: '', isObjectUrl: false, version: '' };
    }

    const versionToken = getBackgroundVersionToken(normalized.cloud) || (normalized.cloud?.downloadUrl || '');
    if (cloudBackgroundRuntime.url && cloudBackgroundRuntime.version === versionToken) {
        return { ...cloudBackgroundRuntime };
    }

    const storageMode = getEffectiveStorageMode();
    const cacheHeaders = buildBackgroundConditionalHeaders(normalized.cloud);
    let resolvedUrl = '';
    let isObjectUrl = false;

    // 尝试从 IndexedDB 读取缓存
    if (isRemoteMode(storageMode)) {
        const cachedData = await getCachedBackground(displayUrl);
        if (cachedData && cachedData.blob) {
            resolvedUrl = URL.createObjectURL(cachedData.blob);
            isObjectUrl = true;
            // 后台检查更新
            checkAndRefreshBackgroundCache(displayUrl, storageMode, normalized, cachedData);
        }
    }

    // 如果没有缓存，则执行下载
    if (!resolvedUrl) {
        try {
            if (storageMode === STORAGE_MODES.WEBDAV) {
                const cfg = normalizeWebdavConfig(appSettings.webdav);
                // 防止配置不完整导致浏览器原生弹窗
                if (!cfg.username && !cfg.password) {
                    return { url: '', isObjectUrl: false, version: '' };
                }
                const resp = await fetchWithTimeout(displayUrl, {
                    method: 'GET',
                    headers: { ...buildWebdavHeaders(cfg, ''), ...cacheHeaders },
                    cache: 'no-store'
                }, REMOTE_FETCH_TIMEOUT);
                if (resp.status === 304 && cloudBackgroundRuntime.url) {
                    return { ...cloudBackgroundRuntime };
                }
                if (resp.ok) {
                    const blob = await resp.blob();
                    resolvedUrl = URL.createObjectURL(blob);
                    isObjectUrl = true;
                    // 保存到缓存
                    setCachedBackground({
                        url: displayUrl,
                        blob: blob,
                        etag: resp.headers.get('etag'),
                        lastModified: resp.headers.get('last-modified'),
                        timestamp: Date.now()
                    });
                }
            } else if (storageMode === STORAGE_MODES.GIST) {
                const cfg = normalizeGistConfig(appSettings.gist);
                const resp = await fetchWithTimeout(displayUrl, {
                    method: 'GET',
                    headers: { ...buildGistHeaders(cfg.token), ...cacheHeaders },
                    cache: 'no-store'
                }, REMOTE_FETCH_TIMEOUT);
                if (resp.status === 304 && cloudBackgroundRuntime.url) {
                    return { ...cloudBackgroundRuntime };
                }
                if (resp.ok) {
                    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
                    if (contentType.startsWith('image/')) {
                        const blob = await resp.blob();
                        resolvedUrl = URL.createObjectURL(blob);
                        isObjectUrl = true;
                        // 保存到缓存
                        setCachedBackground({
                            url: displayUrl,
                            blob: blob,
                            etag: resp.headers.get('etag'),
                            lastModified: resp.headers.get('last-modified'),
                            timestamp: Date.now()
                        });
                    } else {
                        const text = await resp.text();
                        const trimmed = text.trim();
                        if (trimmed.startsWith('data:image')) {
                            resolvedUrl = trimmed;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('读取云端背景失败，使用原始地址', error);
        }
    }

    if (!resolvedUrl) {
        // 若当前有缓存并且版本未变，则继续沿用缓存，避免闪烁
        if (cloudBackgroundRuntime.url && cloudBackgroundRuntime.version === versionToken) {
            return { ...cloudBackgroundRuntime };
        }
        resolvedUrl = displayUrl;
    }

    updateCloudBackgroundRuntime(resolvedUrl, versionToken, isObjectUrl);
    return { url: resolvedUrl, isObjectUrl, version: versionToken };
}

function parseHttpDateToTs(value = '') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
}

function buildBackgroundConditionalHeaders(cloud = {}) {
    const headers = {};
    if (cloud.etag) {
        headers['If-None-Match'] = cloud.etag;
    }
    if (cloud.lastModified) {
        headers['If-Modified-Since'] = cloud.lastModified;
    }
    return headers;
}

function buildBackgroundRemoteName(uploadName, mimeType) {
    const extFromName = (uploadName || '').match(/\.([^.]+)$/);
    const extFromMime = inferExtFromMime(mimeType || '');
    const ext = (extFromName && extFromName[1]) || extFromMime || 'jpg';
    const cleanExt = BACKGROUND_EXTENSIONS.includes(ext.toLowerCase()) ? ext.toLowerCase() : (inferExtFromMime(`image/${ext}`) || 'jpg');
    return `background.${cleanExt}`;
}

async function applyBackgroundFromSettings() {
    const normalizedBg = normalizeBackgroundSettings(appSettings.background);
    appSettings.background = normalizedBg;
    const opacity = normalizedBg.opacity;
    const { url: actualImageUrl } = await resolveBackgroundImageUrl(normalizedBg);
    const hasImage = !!actualImageUrl;
    
    const root = document.documentElement;
    
    // 如果没有图片，直接清除并返回
    if (!hasImage) {
        clearCloudBackgroundRuntime();
        if (root) {
            root.style.setProperty('--custom-bg-image', 'none');
            root.style.setProperty('--custom-bg-opacity', 0);
        }
        if (document.body) {
            document.body.classList.remove('custom-bg-enabled');
        }
        return;
    }

    // 有图片，先设置透明度变量（此时 body 还没 class，所以不会显示）
    if (root) {
        root.style.setProperty('--custom-bg-opacity', opacity);
    }

    // 预加载图片
    return new Promise((resolve) => {
        const img = new Image();
        let resolved = false;
        
        const finish = (success) => {
            if (resolved) return;
            resolved = true;
            if (success) {
                if (root) root.style.setProperty('--custom-bg-image', `url(${actualImageUrl})`);
                if (document.body) document.body.classList.add('custom-bg-enabled');
            } else {
                // 失败时不显示背景
                clearCloudBackgroundRuntime();
                if (document.body) document.body.classList.remove('custom-bg-enabled');
            }
            resolve();
        };

        img.onload = () => finish(true);
        img.onerror = () => {
            console.warn('背景图加载失败');
            finish(false);
        };
        
        // 设置超时，避免过久阻塞（例如 1.5 秒）
        // 注意：如果是 Base64，onload 通常很快；如果是网络图片，超时能防止白屏太久
        setTimeout(() => finish(true), 1500);
        
        img.src = actualImageUrl;
    });
}

function extractBackgroundFromData(data) {
    if (!data || typeof data !== 'object') return null;
    const raw = data.background;
    if (raw && typeof raw === 'object') {
        return normalizeBackgroundSettings(raw);
    }
    return null;
}

function maybeSyncBackgroundFromData(data, { saveSettingsFlag = false } = {}) {
    const bg = extractBackgroundFromData(data);
    if (!bg) return false;
    const current = normalizeBackgroundSettings(appSettings.background);
    const merged = normalizeBackgroundSettings({
        ...current,
        ...bg,
        image: bg.image || current.image,
        cloud: {
            ...current.cloud,
            ...(bg.cloud || {})
        }
    });
    appSettings.background = merged;
    applyBackgroundFromSettings();
    if (saveSettingsFlag) {
        saveSettings();
    }
    return true;
}

function attachBackgroundToData(data) {
    if (!data || typeof data !== 'object') return data;
    const normalized = normalizeBackgroundSettings(appSettings.background);
    const isDataUrl = typeof normalized.image === 'string' && normalized.image.startsWith('data:');
    const shouldStripImage = normalized.mode === 'cloud' || (isRemoteMode(appSettings.storageMode) && isDataUrl);
    const backgroundForData = shouldStripImage ? { ...normalized, image: '' } : normalized;
    data.background = backgroundForData;
    return data;
}

function persistBackgroundChange() {
    attachBackgroundToData(appData);
    saveData({ notifyOnError: true });
}

function getWebdavBaseUrl(endpoint = '') {
    if (!endpoint) return '';
    try {
        const urlObj = new URL(endpoint);
        const segments = urlObj.pathname.split('/');
        segments.pop();
        urlObj.pathname = segments.join('/') + (segments.length ? '/' : '');
        urlObj.search = '';
        urlObj.hash = '';
        return urlObj.toString();
    } catch (error) {
        const lastSlash = endpoint.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return endpoint.slice(0, lastSlash + 1);
    }
}

function buildWebdavBackgroundUrl(fileName) {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    const base = getWebdavBaseUrl(cfg.endpoint);
    if (!base) return '';
    const encoded = encodeURIComponent(fileName || DEFAULT_BACKGROUND.cloud.fileName);
    return base.endsWith('/') ? `${base}${encoded}` : `${base}/${encoded}`;
}

async function fetchWebdavBackgroundFile(preferredName, { metadataOnly = false, cacheHeaders = {} } = {}) {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    if (!cfg.endpoint) return null;
    // 防止配置不完整导致浏览器原生弹窗
    if (!cfg.username && !cfg.password) {
        return null;
    }
    const base = getWebdavBaseUrl(cfg.endpoint);
    if (!base) return null;
    const candidates = buildBackgroundCandidates(preferredName);
    for (const name of candidates) {
        const remoteUrl = base.endsWith('/') ? `${base}${encodeURIComponent(name)}` : `${base}/${encodeURIComponent(name)}`;
        try {
            const headers = { ...buildWebdavHeaders(cfg, ''), ...cacheHeaders };
            const resp = await fetchWithTimeout(remoteUrl, {
                method: metadataOnly ? 'HEAD' : 'GET',
                headers,
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
            if (resp.status === 304) {
                return {
                    dataUrl: '',
                    fileName: name,
                    remoteUrl,
                    notModified: true
                };
            }
            if (!resp.ok) {
                // 部分 WebDAV 端可能不支持 HEAD，退回到 Range 请求以获取元数据
                if (metadataOnly && (resp.status === 405 || resp.status === 501)) {
                    const rangeResp = await fetchWithTimeout(remoteUrl, {
                        method: 'GET',
                        headers: { ...headers, Range: 'bytes=0-0' },
                        cache: 'no-store'
                    }, REMOTE_FETCH_TIMEOUT);
                    if (!rangeResp.ok) continue;
                    const lastModified = rangeResp.headers.get('last-modified') || '';
                    const etag = rangeResp.headers.get('etag') || '';
                    return {
                        dataUrl: '',
                        fileName: name,
                        remoteUrl,
                        etag,
                        lastModified,
                        updatedAt: parseHttpDateToTs(lastModified)
                    };
                }
                continue;
            }
            const lastModified = resp.headers.get('last-modified') || '';
            const etag = resp.headers.get('etag') || '';
            return {
                dataUrl: '',
                fileName: name,
                remoteUrl,
                etag,
                lastModified,
                updatedAt: parseHttpDateToTs(lastModified)
            };
        } catch (error) {
            console.warn('读取 WebDAV 背景失败', error);
        }
    }
    return null;
}

async function uploadWebdavBackground(imageDataUrl, uploadName, mimeType) {
    const cfg = normalizeWebdavConfig(appSettings.webdav);
    if (!cfg.endpoint) {
        throw new Error('未填写 WebDAV 文件地址');
    }
    const fileName = uploadName || buildBackgroundRemoteName('', mimeType);
    const remoteUrl = buildWebdavBackgroundUrl(fileName);
    if (!remoteUrl) {
        throw new Error('WebDAV 地址格式不正确');
    }
    const blob = dataUrlToBlob(imageDataUrl);
    if (!blob) {
        throw new Error('无法读取图片数据');
    }
    const response = await fetchWithTimeout(remoteUrl, {
        method: 'PUT',
        headers: buildWebdavHeaders(cfg, blob.type || 'application/octet-stream'),
        body: blob
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return { fileName, remoteUrl };
}

async function fetchGistBackgroundFile(preferredName) {
    const cfg = normalizeGistConfig(appSettings.gist);
    if (!cfg.token || !cfg.gistId) return null;
    const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
        method: 'GET',
        headers: buildGistHeaders(cfg.token),
        cache: 'no-store'
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const gist = await response.json();
    const files = gist?.files || {};
    const candidates = buildBackgroundCandidates(preferredName);
    const targetKey = candidates.find(name => files[name]);
    if (!targetKey) return null;
    const fileMeta = files[targetKey];
    if (!fileMeta?.raw_url) return null;

    // 直接使用 raw_url，避免将大图转为 base64 占用存储
    return {
        dataUrl: '',
        fileName: targetKey,
        remoteUrl: fileMeta.raw_url,
        etag: (gist?.history && gist.history[0]?.version) || '',
        lastModified: fileMeta.updated_at || gist?.updated_at || '',
        updatedAt: parseHttpDateToTs(fileMeta.updated_at || gist?.updated_at)
    };
}

async function uploadGistBackground(imageDataUrl, uploadName, mimeType) {
    const cfg = normalizeGistConfig(appSettings.gist);
    if (!cfg.token) {
        throw new Error('未填写 Gist Token');
    }
    if (!cfg.gistId) {
        throw new Error('未填写 Gist ID');
    }
    
    // 性能提示：Gist将Base64作为文本存储，大图片会导致：
    // 1. 体积增加约33%（Base64编码开销）
    // 2. 同步速度慢（需传输整个文本）
    // 3. 加载解码慢（浏览器需解析Base64字符串）
    // 建议：图片<5MB，或使用图床+URL模式
    const sizeMB = (imageDataUrl.length / 1024 / 1024).toFixed(2);
    if (imageDataUrl.length > 5 * 1024 * 1024) {
        console.warn(`⚠️ Gist背景图片较大(${sizeMB}MB)，可能导致同步缓慢。建议使用图床服务。`);
    }
    
    const fileName = uploadName || buildBackgroundRemoteName('', mimeType);
    const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
        method: 'PATCH',
        headers: buildGistHeaders(cfg.token),
        body: JSON.stringify({
            files: {
                [fileName]: { content: imageDataUrl }
            }
        })
    }, REMOTE_FETCH_TIMEOUT);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const gist = await response.json();
    const remoteUrl = gist?.files?.[fileName]?.raw_url || '';
    return { fileName, remoteUrl };
}

async function uploadCloudBackground(imageDataUrl, uploadName, mimeType) {
    const storageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    if (storageMode === STORAGE_MODES.WEBDAV) {
        return uploadWebdavBackground(imageDataUrl, uploadName, mimeType);
    }
    if (storageMode === STORAGE_MODES.GIST) {
        return uploadGistBackground(imageDataUrl, uploadName, mimeType);
    }
    throw new Error('当前存储模式不支持云端背景');
}

async function cleanupOldCloudBackgroundFiles(newFileName, previousFileName, storageMode) {
    const mode = storageMode || getEffectiveStorageMode();
    if (!isRemoteMode(mode)) return;
    const cleanNew = (newFileName || '').trim();

    if (mode === STORAGE_MODES.WEBDAV) {
        const cfg = normalizeWebdavConfig(appSettings.webdav);
        const base = getWebdavBaseUrl(cfg.endpoint);
        if (!cfg.endpoint || !base) return;
        
        // 删除所有可能的旧背景文件（所有格式变体）
        const targets = buildBackgroundCandidates(cleanNew).filter(name => name && name !== cleanNew);
        if (previousFileName && previousFileName !== cleanNew && !targets.includes(previousFileName)) {
            targets.unshift(previousFileName);
        }
        
        for (const name of targets) {
            const remoteUrl = base.endsWith('/') ? `${base}${encodeURIComponent(name)}` : `${base}/${encodeURIComponent(name)}`;
            try {
                await fetchWithTimeout(remoteUrl, {
                    method: 'DELETE',
                    headers: buildWebdavHeaders(cfg, ''),
                    cache: 'no-store'
                }, REMOTE_FETCH_TIMEOUT);
            } catch (error) {
                console.warn('清理旧 WebDAV 背景失败', name, error);
            }
        }
        return;
    }
    
    if (mode === STORAGE_MODES.GIST) {
        const cfg = normalizeGistConfig(appSettings.gist);
        if (!cfg.token || !cfg.gistId) return;
        
        try {
            // 先获取 Gist 的所有文件列表
            const response = await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
                method: 'GET',
                headers: buildGistHeaders(cfg.token),
                cache: 'no-store'
            }, REMOTE_FETCH_TIMEOUT);
            
            if (!response.ok) {
                console.warn('获取 Gist 文件列表失败', response.status);
                return;
            }
            
            const gist = await response.json();
            const existingFiles = gist?.files || {};
            
            // 找出所有需要删除的背景图文件
            const filesToDelete = {};
            Object.keys(existingFiles).forEach(fileName => {
                // 匹配 background.* 格式的文件，但排除新上传的文件
                if (fileName.startsWith('background.') && fileName !== cleanNew) {
                    filesToDelete[fileName] = null; // null 表示删除
                }
            });
            
            // 如果有旧文件需要删除，执行删除操作
            if (Object.keys(filesToDelete).length > 0) {
                await fetchWithTimeout(`https://api.github.com/gists/${cfg.gistId}`, {
                    method: 'PATCH',
                    headers: buildGistHeaders(cfg.token),
                    body: JSON.stringify({ files: filesToDelete })
                }, REMOTE_FETCH_TIMEOUT);
                console.log('已清理旧 Gist 背景文件:', Object.keys(filesToDelete));
            }
        } catch (error) {
            console.warn('清理旧 Gist 背景失败', error);
        }
    }
}

async function refreshCloudBackgroundFromRemote({ notifyWhenMissing = false } = {}) {
    const background = normalizeBackgroundSettings(appSettings.background);
    if (background.mode !== 'cloud') return false;
    const storageMode = getEffectiveStorageMode();
    if (!isRemoteMode(storageMode)) {
        if (notifyWhenMissing) {
            alert('云端背景需要先配置 WebDAV 或 Gist。');
        }
        return false;
    }
    try {
        const cacheHeaders = buildBackgroundConditionalHeaders(background.cloud);
        let result = null;
        if (storageMode === STORAGE_MODES.WEBDAV) {
            result = await fetchWebdavBackgroundFile(background.cloud.fileName, { metadataOnly: true, cacheHeaders });
        } else if (storageMode === STORAGE_MODES.GIST) {
            result = await fetchGistBackgroundFile(background.cloud.fileName);
        }
        if (!result) {
            if (notifyWhenMissing) {
                alert('未在云端找到 background 图片，请上传。');
            }
            return false;
        }

        const prevCloud = background.cloud || {};
        const prevUrl = stripCacheBust(prevCloud.downloadUrl || '');
        const cleanRemoteUrl = stripCacheBust(result.remoteUrl || prevUrl);
        const nextCloud = {
            ...prevCloud,
            fileName: result.fileName || prevCloud.fileName,
            downloadUrl: cleanRemoteUrl || prevUrl,
            etag: prevCloud.etag || '',
            lastModified: prevCloud.lastModified || '',
            updatedAt: Number.isFinite(prevCloud.updatedAt) ? prevCloud.updatedAt : 0
        };

        if (!result.notModified) {
            if (result.etag) nextCloud.etag = result.etag;
            if (result.lastModified) nextCloud.lastModified = result.lastModified;
            const remoteTs = Number.isFinite(result.updatedAt) ? result.updatedAt : parseHttpDateToTs(result.lastModified);
            if (Number.isFinite(remoteTs) && remoteTs > 0) {
                nextCloud.updatedAt = remoteTs;
            } else {
                nextCloud.updatedAt = Date.now();
            }
        }

        const urlChanged = prevUrl !== cleanRemoteUrl;
        const prevToken = getBackgroundVersionToken(prevCloud);
        const nextToken = getBackgroundVersionToken(nextCloud);
        const fileChanged = (result.fileName || prevCloud.fileName || '') !== (prevCloud.fileName || '');
        const shouldPersist = urlChanged || (!result.notModified && nextToken !== prevToken) || (!prevUrl && cleanRemoteUrl) || fileChanged;

        if (shouldPersist) {
            appSettings.background = normalizeBackgroundSettings({
                ...background,
                cloud: nextCloud,
                image: '' // 云端模式只使用远端 URL，避免大图写入本地存储
            });
            saveSettings();
            applyBackgroundFromSettings();
        }
        updateBackgroundControlsUI();
        return true;
    } catch (error) {
        console.warn('刷新云端背景失败', error);
        if (notifyWhenMissing) {
            alert(`云端背景读取失败：${error.message}`);
        }
        return false;
    }
}

async function handleBackgroundSourceChange() {
    const selected = Array.from(els.backgroundSourceRadios || []).find(r => r.checked);
    const mode = selected ? selected.value : 'local';
    const normalizedMode = mode === 'cloud' ? 'cloud' : 'local';
    const prevMode = appSettings.background?.mode;
    // 允许重复点击同一模式时重新执行逻辑，避免需要先切回本地再切回云端
    if (normalizedMode === 'cloud' && !isRemoteBackgroundReady()) {
        alert('云端背景需要先配置 WebDAV 或 Gist。');
        Array.from(els.backgroundSourceRadios || []).forEach(radio => {
            radio.checked = radio.value === 'local';
        });
        return;
    }
    let nextBg = normalizeBackgroundSettings({
        ...appSettings.background,
        mode: normalizedMode
    });
    if (normalizedMode === 'cloud') {
        nextBg = normalizeBackgroundSettings({
            ...nextBg,
            image: '',
            cloud: {
                ...nextBg.cloud,
                downloadUrl: '',
                updatedAt: 0,
                etag: '',
                lastModified: ''
            }
        });
    }
    clearCloudBackgroundRuntime();
    appSettings.background = nextBg;
    saveSettings();
    applyBackgroundFromSettings();
    updateBackgroundControlsUI();
    if (normalizedMode === 'cloud') {
        refreshCloudBackgroundFromRemote({ notifyWhenMissing: true });
    }
    persistBackgroundChange();
}

function updateBackgroundControlsUI() {
    const background = normalizeBackgroundSettings(appSettings.background);
    const storageMode = getEffectiveStorageMode();
    const remoteReady = isRemoteBackgroundReady();
    appSettings.background = background;

    const isRemoteStorage = remoteReady;
    const isCloudMode = background.mode === 'cloud';
    const opacityPercent = Math.round(background.opacity * 100);
    if (els.backgroundOpacity) {
        els.backgroundOpacity.value = opacityPercent;
    }
    if (els.backgroundOpacityValue) {
        els.backgroundOpacityValue.textContent = `${opacityPercent}%`;
    }

    // 背景来源单选
    if (els.backgroundSourceRadios) {
        Array.from(els.backgroundSourceRadios).forEach(radio => {
            radio.checked = radio.value === (isCloudMode ? 'cloud' : 'local');
        });
    }
    if (els.bgSourceTip) {
        if (isCloudMode) {
            const modeName = storageMode === STORAGE_MODES.WEBDAV ? 'WebDAV' : (storageMode === STORAGE_MODES.GIST ? 'Gist' : '云端');
            els.bgSourceTip.textContent = `云端同步：在 ${modeName} 的数据文件同目录查找/保存 background 图片，可在多设备共用。`;
        } else {
            els.bgSourceTip.textContent = '本地：仅保存在此设备的浏览器中，不会推送到云端数据文件。';
        }
    }
    
    toggleSettingsSection(els.bgLocalSection, !isCloudMode);
    toggleSettingsSection(els.bgCloudSection, isCloudMode);
    
    // 判断背景类型：base64, sync URL, 或 local URL
    const displayUrl = buildBackgroundDisplayUrl(background);
    const runtimeCloudUrl = isCloudMode ? (cloudBackgroundRuntime.url || '') : '';
    let actualImageUrl = isCloudMode ? (runtimeCloudUrl || displayUrl) : displayUrl;
    let isSyncUrl = false;
    let isLocalUrl = false;
    
    if (!isCloudMode && background.image) {
        if (background.image.startsWith('sync:')) {
            isSyncUrl = true;
            actualImageUrl = background.image.substring(5); // 移除 "sync:" 前缀
        } else if (!background.image.startsWith('data:')) {
            isLocalUrl = true;
            actualImageUrl = background.image;
        } else {
            actualImageUrl = displayUrl;
        }
    }
    
    const isUrl = isSyncUrl || isLocalUrl;
    const hasAnyImage = !!actualImageUrl;
    
    if (els.cloudBgStatus) {
        const cloudFile = background.cloud.fileName || 'background';
        if (!isRemoteStorage) {
            els.cloudBgStatus.textContent = '云端背景需先配置 WebDAV 或 Gist。';
        } else if (hasAnyImage) {
            els.cloudBgStatus.textContent = `已加载云端背景（${cloudFile}），可点击“上传/修改”替换。`;
        } else {
            els.cloudBgStatus.textContent = `未在云端找到 ${cloudFile}.*，请上传或点击“刷新云端”。`;
        }
    }
    if (els.cloudRefreshBtn) {
        els.cloudRefreshBtn.disabled = !isCloudMode || !isRemoteStorage;
    }
    if (els.cloudUploadBtn) {
        els.cloudUploadBtn.disabled = !isCloudMode || !isRemoteStorage;
    }
    
    if (els.backgroundUrlInput) {
        if (isCloudMode) {
            els.backgroundUrlInput.value = '';
            els.backgroundUrlInput.disabled = true;
            els.backgroundUrlInput.placeholder = '云端模式：请用“本地上传”选择图片并同步';
        } else {
            els.backgroundUrlInput.disabled = false;
            els.backgroundUrlInput.placeholder = 'https://example.com/background.jpg';
            els.backgroundUrlInput.value = isUrl ? actualImageUrl : '';
        }
    }
    
    // 更新提示信息
    const urlModeTip = document.getElementById('urlModeTip');
    if (urlModeTip) {
        if (isCloudMode) {
            urlModeTip.textContent = '云端模式使用单独的 background 图片文件，同步前请上传图片。';
        } else {
            urlModeTip.textContent = '推荐 4K 用户使用图床链接（如 Imgur、SM.MS、GitHub），无大小限制。';
        }
    }
    
    // 更新状态标签
    if (els.bgStatusTag) {
        if (isCloudMode) {
            if (!isRemoteStorage) {
                els.bgStatusTag.textContent = '⚠️ 云端未配置';
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '请先在下方配置 WebDAV 或 Gist 后再使用云端背景';
            } else if (!hasAnyImage) {
                els.bgStatusTag.textContent = '☁️ 等待上传';
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '未在云端找到 background 图片，请上传并同步';
            } else {
                const modeName = storageMode === STORAGE_MODES.WEBDAV ? 'WebDAV' : 'Gist';
                els.bgStatusTag.textContent = `☁️ 云端背景（${modeName}）`;
                els.bgStatusTag.className = 'bg-tag accent';
                els.bgStatusTag.title = '已从云端读取 background 图片，可重新上传替换';
            }
        } else {
            const isRemote = isRemoteMode(storageMode);
            if (!background.image) {
                els.bgStatusTag.textContent = '🖼️ 未设置背景';
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '点击"设置背景"按钮添加背景图片';
            } else if (isLocalUrl) {
                els.bgStatusTag.textContent = '🔗 外部链接（仅本地）';
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '使用外部图片链接，不占用存储空间，仅在本设备有效';
            } else if (isSyncUrl) {
                const modeName = isRemote 
                    ? (storageMode === STORAGE_MODES.WEBDAV ? 'WebDAV' : 'Gist')
                    : '云端';
                els.bgStatusTag.textContent = `🔗 外部链接（已同步）`;
                els.bgStatusTag.className = 'bg-tag accent';
                els.bgStatusTag.title = `图片链接已保存到 ${modeName}，所有设备共享此背景`;
            } else if (isRemote) {
                const modeName = storageMode === STORAGE_MODES.WEBDAV ? 'WebDAV' : 'Gist';
                els.bgStatusTag.textContent = `📦 本地私有（不随数据推送到 ${modeName}）`;
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '背景保存在本机设置中，需要同步请切换到云端模式';
            } else {
                els.bgStatusTag.textContent = '📦 本地私有';
                els.bgStatusTag.className = 'bg-tag';
                els.bgStatusTag.title = '背景图片存储在本地浏览器中，可导出或切换到云端同步';
            }
        }
    }
    
    // 切换到对应的模式标签
    if (els.bgModeTabs && els.bgModePanels) {
        const targetMode = (!isCloudMode && isUrl) ? 'url' : 'upload';
        Array.from(els.bgModeTabs).forEach(t => {
            const isUrlTab = t.dataset.mode === 'url';
            t.classList.toggle('active', t.dataset.mode === targetMode);
            t.disabled = isCloudMode && isUrlTab;
        });
        Array.from(els.bgModePanels).forEach(p => p.classList.toggle('hidden', p.dataset.mode !== targetMode));
    }
    
    if (els.backgroundPreview) {
        const hasImage = !!actualImageUrl;
        els.backgroundPreview.classList.toggle('has-image', hasImage);
        const previewUrl = actualImageUrl;
        els.backgroundPreview.style.backgroundImage = hasImage ? `url(${previewUrl})` : 'none';
        els.backgroundPreview.style.setProperty('--bg-preview-opacity', background.opacity);
    }
    if (els.clearBackgroundBtn) {
        els.clearBackgroundBtn.disabled = !hasAnyImage;
    }
    if (isCloudMode && remoteReady && !hasAnyImage) {
        refreshCloudBackgroundFromRemote({ notifyWhenMissing: false });
    }
}

function handleBackgroundOpacityInput(event) {
    const slider = event?.target || els.backgroundOpacity;
    if (!slider) return;
    const raw = parseInt(slider.value, 10);
    const opacity = clamp01(raw / 100, appSettings.background?.opacity);
    appSettings.background = normalizeBackgroundSettings({
        ...appSettings.background,
        opacity
    });
    saveSettings();
    applyBackgroundFromSettings();
    updateBackgroundControlsUI();
}

async function handleBackgroundImageChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
        alert('请选择图片文件。');
        event.target.value = '';
        return;
    }
    
    const storageMode = getEffectiveStorageMode();
    const isRemote = isRemoteMode(storageMode);
    const isCloudMode = (appSettings.background?.mode === 'cloud');
    if (isCloudMode && !isRemote) {
        alert('云端同步背景需要先配置 WebDAV 或 Gist。');
        event.target.value = '';
        return;
    }
    
    // 根据存储模式设置不同的大小限制
    // 浏览器本地存储：2MB（压缩后约2.66MB，考虑其他设置数据）
    // WebDAV：无限制（WebDAV支持二进制，服务器自行控制大小）
    // Gist：4MB（Base64 文本有体积膨胀，控制在安全上限内）
    const isGist = storageMode === STORAGE_MODES.GIST;
    const isWebDAV = storageMode === STORAGE_MODES.WEBDAV;
    const MAX_SIZE = isGist ? 4 * 1024 * 1024 : (isWebDAV ? Infinity : (isRemote ? Infinity : 2 * 1024 * 1024));
    const MAX_COMPRESSED_SIZE = isGist ? 4 * 1024 * 1024 : (isWebDAV ? Infinity : (isRemote ? Infinity : 3 * 1024 * 1024));
    const MAX_RESOLUTION = isRemote ? 3840 : 1920; // 4K 分辨率支持（3840x2160）
    
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    const limitMB = Number.isFinite(MAX_SIZE) ? (MAX_SIZE / 1024 / 1024).toFixed(0) : '∞';
    
    if (file.size > MAX_SIZE) {
        let storageTip;
        if (isGist) {
            storageTip = `当前使用 Gist 存储（图片将转为Base64文本，体积增加约33%）\n⚠️ 大图片会导致同步和加载缓慢，建议使用图床+URL模式`;
        } else if (isWebDAV) {
            // WebDAV 无大小限制，不会进入此分支
            storageTip = `当前使用 WebDAV 存储`;
        } else if (isRemote) {
            storageTip = `当前使用云端存储`;
        } else {
            storageTip = '建议使用 WebDAV 存储以支持更大的图片（无大小限制）';
        }
        
        if (!confirm(`图片文件较大（${sizeMB}MB > ${limitMB}MB）\n${storageTip}\n\n是否尝试压缩到 ${MAX_RESOLUTION}px 并使用？`)) {
            event.target.value = '';
            return;
        }
    }
    
    try {
        let imageDataUrl;
        
        // 如果图片较大，尝试压缩
        if (isGist) {
            // Gist 模式：统一压缩/转码，确保请求体不会超限
            imageDataUrl = await encodeImageForGist(file);
        } else if (file.size > MAX_SIZE) {
            // WebDAV无限制，不压缩；其他远端/本地按需压缩
            const targetSizeMB = isWebDAV ? Infinity : (isRemote ? 8 : 1.5);
            imageDataUrl = await compressImage(file, { 
                maxSizeMB: targetSizeMB, 
                maxWidthOrHeight: MAX_RESOLUTION 
            });
        } else {
            imageDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }
        
        // 检查压缩后的大小（Base64编码后的实际大小）
        const estimatedSize = imageDataUrl.length;
        if (estimatedSize > MAX_COMPRESSED_SIZE) {
            let suggestion;
            if (isGist) {
                suggestion = '💡 Gist不适合存储大图片（Base64编码导致体积膨胀）\n推荐方案：\n1. 使用图床服务（如 imgur.com）并用"图片链接"模式\n2. 切换到 WebDAV 存储（支持二进制，更高效，无大小限制）';
            } else if (isWebDAV) {
                // WebDAV 无限制，不会进入此分支
                suggestion = '如需更大的图片，建议使用"图片链接"模式';
            } else if (isRemote) {
                suggestion = '请使用"图片链接"模式引用外部图床';
            } else {
                suggestion = '请切换到 WebDAV 存储（无大小限制），或使用"图片链接"模式';
            }
            alert(`图片压缩后仍然过大（${(estimatedSize / 1024 / 1024).toFixed(2)}MB）\n\n${suggestion}`);
            event.target.value = '';
            return;
        }

        if (isCloudMode) {
            try {
                const mimeType = file.type || inferMimeFromDataUrl(imageDataUrl);
                const uploadName = buildBackgroundRemoteName(file.name, mimeType);
                const prevCloudFile = appSettings.background?.cloud?.fileName;
                const uploadResult = await uploadCloudBackground(imageDataUrl, uploadName, mimeType);
                appSettings.background = normalizeBackgroundSettings({
                    ...appSettings.background,
                    mode: 'cloud',
                    image: '',
                    cloud: {
                        ...appSettings.background.cloud,
                        fileName: uploadResult?.fileName || uploadName,
                        downloadUrl: stripCacheBust(uploadResult?.remoteUrl || appSettings.background.cloud.downloadUrl),
                        updatedAt: Date.now(),
                        etag: '',
                        lastModified: ''
                    }
                });
                const saveOk = await saveSettingsWithValidation();
                if (!saveOk) {
                    alert('保存失败：存储空间不足或本地存储受限');
                    appSettings.background.image = '';
                    event.target.value = '';
                    return;
                }
                await cleanupOldCloudBackgroundFiles(uploadResult?.fileName || uploadName, prevCloudFile, storageMode);
                applyBackgroundFromSettings();
                updateBackgroundControlsUI();
                persistBackgroundChange();
                alert('云端背景已上传并生效。');
            } catch (error) {
                console.error('处理云端背景失败:', error);
                alert(`云端背景上传失败：${error.message}`);
            }
            event.target.value = '';
            return;
        }
        
        appSettings.background = normalizeBackgroundSettings({
            ...appSettings.background,
            image: imageDataUrl
        });
        
        // 保存并检查是否成功
        const saveSuccess = await saveSettingsWithValidation();
        if (!saveSuccess) {
            const suggestion = isRemote 
                ? '可能是网络问题或服务端限制' 
                : '建议切换到 WebDAV/Gist 存储';
            alert(`保存失败：存储空间不足\n${suggestion}`);
            appSettings.background.image = '';
            event.target.value = '';
            return;
        }
        
        applyBackgroundFromSettings();
        updateBackgroundControlsUI();
        persistBackgroundChange();
    } catch (error) {
        console.error('处理图片失败:', error);
        alert('读取图片失败，请重试。');
    }
    
    event.target.value = '';
}

async function compressImage(file, options = {}) {
    const { maxSizeMB = 4, maxWidthOrHeight = 3840, quality = 0.95 } = options;
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // 计算缩放比例
                if (width > maxWidthOrHeight || height > maxWidthOrHeight) {
                    if (width > height) {
                        height = (height / width) * maxWidthOrHeight;
                        width = maxWidthOrHeight;
                    } else {
                        width = (width / height) * maxWidthOrHeight;
                        height = maxWidthOrHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 尝试不同的质量级别，直到满足大小要求
                let currentQuality = quality;
                let result = canvas.toDataURL('image/jpeg', currentQuality);
                
                // 如果仍然太大，继续降低质量
                while (result.length > maxSizeMB * 1024 * 1024 && currentQuality > 0.3) {
                    currentQuality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', currentQuality);
                }
                
                resolve(result);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --- Gist 专用图片压缩/编码（PNG/JPG 统一走 JPEG 压缩，确保大小可控） ---
const GIST_IMAGE_MAX_BYTES = 4096 * 1024; // 约 4MB 上限，避免请求体过大
const GIST_IMAGE_MAX_WIDTH = 3840; // 与 4K 接近的宽度上限，等比缩放
const GIST_JPEG_INITIAL_QUALITY = 0.8;

function estimateBytesFromDataUrl(dataUrl = '') {
    if (!dataUrl) return 0;
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
    return Math.floor(base64.length * 3 / 4);
}

async function loadImageBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        return createImageBitmap(file);
    }
    // 兼容不支持 createImageBitmap 的环境
    const dataUrl = await blobToDataURL(file);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
    });
}

async function compressImageToJpegDataUrl(file, options = {}) {
    const {
        maxBytes = GIST_IMAGE_MAX_BYTES,
        maxWidth = GIST_IMAGE_MAX_WIDTH,
        initialQuality = GIST_JPEG_INITIAL_QUALITY,
        minQuality = 0.4,
        qualityStep = 0.1
    } = options;

    const bitmap = await loadImageBitmap(file);
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > maxWidth) {
        const scale = maxWidth / width;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = initialQuality;
    let lastDataUrl = '';
    while (quality >= minQuality) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        lastDataUrl = dataUrl;
        if (estimateBytesFromDataUrl(dataUrl) <= maxBytes) {
            return dataUrl;
        }
        quality = Number((quality - qualityStep).toFixed(2));
    }
    return lastDataUrl;
}

async function encodeImageForGist(file) {
    // 小文件直接转 DataURL，避免额外压缩损失
    if (file.size <= GIST_IMAGE_MAX_BYTES) {
        return blobToDataURL(file);
    }

    const compressed = await compressImageToJpegDataUrl(file, {
        maxBytes: GIST_IMAGE_MAX_BYTES,
        maxWidth: GIST_IMAGE_MAX_WIDTH,
        initialQuality: GIST_JPEG_INITIAL_QUALITY,
        minQuality: 0.4,
        qualityStep: 0.1
    });

    if (estimateBytesFromDataUrl(compressed) > GIST_IMAGE_MAX_BYTES) {
        throw new Error('图片压缩后仍然过大，无法同步到 Gist，请裁剪或降低分辨率后重试。');
    }
    return compressed;
}

function saveSettingsWithValidation() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: appSettings }, () => {
            if (chrome.runtime.lastError) {
                console.error('保存设置失败:', chrome.runtime.lastError);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

function handleBackgroundUrlChange() {
    if (!els.backgroundUrlInput) return;
    const url = els.backgroundUrlInput.value.trim();
    const background = normalizeBackgroundSettings(appSettings.background);
    if (background.mode === 'cloud') {
        alert('云端同步背景仅支持上传图片，请使用“本地上传”后同步到云端。');
        els.backgroundUrlInput.value = '';
        return;
    }
    
    if (!url) {
        clearBackgroundImage();
        return;
    }
    
    // 简单的 URL 格式验证
    try {
        new URL(url);
    } catch (e) {
        alert('请输入有效的图片链接地址');
        return;
    }
    
    appSettings.background = normalizeBackgroundSettings({
        ...appSettings.background,
        image: url
    });
    saveSettings();
    applyBackgroundFromSettings();
    updateBackgroundControlsUI();
}

function clearBackgroundImage() {
    clearCloudBackgroundRuntime();
    appSettings.background = normalizeBackgroundSettings({
        ...appSettings.background,
        image: '',
        cloud: {
            ...appSettings.background.cloud,
            downloadUrl: '',
            updatedAt: 0,
            etag: '',
            lastModified: ''
        }
    });
    if (els.backgroundImageInput) {
        els.backgroundImageInput.value = '';
    }
    if (els.backgroundUrlInput) {
        els.backgroundUrlInput.value = '';
    }
    saveSettings();
    applyBackgroundFromSettings();
    updateBackgroundControlsUI();
    persistBackgroundChange();
}

function bindBackgroundControls() {
    if (els.toggleBgSettingsBtn && els.bgSettingsPanel) {
        els.toggleBgSettingsBtn.addEventListener('click', () => {
            const isHidden = els.bgSettingsPanel.classList.contains('hidden');
            els.bgSettingsPanel.classList.toggle('hidden', !isHidden);
            els.toggleBgSettingsBtn.textContent = isHidden ? '收起设置' : '设置背景';
        });
    }
    if (els.backgroundImageInput) {
        els.backgroundImageInput.addEventListener('change', handleBackgroundImageChange);
    }
    if (els.backgroundSourceRadios) {
        Array.from(els.backgroundSourceRadios).forEach(radio => {
            radio.addEventListener('change', () => {
                handleBackgroundSourceChange();
            });
        });
    }
    if (els.cloudRefreshBtn) {
        els.cloudRefreshBtn.addEventListener('click', async () => {
            await refreshCloudBackgroundFromRemote({ notifyWhenMissing: true });
            updateBackgroundControlsUI();
        });
    }
    if (els.cloudUploadBtn) {
        els.cloudUploadBtn.addEventListener('click', () => {
            const bg = normalizeBackgroundSettings(appSettings.background);
            if (bg.mode !== 'cloud') {
                alert('请先选择“云端同步”作为背景来源。');
                return;
            }
            if (!isRemoteMode(appSettings.storageMode)) {
                alert('云端背景需要先配置 WebDAV 或 Gist。');
                return;
            }
            if (els.backgroundImageInput) {
                els.backgroundImageInput.click();
            }
        });
    }
    if (els.backgroundOpacity) {
        els.backgroundOpacity.addEventListener('input', handleBackgroundOpacityInput);
        els.backgroundOpacity.addEventListener('change', (e) => {
            handleBackgroundOpacityInput(e);
            persistBackgroundChange();
        });
    }
    if (els.clearBackgroundBtn) {
        els.clearBackgroundBtn.addEventListener('click', () => {
            clearBackgroundImage();
        });
    }
    
    // 背景模式切换
    if (els.bgModeTabs && els.bgModePanels) {
        Array.from(els.bgModeTabs).forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                const bg = normalizeBackgroundSettings(appSettings.background);
                if (bg.mode === 'cloud' && mode === 'url') {
                    alert('云端背景仅支持上传文件后同步，不支持直接填写图片链接。');
                    updateBackgroundControlsUI();
                    return;
                }
                Array.from(els.bgModeTabs).forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
                Array.from(els.bgModePanels).forEach(p => p.classList.toggle('hidden', p.dataset.mode !== mode));
            });
        });
    }
    
    // URL 输入框变化
    if (els.backgroundUrlInput) {
        els.backgroundUrlInput.addEventListener('blur', handleBackgroundUrlChange);
        els.backgroundUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleBackgroundUrlChange();
            }
        });
    }
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
    updateBackgroundControlsUI();
}

function syncSettingsFromUI() {
    const selectedBgSource = Array.from(els.backgroundSourceRadios || []).find(r => r.checked);
    const bgMode = selectedBgSource ? selectedBgSource.value : appSettings.background?.mode;
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
        },
        background: normalizeBackgroundSettings({
            ...appSettings.background,
            mode: bgMode === 'cloud' ? 'cloud' : 'local',
            opacity: els.backgroundOpacity ? parseInt(els.backgroundOpacity.value, 10) / 100 : appSettings.background?.opacity,
            image: appSettings.background?.image
        })
    });
    applyBackgroundFromSettings();
    updateBackgroundControlsUI();
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

        // 如果背景选择了云端或已是云端模式，自动同步 UI 状态并尝试拉取背景
        const bgRadio = Array.from(els.backgroundSourceRadios || []).find(r => r.checked);
        const wantsCloud = (bgRadio && bgRadio.value === 'cloud') || appSettings.background?.mode === 'cloud';
        if (wantsCloud && isRemoteBackgroundReady()) {
            appSettings.background = normalizeBackgroundSettings({
                ...appSettings.background,
                mode: 'cloud',
                image: ''
            });
            saveSettings();
            applyBackgroundFromSettings();
            updateBackgroundControlsUI();
            refreshCloudBackgroundFromRemote({ notifyWhenMissing: false });
        }
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
    bindBackgroundControls();
    // 搜索
    if (els.searchEngineSelect) {
        els.searchEngineSelect.addEventListener('change', () => {
            appSettings.searchEngine = els.searchEngineSelect.value;
            saveSettings();
            updateSearchPlaceholder(appSettings.searchEngine);
        });
    }

    els.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = els.searchInput.value;
            if (query) {
                const engine = appSettings.searchEngine || 'google';
                let url = '';
                switch (engine) {
                    case 'bing':
                        url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
                        break;
                    case 'baidu':
                        url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
                        break;
                    case 'yahoo':
                        url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
                        break;
                    case 'google':
                    default:
                        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                        break;
                }
                window.location.href = url;
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
                    const parentCard = findBookmarkCardElement(loc.parentFolderId);
                    if (document.startViewTransition) {
                        document.startViewTransition(() => {
                            openFolderModal(loc.parentFolderId, { anchorElement: parentCard });
                        });
                    } else {
                        openFolderModal(loc.parentFolderId, { anchorElement: parentCard });
                    }
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
        animateModalVisibility(els.categoryModal, { open: true });
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
                        const parentAnchor = findBookmarkCardElement(loc.parentFolderId);
                        openFolderModal(loc.parentFolderId, { anchorElement: parentAnchor });
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
                    const parentAnchor = findBookmarkCardElement(loc.parentFolderId);
                    openFolderModal(loc.parentFolderId, { anchorElement: parentAnchor });
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
