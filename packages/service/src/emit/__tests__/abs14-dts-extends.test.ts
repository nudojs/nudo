/**
 * ABS-14 PR4b：契约简单界 → TS 类型形参 `extends`。
 *
 * 口径（计划 §5 实现拆分 4b + ABS-03「不可表达时诚实省略」）：
 * - 可表达：`typeof` 基元标签、`eq(var, lit)` 字面量、`or` 全可表达时联合；
 * - 不可表达：数值界 / 长度 / 否定 / `typeof object|function` ⇒ 跳过，
 *   且**输出与无界基线逐字节一致**（不得悄悄收紧已发布签名）；
 * - 投影单向，不改 Abs 分析结果；生成的声明必须能过 `tsc --noEmit`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { abs as makeAbs, v, type Abs, type Pred } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts, type DtsContractFace } from "../dts-generator.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 本仓 devDependency 的 tsc 入口（不经 `pnpm exec`：那会触发 install/锁文件检查）。 */
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function tscNoEmit(dts: string): { ok: boolean; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-abs14-extends-"));
  dirs.push(dir);
  const p = join(dir, "mod.d.ts");
  writeFileSync(p, dts.endsWith("\n") ? dts : dts + "\n", "utf-8");
  try {
    execFileSync(
      process.execPath,
      [tscBin, "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

const anyVar = (id: string): Abs => makeAbs({ k: "any" }, v(id), undefined, "path");
const varTerm = (id: string) => ({ op: "var" as const, id });

/** processItems 契约面；`items` 位的顶层 pred 引用 `bind:a` 变元。 */
function boundedContract(pred: Pred | undefined): DtsContractFace {
  const a = anyVar("bind:a");
  const b = anyVar("bind:b");
  const items = makeAbs({ k: "arr", element: a }, v("items"), pred, "path");
  const transform = makeAbs(
    { k: "fn", params: ["x"], paramTypes: [a], returnType: b },
    v("transform"),
    undefined,
    "path",
  );
  const returns = makeAbs({ k: "arr", element: b }, v("return"), undefined, "path");
  return {
    params: [
      { name: "items", abs: items, display: 'array(bind("a", any()))' },
      { name: "transform", abs: transform, display: 'fn({ x: ref("a") }, bind("b", any()))' },
    ],
    return: returns,
    returnDisplay: 'array(ref("b"))',
  };
}

const source = `export function processItems(items, transform) { return items.map(transform); }`;

function declOf(pred: Pred | undefined): string {
  const result = analyzeFile("/test/abs14-extends.js", source);
  const fn = result.functions.find((f) => f.name === "processItems");
  if (!fn) throw new Error("function not found");
  return projectFunctionDts(fn, boundedContract(pred)).lines.join("\n");
}

describe("ABS-14 PR4b 契约界投 extends", () => {
  const baseline = declOf(undefined);

  it("无界契约的输出与旧口径逐字节一致（不含 extends）", () => {
    expect(baseline).toContain("<a, b>");
    expect(baseline).not.toContain("extends");
  });

  it("typeof(number) 界投 `a extends number`，其它变元不受影响", () => {
    const decl = declOf({ op: "typeof", t: varTerm("bind:a"), type: "number" });
    expect(decl).toContain("a extends number");
    expect(decl).toContain("<a extends number, b>");
    const check = tscNoEmit(decl);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("and 里不可表达的 gt 叶被跳过，可表达叶仍投", () => {
    const decl = declOf({
      op: "and",
      args: [
        { op: "typeof", t: varTerm("bind:a"), type: "string" },
        { op: "gt", a: varTerm("bind:a"), b: { op: "lit", value: 0 } },
      ],
    });
    expect(decl).toContain("a extends string");
    expect(decl).not.toContain("a extends number");
  });

  it("or 全为字面量界时投联合 `a extends 1 | 2`", () => {
    const decl = declOf({
      op: "or",
      args: [
        { op: "eq", a: varTerm("bind:a"), b: { op: "lit", value: 1 } },
        { op: "eq", a: varTerm("bind:a"), b: { op: "lit", value: 2 } },
      ],
    });
    expect(decl).toContain("a extends 1 | 2");
  });

  it("or 含不可表达臂时整条省略（不投半边收窄）", () => {
    const decl = declOf({
      op: "or",
      args: [
        { op: "eq", a: varTerm("bind:a"), b: { op: "lit", value: 1 } },
        { op: "gt", a: varTerm("bind:a"), b: { op: "lit", value: 0 } },
      ],
    });
    expect(decl).toBe(baseline);
  });

  it("数值界 / typeof object / typeof function 不可表达 ⇒ 输出与无界基线一致", () => {
    const untranslatable: Pred[] = [
      { op: "ge", a: varTerm("bind:a"), b: { op: "lit", value: 0 } },
      { op: "typeof", t: varTerm("bind:a"), type: "object" },
      { op: "typeof", t: varTerm("bind:a"), type: "function" },
      { op: "not", arg: { op: "eq", a: varTerm("bind:a"), b: { op: "lit", value: 1 } } },
    ];
    for (const pred of untranslatable) {
      expect(declOf(pred), JSON.stringify(pred)).toBe(baseline);
    }
  });

  it("界挂在未被发射的变元上时不产生悬空 extends", () => {
    const decl = declOf({ op: "typeof", t: varTerm("bind:ghost"), type: "number" });
    expect(decl).not.toContain("extends");
    expect(decl).toBe(baseline);
  });
});
