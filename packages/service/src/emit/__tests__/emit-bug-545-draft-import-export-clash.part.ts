/**
 * Bug 545 —— 契约草稿生成器写出的模块里，**builder 的 import 绑定**与生成的
 * `export const <name>` **撞名** ⇒ 写出的文件是**非法 JavaScript**
 * （`node --check` 直接 SyntaxError）。
 *
 * 症状（旧口径）：
 * ```js
 * import { fn, number } from "@nudojs/core";
 * export const number = fn({ x: number() }, number());
 * ```
 * ⇒ `SyntaxError: Identifier 'number' has already been declared`（同一模块
 * 作用域重名）⇒ 工具写出的**交付物本身不是合法 JS**，照抄进侧车同样是坏侧车。
 *
 * 根因：草稿模块的 import 绑定与 export 绑定共用一个模块作用域，但冲突检查
 * 只做了「export ↔ export」去重，**从不与 import 名单比对**；import 名单又
 * 是按 DSL 正文正则扫出来的 ⇒ 源函数名本身是 builder 名时正面撞车。
 *
 * 修法：草稿侧车键取**导出身份**，绑定名不安全时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`（与 `--emit` 面同源）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftInterface, sidecarDraftPath } from "../interface-draft.ts";
import { nodeCheck } from "./draft-artifact.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-545-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 545 —— 草稿的 import ↔ export 撞名", () => {
  it("导出名撞 builder import ⇒ 走别名形态（改前：export const number）", async () => {
    const file = join(dir, "src.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function number(x) { return x + 1; }\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "number");
    expect(entry).toBeDefined();
    // 身份仍是导出名 `number`；绑定换别名 ⇒ 与 import { number } 不撞
    expect(entry!.identity).toBe("number");
    expect(r.draftSource).not.toMatch(/^export const number = /m);
    expect(r.draftSource).toContain("export { _nudo_1 as number };");
  });

  it("草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）", async () => {
    const file = join(dir, "src.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function number(x) { return x + 1; }\n`,
    );
    const r = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：普通导出名仍是 export const <name>（不误改别名形态）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "n" (1)\n */\nexport function add(x) { return x + 1; }\n`,
    );
    const r = await draftInterface(file);
    expect(r.draftSource).toContain("export const add = fn({ x: number() });");
    expect(r.draftSource).not.toContain("_nudo_1");
  });
});
