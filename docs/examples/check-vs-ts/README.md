# nudo check vs tsc — 同一逻辑对照

| | **nudo check**（零注解 JS） | **tsc --strict**（需 interface / 注解） |
|---|---|---|
| `setDelay(0)` / `setDelay(-50)` | **报** `constraint-violated`（`0 ⊭ ms>0`） | 不报（`number` 合法） |
| `greet({ id: 1 })` | **报** `arg-structure`（缺 `name`，从 body 访问推出） | 报（若写了 `interface User`） |
| `greet({ id, name, extra })` | ok（宽度允许） | **报** excess property `extra` |
| `config = { host }`（缺 port） | **报** `assign-mismatch` | 报（inferred 形状） |
| 零注解 | 默认 | 需 `checkJs` 或迁 TS |
| 报告形态 | Abs：`actual ⊭ expected` | TS 诊断文案 |

## 实际输出

### nudo（`demo.js`）

```
[ERROR] setDelay[ms]: 实参 ⊭ 前置
    actual:   0  #exact
    expected: ms > 0

[ERROR] greet[user]: 实参结构 ⊭ 形参
    actual:   { id: 1 }  #exact
    expected: { id: unknown, name: unknown }
    → missing slot name

[ERROR] config: 赋值 ⊭ 原有形状
    actual:   { host: "x" }  #exact
    expected: { host: "localhost", port: 8080 }
    → missing slot port
```

### tsc（`demo.ts` + interface）

```
error TS2345: Property 'name' is missing in type '{ id: number; }' but required in type 'User'.
error TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'User'.
error TS2741: Property 'port' is missing in type '{ host: string; }' but required in type '{ host: string; port: number; }'.
```

tsc **抓不到** `setDelay(0)` 的约束违例；nudo **不必写 interface** 就能从程序本身推出必填 slot。

## 怎么跑

```bash
npx tsx packages/cli/src/index.ts check docs/examples/check-vs-ts/demo.js
npx tsc --noEmit --strict docs/examples/check-vs-ts/demo.ts
```

## 定位

- **nudo**：约束 + 推断结构（Abs），零注解，Agent/CI 友好  
- **tsc**：完备结构检查 + 生态；大 TS 仓继续用  
- **dts**：兼容投影，不是主类型模型  
