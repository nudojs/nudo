/**
 * Bug 748 —— `filePathToUri` / `uriToFilePath` **不互逆** ⇒ 服务端自产的
 * `location.uri` 是**非法 URI**（裸 `%`）⇒ 客户端回传后
 * `didOpen` / `didChange` / `didClose` 抛未捕获 `URIError`
 * ⇒ 该文档**零诊断**（L2 假绿）。
 *
 * 根因：编码侧 `filePathToUri`（`server-navigation.ts`）**裸拼** `file://` + 路径
 * （路径里的 `%` / `#` / `?` / 空格**不转义**）；解码侧 `uriToFilePath`
 * （`validation.ts`）**裸 `decodeURIComponent`** ⇒ 畸形百分号转义抛 `URIError`。
 *
 * 修法：编码侧改用 Node 内置 **`pathToFileURL(filePath).href`**（零新增导出、
 * 跨平台、天生与 `fileURLToPath` 互逆）；解码侧改用 **`fileURLToPath` +
 * `try/catch` 兜底**（畸形 ⇒ 回退到未解码原文，**绝不抛**）。
 * ⇒ `cacheKey` 自动受益。
 *
 * ⚠ **非 `file:` scheme**（`untitled:` 等）**原样返回**（行为不变）。
 * ⚠ **Windows 盘符**必须一并验证：`fileURLToPath` 给 `C:\...`，
 *   旧实现 `slice(7)` 会留 `/C:/...` ⇒ 本钉用 `cacheKey` 断言（跨平台同形）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filePathToUri } from "../server-navigation.ts";
import { cacheKey, uriToFilePath } from "../validation.ts";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

describe("Bug 748 — URI 编解码互逆（编码侧 pathToFileURL / 解码侧 fileURLToPath）", () => {
  it("编码侧对保留字符做百分号转义（裸 % 不再出现）", () => {
    expect(filePathToUri("/x/100%.js")).toBe("file:///x/100%25.js");
    expect(filePathToUri("/x/a#b.js")).toBe("file:///x/a%23b.js");
    expect(filePathToUri("/x/a?b.js")).toBe("file:///x/a%3Fb.js");
    expect(filePathToUri("/x/a b.js")).toBe("file:///x/a%20b.js");
    expect(filePathToUri("/x/中文.js")).toBe("file:///x/%E4%B8%AD%E6%96%87.js");
  });

  it("普通路径的 URI 形态不变（file:/// 绝对路径）", () => {
    expect(filePathToUri("/tmp/a.js")).toBe("file:///tmp/a.js");
    expect(filePathToUri("file:///already/a.js")).toBe("file:///already/a.js");
  });

  it("解码侧：合法 URI 解回原路径（与编码侧互逆）", () => {
    for (const p of ["/x/100%.js", "/x/a#b.js", "/x/a?b.js", "/x/a b.js", "/x/中文.js", "/tmp/a.js"]) {
      expect(uriToFilePath(filePathToUri(p)), `round-trip 失败：${p}`).toBe(p);
    }
  });

  it("解码侧：畸形百分号转义**绝不抛**（回退到未解码原文）", () => {
    let out: string | undefined;
    expect(() => {
      out = uriToFilePath("file:///x/100%.js");
    }, "畸形 URI 抛了（didOpen/didChange/didClose 会中断 ⇒ 该文档零诊断）").not.toThrow();
    expect(typeof out).toBe("string");
    let out2: string | undefined;
    expect(() => {
      out2 = uriToFilePath("file:///x/%zz.js");
    }, "畸形 URI 抛了").not.toThrow();
    expect(typeof out2).toBe("string");
  });

  it("解码侧：非 file: scheme 原样返回（行为不变）", () => {
    expect(uriToFilePath("untitled:Untitled-1")).toBe("untitled:Untitled-1");
    expect(uriToFilePath("/plain/path.js")).toBe("/plain/path.js");
  });

  it("Windows 盘符形态经 cacheKey 归一（file:///c:/… ⇒ c:/…）", () => {
    expect(cacheKey("file:///c:/my%20dir/a.js")).toBe("c:/my dir/a.js");
    expect(cacheKey("file:///c:/proj/a.js")).toBe(cacheKey("c:/proj/a.js"));
  });

  it("协议面：客户端把服务端自己刚给的（裸 % 的）URI 回传给 didOpen ⇒ 不中断且该文档有诊断", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-748-"));
    try {
      // 服务端**旧实现**自产的 URI 形态：裸 `%`（非法 URI）
      const src = "export function f() { return unknownGlobal(); }\n";
      writeFileSync(join(dir, "100%.js"), src, "utf-8");
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const uri = `file://${join(dir, "100%.js")}`;
      let thrown: unknown;
      try {
        mock.notifications.get("textDocument/didOpen")!({
          textDocument: { uri, languageId: "javascript", version: 1, text: src },
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown, "didOpen 抛了 ⇒ 该通知中断 ⇒ 该文档零诊断").toBeUndefined();
      await new Promise((r) => setTimeout(r, 300));
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published.length, "该文档从未进入分析 ⇒ 零诊断").toBeGreaterThan(0);
      const last = published[published.length - 1];
      expect((last.diagnostics ?? []).length, "该文档零诊断").toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
