/**
 * BUG-001 回归（service 侧）：导出名命中 Object.prototype 成员。
 *
 * `fnName in run.exports` 走原型链：模块没有自有 toString/constructor/
 * hasOwnProperty 导出时，把 Object.prototype 成员当模块导出调用
 * （伪造结果 / 伪造 throws 面）。导出存在性必须按自有属性判定。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tryEvalCallFull, resetAllAnalysisCaches } from "@nudojs/service";
import { applyMockModuleDirectivesFromSource } from "../mock-module.ts";
import type { AbsModuleExports } from "@nudojs/core";
import { $lit, litValue } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

describe("tryEvalCallFull: Object.prototype names are not module exports", () => {
  const src = `export function real() { return 1; }\n`;

  it("toString / constructor / hasOwnProperty / valueOf → undefined", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      // 修复前：`name in run.exports` 命中原型 → 原型方法被当导出调用
      expect(tryEvalCallFull(src, "/test/proto-chain.js", name, []), name).toBeUndefined();
    }
  });

  it("real export still resolves", () => {
    const full = tryEvalCallFull(src, "/test/proto-chain.js", "real", []);
    expect(full).toBeDefined();
    expect(litValue(full!.result)).toEqual({ ok: true, value: 1 });
  });

  it("real export resolves with args", () => {
    const src2 = `export function id(x) { return x; }\n`;
    const full = tryEvalCallFull(src2, "/test/proto-chain-2.js", "id", [$lit(7)]);
    expect(full).toBeDefined();
    expect(litValue(full!.result)).toEqual({ ok: true, value: 7 });
  });
});

describe("mock-module partial overlay does not pick Object.prototype names", () => {
  it("{ toString } on a mock without such export → not overlaid", () => {
    const dir = tmpProject("nudo-proto-mock-");
    writeFileSync(join(dir, "mock.js"), `export function a() { return 1; }\n`, "utf-8");
    const src = `/// @nudo:mock-module "dep" { toString, a } from "./mock.js"\nexport function f() { return 1; }\n`;
    const base: Record<string, AbsModuleExports> = { dep: { named: {} } };
    const r = applyMockModuleDirectivesFromSource(src, base, {
      fromFile: join(dir, "app.js"),
    });
    // Bug 963：**点名**但 mock 没有导出的名字不再静默跳过 ⇒ 走错误出口
    // （nudo:module-missing / error）且该条指令**不生效**（fail-closed：
    // 原模块保持原样，绝不产生「一半 mock、一半原模块」的混合程序）。
    // ⇒ mock 的 `a` 也不会被叠进来（整条指令被拒）。
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('does not export "toString"');
    expect(r.applied).toBe(false);
    expect(r.modules.dep!.named.a).toBeUndefined();
    // 修复前：mock.named["toString"] 命中原型 → Object.prototype.toString 被叠成 mock 导出
    expect(Object.hasOwn(r.modules.dep!.named, "toString")).toBe(false);
  });
});
