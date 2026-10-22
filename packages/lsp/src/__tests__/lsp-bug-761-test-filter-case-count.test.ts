/**
 * Bug 761 — LSP agent 工具 `nudo/test` 的 **`functions` 过滤**只重算**本地**
 * 函数的 case 数 ⇒ `summary.cases` 与**自身 payload** 矛盾（summary 说 1 个
 * case，payload 里躺着 2 个）。
 *
 * 根因：过滤分支只替换了 `functions` 与 `summary` 两个键，`externalFunctions`
 * （连同它的 case）原封不动留在 payload 里 ⇒ 「summary 说 1、payload 有 2」。
 *
 * 修法口径（与 bug 报告一致）：外部函数**不在** `functions` 过滤范围内 ⇒ 其
 * case 仍留在 payload 里 ⇒ `summary.cases` 必须**含**外部 case。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const LIB = `export function helper(x) {
  return x + 1;
}
`;

const MAIN = `import { helper } from "./lib.js";
export function alpha(x) {
  return helper(x);
}
export function beta(x) {
  return x * 2;
}
alpha(1);
beta(2);
`;

describe("Bug 761 — agent nudo/test 过滤后 summary.cases 与 payload 同源", () => {
  it("summary.cases == payload 里的实际 case 总数（含外部 case）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({
          file: `${dir}/main.js`,
          format: "json",
          functions: ["alpha"],
        });
        const json = JSON.parse(r.content[0].text);
        const local = json.functions.reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        const external = (json.externalFunctions ?? []).reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        expect(local).toBe(1);
        expect(external).toBe(1);
        expect(json.summary.cases).toBe(local + external);
      },
    );
  });

  it("summary.externalFunctions 与 payload 里的外部函数数一致", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({
          file: `${dir}/main.js`,
          format: "json",
          functions: ["alpha"],
        });
        const json = JSON.parse(r.content[0].text);
        expect(json.summary.externalFunctions).toBe(
          (json.externalFunctions ?? []).length,
        );
        expect(json.summary.functions).toBe(json.functions.length);
      },
    );
  });

  it("未过滤时 summary.cases 同样与 payload 同源（含外部 case）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js`, format: "json" });
        const json = JSON.parse(r.content[0].text);
        const local = json.functions.reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        const external = (json.externalFunctions ?? []).reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        expect(json.summary.cases).toBe(local + external);
      },
    );
  });
});
