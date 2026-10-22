/**
 * Bug 765 —— 「⚡ persist interface」不得按**未保存的 buffer** 写侧车。
 *
 * 症状（改前）：侧车守卫只挡了**侧车自己**的脏 buffer；源文件的脏 buffer
 * 没有对称守卫 ⇒ 侧车里落的是**未保存**的代码形状（3 参契约），
 * 磁盘上的源码一个字节没变（仍是 2 参）⇒ 门禁「形参对不上」而项目被打成
 * FAILED，且「形参对不上」被完全静默。
 *
 * 修法：写盘前比对「源文件 buffer」与「磁盘文本」——不一致就**明确报错**
 * （与侧车守卫同款：save or discard before emit），不落任何侧车。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withLspServer } from "./helpers.ts";
import { contractEmitTool } from "../agent-tools.ts";

const DISK = `/**
 * @nudo:case "c" (1, 2) => 3
 */
export function add(a, b) {
  return a + b;
}
`;
/** 编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 */
const BUFFER = `/**
 * @nudo:case "c" (1, 2, 3) => 6
 */
export function add(x, y, z) {
  return x + y + z;
}
`;

describe("Bug 765：emit 不得拿未保存的 buffer 覆盖磁盘", () => {
  it("源文件 buffer 与磁盘不一致 ⇒ 拒写盘并给出可诊断的错误", async () => {
    await withLspServer({ "lib.js": DISK }, async ({ dir }) => {
      const file = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: BUFFER } : undefined),
        },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("unsaved buffer changes");
      // 没有侧车落盘
      expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
      // 磁盘上的源码没被动过
      expect(readFileSync(file, "utf-8")).toBe(DISK);
    });
  });

  it("buffer 与磁盘一致 ⇒ 正常写盘（守卫不误伤）", async () => {
    await withLspServer({ "lib.js": DISK }, async ({ dir }) => {
      const file = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: DISK } : undefined),
        },
      );
      expect(r.isError).toBeFalsy();
      expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
    });
  });

  it("源文件根本没有落盘（新建未保存）⇒ 同样拒写盘", async () => {
    await withLspServer({ "other.js": DISK }, async ({ dir }) => {
      const file = join(dir, "new.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: BUFFER } : undefined),
        },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("unsaved buffer changes");
      expect(existsSync(join(dir, "new.nudo.js"))).toBe(false);
    });
  });
});
