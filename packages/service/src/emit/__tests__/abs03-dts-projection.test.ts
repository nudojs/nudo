/**
 * ABS-03：dts / schema 投影补全。
 *
 * 覆盖：
 * - 契约面类型形参的**可达性**（不发射未被签名引用的变元）与**统一性**
 *   （元素域 / 回调入参共享同一变元）——entry-only HOF 夹具；
 * - 契约可读注记（JSDoc `Contract:` 行）只做注记、不改类型面；
 * - 重载集 → TS 调用签名对象（声明序 = TS 解析序）；
 * - schema 数值界（gt/ge/lt/le）生成检查（可表达时），不可表达时诚实省略。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { abs as makeAbs, lit, v, type Abs } from "@nudojs/core";
import { absToTSType, projectFunctionDts, type DtsContractFace } from "../dts-generator.ts";
import { absToSchemaSource } from "../schema-generator.ts";

function fnOf(source: string, name: string) {
  const result = analyzeFile("/test/abs03.js", source);
  const fn = result.functions.find((f) => f.name === name);
  if (!fn) throw new Error(`function ${name} not found`);
  return fn;
}

function binderVar(id: string): Abs {
  return makeAbs({ k: "any" }, v(id), undefined, "path");
}

/** processItems 的契约面（与 ABS-01 目标数据形态同构） */
function processItemsContract(): DtsContractFace {
  const elemA = binderVar("bind:a");
  const items = makeAbs({ k: "arr", element: elemA }, v("items"), undefined, "path");
  const transform = makeAbs(
    {
      k: "fn",
      params: ["x"],
      paramTypes: [binderVar("bind:a")],
      returnType: binderVar("bind:b"),
    },
    v("transform"),
    undefined,
    "path",
  );
  const returns = makeAbs({ k: "arr", element: binderVar("bind:b") }, v("return"), undefined, "path");
  return {
    params: [
      { name: "items", abs: items, display: 'array(bind("a", any()))' },
      { name: "transform", abs: transform, display: 'fn({ x: ref("a") }, bind("b", any()))' },
    ],
    return: returns,
    returnDisplay: 'array(ref("b"))',
  };
}

describe("ABS-03 契约面类型形参（可达性 + 统一性）", () => {
  const fn = fnOf(
    `export function processItems(items, transform) { return items.map(transform); }`,
    "processItems",
  );

  it("元素域 / 回调入参共享同一变元；返回位复用回调返回变元（<a, b>）", () => {
    const proj = projectFunctionDts(fn, processItemsContract());
    const decl = proj.lines.join("\n");
    expect(decl).toContain("<a, b>");
    expect(decl).toContain("items: a[]");
    expect(decl).toContain("(x: a) => b");
    expect(decl).toContain(": b[]");
  });

  it("未被签名引用的变元不发射（ghost 位不产生悬空类型参数）", () => {
    const contract = processItemsContract();
    contract.params.push({
      name: "ghost",
      abs: binderVar("bind:ghost"),
    });
    const proj = projectFunctionDts(fn, contract);
    const decl = proj.lines.join("\n");
    expect(decl).not.toContain("ghost");
  });

  it("契约可读注记：Contract: 行存在，且不参与类型面", () => {
    const proj = projectFunctionDts(fn, processItemsContract());
    const decl = proj.lines.join("\n");
    expect(decl).toContain('Contract: items: array(bind("a", any()))');
    expect(decl).toContain('Contract: return: array(ref("b"))');
    // 注记不改变声明行的类型面
    expect(decl).toContain("(items: a[], transform: (x: a) => b): b[]");
  });
});

describe("ABS-03 重载集 → TS 调用签名对象", () => {
  it("逐 arm 发射（声明序）且保留形参↔返回相关性", () => {
    const prim = (type: "string" | "number"): Abs =>
      makeAbs({ k: "prim", type }, undefined, undefined, "exact");
    const overloaded: Abs = makeAbs(
      {
        k: "fn",
        params: ["a0"],
        paramTypes: [makeAbs({ k: "unknown" }, undefined, undefined, "partial")],
        returnType: makeAbs({ k: "unknown" }, undefined, undefined, "partial"),
        overloads: [
          { paramTypes: [prim("string")], returnType: prim("number") },
          { paramTypes: [prim("number")], returnType: prim("string") },
        ],
      },
      undefined,
      undefined,
      "exact",
    );
    const ts = absToTSType(overloaded);
    expect(ts).toBe("{ (a0: string): number; (a0: number): string }");
  });
});

describe("ABS-03 schema 数值界投影", () => {
  it("可表达的 gt/ge 下界与 le/lt 上界生成检查", () => {
    const entry = makeAbs(
      { k: "prim", type: "number" },
      v("x"),
      {
        op: "and",
        args: [
          { op: "ge", a: v("x"), b: lit(0) },
          { op: "lt", a: v("x"), b: lit(10) },
        ],
      },
      "path",
    );
    const src = absToSchemaSource(entry);
    expect(src).toContain(".gte(0)");
    expect(src).toContain(".lt(10)");
  });

  it("不可表达的关系（x > y）诚实省略界（不回退成假精确）", () => {
    const entry = makeAbs(
      { k: "prim", type: "number" },
      v("x"),
      { op: "gt", a: v("x"), b: v("y") },
      "path",
    );
    const src = absToSchemaSource(entry);
    expect(src).not.toContain(".gt(");
    expect(src).toContain("number");
  });
});
