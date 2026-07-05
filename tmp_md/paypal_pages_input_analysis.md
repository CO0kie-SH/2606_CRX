# PayPal 页面输入框分析

## 文件说明

本目录保存两份 PayPal 页面原始 HTML 的本地副本，以及对应的输入框分析。文件仅来自当前项目已有抓取结果，没有执行网络上传。

原始 HTML 副本：

- `paypal_checkout_signup_2026-07-03T13-57-18.312Z.html`
- `paypal_agreements_approve_login_2026-07-03T14-20-30.728Z.html`

来源文件：

- `db/crx-c9ad8d4515389510f1c96d9ae9319e93/2026-07-03T13-57-18.312Z.html`
- `db/crx-155b71aa007f9de04021e7ffc6af4370/2026-07-03T14-20-30.728Z.html`

## 统计口径

本次统计以页面被插件捕获时的 HTML 状态为准。

- 计入：当前可见的文本类输入框，例如 `text`、`email`、`tel`、`password`。
- 单独列出：可见下拉框 `select`。
- 不计入输入框总数：`hidden` 字段、隐藏步骤里的字段、按钮、radio、checkbox、iframe、反欺诈/风控 token。
- captcha 字段如果在捕获时处于隐藏容器内，不计入当前可见输入框。

## 页面 1：PayPal 付款/开户注册页

URL：

```text
https://www.paypal.com/checkoutweb/signup?ba_token=BA-1HH7164439368771W&ssrt=1783086933105&token=%5BREDACTED%5D&rcache=1&country.x=BR&locale.x=pt_BR&ulPage=noMatch&abTestThrottle=xoon
```

标题：

```text
PayPal
```

原始 HTML：

```text
tmp_md/paypal_checkout_signup_2026-07-03T13-57-18.312Z.html
```

### 可见文本输入框

当前可见文本输入框共 `15` 个：

| 序号 | 页面标签 | 字段含义 | HTML 线索 |
|---:|---|---|---|
| 1 | E-mail | 邮箱 | `id=email`, `name=email`, `type=email`, `autocomplete=email` |
| 2 | Número de telefone | 电话号码 | `id=phone`, `type=tel`, `autocomplete=tel` |
| 3 | Número do cartão | 银行卡号 | `id=cardNumber`, `name=cardnumber`, `autocomplete=cc-number` |
| 4 | Data de vencimento | 卡有效期 | `id=cardExpiry`, `name=exp-date`, `autocomplete=cc-exp` |
| 5 | CSC | 卡安全码 | `id=cardCvv`, `name=cvv`, `autocomplete=cc-csc` |
| 6 | Nome | 名 | `id=firstName`, `name=fname`, `autocomplete=given-name` |
| 7 | Sobrenome | 姓 | `id=lastName`, `name=lname`, `autocomplete=family-name` |
| 8 | CEP | 邮编 | `id=billingPostalCode`, `name=billingPostalCode` |
| 9 | Endereço | 地址/街道 | `id=billingStreetName`, `name=billingStreetName` |
| 10 | Nº | 门牌号 | `id=billingHouseNumber`, `name=billingHouseNumber` |
| 11 | Distrito/Bairro (opcional) | 区/街区，可选 | `id=billingLine2`, `name=billingLine2` |
| 12 | Cidade | 城市 | `id=billingCity`, `name=billingCity` |
| 13 | Criar senha | 创建密码 | `id=password`, `name=password`, `type=password`, `autocomplete=new-password` |
| 14 | Data de nascimento | 出生日期 | `id=dateOfBirth`, `type=tel` |
| 15 | CPF | 巴西 CPF 税号/身份号 | `id=identityDocumentNumber`, `type=text` |

### 可见下拉框

下拉框共 `3` 个，未计入上面的 15 个文本输入框：

| 序号 | 页面标签 | 字段含义 | HTML 线索 |
|---:|---|---|---|
| 1 | País | 国家 | `select#country`, `name=country`, `data-testid=countrySelector` |
| 2 | Tipo de telefone | 电话类型 | `select#phoneType`, `name=phoneType` |
| 3 | Estado | 州/省 | `select#billingState`, `name=billingState` |

### 其他可见表单控件

这些是表单控件，但不属于文本输入框：

| 类型 | 数量 | 含义 |
|---|---:|---|
| radio | 2 | 借记卡/信用卡选择：`Débito`、`Crédito` |
| checkbox | 2 | 同意条款、营销订阅 |

### 小结

- 只算可见文本输入框：`15` 个。
- 文本输入框 + 下拉框：`18` 个字段。
- 再加 radio 和 checkbox：`22` 个可见表单控件。
- 页面 HTML 中还有隐藏字段，例如浏览器自动填充探针、反欺诈 cookie、`fn_sync_data`，未计入。

## 页面 2：PayPal 登录授权页

URL：

```text
https://www.paypal.com/agreements/approve?ba_token=BA-44H18580SD6603432
```

标题：

```text
Acesse a sua conta do PayPal
```

原始 HTML：

```text
tmp_md/paypal_agreements_approve_login_2026-07-03T14-20-30.728Z.html
```

### 当前可见文本输入框

当前可见文本输入框共 `1` 个：

| 序号 | 页面标签 | 字段含义 | HTML 线索 |
|---:|---|---|---|
| 1 | E-mail ou número de celular | 邮箱或手机号 | `id=email`, `name=login_email`, `type=email`, `autocomplete=username` |

### HTML 中存在但当前隐藏的字段

这些字段在 HTML 中存在，但捕获时处于隐藏容器或隐藏步骤里，因此未计入当前可见输入框：

| 页面标签 | 字段含义 | HTML 线索 | 状态 |
|---|---|---|---|
| Senha | 密码 | `id=password`, `name=login_password`, `type=password` | 隐藏 |
| Informe o código | captcha 验证码 | `id=splitHybridCaptcha`, `name=captchaCode`, `type=text` | 隐藏 |
| Informe o código | password 步骤 captcha | `id=splitPasswordCaptcha`, `name=captcha`, `type=text` | 隐藏 |
| phoneCode | 电话国家码 | `select#phoneCode`, `name=phoneCode` | 隐藏 |
| login_phone | 电话号码隐藏承载字段 | `id=phone`, `name=login_phone`, `type=hidden` | 隐藏 |

### 小结

- 当前可见文本输入框：`1` 个。
- 如果按 HTML 中的潜在步骤字段看，还存在密码框和两个 captcha 输入框，但它们不是捕获时的可见输入框。
- 页面包含大量 `hidden` 字段，例如 `_csrf`、`_sessionID`、`flowId`、`ctxId`、`state`、风控 cookie 等，均未计入。

## 总体结论

两份 PayPal 页面按当前可见状态统计：

| 页面 | 可见文本输入框 | 可见下拉框 | 说明 |
|---|---:|---:|---|
| 付款/开户注册页 | 15 | 3 | 完整收集邮箱、电话、银行卡、账单地址、密码、生日、CPF |
| 登录授权页 | 1 | 0 | 当前处于邮箱/手机号输入步骤，密码和 captcha 在隐藏步骤里 |

合计：

- 当前可见文本输入框：`16` 个。
- 当前可见文本输入框 + 可见下拉框：`19` 个字段。

