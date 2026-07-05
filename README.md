# Chrome URL 跳转捕获扩展

> 当前版本：`26.7.5A`
> 最后更新：`2026-07-05A`
> 插件版本：`26.7.5`
> 插件展示版本：`26.7.5A`
> 日志构建：`url-capture-v16`
> 项目定位：合法合规地调试 Chrome 页面跳转链路，并通过本地 aiohttp 服务接收扩展上报、生成 CTF 地址/姓名/卡片测试数据和保存调试日志。

---

## 项目简介

本项目是一个 Manifest V3 Chrome 扩展 + aiohttp 本地服务的组合项目，用于记录浏览器 URL 跳转过程、生成 CTF 地址/姓名/卡片测试数据，并把扩展侧事件上报到本机日志目录。

当前重点不是自动化绕过浏览器限制，而是把跳转链路看清楚、记录下来、方便复现：

- 在扩展 popup 主页面展示运行日志，包含 URL 跳转记录和前端主动操作记录
- 通过 popup 开关控制是否记录 URL 变化，默认开启
- 在 popup 运行日志框内输出脱敏后的完整 URL 和刷新 token 请求链路
- 使用后台 `service worker` 记录结构化日志
- 记录 popup 打开时的当前页面信息
- 监听地址栏变化、主框架导航、请求发出前和导航错误事件
- 尽量捕获一闪而过、随后被拦截或重定向的中间 URL
- 通过按钮2提取当前活动页的页面文字和完整 HTML
- 通过 aiohttp 的 `/api/report` 接收扩展上报，并写入 `log/YYYY-MM-DD.jsonl`
- Python 运行日志写入 `log/runtime-YYYY-MM-DD.log`

---

## 版本管理

版本号格式采用：`主版本.次版本.补丁版本`。

示例：

| 版本 | 日期 | 说明 |
|---|---|---|
| `26.7.5A` | 2026-07-05A | 封版版本；插件 `version` 更新为 `26.7.5`，`version_name` 更新为 `26.7.5A`；后台日志构建更新为 `url-capture-v16`；按钮6“提取网页AT”补齐 workspace 导出闭环，浮窗新增 workspace 列表、单项复制 AT、导出空间 AT JSON、导出 `team.csv`、`/backend-api/me` 状态回填和批量导出进度条；按钮8由占位入口升级为“城市检查”，可基于 MayIP + AddressGen 查询城市、申请地址并显示浮窗 |
| `26.7.4A` | 2026-07-04A | 封版版本；插件 `version` 更新为 `26.7.4`，`version_name` 更新为 `26.7.4A`；后台日志构建更新为 `url-capture-v15`；popup 按钮3“抓取IP信息”和按钮4“提取地址”入口置灰禁用，功能代码和后端接口暂时保留；新增 `tmp_md/buttons_3_4_deprecation.md` 记录弃用范围、影响和恢复方式 |
| `26.6.28A` | 2026-06-28A | 完成按钮7“MayIP信息”链路：popup 直接请求 `https://mayips.com/`，将返回文本按 JSON-RPC 上传到 `/api/html/text`；后端从 MayIP JSON 中提取 `country`、`state/region_name`、`city` 并返回前端；前端保存到 `lastIpInfo`，运行日志和状态栏显示 `country / region / city`，按钮4后续生成地址时优先使用保存的 country |
| `26.6.24A` | 2026-06-24A | 重构按钮6“提取网页AT”链路；拆分为“打开 session 页 / 等待完成 / 解析 JSON / 保存 AT / 注入浮窗”五段 helper；浮窗改为挂载到 `document.documentElement` 的 Shadow DOM 卡片，先注入再切换标签页，修复原先 popup 失焦后看不到浮窗的问题；新增 `chatgpt_session_*`、`chatgpt_at_overlay_injected` 等运行日志，便于后续排障 |
| `26.6.23A` | 2026-06-23A | 新增按钮6”提取网页AT”，后台打开 ChatGPT session API 并提取 accessToken；新增后端 `/api/at/save` 接口，保存 AT 到 `db/crx-xxx/at-YYYY-MM-DD.csv`；提取成功后自动切换标签页；**已知问题**：浮窗注入功能存在兼容性问题，部分页面无法显示浮窗（console 有日志但元素不可见），建议从运行日志或控制台获取 AT |
| `26.6.20E` | 2026-06-20E | 修正版本；插件 `version_name` 更新为 `26.6.20E`；后台日志构建更新为 `url-capture-v11`；popup 功能4恢复为”提取地址”，继续生成地址和 Luhn 测试卡，同时用新版 `JapaneseNameGenerator` 生成姓名并替换地址里的 `full_name`；popup 功能5恢复为”JS探针”，保留当前名字生成器探针能力，并备注后续可扩展关键词、触发按钮和调用栈规则研究其它 JS 方法 |
| `26.6.20D` | 2026-06-20D | 封版版本；插件 `version_name` 更新为 `26.6.20D`；后台日志构建更新为 `url-capture-v10`；调试完成后收起按钮5“查询方法”和按钮6“生成名字”的专用功能；popup 功能4改为正式“生成名字”入口，调用本地 JSON-RPC `/api/name/generate`，返回 kanji、hiragana、romaji、meaning 等字段并写入 `log/name-YYYY-MM-DD.jsonl` |
| `26.6.20C` | 2026-06-20C | 封版版本；插件 `version_name` 更新为 `26.6.20C`；后台日志构建更新为 `url-capture-v9`；根据按钮5运行探针确认目标页面点击“生成名字”不发网络包、由本地 JS 调用 `Math.random` 生成；后端新增 JSON-RPC `/api/name/generate` 与 `name.generate` 方法；popup 功能6改为“生成名字”，生成 kanji、hiragana、romaji、meaning 等字段并写入 `log/name-YYYY-MM-DD.jsonl` |
| `26.6.20B` | 2026-06-20B | 封版版本；插件 `version_name` 更新为 `26.6.20B`；后台日志构建更新为 `url-capture-v8`；按钮5改为“查询方法”，可扫描当前页内联脚本和同源 JS chunk，并自动点击“生成名字”运行探针，按 `generateName`、`generatedName`、`kanji`、`hiragana`、`romaji`、`Math.random` 等关键词及运行时调用栈定位前端本地生成名字逻辑 |
| `26.6.20A` | 2026-06-20A | 封版版本；插件 `version` 更新为 `26.6.20`，`version_name` 更新为 `26.6.20A`；后台日志构建更新为 `url-capture-v7`；popup 功能区新增第三排按钮，提供功能11到功能15，占位行为沿用现有预留按钮；保留功能4地址/姓名/卡片生成链路 |
| `26.6.19E` | 2026-06-19E | 封版版本；插件 `version_name` 更新为 `26.6.19E`；全面升级为 JSON-RPC 2.0 通信协议；按钮3改为"抓取IP信息"，自动打开/刷新 ipinfo.dkly.net 页面并提取内容；RPC ID 采用时间戳+随机数生成唯一标识；后端自动提取 city 和 region_name 信息返回前端；前端运行日志显示 RPC ID、城市、区域信息；新增 notifications 权限支持系统通知 |
| `26.6.19D` | 2026-06-19D | 封版版本；插件 `version_name` 更新为 `26.6.19D`；后台日志构建更新为 `url-capture-v6`；按钮2改为提取当前活动页文字和完整 HTML；完整 HTML 保存到 `db/[token]/[time].html`，不再写入 `html-all` JSONL；按钮2文字上传超时 10 秒、完整 HTML 上传超时 30 秒；补充 `main.bat` 启动说明 |
| `26.6.19C` | 2026-06-19C | 封版版本；插件 `version_name` 更新为 `26.6.19C`；后台日志构建更新为 `url-capture-v5`；popup 增加功能6到功能10；日志面板升级为“运行日志”；刷新后端 token 请求链路写入前端运行日志 |
| `26.6.19A` | 2026-06-19A | 插件 `version` 更新为纯数字 `26.6.19`，`version_name` 更新为 `26.6.19B`；URL 跳转记录在写入扩展本地存储后同步上报到 aiohttp `/api/report`，后端保存到 `log/YYYY-MM-DD.jsonl`；后台日志构建更新为 `url-capture-v4` |
| `1.1.2-dev` | 2026-06-16A | 新增 aiohttp `/api/log` 与 `/api/report` 上报接口；Python 启动日志落地到 `log/runtime-YYYY-MM-DD.log`；popup 功能1可向后端发送测试上报；URL 记录面板迁移到 popup；补充指纹浏览器使用局域网 IP 的连接方式 |
| `1.1.1` | 2026-06-12 | 新增敏感参数自动脱敏；浮窗新增“复制”和“导出 JSON”；popup 当前页面 URL 同步脱敏；后台日志构建更新为 `url-capture-v3` |
| `1.1.0` | 2026-06-04 | 新增页面内 URL 记录浮窗；新增 `storage`、`tabs`、`webNavigation`、`webRequest` 捕获链路；后台日志加入 `extensionVersion` 和 `loggerBuild`；可捕获 `localhost` OAuth 回调这类中间 URL |
| `1.0.0` | 2026-06-04 | 初始 Manifest V3 扩展；包含 `manifest.json`、popup 页面、基础后台日志与当前页面信息输出 |

重要功能变更时建议同步更新：

- `manifest.json` 中的 `version` 和 `version_name`
- `background.js` 中的 `LOGGER_BUILD`
- README 中的当前版本和版本表

---

## 环境要求

- Chrome 或 Chromium 内核浏览器
- 浏览器需要开启“开发者模式”
- 当前扩展使用 Manifest V3
- 当前项目不依赖 npm、Python 或外部构建工具

开发时可选工具：

- PowerShell：用于查看文件和运行基础检查
- Node.js：用于执行 `node --check` 检查 JavaScript 语法

---

## 项目结构

```text
<PROJECT_ROOT>/
├── README.md
├── main.py                    # aiohttp 服务启动入口，启动日志写入 log/runtime-YYYY-MM-DD.log
├── main.bat                   # Windows 一键启动脚本，创建 db/log 并以 0.0.0.0:8080 启动后端
├── ctf_toolkit.py             # 地址、kanji/kana 姓名和 Luhn 测试卡生成工具
├── server/
│   ├── app.py                 # HTTP 路由、地址/姓名/卡片生成接口、扩展日志上报接口
│   └── runner.py              # aiohttp host/port 参数
├── static/                    # 本地 CTF Dashboard
├── log/                       # 运行日志和扩展上报日志
├── db/                        # 后端 token CSV 登录记录
└── chrome-extension/
    ├── manifest.json           # Chrome 扩展配置
    ├── background.js           # 后台 service worker，负责捕获导航和结构化日志
    ├── content.js              # 页面内 URL 变化采集，不再注入浮窗
    ├── popup.html              # 扩展图标 popup 主页面
    └── popup.js                # 地址配置、功能按钮、URL 日志展示和手动上报
```

说明：

- 真正需要加载到 Chrome / 指纹浏览器的目录是 `chrome-extension/`。
- 修改 `manifest.json` 后必须在 `chrome://extensions/` 手动刷新扩展。

---

## 推荐入口：扩展 popup 主页面

当前最主要的使用入口是点击扩展图标后出现的 popup 主页面。

完整流程：

1. Chrome 加载 `chrome-extension/`。
2. 启动 aiohttp 服务。
3. 在 popup 的“前后端交互地址”输入框保存后端地址。
4. 运行日志默认展示，可在 popup 中查看、复制、导出或清空。
5. 点击“刷新后端token”可向后端申请 token，并创建 `db/[token].csv` 登录记录。
6. 在 `log/YYYY-MM-DD.jsonl` 查看扩展上报记录。
7. 在 Service Worker Console 查看更完整的结构化日志。

默认安全策略：

- URL 运行记录默认开启，可在 popup 手动关闭；刷新 token 这类主动操作日志始终记录。
- 运行日志默认保存在本机 `chrome.storage.local`。
- 运行日志最多保留最近 `300` 条。
- 刷新后端 token、扩展加载上报和 URL 跳转记录会发送到已保存的后端地址。

---

## 本地服务与日志

推荐 Python 环境：

```powershell
D:\0Code2\py312\python.exe
```

Windows 推荐直接使用项目根目录下的启动脚本：

```powershell
.\main.bat
```

`main.bat` 会执行这些准备动作：

- 切换到脚本所在项目目录。
- 创建 `db/` 和 `log/` 目录。
- 设置 `PYTHONIOENCODING=utf-8`，减少中文日志乱码。
- 将 `D:\0Code2\py312`、`D:\job\py312\Scripts` 和 `D:\job\py312` 加入当前窗口的 `PATH`。
- 执行 `python main.py --host 0.0.0.0 --port 8080 %*`，并透传额外命令行参数。

普通浏览器可使用默认本机地址：

```powershell
D:\0Code2\py312\python.exe main.py
```

默认监听：

```text
http://127.0.0.1:8080/
```

指纹浏览器通常会拦截 `127.0.0.1` 或 `localhost`，推荐改用局域网 IP：

```powershell
D:\0Code2\py312\python.exe main.py --host 0.0.0.0 --port 8080
```

然后在扩展 popup 输入框中保存类似地址：

```text
http://192.168.1.15:8080/
```

“刷新后端token”会依次请求：

```text
http://192.168.1.15:8080/api/get_crc_token
http://192.168.1.15:8080/api/token/create
```

按钮2会把当前活动页内容发送到：

```text
http://192.168.1.15:8080/api/html/text
http://192.168.1.15:8080/api/html/all
```

其中页面文字写入 `log/html-text-YYYY-MM-DD.jsonl`；完整 HTML 保存到 `db/[token]/[time].html`，不会再写入 `html-all` JSONL。按钮2上传文字超时为 10 秒，上传完整 HTML 超时为 30 秒；其它普通后端请求默认仍是 3 秒超时。

日志文件：

| 文件 | 来源 | 说明 |
|---|---|---|
| `log/runtime-YYYY-MM-DD.log` | `main.py` | Python 启动、解释器路径、aiohttp 运行日志 |
| `log/YYYY-MM-DD.jsonl` | `/api/log` 或 `/api/report` | 扩展 POST 上报，每行一条 JSON |

当前主要接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/status` | Dashboard 状态 |
| `GET` | `/api/get_crc_token` | 生成 `crx-` + 32 位 hex token |
| `POST` | `/api/token/create` | 用 token 和全部标签页快照创建 `db/[token].csv` |
| `POST` | `/api/html/text` | 接收按钮2/按钮7提取的页面正文文字，写入 `log/html-text-YYYY-MM-DD.jsonl`；文本中存在定位字段时返回 `country`、`region_name`、`city` |
| `POST` | `/api/html/all` | 接收按钮2提取的完整页面 HTML，保存到 `db/[token]/[time].html` |
| `POST` | `/api/address/from-city` | 保留接口；根据 city/region_name/country 生成地址、kanji/kana 配对姓名，并附带一张 `ctf_toolkit.py` 生成的 Luhn 测试卡 |
| `POST` | `/api/name/generate` | 根据 JSON-RPC `name.generate` 生成日本测试姓名，返回 kanji、hiragana、romaji、meaning、nameType、gender 等字段 |
| `POST` | `/api/at/save` | 接收按钮6提取的 ChatGPT accessToken，保存到 `db/[token]/at-YYYY-MM-DD.csv` |
| `POST` | `/api/log` | 扩展日志上报原始路径 |
| `POST` | `/api/report` | 扩展日志上报推荐路径，避免部分浏览器拦截 `/api/log` |

---

## 当前能力

- 使用 Manifest V3。
- 提供基础 popup 页面。
- popup 提供后端地址输入框，默认 `http://127.0.0.1:8080/`。
- popup 提供功能1到功能15，其中：
  - 功能1：刷新后端 token 并创建 CSV 登录记录和 token 文件夹
  - 功能2：提取当前活动页的页面文字和完整 HTML
  - 功能3：抓取 IP 信息入口已禁用，原功能代码保留；恢复后可自动打开/刷新 ipinfo.dkly.net 并提取城市和区域信息
  - 功能4：提取地址入口已禁用，原功能代码保留；恢复后可根据按钮3或按钮7返回的城市/区域生成地址、姓名和 Luhn 测试卡
  - 功能5：JS 探针，扫描页面脚本、下载同源 JS chunk，并通过运行时探针记录按钮触发后的调用栈；当前默认围绕名字生成器关键词，可继续扩展其它 JS 方法
  - 功能6：提取网页 AT，后台打开 ChatGPT session API (`https://chatgpt.com/api/auth/session`)，提取 accessToken，自动保存到后端，并在浮窗中展示 workspace 列表、复制入口和批量导出入口
  - 功能7：MayIP 信息，直接请求 mayips.com，提取 country、city、state/region_name；当前继续保留保存到 `lastIpInfo` 的行为，供后续恢复地址链路时使用
  - 功能8：城市检查，复用按钮7/MayIP 返回的 country、city、region_name，查询 AddressGen 区域列表并申请地址，最终通过浮窗展示结果
  - 功能9-15：预留按钮，当前使用占位点击提示
- popup 打开时读取当前标签页信息。
- 后台记录扩展安装、浏览器启动、popup 打开等事件。
- popup 显示运行日志面板，包含 URL 跳转记录、刷新 token 请求链路和 IP 信息抓取记录。
- URL 运行记录支持开启、关闭；主动操作日志始终记录。
- 运行日志支持复制、导出 JSON 和清空。
- 对常见敏感参数自动脱敏后再展示和持久化。
- 支持普通页面跳转记录。
- 支持 SPA 地址变化记录。
- 支持 hash 变化记录。
- 支持主框架导航开始前 URL 捕获。
- 支持主页面请求发出前 URL 捕获。
- 支持导航错误 URL 捕获。
- 支持地址栏 URL 更新捕获。
- 支持将捕获到的 URL 跳转记录自动上报到 aiohttp `/api/report`。
- 支持将按钮2提取到的页面文字上报到 `/api/html/text`，完整 HTML 上报到 `/api/html/all`。
- 全面支持 JSON-RPC 2.0 通信协议，所有前后端接口统一使用 RPC 格式。
- RPC ID 采用时间戳+随机数生成（时间戳×1000000+随机数），保证全局唯一性。
- 按钮3“抓取IP信息”popup 入口已禁用，原代码仍保留；恢复入口后可自动打开/刷新 ipinfo.dkly.net 页面，后台加载不干扰当前浏览。
- 按钮3保留代码可从页面内容提取 country、city 和 region_name 信息，并在运行日志中显示。
- 按钮4“提取地址”popup 入口已禁用，原代码仍保留；恢复入口后可根据按钮3或按钮7返回的 country、city、region_name 调用 `/api/address/from-city`，返回地址信息、`name` 字段和 `ctf_toolkit.py` 生成的 Luhn 测试卡。
- 按钮4保留代码返回的 `address.full_name` 会替换为新版姓名生成器生成的 `kanjiFull`，`name` 字段同时包含 `kanji`、`hiragana`、`romaji`、`meaning`、`nameType`、`gender`、`effectiveGender` 和兼容旧字段。
- 按钮5作为 JS 探针保留，当前默认扫描名字生成器相关关键词和 `Math.random` 调用栈；后续可扩展关键词、目标按钮识别和探针包装函数，用于研究其它前端 JS 方法。
- 按钮6在后台标签页完成 session 读取、AT 保存和浮窗注入后，才切换到目标页面，避免 popup 失焦导致后续脚本中断。
- 按钮6浮窗挂载到 `document.documentElement`，使用 Shadow DOM 隔离样式，降低被目标页面 CSS 覆盖的概率。
- 按钮6读取 session 页面时会同时尝试 `<pre>`、`document.body.innerText` 和 `document.documentElement.textContent`，降低 JSON 解析失败概率。
- 按钮6浮窗支持复制当前 AT、复制空间列表、导出 workspace AT JSON、导出 `team.csv` 兼容 CSV；批量导出期间会显示进度条，并在结束后尝试恢复原 workspace。
- 按钮6导出 `team.csv` 时会对每个 workspace 额外请求 `/backend-api/me`，写入 `me_status_code` 和 `me_data` 两列；如果返回 `402` 且内容包含 `deactivated_workspace`，可直接据此判断停用空间。
- 按钮7直接在 popup 中请求 `https://mayips.com/`，把返回文本上传到 `/api/html/text`，后端解析 `country`、`city`、`state/region_name` 后返回前端。
- 按钮7成功后会把 MayIP 的 country、city、region_name 保存到扩展本地状态；按钮4入口当前禁用，但保留代码恢复后可直接复用这组数据生成地址。
- 按钮8会复用按钮7/MayIP 的城市信息，查询 AddressGen 区域列表并申请地址；如果当前页不适合注入地址浮窗，会自动打开 MayIP 页面作为回退展示页。
- 所有 JSONL 日志包含 `rpc_id` 字段，便于追踪完整请求链路。
- 完整 HTML 保存为独立 `.html` 文件，避免大 HTML 写入 JSONL。
- aiohttp 支持接收扩展上报并保存 JSONL 日志。
- aiohttp 支持生成 `crx-` token，将首次登录记录写入 `db/[token].csv`，并创建 `db/[token]/` 保存完整 HTML。
- aiohttp 支持启动日志落地。
- aiohttp 支持地址/姓名/卡片生成接口 `/api/address/from-city`。
- aiohttp 支持独立姓名生成接口 `/api/name/generate`。
- aiohttp 同时兼容 REST 和 JSON-RPC 2.0 两种格式，向后兼容旧版扩展。

---

## 按钮6浮窗实现方法

按钮6“提取网页AT”的浮窗链路，后续建议始终保持下面这套写法，避免再次出现“控制台有日志但页面看不到浮窗”的问题：

1. 先把点击事件里的长流程拆成 helper，不要把“开页、等页、解析、保存、注入、切页”全部堆在一个 `if (featureId === "6")` 里。
2. 目标页优先后台打开或后台复用，先完成数据提取和 DOM 注入，再执行 `chrome.tabs.update(..., { active: true })` 与 `chrome.windows.update(...)`。
3. 浮窗宿主优先挂到 `document.documentElement`，不要依赖“手工创建 body 再 append”的兜底逻辑。
4. 浮窗样式优先使用 Shadow DOM 隔离；如果不用 Shadow DOM，就必须准备一整套强隔离 CSS，并验证不会被页面全局样式覆盖。
5. session 内容不要只信任单一来源；至少同时尝试 `<pre>`、`body.innerText`、`documentElement.textContent` 三个文本源。
6. AT 保存后端与浮窗展示要解耦：保存失败时也要允许浮窗展示和复制，不要因为后端失败把前端可见反馈一起丢掉。
7. 必须记录阶段性运行日志，至少包含：打开/复用 session 页、等待完成、解析结果、保存结果、浮窗注入结果、最终失败原因。

当前重构后的参考实现集中在：

- `chrome-extension/popup.js` 中的 `openChatgptSessionTab`
- `chrome-extension/popup.js` 中的 `parseChatgptSessionResponse`
- `chrome-extension/popup.js` 中的 `saveChatgptAccessToken`
- `chrome-extension/popup.js` 中的 `injectChatgptAccessTokenOverlay`
- `chrome-extension/popup.js` 中的 `captureChatgptAccessToken`

---

## 按钮8城市检查链路

按钮8“城市检查”当前已经从占位入口升级为可用链路，执行顺序如下：

1. 先复用按钮7抓到的 `country`、`city`、`region_name`；如果缺字段，直接提示缺少前置数据。
2. 调用 AddressGen 区域列表接口，按城市名和区域名做匹配，判断是否存在可直出的区域代码。
3. 无论命中与否，都继续申请地址；命中时优先带上匹配到的 `area_code`，未命中时回退随机地址。
4. 申请成功后生成地址结果浮窗，内容包含姓名、邮箱、电话、生日、州/省、城市、邮编和完整地址。
5. 如果当前页不允许注入或注入失败，会自动打开 `https://mayips.com/` 作为回退展示页，避免结果丢失。
6. 整个过程会写入 popup 运行日志，便于复盘“查列表 / 申请地址 / 浮窗回退”这三段行为。

---

## 封版说明（2026-07-05A）

本次围绕“26.7.5A 封版、完成按钮6/按钮8本轮开发”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.7.5`，`version_name` 更新为 `26.7.5A`。
2. README 当前版本更新为 `26.7.5A`，最后更新日期改为 `2026-07-05A`。
3. 后台日志构建更新为 `url-capture-v16`。
4. popup 功能6补齐 workspace 导出闭环：AT 浮窗现在会显示 workspace 列表，支持单项复制目标 AT、复制空间列表、导出空间 AT JSON、导出 `team.csv`。
5. 功能6导出 `team.csv` 时会为每个 workspace 额外请求 `/backend-api/me`，回填 `me_status_code` 和 `me_data` 两列，用于识别 `402 + deactivated_workspace` 的停用空间。
6. 功能6批量导出时新增浮窗进度条，显示总数、完成数、当前阶段和恢复原 workspace 状态；批量导出期间会暂时禁用同浮窗里的其它 workspace 导出按钮。
7. popup 功能8由占位按钮升级为“城市检查”，当前会基于 MayIP 和 AddressGen 查询城市、申请地址，并通过浮窗展示结果；当前页无法注入时，会自动打开 MayIP 页面作为回退展示页。
8. popup 状态栏保留 `white-space: pre-line`，允许按钮6/按钮8输出多行结果说明，方便直接在 popup 中查看阶段信息。

封版检查结果：

- `chrome-extension/background.js`、`chrome-extension/content.js`、`chrome-extension/popup.js` JavaScript 语法检查通过。
- `chrome-extension/manifest.json` JSON 格式检查通过。
- `main.py`、`server/app.py`、`server/runner.py`、`ctf_toolkit.py` Python 编译检查通过。
- 本机 `http://127.0.0.1:8080/api/status` 可正常返回状态 JSON。

---

## 封版说明（2026-07-04A）

本次围绕“26.7.4A 封版、按钮3/按钮4入口弃用”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.7.4`，`version_name` 更新为 `26.7.4A`。
2. README 当前版本更新为 `26.7.4A`。
3. 后台日志构建更新为 `url-capture-v15`。
4. popup 按钮3“抓取IP信息”和按钮4“提取地址”增加 `disabled`，用户无法从 popup 直接点击。
5. popup 增加禁用态样式，按钮3和按钮4置灰展示，并用 `title` 标明“已计划弃用，功能代码暂时保留”。
6. 未删除 `popup.js` 中按钮3、按钮4的原功能分支，未删除 `/api/html/text`、`/api/address/from-city` 等后端接口。
7. 新增 `tmp_md/buttons_3_4_deprecation.md`，记录弃用范围、影响、保留代码和恢复方式。

封版检查结果：

- `chrome-extension/background.js`、`chrome-extension/content.js`、`chrome-extension/popup.js` JavaScript 语法检查通过。
- `chrome-extension/manifest.json` JSON 格式检查通过。
- `main.py`、`server/app.py`、`server/runner.py`、`ctf_toolkit.py` Python 编译检查通过。

恢复说明：

- 如需恢复按钮3和按钮4，只需移除 `chrome-extension/popup.html` 中两个按钮的 `disabled` 属性；本次未删除对应 JavaScript 和后端代码。

---

## 封版说明（2026-06-28A）

本次围绕“26.6.28A 完成按钮7 MayIP 信息链路，并返回 country/city/region”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.28`，`version_name` 更新为 `26.6.28A`。
2. README 当前版本更新为 `26.6.28A`。
3. 后台日志构建更新为 `url-capture-v14`。
4. popup 功能7由预留按钮改为“MayIP信息”。
5. 功能7直接在 popup 中请求 `https://mayips.com/`，读取返回文本、HTML、标题、最终 URL 和 canonical 信息。
6. 功能7把 MayIP 返回文本通过 JSON-RPC `html.captureText` 上传到后端 `/api/html/text`，来源标记为 `button7_mayips_text_capture`。
7. 后端 `extract_city_from_text` 扩展为同时支持 JSON 字段和普通文本标签，能够从 MayIP 返回内容中提取 `country`、`city`、`state/region_name`。
8. `/api/html/text` 的 JSON-RPC 返回结果新增 `country` 字段，并继续返回 `city`、`region_name`、`bytes`、`rpc_id`。
9. popup 功能7收到 `country/city/region_name` 后写入扩展本地 `lastIpInfo`，后续功能4可直接复用。
10. popup 运行日志新增“国家”显示，按钮7状态栏显示 `country / region / city`。
11. 功能4生成地址时优先使用按钮3或按钮7保存的 `country`，没有 country 时回退 `JP`。

封版检查结果：

- `server/app.py` Python 编译检查通过。
- `chrome-extension/popup.js` JavaScript 语法检查通过。
- `extract_city_from_text` 已用 JSON 和文本标签样例验证，可返回 `country`、`region_name`、`city`。
- 已实际请求 `https://mayips.com/`，确认返回体包含 `country`、`city`、`state` 字段。

---

## 封版说明（2026-06-24A）

本次围绕“26.6.24A 重构按钮6浮窗链路、修复浮窗不可见问题”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.24`，`version_name` 更新为 `26.6.24A`。
2. README 当前版本更新为 `26.6.24A`。
3. 后台日志构建更新为 `url-capture-v13`。
4. popup 功能6重构为独立 helper 流程：后台打开或复用 session 页、等待页面完成、读取文本、解析 JSON、保存 AT、注入浮窗、最后切换标签页。
5. 功能6的浮窗改为挂载到 `document.documentElement` 的 Shadow DOM 卡片，避免被目标页面样式覆盖。
6. 功能6不再依赖“切到前台后再注入”，改为“后台完成注入后再切页显示”，修复 popup 失焦时的链路中断问题。
7. 功能6读取页面内容时同时尝试 `<pre>`、`body.innerText`、`document.documentElement.textContent` 三个来源，降低解析失败概率。
8. 功能6即使后端保存失败，也会继续展示浮窗并允许复制 accessToken，避免前端反馈被后端错误吞掉。
9. 运行日志新增 `chatgpt_session_tab_opened`、`chatgpt_session_tab_reloaded`、`chatgpt_session_ready`、`chatgpt_at_overlay_injected`、`chatgpt_at_capture_failed` 等事件，便于定位具体失败阶段。

封版检查结果：

- `chrome-extension/popup.js` 语法检查通过。
- `chrome-extension/manifest.json` JSON 格式检查通过。
- 按钮6实测可见浮窗，且可复制 accessToken。
- 文档已补充“按钮6浮窗实现方法”，后续维护可直接按该流程复用。

---

## 封版说明（2026-06-23A）

本次围绕"26.6.23A 新增按钮6提取网页AT功能"完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.23`，`version_name` 更新为 `26.6.23A`。
2. README 当前版本更新为 `26.6.23A`。
3. 后台日志构建更新为 `url-capture-v12`。
4. popup 功能6改为"提取网页AT"，后台打开 `https://chatgpt.com/api/auth/session`。
5. 功能6会优先从 `<pre>` 标签提取 JSON 内容，降级提取 `body.innerText`。
6. 功能6成功提取 accessToken 后自动切换到该标签页并聚焦窗口。
7. 功能6在运行日志中记录 `chatgpt_at_captured` 事件，包含 accessToken 前20字符、用户邮箱、过期时间等信息。
8. 后端新增 `/api/at/save` 接口，支持 JSON-RPC 2.0 和普通 JSON 格式。
9. `/api/at/save` 接口保存 accessToken 到 `db/crx-xxx/at-YYYY-MM-DD.csv`，CSV 格式：`time, user, accessToken`。
10. 同一天多次提取 AT 会追加到同一文件，第一次写入时自动创建表头。
11. **已知问题**：浮窗注入功能存在兼容性问题，脚本注入成功且控制台有详细日志，但浮窗元素在部分页面不可见（可能与页面 CSP 或样式冲突有关）。当前建议从运行日志或浏览器控制台获取 accessToken，浮窗功能待后续优化。

封版检查结果：

- `background.js`、`content.js`、`popup.js` 语法检查通过。
- `manifest.json` JSON 格式检查通过。
- `main.py`、`server/app.py`、`server/runner.py` Python 编译检查通过。
- `/api/at/save` 接口逻辑已验证，支持 JSON-RPC 2.0 格式。
- accessToken 提取功能已验证，可从 `<pre>` 标签正确解析 JSON。
- 自动切换标签页功能已验证，`chrome.tabs.update` 和 `chrome.windows.update` 调用正常。
- CSV 保存路径 `db/crx-xxx/at-YYYY-MM-DD.csv` 已验证，表头和数据行正常写入。

---

## 封版说明（2026-06-20E）

本次围绕“26.6.20E 修正按钮4地址链路、保留按钮5 JS 探针”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.20`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.20E`。
3. README 当前版本更新为 `26.6.20E`。
4. 后台日志构建更新为 `url-capture-v11`。
5. popup 功能4恢复为“提取地址”，继续调用 `/api/address/from-city` 生成地址和 Luhn 测试卡。
6. 功能4使用新版 `JapaneseNameGenerator` 结果替换地址里的 `full_name`，并在日志中记录 `kanji`、`hiragana`、`romaji`、`meaning` 等字段。
7. popup 功能5恢复为“JS探针”，保留脚本扫描、同源 JS chunk 下载和运行时 `Math.random` 调用栈捕获能力。
8. 功能5备注为可扩展调试入口，后续可按目标页面扩展关键词、触发按钮选择和运行时包装函数，不局限于名字生成器。
9. popup 功能6恢复为预留按钮，不再作为独立生成名字入口。

---

## 封版说明（2026-06-20D）

本次围绕“26.6.20D 封版、按钮4正式承接生成名字功能”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.20`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.20D`。
3. README 当前版本更新为 `26.6.20D`。
4. 后台日志构建更新为 `url-capture-v10`。
5. popup 功能4由“提取地址”改为“生成名字”，直接调用本地 `/api/name/generate`。
6. popup 功能5“查询方法”调试入口已收起，恢复为预留按钮。
7. popup 功能6“生成名字”独立入口已收起，恢复为预留按钮。
8. 按钮4生成的姓名包含 `kanji`、`hiragana`、`romaji`、`meaning`、`nameType`、`gender`、`effectiveGender` 等字段，并写入 `log/name-YYYY-MM-DD.jsonl`。
9. `/api/address/from-city` 后端接口保留，方便后续地址/卡片链路继续复用。

---

## 封版说明（2026-06-20C）

本次围绕“26.6.20C 封版、CTF 内置生成名字功能”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.20`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.20C`。
3. README 当前版本更新为 `26.6.20C`。
4. 后台日志构建更新为 `url-capture-v9`。
5. 根据按钮5日志判断，目标页面点击“生成名字”时未发送网络包，运行时随机调用栈指向 `/_next/static/chunks/3942.5d6dfe14e0c8738a.js`，说明生成逻辑在浏览器本地 JS 中完成。
6. `ctf_toolkit.py` 的 `JapaneseNameGenerator` 扩展为输出 `kanji`、`hiragana`、`romaji`、`meaning`、`nameType`、`gender`、`effectiveGender` 等字段，并保留 `kanjiFull`、`kanaFull`、`kanjiGiven`、`kanaGiven` 等旧字段。
7. aiohttp 新增 JSON-RPC 接口 `/api/name/generate`，方法名 `name.generate`，结果保存到 `log/name-YYYY-MM-DD.jsonl`。
8. popup 功能6由占位改为“生成名字”，点击后调用本地后端生成姓名，并把 kanji、hiragana、romaji、meaning 和保存路径写入运行日志。

接口示例：

```json
{
  "jsonrpc": "2.0",
  "method": "name.generate",
  "params": {
    "token": "crx-00000000000000000000000000000000",
    "name_type": "fullName",
    "gender": "unisex",
    "count": 1
  },
  "id": 1
}
```

---

## 封版说明（2026-06-20B）

本次围绕“26.6.20B 封版、按钮5查询生成名字方法”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.20`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.20B`。
3. README 当前版本更新为 `26.6.20B`。
4. 后台日志构建更新为 `url-capture-v8`。
5. popup 功能5由占位按钮改为“查询方法”。
6. 功能5会读取当前活动页脚本列表、Next.js preload chunk 和内联脚本数据。
7. 功能5会尝试下载同源 JS chunk，并使用 `generateName`、`generatedName`、`kanji`、`hiragana`、`romaji`、`Math.random` 等关键词打分。
8. 功能5会在页面主执行环境中临时包装 `Math.random`，自动点击“生成名字”，捕获实际调用栈。
9. 功能5会把候选脚本 URL、来源类型、匹配分数、命中关键词、候选列表、代码片段、随机调用栈和生成后文本写入运行日志。

使用方式：

1. 打开目标页面，例如 `https://mjj.tools/zh/tools/japanese-name-generator`。
2. 点击扩展 popup 的“查询方法”按钮。
3. 在运行日志中查看 `name_method_scan_completed`，重点看“候选脚本”“随机调用栈”“命中关键词”和“代码片段”。

---

## 封版说明（2026-06-20A）

本次围绕“26.6.20A 封版、第三排预留按钮和版本同步”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.20`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.20A`。
3. README 当前版本更新为 `26.6.20A`。
4. 后台日志构建更新为 `url-capture-v7`。
5. popup 功能区新增第三排按钮，提供功能11到功能15。
6. 功能11到功能15当前为预留按钮，点击后沿用现有占位提示和 `feature_button_clicked` 日志记录。
7. 保留既有功能4“提取地址”链路，不改变地址/姓名/卡片生成接口。
8. 当前日志检查未发现 `ERROR`、`CRITICAL`、`Traceback` 或 `Application startup failed`。

封版检查建议：

- 修改 `manifest.json` 后，需要在 `chrome://extensions/` 手动刷新扩展。
- 如果 JSONL 中仍看到 `logger_build=url-capture-v6`，说明浏览器仍在运行旧 service worker；刷新扩展后应看到 `logger_build=url-capture-v7`。

---

## 封版说明（2026-06-19E）

本次围绕"26.6.19E 封版、JSON-RPC 2.0 统一改造和 IP 信息自动提取"完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.19`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.19E`。
3. README 当前版本更新为 `26.6.19E`。
4. 全面升级为 JSON-RPC 2.0 通信协议：
   - 所有前端请求统一使用 `{"jsonrpc": "2.0", "method": "...", "params": {...}, "id": ...}` 格式
   - 后端响应格式：`{"jsonrpc": "2.0", "result": {...}, "id": ...}` 或错误格式
   - 支持的 RPC 方法：`token.generate`、`token.create`、`html.captureText`、`html.captureAll`
5. RPC ID 生成优化：采用 `Date.now() * 1000000 + Math.floor(Math.random() * 1000000)` 算法，避免高并发 ID 冲突。
6. 按钮3功能升级为"抓取IP信息"：
   - 自动检测 ipinfo.dkly.net 标签页是否存在
   - 已存在：刷新标签页获取最新数据
   - 不存在：后台打开新标签页（`active: false`）
   - 等待页面加载完成（轮询检查 `status === "complete"`）
   - 自动提取页面文字内容
   - 上传到后端 `/api/html/text`
7. 后端自动提取 IP 信息：
   - 使用正则表达式从页面文字中提取 `region.name` 和 `city` 字段
   - 在响应中返回 `city` 和 `region_name`
8. 前端运行日志增强：
   - 新增 `ip_info_captured` 事件类型
   - 显示 RPC ID、城市、区域、字节数等完整信息
   - 状态栏显示格式：`Tokyo / Chiyoda（5622 字节）`
9. 后端 JSONL 日志包含 `rpc_id` 字段，便于追踪请求链路。
10. 后端同时支持 REST 和 JSON-RPC 2.0 格式，通过检测 `jsonrpc: "2.0"` 字段自动路由。
11. 新增 `notifications` 权限（预留系统通知功能）。
12. `/api/get_crc_token` 同时支持 GET 和 POST 请求。

按钮3工作流程：

```
检测标签页 → 刷新/打开 → 等待加载 → 提取内容 → 上传 → 提取城市信息 → 显示结果
```

封版检查结果：

- `background.js`、`content.js`、`popup.js` 语法检查通过。
- `manifest.json` JSON 格式检查通过。
- `main.py`、`server/app.py`、`server/runner.py` Python 编译检查通过。
- JSON-RPC 格式请求和响应已通过本地接口验证。
- RPC ID 唯一性已验证（时间戳+随机数组合）。
- City 信息提取已验证（正则匹配 `"name": "Tokyo"` 和 `"city": "Chiyoda"`）。
- 运行日志正常显示 RPC ID、城市、区域信息。
- 后端 JSONL 日志正常包含 `rpc_id` 字段。
- 向后兼容性验证通过（REST 格式仍可正常工作）。

---

## 封版说明（2026-06-19D）

本次围绕“26.6.19D 封版、按钮2页面内容保存和启动脚本文档化”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 保持 `26.6.19`，符合 Chrome 纯数字点分版本要求。
2. `chrome-extension/manifest.json` 的 `version_name` 更新为 `26.6.19D`。
3. README 当前版本更新为 `26.6.19D`。
4. 后台日志构建更新为 `url-capture-v6`。
5. 后台 Console 标题改为展示 `version_name`，例如 `26.6.19D`，方便观察封版日志。
6. 按钮2确认改为提取当前活动页内容，包括页面正文文字和完整 HTML。
7. 按钮2上传时会携带按钮1刷新后保存的后端 token；未刷新 token 时会提示先刷新。
8. `/api/token/create` 创建 `db/[token].csv` 时同步创建 `db/[token]/` 文件夹。
9. `/api/html/all` 不再写入 `html-all-YYYY-MM-DD.jsonl`，而是把完整 HTML 保存到 `db/[token]/[time].html`。
10. `/api/html/text` 继续写入 `log/html-text-YYYY-MM-DD.jsonl`，便于观察小体积正文。
11. 按钮2页面文字上传超时为 10 秒，完整 HTML 上传超时为 30 秒；其它普通请求默认仍为 3 秒。
12. 新增 `main.bat` 文档说明：脚本会创建 `db/`、`log/`，设置 UTF-8，并以 `0.0.0.0:8080` 启动后端。

封版检查结果：

- `background.js`、`content.js`、`popup.js` 语法检查通过。
- `manifest.json` JSON 格式检查通过。
- `main.py`、`server/app.py`、`server/runner.py` Python 编译检查通过。
- `/api/get_crc_token`、`/api/token/create`、`/api/html/text`、`/api/html/all` 行为已通过本地接口验证。
- 完整 HTML 已验证保存为 `db/[token]/[time].html`，且 `html-all` JSONL 不再增长。
- 旧独立卡片生成器已移除，卡片生成改由 `ctf_toolkit.py` 的 `LuhnCardGenerator` 提供。

## 封版说明（2026-06-19C）

本次围绕“26.6.19C 封版、运行日志观察和后端 token 刷新链路”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.19`，保持 Chrome 要求的纯数字点分格式。
2. `chrome-extension/manifest.json` 新增/更新 `version_name` 为 `26.6.19C`，用于展示带字母的版本名。
3. README 当前版本更新为 `26.6.19C`。
4. 后台日志构建更新为 `url-capture-v5`。
5. `background.js` 在 URL 跳转记录写入 `chrome.storage.local` 后，会异步 POST 到 `/api/report`。
6. URL 上报沿用已有 `/api/report` JSON 格式，后端继续写入 `log/YYYY-MM-DD.jsonl`。
7. URL 上报失败只记录到扩展 Service Worker Console，不影响本地 popup 日志展示。
8. popup 功能1改名为“刷新后端token”。
9. 新增 `GET /api/get_crc_token`，生成 `crx-` + 32 位 hex token。
10. 新增 `POST /api/token/create`，用 token 和全部标签页快照创建 `db/[token].csv`。
11. token CSV 第一行为表头，第二行为“登录成功”记录，包含 ISO UTC 时间、UA、remote 和窗口快照 JSON。
12. 如果 token CSV 已存在，后端返回 `400`，不覆盖旧文件。
13. 创建 token CSV 时同步创建 `db/[token]/` 文件夹，供按钮2保存完整 HTML。
14. popup 功能区新增第二排按钮，提供功能6到功能10，占位行为沿用功能2到功能5。
15. popup “网页跳转记录”面板升级为“运行日志”，原 URL 跳转记录格式保持不变。
16. 刷新后端 token 的前端链路会写入运行日志，包括 `token_refresh_started`、`token_requested`、`tabs_snapshot_collected`、`token_create_succeeded`、`token_create_failed` 和 `token_refresh_failed`。
17. 运行日志导出文件名更新为 `runtime-log-*.json`。

封版检查结果：

- `log/2026-06-19.jsonl` 可正常逐行解析，当前未发现坏 JSON 行。
- `log/runtime-2026-06-19.log` 未发现 `ERROR`、`CRITICAL`、`Traceback` 或异常堆栈。
- 现有 `db/crx-*.csv` 均为两行结构：表头 + 登录成功记录，窗口快照 JSON 可解析。
- 本地接口验证确认 `/api/get_crc_token`、`/api/token/create` 和重复 token 返回 `400` 行为正常。
- 注意：如果 JSONL 中仍看到 `logger_build=url-capture-v4`，说明浏览器仍在运行旧 service worker；在 `chrome://extensions/` 刷新扩展后，应看到 `logger_build=url-capture-v5`。

## 今日任务梳理（2026-06-19A）

本次围绕“版本同步和 URL 跳转记录后端落盘”完成以下更新：

1. `chrome-extension/manifest.json` 的 `version` 更新为 `26.6.19`，保持 Chrome 要求的纯数字点分格式。
2. `chrome-extension/manifest.json` 新增/更新 `version_name` 为 `26.6.19B`，用于展示带字母的版本名。
3. README 当前版本更新为 `26.6.19A`。
4. 后台日志构建更新为 `url-capture-v4`。
5. `background.js` 在 URL 跳转记录写入 `chrome.storage.local` 后，会异步 POST 到 `/api/report`。
6. URL 上报沿用已有 `/api/report` JSON 格式，后端继续写入 `log/YYYY-MM-DD.jsonl`。
7. URL 上报失败只记录到扩展 Service Worker Console，不影响本地 popup 日志展示。

## 今日任务梳理（2026-06-16A）

本次围绕“扩展和 aiohttp 联动”完成以下更新：

1. 新增 Python 文件日志，启动 `main.py` 会创建 `log/` 并写入 `runtime-YYYY-MM-DD.log`。
2. 新增 `POST /api/log`，用于接收扩展 JSON 上报并写入 `log/YYYY-MM-DD.jsonl`。
3. 新增 `POST /api/report`，作为推荐上报路径，避免部分指纹浏览器或拦截规则阻断 `/api/log`。
4. `/api/log` 和 `/api/report` 支持 `OPTIONS` 和基础 CORS 响应头。
5. popup 功能1改为直接向保存的后端地址发送测试上报。
6. 发现指纹浏览器会阻断 `127.0.0.1`，改用 `--host 0.0.0.0` + 局域网 IP 连接。
7. 已验证 `http://192.168.1.15:8080/api/report` 可接收功能1上报。
8. 扩展 `connect-src` 已允许连接普通 HTTP 后端地址。

---

## 今日任务梳理（1.1.1）

本版本围绕“日志安全性”和“本机复盘便利性”做了以下更新：

1. 新增 `content.js`，在网页右下角注入 URL 跳转记录浮窗。
2. 浮窗提供开关按钮，打开后开始记录当前标签页 URL。
3. 浮窗日志保存在 `chrome.storage.local`，按标签页 ID 区分。
4. 新增 `webNavigation.onBeforeNavigate`，用于捕获 Chrome 准备导航到某个 URL 的阶段。
5. 新增 `webRequest.onBeforeRequest`，用于捕获主页面请求发出前的 URL。
6. 新增 `webNavigation.onErrorOccurred`，用于捕获导航失败或被拦截时的 URL 和错误信息。
7. 新增 `tabs.onUpdated.url`，用于捕获地址栏 URL 变化。
8. 新增敏感参数自动脱敏，默认处理 `code`、`state`、`token`、`session`、`auth` 等常见字段。
9. 浮窗新增“复制”按钮，便于直接复制当前标签页日志。
10. 浮窗新增“导出 JSON”按钮，便于在本机保存脱敏后的结构化日志。
11. 后台日志新增 `extensionVersion=1.1.1` 和 `loggerBuild=url-capture-v3`。

---

## URL 捕获方法说明

当前扩展使用多层捕获，不同来源代表不同阶段。

| 来源 | 位置 | 含义 | 适合观察 |
|---|---|---|---|
| `url_changed` | `content.js` | 页面内轮询发现 `window.location.href` 变化 | 页面已可执行脚本后的最终 URL 或 SPA URL |
| `hashchange` | `content.js` | hash 发生变化 | `#xxx` 路由变化 |
| `pushState` / `replaceState` | `content.js` | 页面 history API 地址变化 | 单页应用路由变化 |
| `tabs.onUpdated.url` | `background.js` | 标签页地址栏 URL 变化 | 肉眼看到地址栏变化的场景 |
| `webNavigation.onBeforeNavigate` | `background.js` | Chrome 准备导航到某个 URL | 一闪而过的中间 URL，优先看这个 |
| `webRequest.onBeforeRequest` | `background.js` | 主页面请求发出前 | 请求级别的主框架 URL |
| `webNavigation.onErrorOccurred` | `background.js` | 导航失败或被拦截 | 失败 URL 和错误原因 |

如果目标是捕获被拦截前的中间链接，优先查看：

```text
reason: webNavigation.onBeforeNavigate
```

其次查看：

```text
reason: tabs.onUpdated.url
```

---

## 典型日志解读

示例日志：

```json
{
  "time": "2026-06-04T08:55:32.637Z",
  "extensionVersion": "26.6.19",
  "loggerBuild": "url-capture-v6",
  "eventName": "url_jump_recorded",
  "tabContext": {
    "tabId": 1534284702
  },
  "navigation": {
    "time": "2026/6/4 17:55:32",
    "title": "",
    "reason": "webNavigation.onBeforeNavigate",
    "url": "http://localhost:1455/auth/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D",
    "frameId": 0,
    "requestId": "",
    "transitionType": "",
    "error": ""
  }
}
```

这条日志表示：Chrome 准备把当前主页面导航到 `http://localhost:1455/auth/callback?...`。

如果后续又出现：

```text
https://getip.morelogin.com/black_whiteList_stop_page.html
```

通常说明中间回调地址随后被代理环境、指纹浏览器、黑白名单规则或安全策略拦截，最终落到了拦截页。

---

## 本地加载扩展

1. 打开 Chrome。
2. 访问 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择：`<PROJECT_ROOT>\chrome-extension`。
6. 加载后刷新目标网页。

如果修改了 `manifest.json` 或新增权限，需要重新刷新扩展，并接受 Chrome 的权限提示。

---

## 查看后台日志

后台日志通过 `background.js` 输出到扩展的 Service Worker Console。

操作步骤：

1. 打开 `chrome://extensions/`。
2. 找到当前扩展。
3. 点击扩展卡片里的 `Service Worker` 或“检查视图”。
4. 在 DevTools Console 中查看日志。

当前版本日志标题格式：

```text
[My Extension v26.7.5A url-capture-v16] url_jump_recorded 2026-...
```

如果仍然看到旧格式：

```text
[My Extension] ...
```

说明 Chrome 仍在运行旧的 service worker。建议刷新扩展，关闭旧 Console，再重新打开 Service Worker Console。

---

## 权限说明

当前 `manifest.json` 权限：

| 权限 | 用途 |
|---|---|
| `activeTab` | popup 中读取当前活动标签页信息 |
| `storage` | 保存后端地址、URL 记录状态和 URL 日志 |
| `tabs` | 监听标签页地址栏 URL 更新 |
| `scripting` | 按钮2在当前活动页执行脚本，提取页面文字和完整 HTML |
| `webNavigation` | 监听 Chrome 导航阶段 |
| `webRequest` | 监听主页面请求发出前的 URL |
| `host_permissions` | 允许在 `http://*/*` 和 `https://*/*` 页面注入脚本并监听请求 |

权限控制原则：

- 当前权限都服务于 URL 调试和日志展示。
- 后续新增权限前先确认确实需要。
- 不建议为了省事直接扩大到无关权限。

---

## 类似工作流说明

当前扩展虽然不是 Python 类式项目，但核心逻辑可以按三个层次理解。

### 1) 页面采集层：content.js

- 监听页面内 `location`、`hashchange`、history API 相关变化
- 将页面内 URL 变化发送给后台
- 不再创建右下角浮窗

### 2) 后台捕获层：background.js

- 输出统一结构化日志
- 管理版本字段和构建标识
- 监听 `webNavigation`、`webRequest`、`tabs` 事件
- 将捕获结果写入 `chrome.storage.local`
- 扩展安装或浏览器启动时尝试向后端发送加载上报

### 3) popup 控制层：popup.js

- 管理后端地址输入框和保存按钮
- 展示、复制、导出、清空运行日志
- 功能1向 `/api/get_crc_token` 申请 token，再向 `/api/token/create` 创建 CSV 登录记录
- 功能2提取当前活动页的页面正文文字和完整 HTML，并分别发送到 `/api/html/text` 与 `/api/html/all`
- 功能4入口当前禁用，但保留地址、Luhn 测试卡和新版日本姓名生成逻辑
- 功能5为 JS 探针，当前默认围绕名字生成器关键词和随机调用栈，后续可扩展其它 JS 方法
- 功能6提取 ChatGPT accessToken，展示 workspace 列表，并支持导出 workspace AT JSON 和 `team.csv`
- 功能7抓取 MayIP 信息，写回 `country`、`city`、`region_name`
- 功能8查询 AddressGen 城市并申请地址，结果通过浮窗展示
- 功能9到功能15为预留按钮，当前使用占位点击提示
- 读取当前活动标签页
- 输出当前页面标题、URL、域名、tab ID、窗口 ID 等信息
- 将 popup 打开事件发送给后台日志

这个分层的好处是：页面脚本只负责采集页面内变化，后台负责更早阶段的浏览器事件，popup 负责可见交互和手动联调。

---

## 安全注意事项

捕获到的 URL 可能包含敏感参数，例如：

- `code`
- `state`
- `token`
- `session`
- `auth`

这些参数可能代表登录授权、会话状态或临时凭证。

建议：

1. 日志只在本机调试使用。
2. 不要把未脱敏的原始 URL 发送给第三方。
3. 当前导出 JSON 默认保存脱敏后的日志。
4. 如果 URL 中包含 OAuth `code`，应视为敏感临时授权信息。

---

## 测试与验证

语法检查：

```powershell
node --check .\chrome-extension\background.js
node --check .\chrome-extension\content.js
node --check .\chrome-extension\popup.js
```

Manifest JSON 检查：

```powershell
Get-Content -Raw .\chrome-extension\manifest.json | ConvertFrom-Json | Out-Null
```

本次文档更新前已确认：

- `background.js` 语法检查通过
- `content.js` 语法检查通过
- `popup.js` 语法检查通过
- `manifest.json` JSON 格式检查通过
- `main.py`、`server/app.py`、`server/runner.py` Python 编译检查通过
- `/api/get_crc_token`、`/api/token/create` 接口行为验证通过
- 重复 token 返回 `400` 且不会覆盖已存在 CSV
- `/api/html/text`、`/api/html/all` 接口行为验证通过，其中完整 HTML 保存为 `db/[token]/[time].html`
- 实测已捕获 `webNavigation.onBeforeNavigate` 来源的 `localhost` 回调中间 URL

---

## 当前项目变化检查（本次会话）

本次会话主要变更集中在：

- `README.md`：项目说明文档
- `chrome-extension/manifest.json`：版本为 `26.7.5`，展示版本为 `26.7.5A`，包含导航捕获所需权限
- `chrome-extension/background.js`：负责后台日志、导航捕获、版本输出和加载上报
- `chrome-extension/content.js`：负责页面内 URL 变化采集
- `chrome-extension/popup.html`：负责 popup 布局、功能1到功能15和运行日志面板
- `chrome-extension/popup.js`：负责地址配置、功能按钮、运行日志展示、刷新 token、页面内容提取、按钮6 workspace 导出和按钮8城市检查
- `server/app.py`：负责 Dashboard、地址/姓名/卡片生成接口、扩展上报接口、token 生成、CSV 创建接口和页面内容接收接口
- `main.py`：负责初始化控制台和文件日志

如需后续做版本提交，建议先检查：

```powershell
git diff -- README.md chrome-extension\manifest.json chrome-extension\background.js chrome-extension\content.js chrome-extension\popup.js
```

---

## 后续建议

- 增加只记录指定 URL 前缀的过滤规则。
- 将 `localhost:1455/auth/callback` 这类目标 URL 自动高亮。
- 增加独立 options 页面，管理日志保留数量、匹配规则和脱敏规则。
- 后续如果要长期使用，建议把扩展名称、图标和 README 中的项目名统一成正式名称。

---

## TODO：跨扩展内容提取（方案C）

### 当前限制

按钮3可以检查任意窗口信息，但遇到 **其他扩展的页面**（`chrome-extension://其他扩展ID/xxx.html`）时，由于 Chrome 安全策略限制，无法通过扩展 API 提取内容。

**Chrome 硬性限制**：
- `chrome.scripting.executeScript()` 不能跨扩展执行
- `content.js` 不能通过 `manifest.json` 声明注入到其他扩展页面
- `fetch()` 不支持 `chrome-extension://` 协议

示例：当前扩展无法提取 `chrome-extension://<OTHER_EXTENSION_ID>/index.html` 的内容。

### 未来方案：Chrome DevTools Protocol（CDP）

使用外部程序通过 CDP 控制浏览器，绕过扩展沙箱限制，实现跨扩展内容抓取。

#### 实现思路

1. **架构调整**：
   - 保持当前 Chrome 扩展作为 UI 入口（按钮3检查窗口信息）
   - 新增 Python CDP 控制器（通过 Selenium/Playwright 连接浏览器）
   - aiohttp 后端作为中间协调层

2. **工作流程**：
   ```
   用户点击按钮3 
   → 扩展检测到是其他扩展页面
   → 扩展通过后端 API 通知 CDP 控制器
   → CDP 控制器使用 Page.captureSnapshot 或 Runtime.evaluate 提取内容
   → 内容回传到后端保存
   → 扩展显示提取成功
   ```

3. **技术栈选择**：
   - **Selenium + Chrome Driver**：成熟稳定，支持 CDP
   - **Playwright**（推荐）：原生支持 CDP，API 更现代
   - **puppeteer-python**：Python 封装的 Puppeteer

4. **CDP 关键 API**：
   ```python
   # 通过 CDP 提取页面内容，无视扩展隔离
   page.evaluate("document.body.innerText")
   page.evaluate("document.documentElement.outerHTML")
   page.evaluate("({ title: document.title, url: location.href, text: document.body.innerText })")
   ```

5. **连接方式**：
   - 启动浏览器时开启远程调试端口：`chrome.exe --remote-debugging-port=9222`
   - 或使用 Playwright 的 `browser.connect_over_cdp()`
   - 指纹浏览器通常已开启 CDP 端口，可直接连接

#### 实现步骤

**Phase 1：基础架构**
- [ ] 新增 `cdp_controller.py`，封装 CDP 连接和页面操作
- [ ] aiohttp 新增 `/api/cdp/extract` 接口，接收扩展的跨域提取请求
- [ ] 扩展按钮3检测到跨扩展页面时，改为调用 `/api/cdp/extract`

**Phase 2：CDP 提取逻辑**
- [ ] CDP 控制器连接到当前浏览器实例（通过调试端口）
- [ ] 根据 `windowId` 和 `tabId` 定位目标页面
- [ ] 执行 JavaScript 提取 `title`、`url`、`text`、`html`
- [ ] 将内容返回给后端，写入 `log/html-text-YYYY-MM-DD.jsonl`

**Phase 3：错误处理和日志**
- [ ] CDP 连接失败时的降级处理
- [ ] 超时控制（CDP 操作可能卡住）
- [ ] 运行日志记录：`cdp_extract_started`、`cdp_extract_completed`、`cdp_extract_failed`

**Phase 4：隐私模式支持**
- [ ] CDP 支持连接隐私模式窗口
- [ ] 验证指纹浏览器环境下的 CDP 兼容性

#### 参考资料

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Playwright Python - CDP Sessions](https://playwright.dev/python/docs/api/class-cdpsession)
- [Selenium 4 CDP Support](https://www.selenium.dev/documentation/webdriver/bidirectional/chrome_devtools/)

#### 预期效果

实现后，按钮3可以提取**任意页面**的内容，包括：
- ✅ 普通 HTTP/HTTPS 页面
- ✅ 自己扩展的页面
- ✅ **其他扩展的页面**（通过 CDP）
- ✅ `chrome://` 系统页面（通过 CDP，需额外权限）

---

## 当前项目变化检查（本次会话）
