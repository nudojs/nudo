/**
 * Bug 509 —— `nudo contract --draft` 写的**返回义务**只来自**观测到的调用点**
 * ⇒ 接受草稿就是**假红**（函数被自己产生的草稿判违规）。
 *
 * 症状（旧口径）：
 * ```js
 * export function opt(flag) { if (flag) return 1; return null; }
 * opt(true);                     // ← 只观测到 true 这一支
 * ```
 * 草稿写 `fn({ flag: boolean() }, number())`；照抄进 `lib.nudo.js` 后
 * `nudo check` 报 `return value ⊭ @nudo:contract return number()`
 * （actual `1 | null`），而同一次运行的签名面打印的是 `=> 1 | null`
 * —— 草稿与自己的签名自相矛盾。
 *
 * 根因：返回义务从**观测到的返回值**推出，而观测集只是真实返回域的**子集**；
 * 函数自身的推断返回域（generalizeFromAst 的 symbolic，与签名面同源）就在
 * 手边却只用于展示文案。
 *
 * 修法：返回义务投影前先与**推断返回域**对拍——义务的类型盖不住推断域
 * （观测集是真子集）时**不投影**这条义务（宁可少写，不可写假红）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftInterface } from "../interface-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-509-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 509 —— 草稿返回义务的来源", () => {
  it("观测集是真实返回域的真子集 ⇒ 不投影返回义务（改前：number() ⇒ 假红）", async () => {
    const file = join(dir, "opt.js");
    writeFileSync(
      file,
      `export function opt(flag) {\n  if (flag) return 1;\n  return null;\n}\nopt(true);\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "opt");
    expect(entry).toBeDefined();
    // 返回位：null 分支从未被观测到 ⇒ 观测集是真子集 ⇒ 不写这条义务
    expect(entry!.returns?.projected).toBe(false);
    expect(entry!.returns?.display).toContain("is not covered");
    expect(entry!.dsl).toBe("fn({ flag: boolean() })");
    expect(r.draftSource).not.toContain("number())");
  });

  it("负控制：观测域覆盖推断域 ⇒ 返回义务照旧投影（不误伤）", async () => {
    const file = join(dir, "double.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry!.returns?.projected).toBe(true);
    expect(entry!.dsl).toBe("fn({ x: number() }, number())");
  });

  it("负控制：无观测 ⇒ 不发明返回义务（symbolic 只作注释）", async () => {
    const file = join(dir, "lonely.js");
    writeFileSync(file, `export function lonely(y) {\n  return y;\n}\n`);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "lonely");
    expect(entry!.returns?.projected).toBe(false);
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("symbolic");
  });
});
