/**
 * Bug 239：core 对 **union 接收者**读 `.length` 时丢弃各成员的长度、恒返回
 * `number` ⇒ L1 契约门禁**假绿**（`number()` 契约被判定成立，零诊断）。
 *
 * 原生语义：`"ab" | 7` 的 `.length` 是 `2 | undefined`（数字分支没有 length
 * 属性 → 读出 undefined）⇒ `@nudo:contract return number()` 违约。
 */
import { describe, it, expect } from "vitest";
import { anyAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { errorsOf, issuesOf, sigOf } from "./nudo-constraints.ts";

/** 结果里是否含「undefined 臂」（lit undefined term 的 sum 成员） */
function hasUndefArm(r: unknown): boolean {
  const a = r as { shape?: { k?: string; members?: unknown[] } };
  if (a?.shape?.k !== "sum") return false;
  return (a.shape.members ?? []).some((m) => {
    const x = m as { term?: { op?: string; value?: unknown } };
    return x?.term?.op === "lit" && x.term.value === undefined;
  });
}

const UNION_SRC = `
export function pickStrNum(x) { if (x) { return "ab"; } return 7; }
/** @nudo:contract return num */
export function lenOf(y) { return pickStrNum(y).length; }
`;

describe("Bug 239 — union 接收者的 .length 保留各成员长度", () => {
  it("union 接收者读 .length 带 undefined 臂（改前恒 number）", () => {
    const r = call(
      `export function f(y) { function p(x){ if (x) { return "ab"; } return 7; } return p(y).length; }`,
      "f",
      [anyAbs],
    ).result;
    expect(hasUndefArm(r)).toBe(true);
  });

  it("L1 契约门禁不再假绿：number() 契约被判违约（改前零诊断）", () => {
    const errs = errorsOf(
      `/// @nudo:import { num } from "./std.nudo.js"\n${UNION_SRC}`,
      "/t/bug239.js",
    );
    expect(errs.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("L1 门禁面：签名显示 undefined 臂", () => {
    const r = issuesOf(
      `/// @nudo:import { num } from "./std.nudo.js"\n${UNION_SRC}`,
      "/t/bug239.js",
    );
    expect(sigOf(r, "lenOf")).toContain("undefined");
  });

  it("负控制：全成员都有 length 的 union 不带 undefined 臂（不制造假红）", () => {
    const r = call(
      `export function f(y) { function p(x){ if (x) { return "ab"; } return "cde"; } return p(y).length; }`,
      "f",
      [anyAbs],
    ).result;
    expect(hasUndefArm(r)).toBe(false);
  });

  it("负控制：单成员（无 union）读 .length 仍是诚实的 unknown", () => {
    const r = call(`export function f() { return (7).length; }`, "f").result;
    expect((r as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });

  it("负控制：字符串 .length 仍是精确值", () => {
    const r = call(`export function f() { return "ab".length; }`, "f").result;
    expect((r as { term?: { op?: string; value?: unknown } }).term?.op).toBe("lit");
  });
});
