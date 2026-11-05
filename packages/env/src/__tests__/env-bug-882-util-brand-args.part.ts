/**
 * Bug 882（族 29 · S6）—— **core 侧根因**回归钉。
 *
 * 现象：`node:util` 的**品牌形参**函数（`promisify` / `callbackify` /
 * `inherits` / `isDeepStrictEqual`）在**具名导入**调用面
 * （`import { promisify } from "node:util"` ⇒ `promisify(readFile)`）
 * ⇒ **L2 门禁假红**（native 必不抛，引擎却记 `may throw TypeError`），
 * 而**成员调用**面（`util.promisify(readFile)`）完全正常
 * ⇒ 同一函数**两种口径**。
 *
 * 根因（core 侧）：Bug 85 的**实参归一化**只补在 `$invoke`（成员调用面），
 * 没补在**普通调用面**（具名导入 / 直接调用）。普通调用面把**裸宿主值**
 * （宿主函数 / 宿主构造器 / 用户函数声明——transpile 侧直发 host function）
 * 原样灌进 `bindTypeVars`（`packages/core/src/algebra/hof.ts`）
 * ——`arg.shape` 解引用 `undefined` ⇒ TypeError 冒泡
 * ⇒ 上层当成「这个调用可能抛」⇒ 记 may TypeError ⇒ **L2 假红**。
 *
 * 修法（core · S6）：
 * 1. `packages/core/src/algebra/hof.ts` 的 `bindTypeVars`：实参**无形状**
 *    ⇒ **不参与类型变量绑定**（不再崩）。
 * 2. **普通调用面也做实参归一化**（与
 *    `packages/core/src/algebra/exec/class/invoke.ts` 的 Bug 85 段同款）：
 *    `hof.ts` 的 `setRawArgNormalizer` 注册 `asAbsVal` 门面
 *    ⇒ 成员调用面 / 普通调用面共用同一门面 ⇒ **两种口径一致**。
 *
 * 本钉直接驱动引擎（core 的 `checkSource` + env 模块直注），
 * 不经 service 的 `@nudo:env` 指令层。
 *
 * ⚠️ 与 S4 的 `env-bug-882-util-brand-params.test.ts`（env 侧：给
 * `node:util` 四兄弟加 `apply`，建模侧规避）**互补**：本钉的**判别钉**
 * 走 `fs.readFile(path, enc, cb)`（仍是 relation 形态 ⇒ 只由 core 侧
 * 修复兜住）+ 一条 core API 直钉 ⇒ **拆掉 core 修复 ⇒ 本文件必红**。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  resetGeneralizeMemo,
  relationFn,
  instantiateReturn,
  undefAbs,
  abs,
} from "@nudojs/core";
import type { Abs, AbsModuleExports } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const nodeEnv = defineEnv();

/** env 的 `brandOf("Function")` 形状（品牌形参面） */
const fnBrand = abs(
  { k: "brand", name: "Function", shape: abs({ k: "unknown" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "path",
);

/** 裸宿主函数 / 宿主构造器（普通调用面的实参——无 Abs 形状） */
const rawHostFn = function Sub() {};
const rawHostCtor = Object;

/** env 模块表 → core 的模块导出表（与 service 的 `collectEnvModules` 同口径） */
function modulesOf(def: {
  modules?: Record<string, Record<string, Abs>>;
}): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(def.modules ?? {})) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

const NODE_MODULES = modulesOf(nodeEnv);

function check(src: string) {
  resetGeneralizeMemo();
  return checkSource("/t/x.js", src, pTrue, {
    modules: NODE_MODULES,
    inject: { envGlobals: nodeEnv.globals, modules: NODE_MODULES },
  });
}

function codesOf(src: string): string[] {
  return check(src).issues.map((i) => i.code);
}

function sigOf(src: string, name: string): { display: string; throws?: string } {
  const sig = check(src).signatures.find((s) => s.name === name);
  expect(sig, `signature "${name}" missing`).toBeTruthy();
  return { display: sig!.display, throws: sig!.throws };
}

/** L2 入口 may-throw 门禁（假红就是它） */
const MAY_THROW = "nudo:entry-may-throw";

describe("Bug 882 · node:util 品牌形参函数：具名导入调用面不得 L2 假红", () => {
  const NAMED = `/// @nudo:env node
import { promisify } from "node:util";
import { readFile } from "node:fs";
export function use() { return promisify(readFile); }
`;

  const MEMBER = `/// @nudo:env node
import * as util from "node:util";
import { readFile } from "node:fs";
export function use() { return util.promisify(readFile); }
`;

  it("具名导入调用面：promisify(readFile) 零 L2（native 必不抛）", () => {
    const codes = codesOf(NAMED);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    expect(sigOf(NAMED, "use").throws).toBeUndefined();
  });

  it("成员调用面：util.promisify(readFile) 零 L2", () => {
    const codes = codesOf(MEMBER);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    expect(sigOf(MEMBER, "use").throws).toBeUndefined();
  });

  it("两种调用口径一致（具名导入 == 成员调用）", () => {
    expect(sigOf(NAMED, "use").display).toBe(sigOf(MEMBER, "use").display);
  });

  it("裸宿主函数实参（inherits(Sub, Object)）零 L2 —— 普通调用面不得崩", () => {
    const src = `/// @nudo:env node
import { inherits } from "node:util";
export function Sub() {}
export function use() { return inherits(Sub, Object); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    // 崩溃回落会给出 `unknown` + throws TypeError；修好后是确定的 undefined
    const sig = sigOf(src, "use");
    expect(sig.throws).toBeUndefined();
    expect(sig.display).not.toMatch(/unknown/);
  });

  it("裸宿主值实参（isDeepStrictEqual）零 L2", () => {
    const src = `/// @nudo:env node
import { isDeepStrictEqual } from "node:util";
export function use(a, b) { return isDeepStrictEqual(a, b); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
  });

  it("裸宿主函数实参（fs 同步族的回调位）零 L2 —— 钉住 core 侧根因", () => {
    // **判别钉**：函数**声明**绑定是裸宿主函数（transpile 直发 host
    // function）⇒ 普通调用面把它原样灌进 relation 实例化 ⇒
    // `bindTypeVars` 解引用 `arg.shape` ⇒ TypeError 冒泡 ⇒ L2 假红。
    // 改前：`use() => unknown throws TypeError` + `nudo:entry-may-throw`；
    // 改后：`use() => undefined`，零 L2。
    // （`node:util` 四兄弟另有 env 侧 apply 规避；本钉走 `fs.readFile`
    // ——仍是 relation 形态 ⇒ 只由 core 侧修复兜住。）
    const src = `/// @nudo:env node
import { readFile } from "node:fs";
function cb(err, data) { return data; }
export function use() { return readFile("x.txt", "utf8", cb); }
`;
    const codes = codesOf(src);
    expect(codes, `L2 假红：${codes.join(", ")}`).not.toContain(MAY_THROW);
    const sig = sigOf(src, "use");
    expect(sig.throws).toBeUndefined();
    expect(sig.display).not.toMatch(/unknown/);
  });

  it("core 侧根因直钉：relation 实例化遇裸宿主实参不得抛", () => {
    // `instantiateReturn`（packages/core/src/algebra/hof.ts）是普通调用面
    // 把 relation fn 实例化的入口；裸宿主实参此前在此解引用
    // `arg.shape` ⇒ TypeError。
    const rel = relationFn([fnBrand], undefAbs());
    expect(() => instantiateReturn(rel, [rawHostFn as never])).not.toThrow();
    expect(() => instantiateReturn(rel, [rawHostCtor as never])).not.toThrow();
  });

  it("反向对照：真会抛的入口必须报 L2（防永真断言）", () => {
    const src = `export function use() { throw new Error("boom"); }
`;
    expect(codesOf(src)).toContain(MAY_THROW);
  });

  it("反向对照：真会抛的宿主调用必须报 L2（防永真断言）", () => {
    const src = `/// @nudo:env node
import { readFileSync } from "node:fs";
export function use() { return readFileSync("/definitely/not/here.txt", "utf8"); }
`;
    // env 的 fs 同步族声明了 throws 面 ⇒ 真会抛 ⇒ 必须报
    expect(codesOf(src)).toContain(MAY_THROW);
  });
});
