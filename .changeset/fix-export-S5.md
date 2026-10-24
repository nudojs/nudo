---
"nudojs": minor
---

**BREAKING**: `nudo export --format all`（stdout）的**导出名**变了 —— 同一模块
作用域内同名导出现在被**改名**而不是撞名报错。

- zod 面与 standard 面都叫 `<fn>Input` / `<fn>Output` ⇒ `--format all` 的 stdout
  此前撞名（`TS2451`）；现在**后一个**面改名（`<fn>OutputStandard`）⇒ 消费方
  `import { <fn>Output } from "…"` 现在拿到的是 **zod 面**的那个名字，standard 面
  的同名导出**改名** ⇒ 直接按旧名 import 的消费方 `tsc --noEmit` 会红。

谁会坏：`nudo export --format all > out.ts` 后按名 import `<fn>Output` / `<fn>Input`
的消费方（standard 面的同名导出现在带 `Standard` 后缀）；以及期待 `--format all`
stdout **撞名报错**的脚本（现在能出文件了）。

怎么迁移：重新生成产物并按新名 import（zod 面保持 `<fn>Output` / `<fn>Input`，
standard 面在 `--format all` 合并流里是 `<fn>OutputStandard`）；或分开导出
（`--format zod` 与 `--format standard` 各自成文件 ⇒ 名字不冲突）。

`nudo export` to stdout now produces one usable module: the Standard Schema
helper is declared once, the four dialects no longer collide on export names,
and the dropped-preds ledger names the face it came from.

- `--format standard` to stdout repeated the whole `__nudoCheck` helper for
  every exported function, because each per-function module carries its own
  copy and the chunks were concatenated as they were. The shared prelude
  (banner + helper) is now emitted once, so the artifact no longer fails to
  compile with `TS2393` / `TS2300`.
- `--format all` to stdout put the zod and the Standard Schema face into the
  same module scope. Both name the same validator `<fn>Input` / `<fn>Output`,
  so the artifact failed with `TS2451`. A top-level name may now be declared
  only once per stream: the first face keeps the product name and a later
  face that would repeat it is renamed (`<fn>OutputStandard`).
- The `dropped preds` ledger was always titled "not projected into zod" even
  when the run produced no zod artifact at all (`--format standard`) and its
  entries come from the Standard Schema face. The title now names the face
  the entries come from, and `--format all` shows one zod ledger and one
  Standard Schema ledger instead of the same title twice.

Artifacts written with `--out` are unchanged: each dialect keeps its own file
and its own product names.
