---
"@nudojs/lsp": patch
"@nudojs/core": patch
---

LSP 符号 / 观察面与导出面对齐：默认导出、导出类实例方法、CJS 成员导出不再
整段消失，跨模块调用点补上 `call@` 观察透镜（Bug 753 / 769 / 998 / 1034）。

- `export default function` 此前只存在于 hover / 大纲面，CodeLens 与
  inlayHint 的 interface 档（`● contract / imp` / `⚡ persist interface` /
  `⚡ draft interface`）整段缺失。默认导出现在与具名导出同形。
- 导出类的实例方法（`Counter.inc`）此前只在 hover 面可见：CodeLens 没有
  interface 档，inlayHint 也没有返回 inlay。类方法现在以 `Class.method`
  为契约键进入两面，与顶层导出函数同形。
- CJS 成员导出（`exports.f = fn` / `module.exports.f = fn`）此前在
  documentSymbol / workspace symbol / inlayHint / semanticTokens 四个面
  全部不可见，CodeLens 也没有 interface 档——而诊断面却点名该导出。
  四面现在与 ESM 具名导出同形（导出键带 function 档 + interface 档 modifier）。
- 跨模块调用点（`import { add } from "./lib.js"` 后调用 `add(x, 2)`）此前
  不在调用方文件的 CodeLens 上投影——CLI `nudo test` 已经打印该事实。
  调用方文件现在出现与 CLI 同形的 `call@L4` lens；被导入函数的 entry@
  仍属被导入模块，不在调用方落镜。

core 侧只改了内部未导出函数 `listFunctions` 的函数体（导出类实例方法与
CJS 成员导出的枚举），未新增任何导出名。
