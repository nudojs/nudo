/**
 * Bug 932 回归：env 模块的**具名导入**（`import { promisify } from "node:util"`）
 * 不得把 env 里**声明完整**的 fn 导出包成 JS 箭头 wrapper。
 *
 * 缺陷：具名导入的绑定值是 wrapper（`w = (...args) => $call(v, args)`，原 Abs 只
 * 挂在 `w.__nudoAbsFn` 上、无人读）⇒ 绑定 Abs 退化成引擎为宿主函数合成的**裸
 * fn 形状**（无 `paramTypes` / 无 `returnType`）⇒ 签名面渲染成**非法占位符**
 * `() => ?`；而**同一份 env 声明**经**命名空间导入**（槽直填原 Abs）渲染成完整
 * 的 `(CallbackFn) => PromiseFn` ⇒ 同一文件、同一导出、两种导入形态两种类型。
 *
 * 断言：
 * - 具名 / 命名空间两种导入形态给出**同一个**类型（= env 声明的类型）
 * - 渲染面不含非法占位符 `?`
 * - 调用面（`promisify(x)`）返回域 = 声明的 returnType
 * - 负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  abs,
  unknown,
  relationFn,
  formatShape,
  type Abs,
} from "@nudojs/core";

const brand = (name: string): Abs =>
  abs({ k: "brand", name, shape: unknown }, undefined, undefined, "path");

/** env 声明面（对齐 packages/env/src/node.ts 的 util.promisify 形态） */
const callbackFn = brand("CallbackFn");
const promiseFn = brand("PromiseFn");
const promisify = relationFn([callbackFn], promiseFn, { params: ["x"] });

const modules = {
  "node:util": { named: { promisify } },
  "./lib.js": { named: { helper: relationFn([brand("Num")], brand("Num")) } },
};

function sigOf(src: string, fn: string): string {
  const run = runTranspiled(src, { mode: "analyze", modules: modules as never });
  const r = callTranspiledExportFull(run, fn, []);
  return formatShape(r.result as Abs);
}

describe("Bug 932: 具名导入的 fn 绑定保留 env 声明类型", () => {
  const src = `
import { promisify } from "node:util";
import * as util from "node:util";
export function named() { return promisify; }
export function namespace() { return util.promisify; }
export function callIt() { return promisify(promisify); }
`;

  it("具名导入渲染 env 声明的类型（不再退化成裸 fn 的 `() => ?`）", () => {
    expect(sigOf(src, "named")).toBe("(CallbackFn) => PromiseFn");
  });

  it("具名导入与命名空间导入给出同一个类型（同一文件、同一导出、两种形态）", () => {
    const named = sigOf(src, "named");
    const namespace = sigOf(src, "namespace");
    expect(named).toBe(namespace);
    expect(named).toBe("(CallbackFn) => PromiseFn");
  });

  it("签名面不含非法占位符 `?`", () => {
    expect(sigOf(src, "named")).not.toContain("?");
  });

  it("调用面返回域 = 声明的 returnType（实参也是原 Abs，不是裸 fn）", () => {
    expect(sigOf(src, "callIt")).toBe("PromiseFn");
  });

  it("负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致", () => {
    const userSrc = `
import { helper } from "./lib.js";
import * as lib from "./lib.js";
export function named() { return helper; }
export function namespace() { return lib.helper; }
`;
    const named = sigOf(userSrc, "named");
    expect(named).toBe(sigOf(userSrc, "namespace"));
    expect(named).toBe("(Num) => Num");
  });
});
