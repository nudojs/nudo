---
"nudojs": major
---

**BREAKING**: standard 面的返回面导出名**恒为** `<fn>Output`（此前「有返回契约时」
叫 `<fn>Return`）—— 这条改名随 CLI 到达消费方。

谁会坏：`nudo export --format standard` 之后 `import { <fn>Return } from
"*.nudo.standard"` 的消费方 ⇒ 旧名 import 断（消费方 `tsc --noEmit` 会红）。

怎么迁移：改 import 名为 `<fn>Output` 并重新生成产物；文档与
`scripts/verify-doc-examples.sh` 的 pin 已同步。

`nudo export` 的六片并发修复收口：主 agent 接线把「命名规则分叉」「同名条目折叠」
「契约可选性丢失」「模块身份靠猜」四处跨片缺口补上。

- **命名规则的唯一产地**（Bug 602 / 603 / 609 / 622）：`export/stdout.ts` 原先
  自带一份 `DIALECT_SUFFIX` + `uniqueSegmentName`，`export/io.ts` 又造了一份 ⇒
  「stdout 改名规则」与「落盘改名规则」可能分叉。删掉 stdout 侧的本地副本，
  改为 import `io.ts` 的实现（同一 `ArtifactDialect` 口径）。
- **同名条目不再折叠**（Bug 623）：zod 导出表原是**普通对象** ⇒ 同一个类里两个
  同名方法（`C.m` 出现两次）时后者覆盖前者 ⇒ zod 产物只剩 1 个 `C_mInput`，
  另一个方法的证据凭空消失。导出表改无原型对象 + **键侧去重**
  （`C_mInput` / `C_mInput_2`）⇒ 两份都在；guard 面同步接上
  `generateGuardFunctionFromAbs` 的**去重集合** ⇒ 同一份产物里不再出现两个
  同名 `export function`（此前是 TS2393 重复声明）。
- **standard 面的可选性透传**（Bug 627）：参数面的 `optional` 没传给 service ⇒
  契约允许 `undefined` 的形参在 standard 面被当必填 ⇒ 消费方判非法。
- **模块身份不再靠猜**（Bug 609 / 622）：`--out` 写盘时把**源文件路径**作为
  `moduleKey` 传给写盘层 ⇒ 模块身份从「stem + 导出签名」升级为路径 ⇒ 同 stem
  **且**导出名集合也相同的两个模块不再被判成同一模块（后者覆盖前者），且
  改名后重导不会换唯一名、留下陈旧副本。
- **614 的破坏性重命名连带面同步**：standard 面返回面导出名**恒为 `<fn>Output`**
  ⇒ `scripts/verify-doc-examples.sh` 的 pin 与中英文档
  `guides/export-ecosystem.md` 同步（否则 `verify:docs` 红）。
