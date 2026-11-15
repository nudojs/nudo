/**
 * Bug 994 —— agent 的三个 contract 工具要有 `--from`（使用点记录）等价通道。
 *
 * 症状（改前）：`nudo/contract` / `nudo/contract.draft` / `nudo/contract.emit`
 * 都没有 `from` 参数 ⇒ 跨文件调用点证据**系统性丢失**：
 * ① 接口面比 CLI 宽一整级（`(x: any) → number | string` vs CLI 的 `(x: 2) → 3`）；
 * ② 草稿是空契约 `fn({})`——照 agent 自己的指引采纳后门禁仍红；
 * ③ emit 直接拒写（`skipped addOne (not-projectable)`），而 CLI 同参数写得出来。
 *
 * 修法：三个工具加 `from?: string[]`（文件或目录），采集口径与 CLI
 * `nudo contract --from` 同源（顶层调用表达式 ⇒ call@ 记录）。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withLspServer } from "./helpers.ts";
import { contractEmitTool } from "../agent-tools.ts";

const LIB = `export function addOne(x) {
  return x + 1;
}
`;
const MAIN = `import { addOne } from "./lib.js";

addOne(2);
`;

describe("Bug 994：三个 contract 工具的 --from 等价通道", () => {
  it("协议面 nudo/contract：带 from ⇒ 使用点证据参与求解", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, uri }) => {
        const withFrom = await req("nudo/contract")({
          file: uri("lib.js"),
          from: [uri("main.js")],
        });
        expect(withFrom.content[0].text).toContain("(x: 2) → 3");
        // 对照组：不给 from ⇒ 宽一整级
        const without = await req("nudo/contract")({ file: uri("lib.js") });
        expect(without.content[0].text).toContain("(x: any) → number | string");
      },
    );
  });

  it("协议面 nudo/contract.draft：带 from ⇒ 草稿含调用点证据（不再是空契约 fn({})）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, uri }) => {
        const withFrom = await req("nudo/contract.draft")({
          file: uri("lib.js"),
          from: [uri("main.js")],
        });
        expect(withFrom.content[0].text).toContain("fn({ x: number() })");
        expect(withFrom.content[0].text).not.toContain("export const addOne = fn({});");
        const without = await req("nudo/contract.draft")({ file: uri("lib.js") });
        expect(without.content[0].text).toContain("export const addOne = fn({});");
      },
    );
  });

  it("工具面 nudo/contract.emit：带 from ⇒ 写得出契约（改前直接拒写 not-projectable）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ dir }) => {
        const file = join(dir, "lib.js");
        const r = await contractEmitTool(
          { file, functionName: "addOne", mode: "add", from: [join(dir, "main.js")] },
          { workspaceRoots: [dir] },
        );
        const text = r.content[0].text;
        expect(text).not.toContain("not-projectable");
        expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
        expect(readFileSync(join(dir, "lib.nudo.js"), "utf-8")).toContain(
          "export const addOne = fn(",
        );
      },
    );
  });

  it("from 指向不存在的路径 ⇒ 显式报错（不静默给假面）", async () => {
    await withLspServer({ "lib.js": LIB }, async ({ req, uri, dir }) => {
      const r = await req("nudo/contract")({
        file: uri("lib.js"),
        from: [join(dir, "nope.js")],
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("no call-site records collected");
    });
  });
});
