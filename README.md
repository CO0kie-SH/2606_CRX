# Chrome URL 跳转捕获扩展

> 当前版本：`1.1.2-dev`  
> 最后更新：`2026-06-16A`  
> 日志构建：`url-capture-v3`  
> 项目定位：合法合规地调试 Chrome 页面跳转链路，并通过本地 aiohttp 服务接收扩展上报、生成 CTF 测试题目和保存调试日志。

---

## 项目简介

本项目是一个 Manifest V3 Chrome 扩展 + aiohttp 本地服务的组合项目，用于记录浏览器 URL 跳转过程、生成 CTF 测试数据，并把扩展侧事件上报到本机日志目录。

当前重点不是自动化绕过浏览器限制，而是把跳转链路看清楚、记录下来、方便复现：

- 在扩展 popup 主页面展示 URL 跳转记录
- 通过 popup 开关控制是否记录 URL 变化，默认开启
- 在 popup 日志框内输出脱敏后的完整 URL
- 使用后台 `service worker` 记录结构化日志
- 记录 popup 打开时的当前页面信息
- 监听地址栏变化、主框架导航、请求发出前和导航错误事件
- 尽量捕获一闪而过、随后被拦截或重定向的中间 URL
- 通过 aiohttp 的 `/api/report` 接收扩展上报，并写入 `log/YYYY-MM-DD.jsonl`
- Python 运行日志写入 `log/runtime-YYYY-MM-DD.log`

---

## 版本管理

版本号格式采用：`主版本.次版本.补丁版本`。

示例：

| 版本 | 日期 | 说明 |
|---|---|---|
| `1.1.2-dev` | 2026-06-16A | 新增 aiohttp `/api/log` 与 `/api/report` 上报接口；Python 启动日志落地到 `log/runtime-YYYY-MM-DD.log`；popup 功能1可向后端发送测试上报；URL 记录面板迁移到 popup；补充指纹浏览器使用局域网 IP 的连接方式 |
| `1.1.1` | 2026-06-12 | 新增敏感参数自动脱敏；浮窗新增“复制”和“导出 JSON”；popup 当前页面 URL 同步脱敏；后台日志构建更新为 `url-capture-v3` |
| `1.1.0` | 2026-06-04 | 新增页面内 URL 记录浮窗；新增 `storage`、`tabs`、`webNavigation`、`webRequest` 捕获链路；后台日志加入 `extensionVersion` 和 `loggerBuild`；可捕获 `localhost` OAuth 回调这类中间 URL |
| `1.0.0` | 2026-06-04 | 初始 Manifest V3 扩展；包含 `manifest.json`、popup 页面、基础后台日志与当前页面信息输出 |

重要功能变更时建议同步更新：

- `manifest.json` 中的 `version`
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
2606_CRX/
├── README.md
├── main.py                    # aiohttp 服务启动入口，启动日志写入 log/runtime-YYYY-MM-DD.log
├── server/
│   ├── app.py                 # HTTP 路由、Visa 题目接口、扩展日志上报接口
│   └── runner.py              # aiohttp host/port 参数
├── static/                    # 本地 CTF Dashboard
├── log/                       # 运行日志和扩展上报日志
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
4. URL 记录默认开启，可在 popup 中查看、复制、导出或清空。
5. 点击“功能1”可向后端发送一条测试上报。
6. 在 `log/YYYY-MM-DD.jsonl` 查看扩展上报记录。
7. 在 Service Worker Console 查看更完整的结构化日志。

默认安全策略：

- URL 记录默认开启，可在 popup 手动关闭。
- 日志默认保存在本机 `chrome.storage.local`。
- URL 跳转记录最多保留最近 `300` 条。
- 只有功能1或扩展加载上报会发送到已保存的后端地址。

---

## 本地服务与日志

推荐 Python 环境：

```powershell
D:\0Code2\py312\python.exe
```

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

已验证功能1成功上报到：

```text
http://192.168.1.15:8080/api/report
```

日志文件：

| 文件 | 来源 | 说明 |
|---|---|---|
| `log/runtime-YYYY-MM-DD.log` | `main.py` | Python 启动、解释器路径、aiohttp 运行日志 |
| `log/YYYY-MM-DD.jsonl` | `/api/log` 或 `/api/report` | 扩展 POST 上报，每行一条 JSON |

当前主要接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/status` | Dashboard 状态 |
| `GET` | `/api/visa` | 随机生成一组 Visa CTF 测试数据 |
| `POST` | `/api/log` | 扩展日志上报原始路径 |
| `POST` | `/api/report` | 扩展日志上报推荐路径，避免部分浏览器拦截 `/api/log` |

---

## 当前能力

- 使用 Manifest V3。
- 提供基础 popup 页面。
- popup 提供后端地址输入框，默认 `http://127.0.0.1:8080/`。
- popup 提供功能1到功能5，其中功能1用于发送测试上报。
- popup 打开时读取当前标签页信息。
- 后台记录扩展安装、浏览器启动、popup 打开等事件。
- popup 显示 URL 跳转记录面板。
- URL 记录支持开启、关闭和清空日志。
- URL 记录支持复制当前日志和导出 JSON。
- 对常见敏感参数自动脱敏后再展示和持久化。
- 支持普通页面跳转记录。
- 支持 SPA 地址变化记录。
- 支持 hash 变化记录。
- 支持主框架导航开始前 URL 捕获。
- 支持主页面请求发出前 URL 捕获。
- 支持导航错误 URL 捕获。
- 支持地址栏 URL 更新捕获。
- aiohttp 支持接收扩展上报并保存 JSONL 日志。
- aiohttp 支持启动日志落地。
- aiohttp 支持 Visa CTF 数据生成接口 `/api/visa`。

---

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
  "extensionVersion": "1.1.1",
  "loggerBuild": "url-capture-v3",
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
5. 选择：`D:\PycharmProjects\m202604.crx\chrome-extension`。
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
[My Extension v1.1.1 url-capture-v3] url_jump_recorded 2026-...
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
- 展示、复制、导出、清空 URL 记录
- 功能1向 `/api/report` 发送测试上报
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
- 实测已捕获 `webNavigation.onBeforeNavigate` 来源的 `localhost` 回调中间 URL

---

## 当前项目变化检查（本次会话）

本次会话主要变更集中在：

- `README.md`：项目说明文档
- `chrome-extension/manifest.json`：版本为 `1.1.1`，包含导航捕获所需权限
- `chrome-extension/background.js`：负责后台日志、导航捕获、版本输出和加载上报
- `chrome-extension/content.js`：负责页面内 URL 变化采集
- `chrome-extension/popup.js`：负责地址配置、功能按钮、URL 记录展示和手动上报
- `server/app.py`：负责 Dashboard、Visa 题目接口和扩展上报接口
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
