/**
 * Bug 770 — LSP agent 工具 `nudo/check` / `nudo/test` **没有「分析目标」
 * 闸门** ⇒ 对**侧车契约文件**报「OK / 0 error / 0 fn」（假绿），而 CLI 对
 * 同一文件 exit 1「Not an analysis target」；`nudo/test` 还把契约 **DSL
 * 构造器**（`fn(...)` / `shape(...)` / `string()`）当成真实调用点报成 case。
 *
 * 修法：入口复用与 CLI **同一份**目标判定（`isNudoTargetPath` + 侧车 /
 * `.d.ts` / JSX 排除）⇒ 非分析目标返回**明确的错误**（`nudo:path-not-target`
 * 码 + 与 CLI 逐字一致的消息）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;

describe("Bug 770 — agent nudo/check + nudo/test 的分析目标闸门", () => {
  it("nudo/check：侧车 ⇒ 明确错误（不再是 0 fn 判绿）", async () => {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo/check")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.ok).toBe(false);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-target");
      expect(json.pathErrors[0].message).toContain("Not an analysis target");
    });
  });

  it("nudo/test：侧车 ⇒ 明确错误，契约 DSL 构造器不再被报成 case", async () => {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-target");
      // 「0 fn · 3 case」（fn/shape/string 三个 DSL 构造器当成了调用点）
      expect(json.summary.cases).toBe(0);
      expect(json.functions).toEqual([]);
      expect(json.externalFunctions ?? []).toEqual([]);
    });
  });

  it("普通 .js 目标不受闸门影响（仍能分析）", async () => {
    await withLspServer(
      { "lib.nudo.js": SIDECAR, "lib.js": "export function getName(u) { return u.name; }\n" },
      async ({ req, dir }) => {
        const r = await req("nudo/check")({ file: `${dir}/lib.js`, format: "json" });
        expect(r.isError).toBeUndefined();
        const json = JSON.parse(r.content[0].text);
        expect(json.pathErrors).toBeUndefined();
        expect(json.signatures.length).toBe(1);
      },
    );
  });

  it("dot 形式同样过闸门", async () => {
    await withLspServer({ "lib.nudo.js": SIDECAR }, async ({ req, dir }) => {
      const r = await req("nudo.check")({
        file: `${dir}/lib.nudo.js`,
        format: "json",
      });
      expect(r.isError).toBe(true);
    });
  });
});
