# Algebra — 类型即计算

定义性示例：Abs 上的算术、结构与控制流。  
与 `constraints/` 的精化互补——这里看 **推断本身**，不是门禁。

| 文件 | 考察点 |
|------|--------|
| `0-add-intensional.js` | add 的类型是函数本身，不是 `(number,number)=>number` |
| `a-spread-optional.js` | 多态 call-site 保留字面量；函数 join 是重载并 |
| `b-hof-map.js` | HOF 自动多态 |
| `c-reduce-sum.js` | reduce 累加器不动点 |
| `d-mixin-meet.js` | mixin / brand 槽位 meet |
| `e-index-proj.js` | 索引投影 |
| `f-async-eff.js` | async / Promise eff |
| `g-narrow-subtract.js` | 窄化与 subtract |

无契约时 `+` 跟真实 JS：`number | string`；有 `@nudo:refine` 才走数值路径。

```bash
npx tsx packages/cli/src/index.ts infer docs/examples/algebra/0-add-intensional.js
```
