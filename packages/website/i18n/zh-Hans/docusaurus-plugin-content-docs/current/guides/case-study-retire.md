---
slug: /guides/case-study-retire
description: 公开的退役 tsc 案例研究 —— checkout-demo，真实包 ms 与 debug。单向门，没有双跑终局。
---

# 案例研究：退役 tsc

**读完你能带走：** 一份可转发的迁移剧本——前后诊断对照、命令序列 `status → strip → verify → retire`，以及诚实的摩擦记录——背后是本 monorepo 里可运行的样例。

终局始终一样：**`nudo check` 是唯一的门禁；`typescript` 被摘掉。** 共存是迁移战术，不是目的地。命令走读：[从 TypeScript 迁移](./migrating-from-typescript)。

> **诚实标签。** 下面每个包都是来自 [`docs/examples/`](https://github.com/nudojs/nudo/tree/main/docs/examples) 的**示例级**样例（两个真实 npm *消费方*，一个公开 demo 包）。耗时与摩擦计数是**示例级，非生产规模** —— 不是一次生产迁移审计。不要编造外部公司名；证据是已提交的 `before/` / `after/` 树与 `pnpm run verify:examples`。

## 单向门

```text
audit (migrate status) → strip → verify (nudo check) → retire (drop tsc)
```

可直接复制的序列（路径换成你的包）：

```bash
# 0. audit —— what still carries tsc
npx nudojs migrate status ./my-pkg

# 1. strip —— .ts → .js (annotations out, runtime stays). --write to emit.
npx nudojs migrate strip ./my-pkg/src --write

# 2. optional —— reverse old annotations into a reviewable contract draft
npx nudojs contract --from-dts ./my-pkg/src/index.ts
#    → @nudo:draft (NOT enforced until you copy it into *.nudo.js)

# 3. verify —— nudo check must pass on the stripped JS
npx nudojs migrate verify ./my-pkg/src

# 4. retire —— drop typescript, rewrite tsc scripts / GHA lines, write marker
npx nudojs migrate retire ./my-pkg --dry-run   # then drop --dry-run
```

| 步骤 | 作用 | 何时退出 |
|------|------|----------|
| `status` | 统计 `.ts`、找出 `tsc` scripts + `typescript` 依赖、列出 **blockers** | 你摸清了面积 |
| `strip` | `.ts` → `.js`；可选 best-effort 侧车草稿 | 源码已是普通 JS |
| `verify` | 在剥好的 JS 上跑 `nudo check`（迁移**期间**可选 `--with-tsc` 双跑） | 门禁变绿 |
| `retire` | 摘掉 `typescript`，把 `tsc` scripts 改写成 `nudo check`，改写 `.github/workflows`，写出 `.nudo/migrate-retired.json` | **tsc 已消失** |

`migrate retire --all` 可批处理 monorepo。双跑只作为迁移期间的 `migrate verify --with-tsc` 存在——永远不是终局。

## 1. checkout-demo（公开样例）

| | before | after |
|---|---|---|
| 内容 | TypeScript 结账辅助函数 | 普通 JS |
| 门禁 | `tsc --noEmit` | `nudo check src` |
| 故事 | 合成但完整 | 已提交的 after/ 就是黄金终局 |

源码：[`docs/examples/migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate)

### Before → after（代码）

```typescript
// before/src/math.ts
export function lineTotal(price: number, qty: number): number {
  return price * qty;
}
```

```javascript
// after/src/math.js — runtime unchanged
export function lineTotal(price, qty) {
  return price * qty;
}
```

跨文件：`cart.ts` 里的 `type Item = { … }` 被**删除**（TS 专用；它在运行时从未存在）。import 保留。

### Before → after（诊断）

**Before** 是 `tsc --noEmit` 的类型名。**After** 是 Nudo 签名（成功时也打印）加上可选的 L1/L2 面：

```text
nudo check  docs/examples/migrate/after/src/math.js
OK
  0 error · 1 warning · 0 info · 3 fn

signatures
  lineTotal(price: any, qty: any) => number
  applyCoupon(total: any, percent: any) => number  throws RangeError
  formatMoney(cents: any) => string

issues
  [WARNING L9 applyCoupon] applyCoupon (export): may throw RangeError  (nudo:entry-may-throw)
      → throw RangeError → @nudo:throws RangeError / refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

读法是：签名照常打印；无约束参数是 **`any`**（不是 `unknown`）；有意的 `throw` 以 **L2** 浮出，并带下一步。如果你想要第一周更软，after 包可以用 `package.json#nudo.check.entryThrows` 把它翻成 warning。

之后再收紧，脸会变成值 + 谓词（而不是类型名）——见[错误对照](./error-faces)：

```text
actual:   -1  #exact
expected: x > 0
→ use a value satisfying x > 0
fix:  nudo contract --draft
```

## 2. 真实包：`ms`（vercel/ms）

一个消费真实 [`ms`](https://github.com/vercel/ms) 格式化器（纯 JS、非常常见）的包，从 TS + `@types/ms` 迁到 JS + `nudo check`。**依赖本身不变。**

| | before | after |
|---|---|---|
| 语言 | `age.ts` + `ms.d.ts` | `age.js` |
| 门禁 | `tsc --noEmit` | `nudo check` |
| `typescript` 依赖 | 有 | **无** |
| 真实依赖 | `ms@^2.1.3` | 相同 |

源码：[`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real)

### 命令序列（实际）

```bash
# status —— audit face (real output)
npx nudojs migrate status docs/examples/retire-real/before
#   ts files: 2  tsx: 0  tsconfig: yes  typescript dep: yes
#   tsc scripts: typecheck
#   blockers: tsc still in scripts; no nudo check/test script yet; typescript still in dependencies

# strip —— dry-run in this repo; --write emits
npx nudojs migrate strip docs/examples/retire-real/before/src/age.ts

# reverse annotations into a draft you must review
npx nudojs contract --from-dts docs/examples/retire-real/before/src/age.ts
#   export const formatAge = fn({ durationMs: number() }, string());
#   export const parseAge   = fn({ text: string() }, number());
#   → copy into age.nudo.js only after review (that is when L1 goes live)

# verify / gate on the committed after/
npx nudojs check docs/examples/retire-real/after/src/age.js

# retire —— dry-run first
npx nudojs migrate retire docs/examples/retire-real/after --dry-run
```

### Before → after（代码 + 门禁）

```typescript
// before/src/age.ts
export function formatAge(durationMs: number): string {
  return ms(durationMs, { long: true });
}
```

```javascript
// after/src/age.js
export function formatAge(durationMs) {
  return ms(durationMs, { long: true });
}
```

已接受的侧车（`after/src/age.nudo.js`）——上面那份草稿，已审阅：

```javascript
import { fn, number, string } from "@nudojs/core";

export const formatAge = fn({ durationMs: number() }, string());
export const parseAge = fn({ text: string() }, number());
```

退役后的 check 脸（示例级；此处 native `ms()` 未被完整 harvest）：

```text
signatures
  formatAge(durationMs: number) => unknown | string
  parseAge(text: string) => undefined

issues
  [WARNING parseAge] parseAge: signature has true unknown (inference failed)  (nudo:unknown-inference)
      → add @nudo:case / env mock / refine, or confirm the body is algebraically evaluable
```

真实退役后的标记：`.nudo/migrate-retired.json`（`typecheck: tsc --noEmit → nudo check src` 已改写，`typescript` 已移除）。

## 3. 真实包：`debug`（visionmedia/debug）

同一道门，对 [`debug`](https://github.com/debug-js/debug)——半个 npm 背后的日志门面。

| | before | after |
|---|---|---|
| 语言 | `logger.ts` + `debug.d.ts` | `logger.js` |
| 门禁 | `tsc --noEmit` | `nudo check src` |
| 真实依赖 | `debug@^4.3.4` | 相同 |

源码：[`docs/examples/retire-debug/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-debug)

```bash
npx nudojs migrate status docs/examples/retire-debug/before
npx nudojs migrate strip docs/examples/retire-debug/before/src/logger.ts
npx nudojs contract --from-dts docs/examples/retire-debug/before/src/logger.ts
#   → export const createLogger = fn({ namespace: string() }, any());
npx nudojs check docs/examples/retire-debug/after/src/logger.js
npx nudojs migrate retire docs/examples/retire-debug/after --dry-run
```

**诚实边缘：** `debug()` 是 native 入口。strip 之后，返回仍是 **`unknown`** / `conf=opaque`（引擎债的脸，不是契约失败）：

```text
signatures
  createLogger(namespace: any) => unknown
  logHello(name: any) => unknown

issues
  [INFO createLogger] createLogger(...): conf=opaque (path not covered, or native)  (nudo:opaque-result)
      → add @nudo:case or a call site
```

有 `@types/debug` 时，harvest 会填满签名；或用 `@nudo:mock` / `refine return` 钉住。这与 `ms()` 是同一个故事。

## 摩擦与耗时（示例级）

| 摩擦 | 出现在哪里 | 怎么修好 | 成本（示例级） |
|------|------------|----------|----------------|
| `tsc` scripts + `typescript` 依赖还在 | `migrate status` blockers 列表 | `migrate retire` 改写 scripts；摘掉依赖 | 一条命令（先 `--dry-run`） |
| 旧标注只有被你接受才变成义务 | `contract --from-dts` 发出 `@nudo:draft` | 审阅 → 拷进 `*.nudo.js` | 每文件几分钟；**绝不静默** |
| native / 未 harvest 依赖（`ms()`、`debug()`） | `unknown` / `conf=opaque` / `nudo:unknown-inference` | `@types/*` harvest、`@nudo:mock`，或 `refine return` | 有界；在你钉住之前一直是 **warning** |
| 有意 `throw` 上的 L2 `entry-may-throw` | checkout-demo 的 `applyCoupon` | `@nudo:throws RangeError` / guard，或 `nudo.check.entryThrows: "warning"` | `package.json` 一行，或一条 throws 指令 |
| 双跑诱惑 | 迁移中期的 CI | **只**在迁移期间保留 `verify --with-tsc`；出口是 retire | 政策问题，不是工具问题 |

**墙钟时间（示例级，非生产规模）：** 这些样例很小（2–3 个模块，每包约剥 1–2 个文件）。已提交的树就是证据——自己跑 `pnpm run verify:examples`。我们**不**发布生产规模的小时/天数数字；发布说明里的「7 天退役路径」是*产品目标叙事*，不是实测中位数。对真实包，请按 `migrate status` 给出的 `.ts` 文件数做预算，而不是按博客文章。

## 这些证明了什么

| 主张 | 证据 |
|------|------|
| JS 保持 JS | after/ 源码是普通 `.js` |
| 契约是可选义务 | `contract --from-dts` → 审阅 → `*.nudo.js` |
| 出口是 retire，不是双跑 | `.nudo/migrate-retired.json` + 无 `typescript` 依赖 |
| 真实包能迁 | `ms` 与 `debug` 不是合成 fixture |
| 诚实的引擎债 | `unknown` / opaque 保持可见；从不伪装成成功 |

## 跑一遍矩阵

```bash
pnpm run verify:examples
```

上面每条命令都钉在 [`docs/examples/README.md`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md) 的 CI 里。

## 转发这个故事

可直接复制的博客 / HN / 发布说明文案：[`docs/reports/retire-tsc-announcement.md`](https://github.com/nudojs/nudo/blob/main/docs/reports/retire-tsc-announcement.md)。

## 下一步

- [从 TypeScript 迁移](./migrating-from-typescript) —— 那道门本身
- [错误对照](./error-faces) —— 门禁之后你怎么读
- [心智模型](../getting-started/mental-model) —— 10 分钟
