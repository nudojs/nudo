/**
 * BUG-104 —— `textDocument/signatureHelp` 把模块级 callee 渲染成
 * 「形参一律 `any`、返回一律 `unknown`」的**声明空壳** ⇒ 与同一 LSP 面的 hover
 * 及 CLI `nudo check` 给出互斥结论。
 *
 * 症状：`add({ id: 1 })` 的调用点，signatureHelp 给 `(user: any) => unknown`
 * （documentation 亦为 `(user) => ?`），而同一位置的 hover 给
 * `(user: shape({ name: string() })) → string()` 与精确签名
 * `add: (user: { name: string }) => string`，CLI `nudo check` 亦为
 * `add(user: { name: string }) => string`。
 *
 * 根因：`attachSignatureHelp` 路径①（裸标识符 → 绑定面 `getTypeAtPosition`）
 * 只要 `fnAbs.shape.k === "fn"` 就直接 return，不再回落路径③的内涵面
 * （`resolveCalleePolyFn` / `generalizeFromAst`）；而绑定面里的 fn Abs 常是
 * `fnOf()` 造的声明空壳（无 `paramTypes` / `returnType`）。
 *
 * 修法：路径①加与 hover 同款的 `deferIfArityOnlyFn` 闸门——`returnType` 槽空的
 * arity-only fn **不采纳**，回落内涵面 `buildSignatureHelpFromPolyFn`。
 *
 * 钉：调用点签名 label 含侧车契约的形参类型与返回类型（`{ name: string }` /
 * `string`），且**不是** arity-only 空壳（`user: any` / `unknown`）；同一位置
 * hover 仍给精确签名（两面同口径）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

/** 复现夹具（tmp/repro/bug-104/lib.js）：模块级 callee 的调用点在第 5 行。 */
const LIB = `export function add(user) {
  return user.name;
}
export function caller() {
  return add({ id: 1 });
}
`;

/** 侧车契约（tmp/repro/bug-104/lib.nudo.js）：形参 `{ name: string }`，返回 `string`。 */
const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const add = fn({ user: shape({ name: string() }) }, string());
`;

describe("BUG-104 — signatureHelp 取内涵面，不返回 arity-only 声明空壳", () => {
  it("裸标识符 callee 的签名含侧车契约的形参类型与返回类型", async () => {
    await withLspServer({ "lib.js": LIB, "lib.nudo.js": SIDECAR }, async (ctx) => {
      // LSP 位置（0 基行 / 列）：`  return add({ id: 1 });` 的 `add` 内
      const position = { line: 4, character: 10 };
      const sh: any = await ctx.req("textDocument/signatureHelp")({
        textDocument: { uri: ctx.uri("lib.js") },
        position,
      });
      const sig = sh?.signatures?.[0];

      // 契约形参 / 返回（不是 `(user: any) => unknown`）
      expect(sig?.label).toBe("(user: { name: string }) => string");
      expect(sig?.label).not.toContain("unknown");
      expect(sig?.label).not.toContain("user: any");
      expect(
        (sig?.parameters ?? []).map((p: any) => p.label),
        "形参位渲染必须带契约类型",
      ).toEqual(["user: { name: string }"]);

      // documentation 与 hover 同源，不得是占位符签名 `(user) => ?`
      const doc = String(sig?.documentation?.value ?? "");
      expect(doc).not.toContain("(user) => ?");

      // 同一面同口径：hover 在调用点给精确签名（`=> string`）
      const hov: any = await ctx.req("textDocument/hover")({
        textDocument: { uri: ctx.uri("lib.js") },
        position,
      });
      const hoverText = String(hov?.contents?.value ?? "");
      expect(hoverText).toContain("=> string");
      expect(hoverText).not.toContain("(user) => ?");
    });
  }, 60_000);
});
