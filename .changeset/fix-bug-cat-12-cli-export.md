---
"nudojs": patch
---

Fix bug-report category 12 (`nudo export`) — 11 defects.

- BUG-016: the module identity used by `--out` is path-free (package-relative path, or
  `<stem>|<export names>` outside a package root), so exporting the same module from two
  directories produces one byte-identical artifact instead of accumulating
  contradictory stale copies.
- BUG-026 / BUG-279: an `entry@` witness contributes its **element** to a rest parameter,
  so the published type is one array rather than an array of arrays.
- BUG-028: the `--format all` stdout flattener pre-reserves the dts segment's (user API)
  identifiers, so user exports keep their names and the flattened dts matches `--out`.
- BUG-033: a barrel module's dts surface is assembled before the early return, so
  re-exports are no longer dropped when the module has no functions.
- BUG-044: `nudo export` publishes with `caseMode: "none"`, i.e. the same domain as the
  `check` / `health` / `migrate` gate, instead of leaking `@nudo:case` debug witnesses
  into the shipped dts/schema.
- BUG-075: the stdout flattener registers all top-level identifiers (exports, locals,
  import bindings), so the flattened output passes `tsc --strict`.
- BUG-120 / BUG-121: object-destructured parameters collapse to one slot keyed by the
  formal name, and the constraint-disproof `fields` branch handles `sum` shapes
  symmetrically with `prim`.
- BUG-204: identifier renaming in the stdout flattener is lexer-aware (skips strings,
  templates, comments, property keys and object keys), so slot-key **data** is no longer
  rewritten.
- BUG-231: the unique-name fallback in `--out` honours `isSameModule`, so re-exporting
  the same module overwrites in place rather than writing a `.2` copy that diverges.

Regression tests: `cli-bug-016-*`, `cli-bug-026-*`, `cli-bug-028-*`, `cli-bug-033-*`,
`cli-bug-044-*`, `cli-bug-075-*`, `cli-bug-120-*`, `cli-bug-121-*`, `cli-bug-204-*`,
`cli-bug-231-*`, `cli-bug-279-*`.

Known follow-up: BUG-044's **contract print** face still consumes
`packages/service/src/emit/interface-surface.ts` with the default `caseMode: "all"`, so
`nudo contract`'s printed interface can still include `@nudo:case` witnesses. The export
products (dts/schema/guard) are now gate-consistent.

### 追加：两处既有期望按 BUG-109 重钉（不是放宽）

BUG-109 声明正确行为 = rest 槽**恒可选**且只有**一层**数组，而两个既有用例钉的是修复前
的「必填」形状，与之相反 ⇒ 按声明正确行为重钉 expected 子串，**行为断言原样保留**
（一层数组、`not.toContain("z.array(z.array(")`、错误形状仍被拒）：

- `cli-bug-026-rest-param-single-array.test.ts`：standard 面槽 →
  `{"key":"rest","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}`。
- `cli-bug-279-rest-entry-witness-slot.test.ts`：zod →
  `z.object({ args: z.array(z.unknown()).optional() })`；standard 槽带 `"optional":true`。

### 重钉：BUG-044（`@nudo:case` 见证不进发布面）+ 文档口径修正

`@nudo:case` 是**调试见证**、不是契约产品 ⇒ `nudo export` 以 `caseMode: "none"` 调分析器，
发布面（dts / schema / guard / standard）不消费见证。据此：

- `docs/design/cli-semantics.md` §2 的「已记录例外（export 投影面）」把签名数据源写清：
  **契约 / 调用点证据 / `entry@` 兜底**，并明写「`@nudo:case` 调试见证不进导出面」。
- `packages/website/docs/guides/export-ecosystem.md:114/185` 与 zh-Hans 镜像同步：
  删除「`@nudo:case` 见证喂导出签名」的表述，改为「`nudo export` 与门禁一样以
  `caseMode: "none"` 分析；见证不进发布面」。
- 重钉 3 处旧断言（原断言钉住「见证拓宽形参 / 产出 `Case:` 行 / 进 `Output` 校验器」）：
  - `export-dts-evidence.test.ts`：用例改名「调试见证不进导出面（BUG-044）」；
    `toContain("export declare function greet3(u: { name: string }): string;")` +
    `toContain('Case: named …')` ⇒ `toContain("export declare function greet3(u: any): any;")` +
    `not.toContain("Case:")`。
  - `cli-bug-619-skip-multi-witness-output.test.ts`：zod 面
    `toContain("twiceOutput")` + `toContain("z.literal(4)/6")` ⇒
    `toContain("twiceInput")` + `not.toContain("twiceOutput")` + `not.toContain("z.literal(4)")` +
    `not.toContain("z.literal(6)")`；standard 面 `toContain("twiceOutput")` ⇒
    `toContain("twiceInput")` + `not.toContain("twiceOutput")`。
    只带 case、无契约的 skip 函数发布面无 `Output` 校验器（域证据为空 ⇒ 返回面无种子）是
    该口径的**结果**而非缺陷；「函数仍出现在产物里 + exit 0」仍被钉住。
- 附带（BUG-189 形态统一）：`export-dts-evidence` 的「export default 函数进导出面」由
  `toContain("export default function makeGreeting")` 改为
  `toContain("makeGreeting")` + `toContain("as default")`；
  `not.toContain("export declare function makeGreeting")`（Bug 515：局部名不得成为具名导出）保留。
