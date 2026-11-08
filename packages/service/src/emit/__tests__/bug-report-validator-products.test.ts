/**
 * 缺陷报告分册 `tmp/bugs/07-validator-products.md` 回归钉。
 *
 * 覆盖 **运行时校验器产物面** 的 7 条在 `service/src/emit` 可修缺陷：
 *   Bug 21（zod `<fn>Input` 丢嵌套数组长度界）
 *   Bug 41（命名捕获组让 arrayView 在契约投影路径丢失）
 *   Bug 53（guard 丢算术推导数值界）
 *   Bug 69（standard 零参函数缺 `<fn>Input`）
 *   Bug 97（guard 对 RegExpExecArray 形状产出 strict 编不过的 TS）
 *   Bug 98（zod 把 promise 面投影成 `z.promise`，safeParse 抛 $ZodAsyncError）
 *   Bug 104（guard 克隆 Abs 丢按身份键控的 accessor 侧表）
 *
 * 口径：与 `emit-bug-094` / `service-bug-258-array-view-products` /
 * `emit-bug-512-guard-strict-compile` 等既有钉一致——直接投影 Abs 到
 * SchemaNode / guard / standard 产物，并用 `fixtures.ts` 的
 * `loadGeneratedModule` 真执行产物里的校验器（不只比对字符串）。
 *
 * Bug 39 / 103 的根因在 `analyzer-orchestrate-uncached-cases.ts`（入口兜底
 * 求值），不在 `emit` 侧，本分片不可修 ⇒ 不在此钉，交由主代理整合。
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  $objAccessor,
  abs,
  app,
  num,
  numLit,
  obj,
  type Pred,
} from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import {
  absToSchemaNode,
  schemaNodeToZod,
  type SchemaNode,
} from "../schema-generator.ts";
import {
  absToStandardSchema,
  absToStandardSchemaFunction,
  validateSchemaNode,
} from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { loadGeneratedModule, undefLit } from "./fixtures.ts";

/** `length(__nudo_self__) op n` —— 契约面数组长度界的口径（BUG-094）。 */
const lenPred = (n: number, op: "ge" | "le" | "gt" | "lt"): Pred =>
  ({
    op,
    a: app("length", [{ op: "var", id: "__nudo_self__" }]),
    b: { op: "lit", value: n },
  }) as Pred;

/** 真跑 `tsc --noEmit --strict`（与 emit-bug-512 同口径）。 */
function tscStrictOk(source: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b97-guard-"));
  const file = join(dir, "guard.ts");
  try {
    writeFileSync(file, source.endsWith("\n") ? source : source + "\n", "utf-8");
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", file],
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 21 — zod `<fn>Input` 不得丢掉嵌套数组的长度界", () => {
  // zod 面把入参恒包成 obj ⇒ 数组必为**嵌套**；standard 面逐形参投影 ⇒ 顶层即数组。
  const arrAbs = abs({ k: "arr", element: num() }, undefined, lenPred(2, "ge"), "exact");
  const inputAbs = obj({ xs: { value: arrAbs } });

  it("契约投影树上嵌套 arr 节点带 minLen（改前静默丢且零台账）", () => {
    const { node } = absToSchemaNode(inputAbs);
    expect(node).toMatchObject({
      k: "obj",
      slots: [{ key: "xs", node: { k: "arr", minLen: 2 } }],
    });
  });

  it("zod 源码在同一对象投影里补 `.min(2)`（与 fOutput 同界）", () => {
    const zod = schemaNodeToZod(absToSchemaNode(inputAbs).node);
    expect(zod).toContain("z.object(");
    expect(zod).toContain(".min(2)");
  });

  it("standard 校验器按界拒绝 {xs:[1]}、放行 {xs:[1,2]}", () => {
    const { node } = absToSchemaNode(inputAbs);
    expect(validateSchemaNode(node, { xs: [1] }).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, { xs: [1, 2] }).issues).toBeUndefined();
  });

  it("负控制：顶层数组（返回面）仍保留 minLen", () => {
    expect(absToSchemaNode(arrAbs).node).toMatchObject({ k: "arr", minLen: 2 });
  });
});

describe("Bug 41 — 命名捕获组不得让 arrayView 在契约投影路径丢失", () => {
  // `/a(?<g>b)c/` 的 groups 槽可投影 ⇒ projectObj 成功 ⇒ 走**契约投影早退**分支
  // （无命名组的 `/a(b)c/` 走形状兜底，本来就带 arrayView）。
  const SRC = `export function m() { return /a(?<g>b)c/.exec("abc"); }\n`;
  const a = analyzeFile("/test/b41-named-group.ts", SRC).functions.find(
    (x) => x.name === "m",
  )!.combinedAbs!;

  it("形状前提：Abs 是 obj + view: array，且 groups 槽可投影", () => {
    expect(a.shape.k).toBe("obj");
    expect(a.shape.k === "obj" ? a.shape.view : undefined).toBe("array");
  });

  it("契约投影分支补回 arrayView（与形状兜底同口径）", () => {
    const { node } = absToSchemaNode(a);
    const hasView =
      node.k === "obj"
        ? node.arrayView === true
        : node.k === "union"
          ? node.members.some((m) => m.k === "obj" && m.arrayView === true)
          : false;
    expect(hasView).toBe(true);
  });

  it("standard 产物带 arrayView 并接受函数自己的返回值", async () => {
    const { source } = absToStandardSchema(a, { name: "m_out" });
    expect(source).toContain('"arrayView":true');
    const mod = await loadGeneratedModule(source);
    const arr = /a(?<g>b)c/.exec("abc")!;
    expect(mod.m_out!["~standard"].validate(arr).issues).toBeUndefined();
  });

  it("zod 面出 z.tuple（不再是拒绝真实数组的 z.object）", () => {
    expect(schemaNodeToZod(absToSchemaNode(a).node)).toContain("z.tuple(");
  });
});

describe("Bug 53 — guard 不得丢掉算术推导出的数值界", () => {
  // `plus(x) { return x + 1 }` 且 `x positive` ⇒ term=(x+1)、pred=(x+1)>1−ε。
  const term = app("+", [{ op: "var", id: "x" }, { op: "lit", value: 1 }]);
  const pred: Pred = { op: "gt", a: term, b: { op: "lit", value: 0.9999999999999999 } };
  const a = abs({ k: "prim", type: "number" }, term, pred, "path");

  it("guard 体保留 `data > 0.9999…`（改前只剩 typeof）", () => {
    const g = generateGuardFunctionFromAbs("isPlus", a);
    expect(g).toContain('typeof data === "number"');
    expect(g).toContain("data > 0.9999999999999999");
  });

  it("与 standard / zod 面同源同界（三面对 0 一致拒绝）", () => {
    const node = absToSchemaNode(a).node;
    expect(validateSchemaNode(node, 0).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, 1).issues).toBeUndefined();
    expect(schemaNodeToZod(node)).toContain(".gt(0.9999999999999999)");
  });
});

describe("Bug 69 — standard 面零参函数也必须有 `<fn>Input`", () => {
  const zeroArg = () =>
    absToStandardSchemaFunction({ fn: "f", inputs: [], returns: numLit(1) }).source;

  it("零参函数发射 fInput（与 zod 面 `z.object({  })` 对齐）", () => {
    expect(zeroArg()).toContain("export const fInput");
  });

  it("零槽 fInput 校验器接受任意对象", async () => {
    const mod = await loadGeneratedModule(zeroArg());
    expect(mod.fInput!["~standard"].validate({ anything: 1 }).issues).toBeUndefined();
  });

  it("负控制：调用方未给入参面（inputs undefined）时不发射", () => {
    const source = absToStandardSchemaFunction({ fn: "f", returns: numLit(1) }).source;
    expect(source).not.toContain("export const fInput");
  });
});

describe("Bug 97 — guard 对 RegExpExecArray 产物必须过 strict tsc", () => {
  const SRC = `export function re(s) { return /a(b)?/.exec(s); }\n`;
  const a = analyzeFile("/test/b97-re.ts", SRC).functions.find(
    (x) => x.name === "re",
  )!.combinedAbs!;
  const guard = () => generateGuardFunctionFromAbs("isRe", a);

  it("data 降级成 any 且 Array.isArray 收窄被中性化", () => {
    const g = guard();
    expect(g).toContain("const data: any = ");
    expect(g).toContain("Array.isArray(data as unknown)");
  });

  it("产物自身 `tsc --noEmit --strict` exit 0（改前 TS2551 / TS2339）", () => {
    expect(tscStrictOk(guard())).toBe(true);
  }, 120_000);

  it("运行时语义不变：接受函数自己的 exec 结果", async () => {
    const mod = (await loadGeneratedModule(guard())) as unknown as Record<
      string,
      (v: unknown) => boolean
    >;
    expect(mod.isRe!(/a(b)?/.exec("abc"))).toBe(true);
  });
});

describe("Bug 98 — zod 的 promise 面必须同步可消费（safeParse 不抛）", () => {
  const promiseNode: SchemaNode = {
    k: "promise",
    inner: { k: "prim", type: "number", refinements: [] },
  };

  it("不再用异步构造器 `z.promise(...)`，改投影成 instanceof 检查", () => {
    const src = schemaNodeToZod(promiseNode);
    expect(src).toContain("z.custom((v) => v instanceof Promise)");
    expect(src.startsWith("z.promise(")).toBe(false);
  });

  it("产物如实标注原本的 `z.promise(...)` 仅异步语义", () => {
    const src = schemaNodeToZod(promiseNode);
    expect(src).toContain("z.promise(");
    expect(src).toContain("$ZodAsyncError");
  });
});

describe("Bug 104 — guard 克隆 Abs 不得丢掉按身份键控的 accessor 侧表", () => {
  it("getter 槽写成读域 `data.g === 3`（改前是 `data.g === undefined`）", () => {
    // 访问器不住 shape 槽里：transpile 落 `$lit(void 0)` 占位，真 getter 住
    // 按 Abs 对象身份键控的 WeakMap（core/accessors.ts）。
    const o = obj({ g: { value: undefLit() }, v: { value: numLit(4) } });
    $objAccessor(o, "g", () => numLit(3), null);
    const g = generateGuardFunctionFromAbs("isObj", o);
    expect(g).toContain("data.g === 3");
    expect(g).not.toContain("data.g === undefined");
  });

  it("运行时接受函数自己的返回值（guard 不再假红）", async () => {
    const o = obj({ g: { value: undefLit() }, v: { value: numLit(4) } });
    $objAccessor(o, "g", () => numLit(3), null);
    const mod = (await loadGeneratedModule(generateGuardFunctionFromAbs("isObj", o))) as unknown as Record<
      string,
      (v: unknown) => boolean
    >;
    const value = { get g() { return 3; }, v: 4 };
    expect(mod.isObj!(value)).toBe(true);
  });
});
