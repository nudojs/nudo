import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkNode, staticSlotOf } from "./env-bug-1044-1049-helpers.ts";
import { envMember } from "./env-bug-s3-helpers.ts";

/**
 * 族 15 · BUG-193 — node env 把**宿主上不存在**的 4 个成员声明成 `Buffer`
 * 类的**静态**成员（`compareBuffers` / `isUtf8` / `transcode` / `constants`）。
 *
 * 宿主真值：`typeof Buffer.isUtf8 === "undefined"`（它们是 `node:buffer` 的
 * **模块级导出**）⇒ 引擎判「不抛 + 自信的值」，宿主**必抛 TypeError**
 * ⇒ 假绿 + 错值（`Buffer.constants.MAX_LENGTH` 折成 `number`）。
 *
 * 修法：从 `Buffer` 静态表移除，按宿主放回 `node:buffer` 的模块面。
 *
 * 反向钉：把 `isUtf8` 加回 Buffer 静态表 ⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 193 — Buffer has no isUtf8/transcode/constants statics", () => {
  it("host oracle: the four names are not Buffer statics (they are module exports)", () => {
    const out = host(`
      const b = require("node:buffer");
      console.log(JSON.stringify({
        bufferStatics: ["compareBuffers", "isUtf8", "transcode", "constants"].map((k) => typeof Buffer[k]),
        moduleExports: ["isUtf8", "transcode", "constants"].map((k) => typeof b[k]),
      }));
    `);
    expect(JSON.parse(out)).toEqual({
      bufferStatics: ["undefined", "undefined", "undefined", "undefined"],
      moduleExports: ["function", "function", "object"],
    });
  });

  it("the env Buffer static table no longer declares them", () => {
    for (const name of ["compareBuffers", "isUtf8", "transcode", "constants"]) {
      expect(staticSlotOf("Buffer", name), `Buffer.${name} must not be declared`).toBeUndefined();
    }
    // 真实静态仍在（负控：不是把整张表删空）
    expect(staticSlotOf("Buffer", "compare")).toBeTruthy();
    expect(staticSlotOf("Buffer", "isBuffer")).toBeTruthy();
  });

  it("calling Buffer.isUtf8(...) is no longer a confident value (was green)", () => {
    const out = checkNode(`export function f1(){ return Buffer.isUtf8(Buffer.from("x")); }`);
    // 修复前：`boolean`（引擎说「不抛 + 有值」），宿主必抛 TypeError。
    // 修复后：该名字**不再声明** ⇒ 读面诚实落 unknown（不再给自信错值）。
    expect(out.signatures[0]!.display).toBe("unknown");
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("Buffer.constants.MAX_LENGTH is no longer a confident number", () => {
    const out = checkNode(`export function f3(){ return Buffer.constants.MAX_LENGTH; }`);
    expect(out.signatures[0]!.display).toBe("unknown");
  });

  it("the module face node:buffer declares them at module scope", () => {
    for (const name of ["isUtf8", "transcode", "constants"]) {
      expect(envMember("node:buffer", name), `node:buffer.${name}`).toBeTruthy();
    }
    const out = checkNode(`export function f4(){ return Buffer.compare(Buffer.from("a"), Buffer.from("b")); }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toBe("number");
  });
});
