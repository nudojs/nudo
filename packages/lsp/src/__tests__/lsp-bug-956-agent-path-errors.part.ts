/**
 * Bug 956 — LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道**
 * ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有
 * `nudo:path-not-found` 码、没有 suggestion）；而 CLI `test --json` /
 * `check --json` 对同一文件给**结构化信封**。
 *
 * 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`），
 * 且 `format:"json"` 必须真的返回 JSON。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = "export function add(a) {\n  return a + 1;\n}\n";

describe("Bug 956 — agent 工具的路径错误通道", () => {
  it("nudo/test：JSON 面是结构化 pathErrors（不是裸 errno 文本）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors).toBeTruthy();
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
      expect(json.pathErrors[0].message).toContain("Not found:");
      expect(json.pathErrors[0].suggestion).toBeTruthy();
      expect(json.pathErrors[0].path).toContain("nope.js");
    });
  });

  it("nudo/check：JSON 面是结构化 pathErrors", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.ok).toBe(false);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
      expect(json.pathErrors[0].suggestion).toBeTruthy();
    });
  });

  it("文本面：一行原因 + fix 提示（不再是裸 errno）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/nope.js` });
      expect(r.isError).toBe(true);
      const text = r.content[0].text;
      expect(text).toContain("Not found:");
      expect(text).toContain("fix:");
      expect(text).not.toContain("ENOENT");
    });
  });

  it("dot 形式同样是结构化信封", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo.test")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
    });
  });
});
