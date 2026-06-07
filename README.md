# Chrome URL 跳转捕获扩展

> 当前版本：`1.1.0`  
> 最后更新：`2026-06-04`  
> 日志构建：`url-capture-v2`  
> 项目定位：合法合规地调试 Chrome 页面跳转链路，重点用于观察地址栏变化、主框架导航、被拦截前的中间 URL、最终落地页与完整跳转日志。

---

## 项目简介

本项目是一个 Manifest V3 Chrome 扩展，用于记录当前标签页的 URL 跳转过程。

当前重点不是自动化绕过浏览器限制，而是把跳转链路看清楚、记录下来、方便复现：

- 在网页右下角注入 URL 跳转记录浮窗
- 通过开关控制是否记录当前标签页 URL 变化
- 在浮窗日志框内输出完整 URL
- 使用后台 `service worker` 记录结构化日志
- 记录 popup 打开时的当前页面信息
- 监听地址栏变化、主框架导航、请求发出前和导航错误事件
- 尽量捕获一闪而过、随后被拦截或重定向的中间 URL
- 在日志中输出版本号和构建标识，确认 Chrome 是否加载了最新代码

---

## 版本管理

版本号格式采用：`主版本.次版本.补丁版本`。

示例：

| 版本 | 日期 | 说明 |
|---|---|---|
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
m202604.crx/
├── README.md
├── README2.md                  # 参考说明文档格式
└── chrome-extension/
    ├── manifest.json           # Chrome 扩展配置
    ├── background.js           # 后台 service worker，负责捕获导航和输出日志
    ├── content.js              # 注入网页的浮窗与页面内 URL 记录逻辑
    ├── popup.html              # 扩展图标 popup 页面
    └── popup.js                # popup 当前页面信息采集逻辑
```

说明：

- 真正需要加载到 Chrome 的目录是 `chrome-extension/`。
- `README2.md` 只是格式参考，不属于扩展运行文件。
- 修改 `manifest.json` 后必须在 `chrome://extensions/` 手动刷新扩展。

---

## 推荐入口：页面右下角浮窗

当前最主要的使用入口是网页右下角的 `URL 跳转记录` 浮窗。

完整流程：

1. Chrome 加载 `chrome-extension/`。
2. 打开目标网页。
3. 刷新目标网页，让 content script 注入。
4. 在右下角浮窗中打开记录开关。
5. 执行会触发跳转的操作。
6. 在浮窗日志框查看 URL 记录。
7. 在 Service Worker Console 查看更完整的结构化日志。

默认安全策略：

- 只有打开浮窗开关后才记录当前标签页 URL。
- 日志默认保存在本机 `chrome.storage.local`。
- 每个标签页最多保留最近 `100` 条 URL 日志。
- 日志不会主动发送到外部服务。

---

## 当前能力

- 使用 Manifest V3。
- 提供基础 popup 页面。
- popup 打开时读取当前标签页信息。
- 后台记录扩展安装、浏览器启动、popup 打开等事件。
- 页面内显示 URL 跳转记录浮窗。
- 浮窗支持开启、关闭和清空日志。
- 支持普通页面跳转记录。
- 支持 SPA 地址变化记录。
- 支持 hash 变化记录。
- 支持主框架导航开始前 URL 捕获。
- 支持主页面请求发出前 URL 捕获。
- 支持导航错误 URL 捕获。
- 支持地址栏 URL 更新捕获。

---

## 今日任务梳理（1.1.0）

本版本围绕“一闪而过的中间 URL 捕获”和“可确认版本的日志输出”做了以下更新：

1. 新增 `content.js`，在网页右下角注入 URL 跳转记录浮窗。
2. 浮窗提供开关按钮，打开后开始记录当前标签页 URL。
3. 浮窗日志保存在 `chrome.storage.local`，按标签页 ID 区分。
4. 新增 `webNavigation.onBeforeNavigate`，用于捕获 Chrome 准备导航到某个 URL 的阶段。
5. 新增 `webRequest.onBeforeRequest`，用于捕获主页面请求发出前的 URL。
6. 新增 `webNavigation.onErrorOccurred`，用于捕获导航失败或被拦截时的 URL 和错误信息。
7. 新增 `tabs.onUpdated.url`，用于捕获地址栏 URL 变化。
8. 后台日志新增 `extensionVersion=1.1.0` 和 `loggerBuild=url-capture-v2`。
9. 已通过实测捕获到 `http://localhost:1455/auth/callback?code=...&state=...` 这类 OAuth 回调中间 URL。

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
  "extensionVersion": "1.1.0",
  "loggerBuild": "url-capture-v2",
  "eventName": "url_jump_recorded",
  "tabContext": {
    "tabId": 1534284702
  },
  "navigation": {
    "time": "2026/6/4 17:55:32",
    "title": "",
    "reason": "webNavigation.onBeforeNavigate",
    "url": "http://localhost:1455/auth/callback?code=...&state=...",
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
[My Extension v1.1.0 url-capture-v2] url_jump_recorded 2026-...
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
| `storage` | 保存浮窗开关状态和 URL 日志 |
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

### 1) 页面展示层：content.js

- 创建右下角浮窗
- 管理开关状态
- 展示 URL 日志
- 监听页面内 `location`、`hashchange`、history API 相关变化
- 接收后台推送的 URL 日志更新

### 2) 后台捕获层：background.js

- 输出统一结构化日志
- 管理版本字段和构建标识
- 监听 `webNavigation`、`webRequest`、`tabs` 事件
- 将捕获结果写入 `chrome.storage.local`
- 尝试通知 content script 更新浮窗

### 3) popup 信息层：popup.js

- 读取当前活动标签页
- 输出当前页面标题、URL、域名、tab ID、窗口 ID 等信息
- 将 popup 打开事件发送给后台日志

这个分层的好处是：页面浮窗只负责看得见的交互，后台负责更早阶段的浏览器事件，popup 负责临时查看当前页面信息。

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
2. 不要把未脱敏的完整 URL 发送给第三方。
3. 后续如果要导出日志，优先增加自动脱敏能力。
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

- `README.md`：按照 `README2.md` 的说明风格重写项目文档
- `chrome-extension/manifest.json`：版本为 `1.1.0`，包含导航捕获所需权限
- `chrome-extension/background.js`：负责后台日志、导航捕获、版本输出
- `chrome-extension/content.js`：负责页面浮窗、开关、日志框和页面内 URL 变化记录
- `chrome-extension/popup.js`：负责 popup 打开时记录当前页面信息

如需后续做版本提交，建议先检查：

```powershell
git diff -- README.md chrome-extension\manifest.json chrome-extension\background.js chrome-extension\content.js chrome-extension\popup.js
```

---

## 后续建议

- 增加“复制当前日志”按钮。
- 增加“导出 JSON”按钮。
- 对敏感 URL 参数自动脱敏。
- 增加只记录指定 URL 前缀的过滤规则。
- 将 `localhost:1455/auth/callback` 这类目标 URL 自动高亮。
- 增加独立 options 页面，管理日志保留数量、匹配规则和脱敏规则。
- 后续如果要长期使用，建议把扩展名称、图标和 README 中的项目名统一成正式名称。
