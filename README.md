# My Local New Tab

<div align="center">

**一个简洁、本地化、功能丰富的浏览器新标签页扩展**

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Chrome Extension Manifest](https://img.shields.io/badge/manifest-v3-brightgreen.svg)](manifest.json)

[English](#english) | [简体中文](#简体中文)

</div>

## 📦 更新日志

|  版本  |  日期   | 更新内容                                                       |
| :----: | :-----: | :------------------------------------------------------------- |
| v1.5.3 | 2025-12 | 可修改标签的透明度 |
| v1.5.2 | 2025-12 | 限制 gist 图片大小，提供压缩，确保 gist 同步时能正常显示背景图 |
| v1.5.1 | 2025-12 | 新建标签页时默认显示第一个分类                                 |
|  v1.5  |    -    | 完成所有预期功能                                               |
|  v1.0  |    -    | 完成基本框架搭建                                               |

---

## 简体中文

### 免责声明

本项目代码 100%由 ai 编写，感谢 Claude Sonnet 4.5，Gemini3 Pro，gpt-5.1-Codex-Max 的大力支持

### 📋 目录

-   [功能特性](#-功能特性)
-   [快速开始](#-快速开始)
-   [详细功能说明](#-详细功能说明)
-   [关键常量配置](#-关键常量配置)
-   [数据同步](#-数据同步)
-   [开发指南](#-开发指南)
-   [常见问题](#-常见问题)
-   [许可证](#-许可证)
-   [联系方式](#-联系方式)

---

### ✨ 功能特性

#### 🎯 核心功能

-   **📑 智能书签管理**

    -   支持书签和文件夹两种类型
    -   拖拽排序，长按即可拖动
    -   支持文件夹嵌套，拖拽到文件夹即可收纳
    -   书签卡片支持自定义图标（Favicon 自动获取/自定义上传/纯色+文字）
    -   多级图标降级策略，确保显示稳定

-   **🗂️ 分类系统**

    -   无限分类，侧边栏管理
    -   分类支持拖拽排序
    -   每个分类独立管理书签

-   **🔍 多引擎搜索**

    -   支持 Google、Bing、百度、Yahoo
    -   快速切换搜索引擎
    -   搜索框集成在顶部

-   **🎨 自定义背景**
    -   **本地模式**：上传本地图片或使用图片链接
    -   **云端模式**：从 WebDAV/Gist 自动同步背景图
    -   可调节透明度（0-100%）
    -   支持多种图片格式（jpg/png/webp/avif/gif）
    -   实时预览效果

#### 💾 数据存储与同步

支持四种存储方式，满足不同使用场景：

1. **浏览器存储**（默认）

    - 数据保存在扩展专属的 `storage.local`
    - 仅绑定当前设备/浏览器配置文件
    - 无容量限制，支持大量书签和大尺寸背景图
    - 物理路径：Edge 用户数据目录下的 `Local Extension Settings/<扩展ID>`

2. **账号同步**

    - 通过浏览器账号的 `chrome.storage.sync` 自动同步
    - 适合多设备共享
    - 受浏览器同步配额限制（约 100KB）

3. **WebDAV 同步**

    - 支持任何兼容 WebDAV 协议的服务（Nextcloud、坚果云等）
    - 需要可外网访问的 WebDAV 端点
    - 支持 HTTPS + 基础认证
    - 配置示例：`https://dav.example.com/remote.php/dav/files/<user>/edgeTab-data.json`

4. **GitHub Gist 同步**
    - 使用 GitHub Personal Access Token（需 `gist` 权限）
    - 可指定现有 Gist ID，或留空自动创建私有 Gist
    - 默认文件名 `edgeTab-data.json`，可自定义
    - Token 和 Gist ID 仅保存在本地

#### 📤 数据导入导出

-   **导出**：JSON 格式，可用于备份或迁移
-   **导入**：支持两种模式
    -   **合并模式**：在现有数据基础上追加（不重复网址）
    -   **覆盖模式**：完全替换当前数据
-   **兼容性**：支持本扩展和 WeTab 的数据格式导入

#### 🎭 用户体验

-   **主题**：自动跟随系统深色/浅色模式
-   **动画**：提供过渡动画和交互反馈
-   **拖拽**：
    -   书签卡片：长按激活拖拽（带视觉反馈）
    -   分类列表：长按激活拖拽
    -   支持跨文件夹拖动
    -   拖拽到文件夹卡片可自动收纳
    -   实时占位符提示
-   **图标缓存**：自动缓存网站图标，提升加载速度
-   **View Transitions API**：支持浏览器原生页面过渡动画

---

### 🚀 快速开始

#### 安装步骤

1. **下载项目**

    ```bash
    git clone https://github.com/everlst/MyLocalNewTab.git
    cd MyLocalNewTab
    ```

2. **加载扩展**

    - 打开 Edge/Chrome 浏览器
    - 访问 `edge://extensions/`（Edge）或 `chrome://extensions/`（Chrome）
    - 开启"开发者模式"
    - 点击"加载已解压的扩展程序"
    - 选择项目文件夹 `MyLocalNewTab`

3. **开始使用**
    - 打开新标签页，扩展会自动生效
    - 默认包含 Google、Bilibili、GitHub 三个示例书签

---

### 📖 详细功能说明

#### 书签管理

##### 添加书签

1. 点击书签网格中的"添加"卡片
2. 选择类型：
    - **网址**：添加一个网站链接
    - **文件夹**：创建一个书签文件夹
3. 填写信息：
    - **网址**（仅网址类型）：网站的完整 URL
    - **标题**：显示名称
    - **图标**（仅网址类型）：
        - 自动获取 Favicon：从多个图标源自动获取高清图标
        - 自定义图标：上传本地图片或使用纯色+文字
    - **分类**：选择所属分类

##### 编辑/删除书签

-   鼠标悬停在书签卡片上
-   点击右上角的 ✎（编辑）或 ×（删除）按钮

##### 拖拽排序

-   **激活拖拽**：长按书签卡片（卡片会放大并显示阴影）
-   **移动**：拖动到目标位置（会显示蓝色虚线占位符）
-   **释放**：松开鼠标完成移动
-   **跨分类移动**：可拖拽到不同分类
-   **收纳到文件夹**：拖拽到文件夹卡片上（文件夹会高亮提示）

##### 文件夹功能

-   **创建文件夹**：添加书签时选择"文件夹"类型
-   **打开文件夹**：点击文件夹卡片
-   **在文件夹内添加**：文件夹弹窗中点击"添加"
-   **移出文件夹**：在文件夹内拖拽书签到外部
-   **自动解散**：文件夹仅剩一个书签时自动解散
-   **嵌套文件夹**：支持文件夹内创建子文件夹，最多支持 3 级文件夹

#### 分类管理

##### 添加分类

1. 点击侧边栏底部的"+"按钮
2. 输入分类名称
3. 点击"保存"

##### 切换分类

-   点击侧边栏的分类名称
-   主区域会显示该分类下的所有书签

##### 删除分类

-   鼠标悬停在分类上
-   点击右侧的 × 按钮
-   注意：至少保留一个分类

##### 分类排序

-   长按分类名称 90ms 激活拖拽
-   拖动到目标位置
-   松开完成排序

#### 搜索功能

-   **切换搜索引擎**：点击搜索框左侧的下拉菜单
-   **搜索**：在搜索框输入关键词，按 Enter 键
-   **支持的搜索引擎**：
    -   Google（默认）
    -   Bing
    -   百度
    -   Yahoo

#### 背景设置

##### 本地模式

1. 打开设置 → 外观 → 背景设置
2. 选择"本地"
3. 选择上传方式：
    - **本地上传**：选择图片文件（建议 ≤2MB 用于浏览器存储，≤4MB 用于 Gist，WebDAV 无大小限制）
    - **图片链接**：粘贴图片 URL（推荐 4K 用户使用图床，无大小限制）
4. 调节透明度（0-100%）
5. 实时预览效果

> **⚠️ Gist 背景图性能提示**  
> Gist 将图片存储为 Base64 文本格式，存在以下限制：
>
> -   Base64 编码会使体积增加约 33%
> -   大图片会导致同步和加载速度明显变慢
> -   建议图片压缩后 < 4MB，或使用图床服务 + URL 模式
> -   **WebDAV 无大小限制**，支持二进制存储，性能更好，推荐大图片使用

##### 云端模式

1. 打开设置 → 外观 → 背景设置
2. 选择"云端同步"
3. 确保已配置 WebDAV 或 Gist 同步
4. 点击"刷新云端"或"上传/修改"
5. 扩展会自动在远程数据文件同目录查找 `background.(jpg|png|webp|avif|gif)` 文件

#### 设置页面

点击右下角的齿轮按钮 ⚙ 打开设置页面。

##### 外观设置

-   **背景图**：详见"背景设置"部分
-   **透明度**：拖动滑块调节（0-100%）
-   **实时预览**：所见即所得

##### 数据存储位置

选择四种存储方式之一：

1. **浏览器存储**（推荐）

    - 仅此设备
    - 无容量限制
    - 数据保存在扩展专属存储区域

2. **账号同步**

    - 跨设备同步
    - 容量限制约 100KB
    - 数据过大时请改用浏览器存储或远程同步

3. **WebDAV 同步**

    - 填写配置：
        - **文件地址**：直接指向 JSON 文件的完整 URL
        - **用户名**：WebDAV 账号
        - **密码**：WebDAV 密码或应用专用密码
    - 点击"应用配置"验证
    - 验证成功后可选择同步方向：
        - **本地覆盖云端**：上传本地数据到远程
        - **合并后上传并生效**：合并本地和远程数据
        - **云端覆盖本地**：下载远程数据覆盖本地

4. **GitHub Gist 同步**
    - 填写配置：
        - **GitHub Token**：[创建 Token](https://github.com/settings/tokens)（仅需 `gist` 权限）
        - **Gist ID**：留空则自动创建
        - **文件名**：默认 `edgeTab-data.json`
    - 点击"应用配置"验证
    - 验证成功后可选择同步方向

##### 数据转移

-   **导出数据**：点击"导出数据"按钮，下载 JSON 文件
-   **导入数据**：
    1. 选择数据来源：
        - 由当前扩展导出的数据
        - 由 WeTab 导出的数据（需要将*.data 格式手动改为*.json）
    2. 选择导入模式：
        - **合并**：在现有数据基础上追加
        - **覆盖**：替换当前所有数据
    3. 点击"导入数据"，选择文件

---

#### 关键常量配置

**存储键**：

```javascript
const STORAGE_KEYS = {
	DATA: "edgeTabData",
	SETTINGS: "edgeTabSettings",
	BACKGROUND_IMAGE: "edgeTabBgImage",
};
```

**同步配置**：

```javascript
const REMOTE_FETCH_TIMEOUT = 12000; // 12秒超时
const DEFAULT_REMOTE_FILENAME = "edgeTab-data.json";
const BACKGROUND_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];
```

**缓存配置**：

```javascript
const MAX_CACHED_ICON_BYTES = 500 * 1024; // 单张图标最大 500KB
```

**拖拽配置**：

```javascript
const DRAG_LONG_PRESS_MS = 90; // 长按 90ms 激活拖拽
```

---

### 🔄 数据同步

#### WebDAV 同步详细配置

##### 服务商举例

-   **Nextcloud**：开源私有云存储
-   **坚果云**：国内 WebDAV 服务
-   **群晖 NAS**：自建 WebDAV 服务器
-   **其他**：任何支持 WebDAV 协议的服务

##### 配置步骤

1. **准备 WebDAV 服务**

    - 确保可外网访问（或在内网环境使用）
    - 启用 WebDAV 协议
    - 创建用户账号并赋予读写权限

2. **获取配置信息**

    - **文件地址**：完整的 JSON 文件 URL
        - 示例（Nextcloud）：`https://cloud.example.com/remote.php/dav/files/username/edgeTab-data.json`
        - 示例（坚果云）：`https://dav.jianguoyun.com/dav/edgeTab-data.json`
    - **用户名**：WebDAV 账号
    - **密码**：WebDAV 密码或应用专用密码（推荐）

3. **在扩展中配置**

    - 打开设置 → 数据存储位置 → 选择 WebDAV 同步
    - 填写文件地址、用户名、密码
    - 点击"应用配置"验证连接

4. **选择同步方向**

    - 验证成功后，选择一次性同步方式：
        - **本地覆盖云端**：上传本地数据
        - **合并后上传并生效**：合并本地和远程数据
        - **云端覆盖本地**：下载远程数据

5. **自动同步**
    - 完成首次同步后，后续操作将自动使用该模式
    - 每次保存时自动上传到 WebDAV

##### 常见问题

-   **401 Unauthorized**：用户名或密码错误
-   **404 Not Found**：文件路径不存在（首次同步会自动创建）
-   **403 Forbidden**：账号权限不足
-   **超时**：网络不稳定或服务器响应慢

#### GitHub Gist 同步详细配置

##### 配置步骤

1. **创建 Personal Access Token**

    - 访问 [GitHub Token 设置](https://github.com/settings/tokens)
    - 点击"Generate new token" → "Generate new token (classic)"
    - 勾选 `gist` 权限（仅需此权限）
    - 生成并复制 Token（格式：`ghp_xxx` 或 `github_pat_xxx`）

2. **在扩展中配置**

    - 打开设置 → 数据存储位置 → 选择 GitHub Gist 同步
    - 填写 GitHub Token
    - Gist ID：
        - **留空**：首次保存时自动创建私有 Gist
        - **填写**：使用现有 Gist（从 Gist URL 中获取）
    - 文件名：默认 `edgeTab-data.json`，可自定义

3. **验证和同步**
    - 点击"应用配置"验证 Token
    - 选择同步方向（同 WebDAV）

##### 安全说明

-   Token 和 Gist ID 仅保存在浏览器本地
-   建议使用 Fine-grained Token 并限制权限
-   定期轮换 Token 以提高安全性

---

### 👨‍💻 开发指南

#### 代码结构

**JavaScript 主要模块**：

-   **数据管理**：
    -   `loadData()` / `saveData()`：数据读写
    -   `normalizeDataStructure()`：数据格式校验
-   **书签操作**：
    -   `findBookmarkLocation()`：定位书签
    -   `moveBookmarkTo()`：移动书签
    -   `removeBookmarkById()`：删除书签
-   **拖拽系统**：
    -   `setupBookmarkCardDrag()`：初始化拖拽
    -   `dragState`：拖拽状态管理
-   **图标系统**：
    -   `generateHighResIconMeta()`：生成图标源列表
    -   `cacheIconIfNeeded()`：缓存图标
    -   `resolveBookmarkIconSource()`：解析图标源
-   **同步系统**：
    -   `loadDataFromWebDAV()` / `saveDataToWebDAV()`
    -   `loadDataFromGist()` / `saveDataToGist()`
-   **渲染系统**：
    -   `renderApp()`：渲染整个应用
    -   `renderCategories()`：渲染分类列表
    -   `renderBookmarks()`：渲染书签网格

#### 本地开发

1. 克隆项目

    ```bash
    git clone https://github.com/everlst/MyLocalNewTab.git
    cd MyLocalNewTab
    ```

2. 在浏览器中加载扩展（见"快速开始"部分）

3. 修改代码

    - 编辑 `js/script.js`、`css/style.css` 或 `newtab.html`
    - 在扩展管理页面点击刷新按钮
    - 打开新标签页查看效果

4. 调试
    - 右键点击新标签页 → 检查
    - 使用 Chrome DevTools 调试

---

### ❓ 常见问题

#### 1. 为什么有些网站图标加载失败？

-   **原因**：部分网站没有提供 Favicon，或图标源被 CORS 策略阻止
-   **解决**：
    -   使用"自定义图标"功能上传本地图片
    -   或使用"纯色+文字"创建简单图标

#### 2. 背景图片为什么不显示？

-   **原因**：
    -   图片格式不支持
    -   图片链接失效
    -   浏览器存储配额已满
    -   受服务商限制，图片尺寸太大
-   **解决**：
    -   确保图片格式为 jpg/png/webp/avif/gif
    -   使用图片链接模式（无大小限制）
    -   检查浏览器存储空间（`edge://settings/storageAccessPermissions`）
    -   使用自建的 WebDav 服务（已验证稳定性），或使用更小文件大小的图片

#### 3. WebDAV 同步失败怎么办？

-   **检查项**：
    -   文件地址是否正确（直接指向 JSON 文件）
    -   用户名和密码是否正确
    -   网络是否可访问 WebDAV 服务器
    -   WebDAV 账号是否有读写权限
-   **调试方法**：
    -   打开浏览器控制台（F12）查看错误信息
    -   尝试在浏览器地址栏直接访问文件地址

#### 4. 数据会丢失吗？

-   **本地存储**：
    -   数据保存在浏览器扩展存储区域
    -   卸载扩展会清空数据
    -   建议定期导出备份
-   **远程同步**：
    -   WebDAV/Gist 会保留远程副本
    -   可随时从远程恢复

#### 5. 如何迁移到其他设备？

-   **方法 1**：导出/导入
    -   在旧设备导出数据（JSON 文件）
    -   在新设备导入数据
-   **方法 2**：使用同步功能
    -   在旧设备配置 WebDAV/Gist 同步
    -   在新设备配置相同的同步账号
    -   选择"云端覆盖本地"

#### 6. 扩展与其他新标签页扩展冲突？

-   浏览器只允许一个扩展覆盖新标签页
-   禁用其他新标签页扩展即可

#### 7. Gist 同步背景图很慢怎么办？

-   **原因**：
    -   Gist 将图片存储为 Base64 文本格式，大图片会导致：
        -   体积增加约 33%（Base64 编码开销）
        -   同步速度明显变慢
        -   浏览器解码 Base64 耗时较长
-   **解决方案**：
    -   **方案 1**：使用更小的图片（建议压缩后 < 4MB）
    -   **方案 2**：切换到 WebDAV 存储（支持二进制，性能更好，**无大小限制**）
    -   **方案 3**：使用图床服务（如 imgur.com、sm.ms）+ "图片链接"模式（无大小限制，加载最快）
-   **最佳实践**：
    -   Gist 适合存储书签数据（文本），不适合大图片
    -   背景图推荐：图床 URL > WebDAV（无限制） > Gist（≤4MB）

#### 8. 如何备份数据？

-   **手动备份**：
    -   打开设置 → 数据转移 → 导出数据
    -   保存 JSON 文件到安全位置
-   **自动备份**：
    -   使用 WebDAV/Gist 同步
    -   定期检查远程数据

---

### 📄 许可证

本项目采用双重许可证：

-   **🆓 AGPL-3.0** 用于开源使用（免费）
-   **💼 商业许可证** 用于商业使用（付费）

#### 开源使用 (AGPL-3.0)

免费提供给个人、开源项目和愿意以下条件的公司：

-   在 AGPL-3.0 许可证下发布其修改
-   与使用该软件的用户共享源代码

#### 商业使用

如需在闭源产品或服务中使用本软件且不受 AGPL-3.0 要求的约束，请联系我们获取商业许可证。

**联系方式:** everlastingk@163.com

详见 [LICENSE](LICENSE) 文件。

### 📮 联系方式

-   GitHub：[@everlst](https://github.com/everlst)
-   Issues：[提交问题](https://github.com/everlst/MyLocalNewTab/issues)

---

## English

> **Note: This English version is translated by AI**

### Disclaimer

This project is 100% coded by AI. Thanks to Claude Sonnet 4.5, Gemini3 Pro, and gpt-5.1-Codex-Max for their great support.

### 📋 Table of Contents

-   [Features](#-features)
-   [Quick Start](#-quick-start)
-   [Detailed Feature Description](#-detailed-feature-description)
-   [Key Configuration Constants](#-key-configuration-constants)
-   [Data Synchronization](#-data-synchronization)
-   [Development Guide](#-development-guide)
-   [FAQ](#-faq)
-   [License](#-license)
-   [Contact](#-contact)

---

### ✨ Features

#### 🎯 Core Features

-   **📑 Smart Bookmark Management**

    -   Support for both bookmarks and folders
    -   Drag-and-drop sorting with long-press activation
    -   Nested folder support, drag to folder for organization
    -   Custom bookmark icons (auto-fetch Favicon / custom upload / solid color + text)
    -   Multi-level icon fallback strategy for stable display

-   **🗂️ Category System**

    -   Unlimited categories with sidebar management
    -   Drag-and-drop category reordering
    -   Independent bookmark management per category

-   **🔍 Multi-Engine Search**

    -   Support for Google, Bing, Baidu, Yahoo
    -   Quick search engine switching
    -   Integrated search bar at the top

-   **🎨 Custom Background**
    -   **Local Mode**: Upload local images or use image URLs
    -   **Cloud Mode**: Auto-sync background from WebDAV/Gist
    -   Adjustable opacity (0-100%)
    -   Support for multiple image formats (jpg/png/webp/avif/gif)
    -   Real-time preview

#### 💾 Data Storage & Sync

Four storage options for different use cases:

1. **Browser Storage** (Default)

    - Data saved in extension-specific `storage.local`
    - Bound to current device/browser profile only
    - Unlimited capacity, supports many bookmarks and large background images
    - Physical path: `Local Extension Settings/<Extension ID>` in Edge user data directory

2. **Account Sync**

    - Auto-sync via browser account's `chrome.storage.sync`
    - Suitable for multi-device sharing
    - Limited by browser sync quota (~100KB)

3. **WebDAV Sync**

    - Support for any WebDAV-compatible service (Nextcloud, Nutstore, etc.)
    - Requires internet-accessible WebDAV endpoint
    - Support for HTTPS + Basic Authentication
    - Example: `https://dav.example.com/remote.php/dav/files/<user>/edgeTab-data.json`

4. **GitHub Gist Sync**
    - Use GitHub Personal Access Token (requires `gist` permission)
    - Specify existing Gist ID, or leave empty to auto-create private Gist
    - Default filename `edgeTab-data.json`, customizable
    - Token and Gist ID stored locally only

#### 📤 Data Import/Export

-   **Export**: JSON format for backup or migration
-   **Import**: Two modes supported
    -   **Merge Mode**: Append to existing data (no duplicate URLs)
    -   **Overwrite Mode**: Replace all current data
-   **Compatibility**: Support for importing data from this extension and WeTab

#### 🎭 User Experience

-   **Theme**: Auto-follow system dark/light mode
-   **Animations**: Smooth transitions and interactive feedback
-   **Drag & Drop**:
    -   Bookmark cards: Long-press to activate drag (with visual feedback)
    -   Category list: Long-press to activate drag
    -   Support for cross-folder dragging
    -   Drag to folder card for auto-organization
    -   Real-time placeholder hints
-   **Icon Caching**: Auto-cache website icons for faster loading
-   **View Transitions API**: Support for native browser page transitions

---

### 🚀 Quick Start

#### Installation Steps

1. **Download the project**

    ```bash
    git clone https://github.com/everlst/MyLocalNewTab.git
    cd MyLocalNewTab
    ```

2. **Load the extension**

    - Open Edge/Chrome browser
    - Visit `edge://extensions/` (Edge) or `chrome://extensions/` (Chrome)
    - Enable "Developer mode"
    - Click "Load unpacked"
    - Select the `MyLocalNewTab` folder

3. **Start using**
    - Open a new tab, the extension will activate automatically
    - Default bookmarks include Google, Bilibili, GitHub

---

### 📖 Detailed Feature Description

#### Bookmark Management

##### Add Bookmark

1. Click the "Add" card in the bookmark grid
2. Select type:
    - **URL**: Add a website link
    - **Folder**: Create a bookmark folder
3. Fill in information:
    - **URL** (URL type only): Complete website URL
    - **Title**: Display name
    - **Icon** (URL type only):
        - Auto-fetch Favicon: Automatically get HD icons from multiple sources
        - Custom icon: Upload local image or use solid color + text
    - **Category**: Select category

##### Edit/Delete Bookmark

-   Hover over a bookmark card
-   Click ✎ (edit) or × (delete) button in the top-right corner

##### Drag & Drop Sorting

-   **Activate drag**: Long-press bookmark card (card will enlarge with shadow)
-   **Move**: Drag to target position (blue dashed placeholder will appear)
-   **Release**: Release mouse to complete move
-   **Cross-category move**: Can drag to different categories
-   **Organize into folder**: Drag onto folder card (folder will highlight)

##### Folder Features

-   **Create folder**: Select "Folder" type when adding bookmark
-   **Open folder**: Click folder card
-   **Add inside folder**: Click "Add" in folder modal
-   **Move out of folder**: Drag bookmark outward inside folder
-   **Auto-dissolve**: Folder auto-dissolves when only one bookmark remains
-   **Nested folders**: Support creating subfolders, up to 3 levels

#### Category Management

##### Add Category

1. Click "+" button at the bottom of sidebar
2. Enter category name
3. Click "Save"

##### Switch Category

-   Click category name in sidebar
-   Main area will display all bookmarks in that category

##### Delete Category

-   Hover over a category
-   Click × button on the right
-   Note: At least one category must remain

##### Reorder Categories

-   Long-press category name for 90ms to activate drag
-   Drag to target position
-   Release to complete reordering

#### Search Function

-   **Switch search engine**: Click dropdown menu on the left of search bar
-   **Search**: Enter keywords in search bar, press Enter
-   **Supported search engines**:
    -   Google (default)
    -   Bing
    -   Baidu
    -   Yahoo

#### Background Settings

##### Local Mode

1. Open Settings → Appearance → Background Settings
2. Select "Local"
3. Choose upload method:
    - **Local Upload**: Select image file (≤2MB recommended for browser storage, ≤10MB for WebDAV/Gist)
    - **Image Link**: Paste image URL (recommended for 4K users, no size limit)
4. Adjust opacity (0-100%)
5. Real-time preview

##### Cloud Mode

1. Open Settings → Appearance → Background Settings
2. Select "Cloud Sync"
3. Ensure WebDAV or Gist sync is configured
4. Click "Refresh Cloud" or "Upload/Modify"
5. Extension will auto-search for `background.(jpg|png|webp|avif|gif)` in remote data directory

#### Settings Page

Click the gear button ⚙ in the bottom-right corner to open settings.

##### Appearance Settings

-   **Background**: See "Background Settings" section
-   **Opacity**: Drag slider to adjust (0-100%)
-   **Real-time preview**: What you see is what you get

##### Data Storage Location

Choose one of four storage methods:

1. **Browser Storage** (Recommended)

    - This device only
    - Unlimited capacity
    - Data saved in extension-specific storage area

2. **Account Sync**

    - Cross-device sync
    - ~100KB capacity limit
    - Use browser storage or remote sync if data is too large

3. **WebDAV Sync**

    - Configuration:
        - **File URL**: Complete URL pointing to JSON file
        - **Username**: WebDAV account
        - **Password**: WebDAV password or app-specific password
    - Click "Apply Configuration" to verify
    - After successful verification, choose sync direction:
        - **Local to Cloud**: Upload local data to remote
        - **Merge and Upload**: Merge local and remote data
        - **Cloud to Local**: Download remote data to overwrite local

4. **GitHub Gist Sync**
    - Configuration:
        - **GitHub Token**: [Create Token](https://github.com/settings/tokens) (only `gist` permission needed)
        - **Gist ID**: Leave empty to auto-create
        - **Filename**: Default `edgeTab-data.json`
    - Click "Apply Configuration" to verify
    - After successful verification, choose sync direction

##### Data Transfer

-   **Export Data**: Click "Export Data" button to download JSON file
-   **Import Data**:
    1. Select data source:
        - Data exported by current extension
        - Data exported by WeTab (manually change \*.data format to \*.json)
    2. Select import mode:
        - **Merge**: Append to existing data
        - **Overwrite**: Replace all current data
    3. Click "Import Data", select file

---

### ⚙️ Key Configuration Constants

**Storage Keys**:

```javascript
const STORAGE_KEYS = {
	DATA: "edgeTabData",
	SETTINGS: "edgeTabSettings",
	BACKGROUND_IMAGE: "edgeTabBgImage",
};
```

**Sync Configuration**:

```javascript
const REMOTE_FETCH_TIMEOUT = 12000; // 12 second timeout
const DEFAULT_REMOTE_FILENAME = "edgeTab-data.json";
const BACKGROUND_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];
```

**Cache Configuration**:

```javascript
const MAX_CACHED_ICON_BYTES = 500 * 1024; // Max 500KB per icon
```

**Drag Configuration**:

```javascript
const DRAG_LONG_PRESS_MS = 90; // 90ms long-press to activate drag
```

---

### 🔄 Data Synchronization

#### WebDAV Sync Detailed Configuration

##### Service Examples

-   **Nextcloud**: Open-source private cloud storage
-   **Nutstore**: Domestic WebDAV service (坚果云)
-   **Synology NAS**: Self-hosted WebDAV server
-   **Others**: Any service supporting WebDAV protocol

##### Configuration Steps

1. **Prepare WebDAV Service**

    - Ensure internet accessibility (or use in local network)
    - Enable WebDAV protocol
    - Create user account with read/write permissions

2. **Get Configuration Info**

    - **File URL**: Complete JSON file URL
        - Example (Nextcloud): `https://cloud.example.com/remote.php/dav/files/username/edgeTab-data.json`
        - Example (Nutstore): `https://dav.jianguoyun.com/dav/edgeTab-data.json`
    - **Username**: WebDAV account
    - **Password**: WebDAV password or app-specific password (recommended)

3. **Configure in Extension**

    - Open Settings → Data Storage Location → Select WebDAV Sync
    - Fill in file URL, username, password
    - Click "Apply Configuration" to verify connection

4. **Choose Sync Direction**

    - After successful verification, choose one-time sync method:
        - **Local to Cloud**: Upload local data
        - **Merge and Upload**: Merge local and remote data
        - **Cloud to Local**: Download remote data

5. **Auto Sync**
    - After first sync, subsequent operations will auto-use this mode
    - Auto-upload to WebDAV on each save

##### Common Issues

-   **401 Unauthorized**: Incorrect username or password
-   **404 Not Found**: File path doesn't exist (will auto-create on first sync)
-   **403 Forbidden**: Insufficient account permissions
-   **Timeout**: Unstable network or slow server response

#### GitHub Gist Sync Detailed Configuration

##### Configuration Steps

1. **Create Personal Access Token**

    - Visit [GitHub Token Settings](https://github.com/settings/tokens)
    - Click "Generate new token" → "Generate new token (classic)"
    - Check `gist` permission (only this permission needed)
    - Generate and copy Token (format: `ghp_xxx` or `github_pat_xxx`)

2. **Configure in Extension**

    - Open Settings → Data Storage Location → Select GitHub Gist Sync
    - Fill in GitHub Token
    - Gist ID:
        - **Leave empty**: Auto-create private Gist on first save
        - **Fill in**: Use existing Gist (get from Gist URL)
    - Filename: Default `edgeTab-data.json`, customizable

3. **Verify and Sync**
    - Click "Apply Configuration" to verify Token
    - Choose sync direction (same as WebDAV)

##### Security Notes

-   Token and Gist ID stored locally in browser only
-   Recommend using Fine-grained Token with limited permissions
-   Regularly rotate Token for better security

---

### 👨‍💻 Development Guide

#### Code Structure

**Main JavaScript Modules**:

-   **Data Management**:
    -   `loadData()` / `saveData()`: Data read/write
    -   `normalizeDataStructure()`: Data format validation
-   **Bookmark Operations**:
    -   `findBookmarkLocation()`: Locate bookmark
    -   `moveBookmarkTo()`: Move bookmark
    -   `removeBookmarkById()`: Delete bookmark
-   **Drag System**:
    -   `setupBookmarkCardDrag()`: Initialize drag
    -   `dragState`: Drag state management
-   **Icon System**:
    -   `generateHighResIconMeta()`: Generate icon source list
    -   `cacheIconIfNeeded()`: Cache icon
    -   `resolveBookmarkIconSource()`: Resolve icon source
-   **Sync System**:
    -   `loadDataFromWebDAV()` / `saveDataToWebDAV()`
    -   `loadDataFromGist()` / `saveDataToGist()`
-   **Render System**:
    -   `renderApp()`: Render entire app
    -   `renderCategories()`: Render category list
    -   `renderBookmarks()`: Render bookmark grid

#### Local Development

1. Clone the project

    ```bash
    git clone https://github.com/everlst/MyLocalNewTab.git
    cd MyLocalNewTab
    ```

2. Load extension in browser (see "Quick Start" section)

3. Modify code

    - Edit `js/script.js`, `css/style.css`, or `newtab.html`
    - Click refresh button on extension management page
    - Open new tab to see changes

4. Debug
    - Right-click new tab page → Inspect
    - Use Chrome DevTools for debugging

---

### ❓ FAQ

#### 1. Why do some website icons fail to load?

-   **Reason**: Some websites don't provide Favicon, or icon sources are blocked by CORS policy
-   **Solution**:
    -   Use "Custom Icon" feature to upload local image
    -   Or use "Solid Color + Text" to create simple icon

#### 2. Why doesn't the background image display?

-   **Reason**:
    -   Unsupported image format
    -   Invalid image link
    -   Browser storage quota full
    -   Service provider restrictions
-   **Solution**:
    -   Ensure image format is jpg/png/webp/avif/gif
    -   Use image link mode (no size limit)
    -   Check browser storage space (`edge://settings/storageAccessPermissions`)
    -   Use self-hosted WebDAV service (verified stability)

#### 3. What if WebDAV sync fails?

-   **Check**:
    -   Is file URL correct (pointing directly to JSON file)
    -   Are username and password correct
    -   Is WebDAV server accessible via network
    -   Does WebDAV account have read/write permissions
-   **Debug**:
    -   Open browser console (F12) to view error messages
    -   Try accessing file URL directly in browser address bar

#### 4. Will data be lost?

-   **Local Storage**:
    -   Data saved in browser extension storage area
    -   Uninstalling extension will clear data
    -   Recommend regular export backups
-   **Remote Sync**:
    -   WebDAV/Gist keeps remote copies
    -   Can restore from remote anytime

#### 5. How to migrate to another device?

-   **Method 1**: Export/Import
    -   Export data on old device (JSON file)
    -   Import data on new device
-   **Method 2**: Use sync feature
    -   Configure WebDAV/Gist sync on old device
    -   Configure same sync account on new device
    -   Choose "Cloud to Local"

#### 6. Extension conflicts with other new tab extensions?

-   Browser only allows one extension to override new tab page
-   Disable other new tab extensions

#### 7. How to backup data?

-   **Manual Backup**:
    -   Open Settings → Data Transfer → Export Data
    -   Save JSON file to safe location
-   **Auto Backup**:
    -   Use WebDAV/Gist sync
    -   Regularly check remote data

---

### 📄 License

This project is dual-licensed:

-   **🆓 AGPL-3.0** for open-source use (free)
-   **💼 Commercial License** for proprietary use (paid)

#### Open Source Use (AGPL-3.0)

Free for individuals, open-source projects, and companies willing to:

-   Release their modifications under AGPL-3.0
-   Share source code with users interacting with the software

#### Commercial Use

For using this software in closed-source products or services without the
AGPL-3.0 requirements, please contact us for a commercial license.

**Contact:** everlastingk@163.com

See [LICENSE](LICENSE) for full details.

### 📮 Contact

-   GitHub: [@everlst](https://github.com/everlst)
-   Issues: [Submit Issue](https://github.com/everlst/MyLocalNewTab/issues)
