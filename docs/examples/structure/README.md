# Structure — Abs leq

结构检查来自**推断的 Abs 形状**（赋值）与**显式 shape 契约**（传参）。
与 [`../constraints/`](../constraints/) 的精化互补：refine 管「值满足约束」，
本目录管「形状可赋值 / 可传参」（Abs `leq` + 契约字段）。

| 文件 | 诊断 | 演示 |
|------|------|------|
| [`assign.js`](./assign.js) | `nudo:assign-mismatch` | 赋值 ⊭ 原有形状 |
| [`arg-structure.js`](./arg-structure.js) | `nudo:constraint-violated` | 实参 ⊭ 显式 shape 契约 |

> **契约模型（C0.1 + L2）**：无显式契约时**不**从 body 访问发明必填 slot。
> 无契约 → 调用点事实 / **`any`**（不是 unknown）；有 L1 契约 → 按契约执法。
> 入口 export 上未消化的 may-throw 是 **L2**（`nudo:entry-may-throw`，默认 error），
> 与 body-slot 义务正交。

运行命令与期望退出码见 [../README.md](../README.md) 的命令矩阵；
`pnpm run verify:examples` 一次验证全部。

## 语义：宽度子类型

`leq` 是**宽度子类型**：

- 右值 / 实参**多余 slot 合法**——只要合同需要的 slot 都齐；
- **缺 slot 报错**——「需要什么」由**显式来源**给出：赋值看左值既有形状，
  传参看 `@nudo:refine` / 侧车 shape。

| 形态 | 例 | nudo |
|------|-----|------|
| 赋值缺 slot | `config = { host: "y" }`（config 原有 `port`） | **报** `assign-mismatch` |
| 赋值多余 slot | `a = { x: 2, z: "s" }`（a 原有 `{ x }`） | ok |
| 契约缺字段 | `readXY({ x: 1 })`（契约 `shape({x,y})`） | **报** `constraint-violated` |
| 契约多余字段 | `readXY({ x: 1, y: 2, z: 9 })` | ok（宽度） |
| 无契约缺字段 | 同逻辑但无 refine | **不报**（调用点事实） |

与 tsc 的差异：tsc 对**对象字面量**有 excess property 检查（多 key 报
TS2353），nudo 宽度子类型一律放行——同逻辑对照见
[`../vs-ts/`](../vs-ts/)（CI 钉住两侧退出码与错误数）。

## 赋值：原有形状是合同

```js
let config = { host: "localhost", port: 8080 };

config = { host: "x", port: 1 };     // ok（同形状重赋值）
config = { host: "y" };              // error: assign-mismatch（缺 port）

let a = { x: 1 };
a = { x: 2, z: "s" };                // ok（宽度允许多余 key）
```

```
issues
  [ERROR L7 config] config: 赋值 ⊭ 原有形状  (nudo:assign-mismatch)
      actual:   { host: "y" }  #exact
      expected: { host: "x", port: 1 }  #exact
      → missing slot port
```

左值首次赋值**建立**形状；之后的赋值必须 leq 于它。多余 key 不破坏合同。

## 传参：显式 shape 契约

```js
/// @nudo:import { xy } from "./xy.nudo.js"

/**
 * @nudo:refine p xy
 */
function readXY(p) { return p.x + p.y; }

readXY({ x: 1 });           // error: constraint-violated（契约缺 y）
readXY({ x: 1, y: 2 });     // ok
readXY({ x: 1, y: 2, z: 9 }); // ok（宽度）
```

```
issues
  [ERROR L12 readXY] readXY[p]: 实参 ⊭ 前置  (nudo:constraint-violated)
      actual:   { x: 1 }  #exact
      expected: p ∈ shape({ x: number, y: number })
```

要点：

- **L1 shape 义务只来自声明**（`@nudo:refine` / 侧车），不是 body AST 扫描；
- **无契约不发明 shape 义务**：`readXY({x:1})` 在无 refine 时合法（调用点事实 / `any`）；
- **L2 仍可能执法**：export 入口对 `any` 的危险操作可报 `nudo:entry-may-throw`；
- **宽度子类型**：契约外的多余字段放行。

## 关联文档

- 精化契约（值约束）：[`../constraints/README.md`](../constraints/README.md)
- `nudo check` 全貌：[`../../design/cli-semantics.md`](../../design/cli-semantics.md)
- tsc 同逻辑对照：[`../vs-ts/README.md`](../vs-ts/README.md)
- 契约模型（C0：义务只来自显式契约或调用点事实）：[`../../design/cli-semantics.md`](../../design/cli-semantics.md) §3
