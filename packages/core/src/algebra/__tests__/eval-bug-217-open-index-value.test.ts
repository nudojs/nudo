/**
 * Bug 217 回归（core 侧接线）：**开放对象**的成员读必须使用声明的索引值域
 * （`shape.index.value`），不得无条件退 unknown。
 *
 * 语境：`process.env` 是开放键对象（值域 `string | undefined`）、
 * `process.versions` 值域 `string`。env 侧（packages/env）已带索引值域声明；
 * core 侧读臂此前**无条件** `return unknown` ⇒ 同一对象两面自相矛盾
 * （展示面 `Record<string, string | undefined>` vs 读面 unknown）+ 触发**假**
 * `nudo:unknown-inference`。
 *
 * 接线：`exec/runtime/containers/member.ts` 的开放对象读臂调
 * `openIndexValueOf`（exec/runtime/members.ts）——符号键例外
 * （`process.env[Symbol.iterator]` 原生 undefined）。
 */
import { describe, it, expect } from "vitest";
import { abs, str, type Abs } from "@nudojs/core";
import { undef } from "../exec/runtime/state.ts";
import { objOf } from "../objects.ts";
import { $get } from "../exec/runtime/containers/member.ts";
import { formatAbs } from "../format.ts";

/** 开放对象：声明索引值域（key = string 键，value = 值域） */
function openObj(value: Abs): Abs {
  return objOf({}, { open: true, index: { key: str(), value } });
}

describe("Bug 217 — 开放对象读臂使用声明的索引值域", () => {
  it("有索引声明 → 成员读返回该值域（string | undefined）", () => {
    const domain = abs(
      { k: "sum", members: [str(), undef()] },
      undefined,
      undefined,
      "exact",
    );
    const got = $get(openObj(domain), "HOME");
    expect(formatAbs(got)).toContain("string");
    expect(formatAbs(got)).toContain("undefined");
  });

  it("有索引声明 → 值域是 string 时读到 string", () => {
    const got = $get(openObj(str()), "node");
    expect(formatAbs(got)).toContain("string");
  });

  it("无索引声明 → 诚实退 unknown（那才是真正的推断失败）", () => {
    const got = $get(objOf({}, { open: true }), "HOME");
    expect(formatAbs(got)).toContain("unknown");
  });

  it("符号键例外：符号键读不落到索引值域（原生 undefined）", () => {
    const got = $get(openObj(str()), "@@iterator", { symbolKey: true });
    expect(formatAbs(got)).toContain("unknown");
  });
});
