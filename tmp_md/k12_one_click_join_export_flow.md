# K12 一键上车并导出凭证流程

来源文件：`k12/tmp.js`

本文档只拆解 `tmp.js` 中第七个流程：按钮「一键上车并导出凭证」。该脚本是运行在 `chatgpt.com` 页面内的 bookmarklet，会复用当前页面登录态请求同源接口。

## 入口

UI 按钮：

```js
jrK12AutoExport
```

事件绑定：

```js
G && (G.onclick = sn)
```

核心函数：

```js
async function sn()
```

## 用户输入

输入框内容来自：

```js
jrK12Ids
```

解析函数：

```js
Q()
```

`Q()` 的行为：

- 读取输入框文本。
- 做 `NFKC` 标准化。
- 把不同形态的横线统一成 `-`。
- 用 UUID 正则提取工作区 ID。
- 去重。
- 全部转成小写。

识别格式：

```regex
[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
```

没有识别到 UUID 时，流程停止。

## 输出格式选择

点击按钮后会弹出 `prompt`，让用户选择导出格式：

| 输入 | 格式 |
|---|---|
| `1` / `codex` | `Codex auth.json` |
| `2` / `cpa` | `CPA JSON` |
| `3` / `sub` / `sub2api` | `sub2api bundle` |

用户取消 prompt 时，流程停止。

## 全局状态

脚本维护两个关键变量：

```js
let k = ""; // 当前 accessToken
let h = ""; // 当前 userId
```

在一键流程开始时，会先刷新当前 Session，并保存原始状态：

```js
await E()
const originalToken = k
const originalUserId = h
```

之后每处理一个目标工作区前都会恢复：

```js
k = originalToken
h = originalUserId
```

这个设计是为了确保每次“上车”请求都使用最初的当前账号 token，而不是上一个目标工作区交换出来的 token。

## Step 1：刷新当前 Session

调用函数：

```js
E()
```

请求：

```http
GET /api/auth/session
credentials: include
accept: */*
```

作用：

- 获取当前 ChatGPT 登录态。
- 提取 `accessToken`。
- 从返回 JSON 或 JWT payload 中提取用户 ID。
- 写入全局变量 `k` 和 `h`。

失败条件：

- HTTP 非 2xx。
- 没有拿到 `accessToken`。

## Step 2：逐个处理目标工作区

对每个输入的 workspace ID，执行以下子流程。

### 2.1 恢复原始 token

```js
k = originalToken
h = originalUserId
```

### 2.2 尝试上车

调用函数：

```js
B(workspaceId)
```

请求：

```http
POST /backend-api/accounts/{workspace_id}/invites/request
credentials: include
authorization: Bearer {k}
content-type: application/json
oai-language: navigator.language || "en-US"
body: {}
```

行为：

- 成功：记录“上车成功”。
- 失败：记录警告，但不中断当前工作区的后续导出。

这里的失败不一定代表最终不可导出，因为账号可能已经在该工作区内，或者邀请状态已有变化，所以脚本会继续尝试交换目标工作区 Session。

### 2.3 交换目标工作区 Session

调用函数：

```js
A(workspaceId)
```

请求：

```http
GET /api/auth/session?exchange_workspace_token=true&workspace_id={workspaceId}&reason=setCurrentAccount
credentials: include
accept: */*
```

作用：

- 请求 ChatGPT 为目标工作区返回对应 Session。
- 从返回中取出目标工作区 `accessToken`。
- 更新全局变量 `k` 为目标工作区 token。

### 2.4 校验目标 Session

`A()` 会解析目标 `accessToken` 的 JWT payload：

```js
https://api.openai.com/auth.chatgpt_account_id
```

然后和输入的 `workspaceId` 做小写比较。

如果不一致，报错：

```text
未拿到目标工作区 Session
```

这个校验很关键，避免把当前工作区或错误工作区的 token 导出成目标工作区凭证。

### 2.5 生成凭证中间对象

调用函数：

```js
W(session)
```

内部会调用：

```js
I(session)
```

生成的中间信息包含：

- `account_id`
- `email`
- `access_token`
- `id_token`
- `refresh_token`
- `session_token`
- `chatgpt_user_id`
- `plan_type`
- `expired`
- `codex`

其中 `codex` 是 `Codex auth.json` 风格的对象：

```js
{
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: {
    id_token,
    access_token,
    refresh_token,
    account_id
  },
  last_refresh
}
```

如果 Session 缺少 `id_token`，脚本会用已有字段构造一个 synthetic JWT。

### 2.6 节流等待

多个工作区时，每个工作区之间等待：

```js
await N(1000)
```

即 1 秒。

## Step 3：恢复原始状态

循环结束后恢复：

```js
k = originalToken
h = originalUserId
```

这只恢复脚本内部变量，不一定改变 ChatGPT 页面前端当前显示的工作区状态。

## Step 4：按格式生成文件

调用函数：

```js
en(format, accounts)
```

### Codex auth.json

格式值：

```js
codex
```

输出：

- 每个 workspace 一个文件。
- 文件名：

```text
{email}_{account_id前8位}_codex_auth.json
```

内容为 `codex` 对象。

### CPA JSON

格式值：

```js
cpa
```

输出：

- 每个 workspace 一个文件。
- 文件名：

```text
{email}_{account_id前8位}_cpa.json
```

字段包含：

- `type`
- `email`
- `expired`
- `id_token`
- `account_id`
- `disabled`
- `access_token`
- `session_token`
- `last_refresh`
- `refresh_token`

### sub2api bundle

格式值：

```js
sub
```

输出：

- 所有 workspace 打包成一个文件。
- 文件名：

```text
sub2api_{数量}_{时间}.json
```

结构：

```js
{
  exported_at,
  proxies: [],
  accounts: [...]
}
```

每个 account 由 `Y()` 生成，包含：

- `name`
- `platform: "openai"`
- `type: "oauth"`
- `credentials`
- `extra`
- `concurrency`
- `priority`
- `rate_multiplier`
- `auto_pause_on_expired`

## Step 5：自动下载文件

调用函数：

```js
Z(filename, text)
```

实现方式：

- 创建 JSON `Blob`。
- 创建临时 `<a download>`。
- 自动点击下载。
- 删除 `<a>`。
- 延迟释放 Object URL。

多个文件时，每个下载间隔：

```js
180ms
```

## 错误处理策略

| 阶段 | 失败行为 |
|---|---|
| 输入 ID 解析失败 | 直接停止 |
| 用户取消格式选择 | 直接停止 |
| 当前 Session 刷新失败 | 直接停止 |
| 单个工作区上车失败 | 记录警告，继续导出 |
| 单个工作区 Session 交换失败 | 当前工作区失败，继续下一个 |
| 单个工作区凭证生成失败 | 当前工作区失败，继续下一个 |
| 所有工作区均失败 | 显示“没有成功生成凭证” |
| 有成功项 | 生成并下载成功项 |

## 总体伪代码

```js
ids = Q()
format = prompt()

await E()
originalToken = k
originalUserId = h

accounts = []

for id in ids:
  try:
    k = originalToken
    h = originalUserId

    try:
      await B(id)
    catch:
      log("上车失败但继续导出")

    session = await A(id)
    account = W(session)
    accounts.push(account)
  catch:
    log("该工作区失败")

  await sleep(1000)

k = originalToken
h = originalUserId

if accounts.length == 0:
  error("没有成功生成凭证")
else:
  output = en(format, accounts)
  download(output.files)
```

## 插件化拆分建议

后续补充到当前 Chrome 插件时，建议不要直接搬整段 bookmarklet，而是拆成这些模块：

| 模块 | 职责 |
|---|---|
| `parseWorkspaceIds(text)` | 从输入内容提取 workspace UUID |
| `fetchCurrentChatgptSession()` | 请求 `/api/auth/session` |
| `requestWorkspaceInvite(workspaceId, accessToken)` | 执行上车请求 |
| `exchangeWorkspaceSession(workspaceId)` | 换取目标工作区 Session |
| `decodeJwtPayload(token)` | 解析 JWT payload |
| `assertWorkspaceSession(session, workspaceId)` | 校验目标工作区 ID |
| `buildCredentialRecord(session)` | 生成中间凭证对象 |
| `formatCredentialFiles(mode, records)` | 生成 Codex / CPA / sub2api 文件 |
| `downloadJsonFiles(files)` | 下载 JSON 文件 |
| `appendRuntimeLog(...)` | 记录每个阶段的结果 |

插件内建议 UI 流程：

1. 新增按钮或复用一个空按钮作为“K12 一键上车导出”。
2. 弹出或提供 textarea 输入 workspace ID。
3. 提供格式选择：Codex / CPA / sub2api。
4. 点击执行后，逐个 ID 显示：
   - 开始上车
   - 上车成功/失败
   - Session 交换成功/失败
   - 凭证生成成功/失败
5. 全部结束后下载文件，并在插件日志里保留摘要。

插件化时需要特别注意：这些请求依赖 `chatgpt.com` 登录态和同源 Cookie。最稳妥的执行位置是 `chatgpt.com` 页面上下文或 content script，而不是普通 popup 里直接跨域请求。
