# MyLocalNewTab

设置页支持多种存储方式，方便在多设备间同步：
- 浏览器存储：仅当前设备/浏览器配置文件，容量无限制。
- 账号同步：依赖浏览器账号的 storage.sync，容量有限（约 100KB）。
- WebDAV 同步：准备一个可外网访问的 JSON 文件地址（例：`https://dav.example.com/.../edgeTab-data.json`），填写用户名/密码后即可读写；需具备 GET/PUT 权限。点击“应用配置”验证后，可选择覆盖/合并/拉取。
- GitHub Gist 同步：使用仅包含 `gist` 权限的 Token，填入 Gist ID（留空则首次保存时自动创建私有 Gist），文件名默认 `edgeTab-data.json` 可自定义。点击“应用配置”验证后再选择同步方向。

在“数据转移”区可以导出/导入 JSON 备份，支持本扩展与 WeTab 的数据格式。
