---
slug: /guides/env-harvest
description: 依赖类型从哪来 —— 固定 es/web/node env、@types 分析期静默补洞，以及何时该 mock。
---

# 依赖类型

Nudo 不为用户提供 harvest 命令。产品 env 是**固定集合**（`@nudojs/env` 的 `es` / `web` / `node`）；其余要么分析期静默补洞，要么你自己 mock。

## 类型如何到达

| import 目标 | 发生什么 |
|---|---|
| 内建 API（`path`、`fs`、DOM…） | 手写 `@nudojs/env`（`es` / `web` / `node`） |
| 有可用 `.js`/`.mjs` 的 JS 源码包 | 分析**执行**源码（Abs 求值器） |
| `@types/*` 或包自带 `.d.ts` | 分析**自动 harvest** 声明进 env 模块 —— 无需 CLI 步骤 |
| 两者皆无 | 空 modules → 用 `@nudo:mock` 或路径 `/// @nudo:env` |

Harvest **不是**产品动词。第三方 `@types` 在 `nudo check` / `nudo test` / LSP 分析时自动注入；手写 `@nudojs/env` 在重叠模块键与导出名上 wins。

## 为什么 @types → Abs env

没有类型时，依赖 import 是空模块：对它的每次调用都会退化成 `any` / `entry@` 面，你自己的签名也会丢掉依赖实际带有的精度。把声明 harvest 进 Abs env 模块后，分析就能*使用*那些签名 —— 调用结果参与代数，而不是坍缩。标题里的「harvest」是分析替你做的事；没有 `nudo harvest` 命令。

## 走读工作流

### 1. 声明运行时（具名 env）

内建面来自固定的 `es` / `web` / `node` 集合。文件级：

```javascript
/// @nudo:env node
import { join } from "node:path";

export function buildKey(dir, name) {
  const p = join(dir, name);
  return p + ".md";
}
```

或在 `package.json` 里按项目声明一次（文件级指令与之并集合并）：

```json
{
  "nudo": {
    "env": ["node"]
  }
}
```

`web` 与 `node` 自动包含 `es`。

### 2. 让 @types 补洞

安装类型包（或依赖已自带的）：

```bash
npm install -D @types/express
```

没有后续步骤。下一次分析运行就会把声明 harvest 进 env 模块。在重叠模块键与导出名上，手写 `@nudojs/env` 仍然 wins。

### 3. 跑 check，读签名

```bash
npx nudojs check src/
```

对比前后：原本坍缩成 `any` 的 import 现在显示依赖形状的返回值。`npx nudojs test src/ --from tests/` 的调用点用例继承同样的精度。

### 4. 只为自定义面才升级到路径 env

具名环境是固定的：

```javascript
/// @nudo:env node
```

需要自定义类型面（领域包、手调签名）时，自己写或生成 env 模块，按路径引用：

```javascript
/// @nudo:env ./my-env.ts
```

路径 env 导出 `defineEnv()`，用 `@nudojs/core` 的 Abs 构造器。`@nudojs/harvester` 可为 **env 包作者**从 `.d.ts` 生成该形态——它是库辅助，不是终端用户命令。harvester API 的例子：`harvestDts` + `emitEnvModule` 产出 `defineEnv()` 模块，再按路径引用。

## 常见陷阱

- **解析率 ≠ 完备性。** 已解析符号占比高，说明不了剩余叶节点是否被建模 —— 见下文边界。
- **重叠时手写 wins。** 若 `@nudojs/env` 与 harvest 来的 `@types` 模块都定义了同名符号，使用手写面。这是有意的；不要以为 harvest「更新」了内建。
- **路径 env 异步加载。** `nudo check` / `nudo test` 与 LSP 会预载它们；同步的 `analyzeFile` 在文件声明了路径 env 时会降级。
- **空模块是诚实的，不是 bug。** 既无源码也无类型就不发明 —— mock 或扩展 env。

## 诚实边界

**Env / 自动 harvest 不能替代 mock。** 原生运行时回调、动态 `require` 与未建模的原生仍可能以 `unknown` / `entry@` 结果出现。覆盖率基线**不是**完备性承诺。见[边界](../concepts/limits.md)与[语言语义](../concepts/semantics.md)。

## 何时 mock 而不是 harvest

当 API 进程本地或高度动态时，改用 mock：

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

| 情形 | 优先 |
|---|---|
| 包自带 `.js` 源码 | 让求值器执行它 —— 不 mock |
| 包自带 `@types` / `.d.ts` | 让自动 harvest 补 env |
| 内建 Node/Web API | 具名 env（`es` / `web` / `node`） |
| 进程本地 / 动态 / 原生 binding | `@nudo:mock`（或 `@nudo:mock-module`） |
| 想钉死的领域签名 | 路径 `/// @nudo:env`（或对*你的*函数用侧车契约） |

义务落在*你的* API 上时，优先补调用点或契约，而不是 mock —— 无调用点的函数回落到 `entry@`（诚实的 `any`）。

### Mock 边界清单

来源：[env / Node 覆盖率基线](https://github.com/nudojs/nudo/blob/main/docs/reports/env-coverage-baseline.md)（解析率**不是**完备性承诺）。下列叶节点目前仍偏薄或必须 mock——分析质量重要时请 mock：

| 类别 / probe | 为何偏薄 | 做法 |
|---|---|---|
| `child_process.spawn*` / 原生进程 spawn | 无副作用模拟；`ChildProcess` 仅签名级 | `@nudo:mock` 该调用，或接受声明形状 |
| 流机器回调（Transform 内部） | `data` / `error` 事件由机器驱动（见[边界](../concepts/limits.md)） | mock 你依赖的载荷 |
| 动态 `require` / 计算模块图 | 模块图不静态 | `@nudo:mock-module` 或路径 `/// @nudo:env` |
| 原生 addon / binding | 不会被求值 | mock 该 binding 面 |
| 浏览器/Node 双入口变体 | 调用点记录不跨文件 | mock 另一入口，或两侧分开分析 |
| 签名级 `any` 叶（`util.format`、`util.inspect`、`util.types.isDate`、`assert.*`） | 已解析，但 format 仍含 `any` | 接受该叶，或 mock 换更紧的面 |

## 下一步

- [指令 —— `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md)（env 编写库）
- [边界](../concepts/limits.md) —— 分析在哪里不再精确
- [Recipes](./recipes.md)
