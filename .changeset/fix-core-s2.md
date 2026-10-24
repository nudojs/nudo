---
"@nudojs/core": patch
---

fix(core): 「prim + 界」契约补回类型义务 + 约束 DSL 形态校验（族 06 / Bug 333 335 337 347 357 358）

- **333 / 335**：`instantiateConstraint` 只要约束带 `prim` 就把 `typeof` 谓词与界**合取**
  （此前只在 `preds.length === 0` 时补 ⇒ `number().gt(0)` / `string().max(3)` 这类
  「prim + 界」契约实例化后**没有类型义务** ⇒ 类型错配的实参被静默放行）。
  ⚠ `instantiateOnTerm` 保持原口径：union 成员经它实例化，补 `typeof` 会让
  执法侧 `or` 分支判不出（成员谓词变 `and`）⇒ `union(lit(1), lit(2))` 的违例丢失。
- **337**：`length()` 的内部占位符 `__nudo_self__` 替换**递归进应用项实参**
  （`app("length", […])`）与 `and` / `or` / `not` 分支 ⇒ 占位符不再泄漏进
  实例化谓词与产品 `expected` 文本。
- **347**：`pick()` 取字段改**自有属性**判定（`Object.hasOwn`）⇒
  `"constructor"` / `"toString"` 等原型链成员不再被当成字段塞进字段表
  （此前让 `nudo contract` / `nudo export` 面裸崩、`nudo check` 面静默作废整条契约）。
- **357**：`fn()` 第三实参做形态校验：`opts` 必须是对象；`opts.throws` 归一后必须能
  抽出至少一个错误名 ⇒ 无效申报不再被静默吞掉（零诊断假红），改为可读的 DSL 错误。
- **358**：`pick()` / `omit()` 的 `keys` 必须是**字符串数组** ⇒ 传字符串不再被逐字符
  迭代（`pick` 把契约放松成空 = 假绿、`omit` 让约束变更严 = 假红），改为可读的 DSL 错误。
