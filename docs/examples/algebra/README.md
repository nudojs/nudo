# Algebra — 类型即计算

定义性示例：Abs 上的算术、结构与控制流。  
与 `constraints/` 的精化互补——这里看 **推断本身**，不是门禁。

| 文件 | 考察点 | 命令 |
|------|--------|------|
| [`0-add-intensional.js`](./0-add-intensional.js) | add 的类型是函数本身，不是 `(number,number)=>number` | `pnpm run infer docs/examples/algebra/0-add-intensional.js` |
| [`a-spread-optional.js`](./a-spread-optional.js) | 多态 call-site 保留字面量；函数 join 是重载并 | `pnpm run infer docs/examples/algebra/a-spread-optional.js` |
| [`b-hof-map.js`](./b-hof-map.js) | HOF 自动多态 | `pnpm run infer docs/examples/algebra/b-hof-map.js` |
| [`c-reduce-sum.js`](./c-reduce-sum.js) | reduce 累加器不动点 | `pnpm run infer docs/examples/algebra/c-reduce-sum.js` |
| [`d-mixin-meet.js`](./d-mixin-meet.js) | mixin / brand 槽位 meet | `pnpm run infer docs/examples/algebra/d-mixin-meet.js` |
| [`e-index-proj.js`](./e-index-proj.js) | 索引投影 | `pnpm run infer docs/examples/algebra/e-index-proj.js` |
| [`f-async-eff.js`](./f-async-eff.js) | async / Promise eff × `@nudo:mock` 替换内置 fetch | `pnpm run infer docs/examples/algebra/f-async-eff.js` |
| [`g-narrow-subtract.js`](./g-narrow-subtract.js) | 窄化与 subtract | `pnpm run infer docs/examples/algebra/g-narrow-subtract.js` |
| [`sample.js`](./sample.js) | 综合：以上片段合集 | `pnpm run infer docs/examples/algebra/sample.js` |

无契约时 `+` 跟真实 JS：`number | string`；有 `@nudo:refine` 才走数值路径。
