/**
 * env 全局的槽位写不毒化整场求值（issue #148）。
 *
 * 背景：env 全局（process / console…）此前注入为模块级 const 绑定。
 * `process.exitCode = 1` 的成员写经 memberPath 写回链编译成
 * `process = $set(process, "exitCode", 1)`——对 const 赋值抛原生
 * TypeError → 整个函数求值中止：返回值折 unknown（nudo:unknown-inference）
 * + entry-may-throw。CLI 失败即退出（process.exitCode = 1）是标准形态，
 * npm-safe 的 printPublishResult / printAudit 全部中招。
 *
 * 修复：注入改 let（env 全局在原生是 globalThis 的可写属性）。断言：
 * 写不毒化返回路径、不产生 unknown-inference / entry-may-throw；同场后读
 * 看到写入值（$set 就地写槽的引用语义与原生单次执行一致）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, objOf, abs, undefAbs, type Abs } from "@nudojs/core";
import { sigOf } from "./nudo-constraints.ts";

const strPrim: Abs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numOrUndef: Abs = abs(
  { k: "sum", members: [abs({ k: "prim", type: "number" }, undefined, undefined, "path"), undefAbs()] },
  undefined,
  undefined,
  "exact",
);
/** process.env 形：开放键 string→string brand（Record<string, string>） */
const openEnvRecord: Abs = abs(
  {
    k: "brand",
    name: "Record<string, string>",
    shape: abs(
      { k: "obj", slots: {}, open: true, index: { key: strPrim, value: strPrim } },
      undefined,
      undefined,
      "exact",
    ),
  },
  undefined,
  undefined,
  "path",
);

const processGlobal = objOf({
  exitCode: { value: numOrUndef },
  env: { value: openEnvRecord },
});

const SRC = `
export function setExitA() {
  process.exitCode = 1;
  return "ok";
}
export function plainA() {
  return "ok";
}
export function readAfterWrite() {
  process.exitCode = 1;
  return process.exitCode;
}
export function writeEnvKey() {
  process.env.FOO = "1";
  return "ok";
}
`;

const report = checkSource("/t/env-global-write-148.js", SRC, pTrue, {
  inject: { envGlobals: { process: processGlobal } },
});

describe("env 全局槽位写（issue #148）", () => {
  it("process.exitCode = 1 不毒化返回路径", () => {
    expect(sigOf(report, "setExitA")).toContain(`"ok"`);
    expect(sigOf(report, "setExitA")).not.toContain("unknown");
  });

  it("不产生 entry-may-throw / unknown-inference", () => {
    const codes = report.issues.filter((i) => i.fn === "setExitA" || i.fn === "writeEnvKey").map((i) => i.code);
    expect(codes).toEqual([]);
  });

  it("同场后读看到写入值（引用语义）", () => {
    expect(sigOf(report, "readAfterWrite")).toContain("1");
    expect(sigOf(report, "readAfterWrite")).not.toContain("unknown");
  });

  it("开放记录 brand 的键写（process.env.FOO = …）同样干净", () => {
    expect(sigOf(report, "writeEnvKey")).toContain(`"ok"`);
    expect(sigOf(report, "writeEnvKey")).not.toContain("unknown");
  });
});
