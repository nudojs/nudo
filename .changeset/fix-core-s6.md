---
"@nudojs/core": patch
---

族 06 修复 S6：Bug 343 346 349 1023 —— 契约面的采用与呈现口径（callee 违约、
assume 前提作用域、fn 槽位占位 term、跨模块形参名）

- **343**（callee 违约时的假绿）：调用点不再用 callee 的**声明面**替换**确定违反**
  声明约束的真实返回值。callee 返回 `5` 而契约声明 `number().ge(0).le(1)` 时，
  引擎本已判定违约，但调用点仍把声明面当事实交给 caller ⇒ caller 的返回契约被
  「证得」（跨模块时 `nudo check` 零错误）。现在保留真实返回值 ⇒ caller 侧同样
  报 `nudo:constraint-violated`。
- **346**（`@nudo:assume` 前提的作用域）：前提槽不再**整体**关掉 callee 契约面的
  采用。只有当引理前提的自由变量里**确实含**该位被重锚成的 callee 形参名时才跳过
  这一位；与本次调用无关的惰性引理（如 `p <= q`，p/q 是调用方的局部量）不再把
  调用方的返回类型退化成 `any`、也不再造出假红的 `nudo:unproven-return`。
  与引理名字撞名的情形仍跳过（#152 的 soundness 护栏保留）。
- **349**（签名面泄漏内部占位 term）：契约 fn 的槽位 term 是内部占位名
  （constraint.ts 生成的 `x${i}` / `ret`），此前回显进签名面长成 TS 默认参数
  `f(cb: (number = x0) => number = ret) => number`。现在 fn 形状的内层槽位不再
  回显占位名；关系 fn 槽位的 α 名（A1/B1）照旧回显。
- **1023**（跨模块形参名对不上被静默吞掉）：跨模块桥接路径与同文件路径**同口径**
  ——契约形参名对不上形参表时报 `nudo:interface-param-mismatch`（此前该形参的义务
  在调用方**蒸发**，负参调用假绿）。两条路径复用同一段计算与同一条文案。
