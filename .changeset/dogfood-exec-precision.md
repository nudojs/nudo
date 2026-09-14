---
"@nudojs/core": minor
---

修复抽象执行器的多处精度与门禁缺陷（dogfooding 回归全绿）：

- 结构门禁：`@nudo:refine` 在 `export function`/`export const`/`export default`/`async` 声明上被静默丢弃（refine.ts 的声明正则只匹配裸 `function`）——现在导出函数上的参数 refine 真实生效，`string()` 原语约束能拦截 `first(42)` 这类调用（退出码 1）
- 转译执行（exec/transpile.ts 等）：解构形参绑定、`+=` 等复合赋值、`Math.*`/`Number.isNaN` 命名空间调用、正则字面量 `.exec` 捕获组、可选链真值判断、`i++`、成员/索引写回、三元表达式、`new Array().fill`、字符串下标/长度——此前均丢失精确值（case 求值为 unknown），现在 `@nudo:case ... => expected` 在这些体上可精确断言（含 OSA 编辑距离 DP 矩阵、semver 比较链）
- 早返回折叠：`if (c) return X;` 语句级 `$fork` 的返回值被静默丢弃导致整函数回退到最后一条 return——改为位置感知提升（后续语句整体进 else 分支），`join` 语义与 JS 控制流一致
- bridge：`null` 字面量可投影为 `T.literal(null)`，`=> null` 期望成立
