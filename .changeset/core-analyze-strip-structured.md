---
"@nudojs/core": patch
---

fix(core): analyze 模式顶层剥离（stripEffectfulTopLevel）改结构化——Babel 解析 transpile 产物、按顶层语句整条剥除，替代行级正则 + `endsWith(";")`/括号计数启发式。修复三类实证误剥：① 多行语句回调体内行以 `;`/`}` 结尾提前终止跳过 → 语句尾悬空 `new Function` SyntaxError（如顶层 `setTimeout(fn, 100)`，整模块 fail-closed）；② 字符串/模板字面量里的未配对 `(`（如 `"fetch("`）被计入 `$for`/`$fork` 括号平衡 → 连带误删后续顶层 `export function`（导出静默 unknown）；③ 列 0 的 `catch (` 头匹配「未知全局调用」正则 → 顶层 try/catch 一律被剥成悬空块。剥除口径零变更（`$callNamed` 未知全局、`$for`/`$fork`/`$while*` 与源形态 if/for/while 剥；本地调用、for-of、赋值、`$switch`/`$throw`、try/catch、`__nudo*` 簿记保留），35 例新旧差分语料 30 例字节级一致、5 例均为旧实现损坏样本；新增 run-strip-effectful.test.ts 差分护栏，eval-*（64 文件 657 用例）与 core algebra 全量（272 文件 3078 用例）绿。
