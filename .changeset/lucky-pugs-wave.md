---
"@nudojs/core": patch
---

fix(core): regex 捕获组接收者窄化 + exec 抽象匹配 per-index 槽（#136）与方法调用接收者守卫事实

- 抽象 subject 的 `re.exec()` 结果从均质元素 arr（`m[0]`/`m[1]` 同值 `string|undefined`、无从窄化）改为与具体路径 `matchResultAbs` 同构的 per-index 槽 obj：`m[0]`=string、捕获组槽=string|undefined、`length`/`index`/`input`/具名 `groups` 全可读（修前 length/index/input 为 unknown）。
- `if (m[1].trim().length > 0) out.push(m[1])`：方法调用求值到达 ⇒ 接收者非 nullish——该事实经既有臂 thunk 影子参数窄化应用到 if 两臂（短路方向 sound：`A && B` 的 B 位仅真值臂、`A || B` 的 B 位仅假值臂；`?.` 可选链不识别）。修复 1.3.15 数组元素诚实化引入的 `array(string())` 误报 constraint-violated（守卫后 push 的元素必为 string）。
- `memberGuardTarget` 计算键认数值字面量：`if (m[1])` 显式真值守卫与 `if (o.p)` 同走 $removeMemberNullish 槽剪影（此前计算键一律不识别）。
- 诚实化不回退：无守卫直推仍如实报 `string | undefined` 契约违例；`.trim()` 的 nullish 臂 throws 事实不丢（无契约时仍报 entry-may-throw）。
