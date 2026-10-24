---
"@nudojs/lsp": patch
---

fix(lsp): `refactor.extract` 的多 edit 合成统一坐标口径（Bug 450）

- 根因：`packages/lsp/src/extract-function.ts` 的 `applyEdits` **排序**用原
  `source` 的坐标、**应用**时却用 `posToOffset(out, …)` 在**已被前面的 edit
  改写过的** `out` 上求坐标 ⇒ 两个区间相互包含（插入点落在替换范围内部）时，
  后应用的 edit 落点按**陈旧坐标**漂移 ⇒ 源文件被搅成垃圾
  （`"AAAA BBBB CCCC"` + 替换 [5,9) + 插入 @6 ⇒ 改前 `"AAAA REPLBBB CCCC"`）。
- 修法：**统一坐标口径** —— 全部 edit 的偏移都在**原 source** 上算好，再
  **从后往前**（起点倒序）应用；区间嵌套（插入点落在替换范围内部，LSP 规范下
  属非法重叠 edit）按「插入文本并入该替换范围、紧贴替换文本**之前**」
  **确定性合成** ⇒ 改后 `"AAAA INSREPL CCCC"`（插入内容不丢、源码不被搅乱）。
- 替换范围之间**真的**重叠（部分重叠 / 交叉）无法确定性合成 ⇒ fail-closed：
  抛 `RangeError`（`server-code-actions.ts` 的 `refactor.extract` 是
  best-effort ⇒ 抛错即「不出 action」，绝不产出非法 WorkspaceEdit）。
- 影响面：`applyEdits` 的两个调用点（**表达式提取路径** / **语句序列路径**）
  同时受益；不相交 edit 的既有行为**逐字不变**。
- 未变：公共 API 冻结面零变更（`packages/lsp/src/public-api.ts` 四张表不动、
  零新增导出）。
