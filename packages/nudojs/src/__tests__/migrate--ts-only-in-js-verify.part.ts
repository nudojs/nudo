/**
 * BUG-114 —— `nudo migrate verify` 对 `.js` 里的 **TS-only 语法**判绿 ⇒ 与
 * `nudo check` 相反 ⇒ 迁移闸门假绿。
 *
 * 根因：check 面按**扩展名**选解析插件（`parseSource(source, { filename })`：
 * `.js` 不带 TS 插件 ⇒ TS 语法直接 SyntaxError ⇒ pathErrors + exit 1），
 * verify 只走宽松解析 ⇒ 同一文件 check 红 / verify 绿。
 *
 * 影响链（与 BUG-050 串联）：`migrate strip` 写坏的产物（`export namespace …` /
 * `import x = require(…)`）在 verify 面**也是绿的** ⇒ 「strip 写坏 ⇒ verify 放绿
 * ⇒ retire 摘掉 TS」完整失效链。
 *
 * 修复：verify 的逐文件通道先做 check 同款**严格解析**；不通过 ⇒ 该文件
 * `code: "syntax-error"` + `nudoOk: false`。
 *
 * 反向闸：普通 `.js` 与合法的 `.ts` 仍判绿（不得把闸门全打红）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateVerify } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-114-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "f114", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("Bug 114: .js 里的 TS-only 语法必须与 nudo check 同结论（判红）", () => {
  it("`.js` 里的类型标注 ⇒ code: syntax-error + nudoOk: false", async () => {
    const dir = project({ "ts-in-js.js": "export function f(a: number): number {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ts-in-js.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(false);
    expect(rows[0]!.code).toBe("syntax-error");
  });

  it("`migrate strip` 的 namespace 产物在 verify 面同样是红的", async () => {
    const dir = project({
      "ns.js": "export namespace Helpers {\n  export const twice = 2;\n}\n",
    });
    const rows = await migrateVerify([join(dir, "ns.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(false);
    expect(rows[0]!.code).toBe("syntax-error");
  });

  it("反向闸：普通 `.js` 仍判绿", async () => {
    const dir = project({ "ok.js": "export function f(a) {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ok.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：`.ts` 里的类型标注照常判绿（严格解析按扩展名选插件）", async () => {
    const dir = project({ "ok.ts": "export function f(a: number): number {\n  return a;\n}\n" });
    const rows = await migrateVerify([join(dir, "ok.ts")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});
