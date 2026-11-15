/**
 * Bug 766 —— emit 写盘边界按**路径分量**判定，不按字符串前缀。
 *
 * 症状（改前）：`pathInsideRoot` 用 `rel.startsWith("..")` 判逃逸 ⇒
 * `..dotted.js` / `...triple.js` / `..cfg/x.js` 这些**合法**的相对路径
 * （组件名以 `..` 开头）被误判成逃逸 ⇒ IDE 拒绝对**工作区内**的合法文件
 * 写侧车，而 CLI（无 workspace root 闸门）接受。
 *
 * 修法：逃逸判据 = 「整段等于 `..`」或「以 `..` + 分隔符开头」。
 * 真正的逃逸（root 外的兄弟目录、指向 root 外的符号链接）**仍必须拒**。
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { withLspServer } from "./helpers.ts";
import { contractEmitTool } from "../agent-tools.ts";

const SRC = `export function f() {
  return 1;
}
`;

describe("Bug 766：emit 写盘边界按路径分量判定", () => {
  it("root 内以 `..` 开头的合法路径名 ⇒ 允许写侧车", async () => {
    await withLspServer(
      {
        "..dotted.js": SRC,
        "...triple.js": SRC,
      },
      async ({ dir }) => {
        // `..cfg/` 子目录（组件名以 `..` 开头）在回调里现落
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(join(dir, "..cfg"), { recursive: true });
        writeFileSync(join(dir, "..cfg", "x.js"), SRC, "utf-8");
        // workspace root = 临时目录本身（..cfg 是它的子目录）
        for (const rel of ["..dotted.js", "...triple.js", join("..cfg", "x.js")]) {
          const file = join(dir, rel);
          const r = await contractEmitTool(
            { file, functionName: "f", mode: "add" },
            { workspaceRoots: [dir] },
          );
          expect(r.isError, `${rel} 不该被拒：${r.content[0].text}`).toBeFalsy();
        }
        expect(existsSync(join(dir, "..dotted.nudo.js"))).toBe(true);
        expect(existsSync(join(dir, "...triple.nudo.js"))).toBe(true);
        expect(existsSync(join(dir, "..cfg", "x.nudo.js"))).toBe(true);
      },
    );
  });

  it("root 外的文件 ⇒ 仍然拒绝", async () => {
    await withLspServer({ "in.js": SRC }, async ({ dir }) => {
      const root = join(dir, "root");
      mkdirSync(root, { recursive: true });
      const outside = join(dir, "outside", "secret.js");
      mkdirSync(join(dir, "outside"), { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outside, SRC, "utf-8");
      const r = await contractEmitTool(
        { file: outside, functionName: "f", mode: "add" },
        { workspaceRoots: [root] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("outside allowed roots");
      expect(existsSync(join(dir, "outside", "secret.nudo.js"))).toBe(false);
    });
  });

  it("指向 root 外的符号链接 ⇒ 仍然拒绝（realpath 防逃逸）", async () => {
    await withLspServer({ "in.js": SRC }, async ({ dir }) => {
      const root = join(dir, "root");
      const outsideDir = join(dir, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(outsideDir, "secret.js"), SRC, "utf-8");
      const link = join(root, "link.js");
      symlinkSync(join(outsideDir, "secret.js"), link);
      const r = await contractEmitTool(
        { file: link, functionName: "f", mode: "add" },
        { workspaceRoots: [root] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("outside allowed roots");
      expect(existsSync(join(outsideDir, "secret.nudo.js"))).toBe(false);
    });
  });
});
