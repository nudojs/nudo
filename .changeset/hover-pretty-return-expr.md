---
"@nudojs/core": patch
"@nudojs/lsp": patch
---

hover 弹窗可读性与 return 表达式推导：

- **pretty 缩进展示**：`formatShape(a, { pretty: true })`（opts 挂 `ProjectionBudget.pretty`，与 `showLits` 同先例）——object 每槽一行 + 尾逗号 + 2 空格缩进递增；union 仅当至少一臂是复合 shape（object/array/map/set/fn 或渲染含 `{`）时按臂断行（` | ` 前缀换行），纯 prim/lit 联合保持单行（`string | null | undefined` 不断）；截断标记 `…`/`…cycle` 原样内联。默认（不传 pretty）输出字节不变——check 签名 / dts / inlay / 语义 token 面不受影响。应用点仅 hover 面：标识符 hover（identHover / A0 求值态）与 return 表达式 hover；`gSig` 签名、`paramDisplayOf` 声明形态折叠面保持单行。
- **删除「契约原文」链接行**：hover 弹窗不再推送 `[契约原文](file://…#L<n>)` 链接（`linkedText` 变量链接面保留）；`HoverInfo.sidecarPath`/`sidecarLine` 字段随唯一消费方一并删除。
- **return 表达式推导 hover**：transpile `ReturnStatement` 在 `recordPositions` 时把返回值包 `$nodoPos(src, line, column)` 记录到 **`return` 关键字起始位**（argument 起始位与内部根标识符读记录同键 first-wins 丢失；`emitRet` 单一 choke point 覆盖 asVar/try/loop/mutator 全路径；裸 `return;` 不记录）。LSP `absNodeAtPosition` 词中回落从 Identifier 泛化为任意带 loc 节点（候选仅当起始键已有记录，取最小 span——词中标识符行为不变）；新增无 ident 分支——hover `return` 关键字或表达式内非标识符位（`?.[`、`[0]`、`.`）直接显示推导类型（无 ident 前缀，pretty 渲染）。
