---
"@nudojs/core": patch
---

fix(core): 解析入口 / 依赖指纹 / 泛型 α 绑定三条根因收口（Bug 451 / 452 / 453）

- **Bug 451 —— `.ts` 尖括号类型断言不再整文件解析失败**：
  `packages/core/src/algebra/parse-source.ts` 的 `parseUncached` 对**所有**源一律
  `["typescript", "jsx"]`（`parseSource` 拿不到文件名）⇒ Babel 在 TS+JSX 双插件下
  把 `<` 起始的表达式**优先**按 JSX 解析 ⇒ `.ts`（非 `.tsx`）里**合法**的
  `<T>x` 尖括号类型断言让**整个文件**解析失败（`check` / `test` / `export` /
  `migrate strip` 全废，tsc 对同一份源 `exit 0`）。
  修法（路线 A，单文件 / 零调用面改动 / `parseSource` 签名不变 ⇒ 公共 API 冻结面
  零变更）：解析**硬失败**时去掉 `jsx` **重试一次**；重试也失败则报**首次**错误。
  插件集不随调用方变化 ⇒ AST LRU 缓存键（mode + source）**不动**、无串味。
- **Bug 452 —— 依赖指纹不再漏「仅副作用 import」**：
  `packages/core/src/algebra/load-deps-fp.ts` 的 `extractAllLoadSpecs` 用**正则**抽
  说明符、模块图用 **AST** 抽 ⇒ 两者对「仅副作用 import」（`import "./setup.js";`）
  与「模板字符串 `require(\`./tpl.js\`)`」的判断**不一致** ⇒ 指纹**低估**真实依赖集
  ⇒ 磁盘缓存键不含该依赖的内容 ⇒ 依赖改了而键不变 ⇒ `nudo check` 继续吐**上一次的
  陈旧签名**（文件头「more misses, **never a stale hit**」承诺被证伪）。
  修法：指纹的说明符抽取**并入 AST 侧**（与模块图同口径：import / export-from /
  `require` / `require.resolve` 的可折叠静态字符串）⇒ **正则集 ∪ AST 集** ⇒
  只多 miss（保守），绝不陈旧命中；AST 解析失败时正则集仍在 ⇒ 不引入新的低估。
- **Bug 453 —— 收割的泛型函数在调用点绑定类型实参**：
  `packages/core/src/algebra/hof.ts` 的 `bindTypeVars` 只做**同 kind** 配对 ⇒
  harvester 把 `T[]` 建成 **`arr`**（元素 = α var）、引擎把**数组字面量**建成
  **`tuple`** ⇒ α **永不绑定** ⇒ 返回值落 `any` ⇒ 参与算术即「抽象操作数强制转换」
  ⇒ 记 may-throw ⇒ **L2 假红**（tsc `exit 0` 的合法代码被门禁判红）。
  修法：加**跨 kind 臂**（`arr` 形参 × `tuple` 实参 ⇒ 取首元素；
  `tuple` 形参 × `arr` 实参 ⇒ 取 arr 的元素类型）。
  ⚠ **同 kind 臂排在前** —— `hof-relation.test.ts` 的既有用例
  「deep α: `T[]` param binds T from `number[]` arg (lodash-style)」**保持绿**。
- 未变：core 公共 API 冻结面**零新增导出**（`parseSource` 签名不变、
  `extractAllLoadSpecs` / `loadModuleDepsFingerprint` 只改内部实现）。
