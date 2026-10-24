/**
 * Bug 438 —— 跨文件调用时，**被调方**的 `@nudo:import` 侧车说明符按**调用方目录**
 * 解析 ⇒ 侧车明明在**被调方旁边**却报「failed to load」⇒ **error 级**
 * `nudo:interface-load` + `nudo:contract-syntax` 假红。
 *
 * 现状：**假阳性** —— 症状已被修掉：`scan-literal-calls.ts` 的 `checkArgStructures`
 * 把**被调方的定义路径**（`ext.fromFile`，经第 6 参 `interfaceFromFile` 传进来）
 * 用作 `refine.fromFile`（`refineFromFile = !sameFile && interfaceFromFile
 * ? interfaceFromFile : (opts?.fromFile ?? "")`）⇒ 侧车按**被调方目录**解析。
 * 本钉把这条行为钉死（**不改实现**）。
 *
 * 判据（**不是**「有没有报错」，而是「报什么」）：
 *   - 正例：侧车在被调方旁边 ⇒ 只有**真违例**（`nudo:constraint-violated`），
 *     **零** `nudo:interface-load` / **零** `nudo:contract-syntax`；
 *   - 负控制：侧车**只**在调用方目录 ⇒ 按被调方目录解析必然找不到 ⇒ 报
 *     `nudo:interface-load`（证明 loader 的 base 目录确实决定解析结果，
 *     正例不是因为「压根没查侧车」而绿）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { makeFiles } from "./nudo-constraints.ts";

const STD = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

/** 被调方：侧车说明符按**被调方自己的目录**解析 */
const LIB = `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x;
}
`;

/** 调用方（被调方在子目录） */
const CALLER_SUB = `import { f } from "./sub/lib.js";
f(-1);
`;

/** 调用方（被调方同目录） */
const CALLER_SAME = `import { f } from "./lib.js";
f(-1);
`;

const ENTRY = "/t/e-call.js";

function check(caller: string, files: Record<string, string>) {
  const { loadModule } = makeFiles(files);
  return checkSource(ENTRY, caller, pTrue, { loadModule, fromFile: ENTRY });
}

function codes(r: { issues: { code: string }[] }): string[] {
  return r.issues.map((i) => i.code);
}

describe("Bug 438 —— 跨文件调用：侧车按**被调方目录**解析", () => {
  it("正例：侧车在被调方旁边 ⇒ 只有真违例，无 interface-load / contract-syntax", () => {
    const r = check(CALLER_SUB, {
      "/t/sub/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:constraint-violated")).toHaveLength(1);
    expect(codes(r).filter((c) => c === "nudo:interface-load")).toHaveLength(0);
    expect(codes(r).filter((c) => c === "nudo:contract-syntax")).toHaveLength(0);
  });

  it("正例：违例诊断指向被调方的契约（expected: x > 0），不是「装载失败」", () => {
    const r = check(CALLER_SUB, {
      "/t/sub/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x > 0");
    expect(issue?.actual).toContain("-1");
  });

  it("负控制：侧车只在调用方目录 ⇒ 按被调方目录解析找不到 ⇒ 报 interface-load", () => {
    const r = check(CALLER_SUB, {
      "/t/std.nudo.js": STD,
      "/t/sub/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:interface-load")).toHaveLength(1);
    const issue = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(issue?.message).toContain("/t/sub/lib.js");
  });

  it("对照：被调方与调用方同目录 ⇒ 侧车同目录 ⇒ 正常解析（零 interface-load）", () => {
    const r = check(CALLER_SAME, {
      "/t/std.nudo.js": STD,
      "/t/lib.js": LIB,
    });
    expect(codes(r).filter((c) => c === "nudo:constraint-violated")).toHaveLength(1);
    expect(codes(r).filter((c) => c === "nudo:interface-load")).toHaveLength(0);
    expect(codes(r).filter((c) => c === "nudo:contract-syntax")).toHaveLength(0);
  });
});
