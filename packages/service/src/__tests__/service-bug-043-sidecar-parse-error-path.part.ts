/**
 * BUG-043 —— 侧车不可解析时诊断点名**源文件**而不是侧车。
 *
 * `collectGeneratedSections` 抛的是无路径的 `"sidecar is not parseable"`
 * （注释说「由调用方补充路径上下文」，但调用方直接让异常冒泡）⇒ 紧随其后的
 * 带路径分支（`tables === undefined`）**永远走不到** ⇒ 带路径的错误分支是
 * 死代码，用户拿到的报错指向被分析的**源文件**。
 *
 * 修法：调用方补上侧车路径再重抛。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../emit/interface-emitter.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-043-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-043 —— 侧车解析失败必须点名侧车", () => {
  it("错误消息含侧车文件名（不是源文件名）", async () => {
    writeFileSync(join(dir, "lib.js"), `export function f(a) {\n  return a + 1;\n}\nf(1);\n`, "utf-8");
    // 语法的确崩：`const x = ;`
    writeFileSync(join(dir, "lib.nudo.js"), `export const x = ;\n`, "utf-8");

    await expect(emitInterface(join(dir, "lib.js"), { mode: "update", all: true })).rejects.toThrow(
      /lib\.nudo\.js.*not parseable/,
    );
  });
});
