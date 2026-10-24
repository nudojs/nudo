/**
 * Bug 479 —— `.ts` 源的**形参类型注解**从未进入推断：剥除 pass（core 的
 * `strip-types.ts`）在解析阶段就 `delete` 掉 `typeAnnotation` ⇒ 形参一律
 * `any` ⇒ 合法 TypeScript 拿到 **`nudo:entry-may-throw` 假红**，诊断还宣称
 * 「unconstrained value」。
 *
 * 修法（core 侧）：
 * - `strip-types.ts`：删注解前把**类型注解的源码文本**留在节点上
 *   （`nudoTypeText`）——存字符串而非 AST 节点，AST 遍历器看不见它 ⇒
 *   分析管线语义零变化；
 * - `param-surface.ts`：`FormalParam.tsType` 带出该文本；
 * - `generalize.ts`：入口形参按声明类型建 Abs（基本类型子集）⇒ 不再是
 *   「无约束 any」。
 *
 * 本文件钉住：
 * - 正控制：`.ts` 源的形参按声明类型推断（string），且**不再**报
 *   `nudo:entry-may-throw` 假红；
 * - 负控制：同形 `.js` 源**行为不变**（形参仍是 any，may-throw 仍在）；
 * - 原生 oracle 对拍（node 另起进程）：`upper("x")` 返回 "X"，不抛。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { pTrue } from "../pred.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

const TS_SOURCE = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_SOURCE = `export function upper(a) {
  return a.toUpperCase();
}
`;

describe("Bug 479：.ts 形参类型注解进入推断", () => {
  it("形参按声明类型推断（string），不再是 any", () => {
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    const sig = r.signatures.find((s) => s.name === "upper");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("string");
    expect(sig!.display).toContain("string");
  });

  it("合法 .ts 不再触发 nudo:entry-may-throw 假红", () => {
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    const throws = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(throws).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("负控制：同形 .js 源行为不变（形参仍是 any，may-throw 仍在）", () => {
    const r = checkSource("/t/upper.js", JS_SOURCE, pTrue);
    const sig = r.signatures.find((s) => s.name === "upper");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("any");
    const throws = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(throws.length).toBe(1);
  });

  it("原生 oracle：upper('x') 返回 'X' 且不抛（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug479-"));
    const mod = join(dir, "mod.mjs");
    writeFileSync(
      mod,
      `export function upper(a) {
  return a.toUpperCase();
}
`,
      "utf8",
    );
    const runner = join(dir, "run.mjs");
    writeFileSync(
      runner,
      `import { upper } from "./mod.mjs";
console.log(JSON.stringify({ value: upper("x") }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { value: string };
    expect(native.value).toBe("X");

    // 引擎侧：.ts 源的同一函数不得报 may-throw（原生不抛）
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  });
});
