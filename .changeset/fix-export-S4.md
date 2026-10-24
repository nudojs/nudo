---
"nudojs": major
---

**BREAKING**: `nudo export --out` 的**产物文件名**变了，且**不再覆盖**不是自己
生成的产物。

- 产物名冲突时现在带**模块键后缀**（`lib.323a7411.d.ts` / `C.m.nudo.standard.ts` /
  `C.m.2.nudo.standard.ts`）⇒ 此前 `a/lib.js` 与 `b/lib.js` 会**互相覆盖**
  （后者静默盖掉前者）⇒ 消费方按**固定文件名**取产物的流水线现在会找不到文件。
- `--out` 现在**拒绝覆盖**它没生成过的文件（exit 1 + `nudo:path-io`）⇒ 此前
  手写的 `.d.ts` 会被**静默替换**成 `unknown`；现在构建会以非零码退出。

谁会坏：按**固定文件名**消费 `nudo export --out` 产物的脚本（文件名现在带模块键
后缀 / 方法名）；以及依赖「`--out` 会覆盖输出目录里的同名文件」的流水线（现在
拒绝并 exit 1）。

怎么迁移：改用产物里的 `// nudo-export-module:` marker 行定位产物（它记录产物
属于哪个模块），而不是硬编码文件名；确保输出目录里没有会被覆盖的同名文件
（或先清空输出目录）。产物内的 `// nudo-export-module:` marker 用于区分
「同模块更新」与「另一个模块的同名产物」。

`nudo export --out` no longer loses artifacts silently: product names are
unique per module, hand-written files are never overwritten, and a failed
write reports what actually landed.

- Two modules could map to the same artifact path. The Standard Schema face
  names its file after the **function** (so two modules exporting a function
  of the same name collided), while the dts / zod / guard faces name theirs
  after the source file **stem** (so `a/lib.js` and `b/lib.js` collided). The
  second export silently overwrote the first one, and the consumer ended up
  with another module's declarations. A product name that is already taken
  by a different module now gets a module-key suffix
  (`lib.323a7411.d.ts`), so both modules keep their artifact.
- Two functions with the same name in one module (two `m` methods of a class)
  were written to the same Standard Schema file — the second write overwrote
  the first. Each function now gets its own file
  (`C.m.nudo.standard.ts`, `C.m.2.nudo.standard.ts`).
- A hand-written `.d.ts` in the output directory was overwritten without a
  word, replacing precise types with `unknown`. `nudo export` now refuses to
  overwrite a file it did not generate (exit 1, `nudo:path-io` diagnostic) and
  leaves the file untouched.
- When a write failed, the artifacts that had already been written were
  dropped from the output: stdout showed no `wrote` line at all while the
  files were on disk. The written list is now replayed, and the error names
  the file that failed instead of only the directory.
- The `fix:` hint for a failed `--out` pointed at `nudo check --out`, an
  option that does not exist (`error: unknown option '--out'`). It now points
  at `nudo export --out` and says what to do.

Artifacts written with `--out` carry a `// nudo-export-module:` marker line
that records which module they belong to; it is used to tell "same module,
updated" from "another module with the same name".
