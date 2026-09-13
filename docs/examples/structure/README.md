# Structure — Abs leq

结构来自**推断的 Abs 形状** + body 访问，不必写 interface。
与 [`../constraints/`](../constraints/) 的精化互补：refine 管「值满足约束」，
本目录管「形状可赋值」（Abs `leq`）。

| 文件 | 诊断 | 演示 |
|------|------|------|
| [`assign.js`](./assign.js) | `nudo:assign-mismatch` | 赋值 ⊭ 原有形状 |
| [`arg-structure.js`](./arg-structure.js) | `nudo:arg-structure` | 实参结构 ⊭ body 访问的 slot |

两个都是负例文件：`check` **故意 exit 1**（报错行即演示内容）。
运行命令与期望退出码见 [../README.md](./README.md) 的命令矩阵；
`pnpm run verify:examples` 一次验证全部。

## 语义：宽度子类型

`leq` 是**宽度子类型**：

- 右值 / 实参**多余 slot 合法**——只要被检查的形状需要的 slot 都齐；
- **缺 slot 报错**——「需要什么」由用法推出：赋值看左值既有形状，
  传参看被调函数 body 实际访问的属性。

| 形态 | 例 | nudo |
|------|-----|------|
| 赋值缺 slot | `config = { host: "y" }`（config 原有 `port`） | **报** `assign-mismatch` |
| 赋值多余 slot | `a = { x: 2, z: "s" }`（a 原有 `{ x }`） | ok |
| 实参缺 slot | `readXY({ x: 1 })`（body 访问 `p.y`） | **报** `arg-structure` |
| 实参多余 slot | `readX({ x: 1, z: 9 })`（body 只读 `p.x`） | ok |
| 标识符实参 | `const o = { x: 1 }; readXY(o)` | **报**（绑定表形状，非仅字面量） |

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

## 传参：body 访问推出必填 slot

```js
function readXY(p) { return p.x + p.y; }
function readX(p)  { return p.x; }

readXY({ x: 1 });           // error: arg-structure（缺 y）
readXY({ x: 1, y: 2 });     // ok
readX({ x: 1, z: 9 });      // ok（宽度允许：readX 只读 p.x）

const o = { x: 1 };
readXY(o);                  // error（标识符绑定表同样检查）
```

```
issues
  [ERROR L12 readXY] readXY[p]: 实参结构 ⊭ 形参  (nudo:arg-structure)
      actual:   { x: 1 }  #exact
      expected: { x: unknown, y: unknown }  #exact
      → missing slot y
  [ERROR L17 readXY] readXY[p]: 实参结构 ⊭ 形参  (nudo:arg-structure)
      → missing slot y
```

要点：

- **按函数算 slot**：`readX` 只要求 `{ x }`——同名参数 `p` 在兄弟函数里
  访问 `p.y` 不会污染 `readX` 的期望（曾是真 bug，已修并回归测试）；
- **slot 类型是 `unknown`**：body 只访问、不约束值类型，形状检查不
  管槽位值是什么；
- **标识符实参同样查**：绑定表里的形状 ⊭ 期望形状一样报。

## 关联文档

- 精化契约（值约束）：[`../constraints/README.md`](../constraints/README.md)
- `nudo check` 全貌（能扫描什么、报告格式）：[`../../nudo-check.md`](../../nudo-check.md)
- tsc 同逻辑对照：[`../vs-ts/README.md`](../vs-ts/README.md)
