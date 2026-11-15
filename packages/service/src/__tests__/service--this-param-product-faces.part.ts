/**
 * Bug 397（**产物半**，service 侧）：TS 的 `this: T` 是**接收者标注**，不是
 * 运行时形参 —— 形参表多一槽 ⇒ **四个产物面同时失真**：
 * dts 多一个形参（消费方吃 TS2554 假红）、zod 多一个字面量槽 `"this"`
 * （对每一个真实调用值报假红）、standard 多一个幽灵导出 `<fn>_this`。
 *
 * 根因分层：
 * - **模型层**（core `formalParamsFromNodes` 的 Identifier 分支）：已排除名字
 *   为 `this` 的形参；
 * - **产物半**（本文件钉的）：`packages/service/src/analyzer-ast.ts` 的
 *   `extractFormals` 是 service 侧**唯一的形参表入口**（dts / zod / standard /
 *   case 四个产物面都从它取形参）⇒ 这里必须**兜底**过滤 `this`，并在过滤后
 *   **重排 index**（index 是形参表内的位置 ⇒ 实参位靠它对齐）。
 *
 * 钉：
 * - `extractFormals` 不返回 `this` 形参、后续形参的 index 前移；
 * - dts 产物面没有 `this` 形参；
 * - 负控制：普通形参表不受影响（index 连续、`this` 之外的形参原样）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parseSource } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { resetAllAnalysisCaches } from "../index.ts";
import { extractFormals, extractParamNames } from "../analyzer-ast.ts";
import { generateDts } from "../emit/dts-generator.ts";

beforeEach(() => {
  resetAllAnalysisCaches();
});

/** 取源里第一个函数声明的节点。 */
function firstFnNode(source: string) {
  const file = parseSource(source);
  for (const stmt of file.program.body) {
    const node = stmt as { type: string; declaration?: { type: string } };
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration") {
      return node.declaration as never;
    }
  }
  throw new Error("no function declaration found");
}

const WITH_THIS = `export function withThis(this: { x: number }, a: number): number {
  return a;
}
`;

describe("Bug 397（产物半）— 形参表过滤 `this` 接收者标注", () => {
  it("extractFormals 不返回 `this` 形参", () => {
    const formals = extractFormals(firstFnNode(WITH_THIS));
    expect(formals.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a"]);
  });

  it("过滤后 index 重排（`this` 不占实参位 ⇒ 后续形参前移）", () => {
    const formals = extractFormals(firstFnNode(WITH_THIS));
    expect(formals.map((f) => f.index)).toEqual([0]);
    expect(formals[0]!.kind === "id" && formals[0]!.name).toBe("a");
  });

  it("extractParamNames（产物面的槽名来源）不含 `this`", () => {
    expect(extractParamNames(firstFnNode(WITH_THIS))).toEqual(["a"]);
  });

  it("dts 产物面没有 `this` 形参（消费方不该吃 TS2554 假红）", () => {
    const dts = generateDts(analyzeFile("/test/bug397-dts.ts", WITH_THIS));
    expect(dts).not.toContain("this:");
    expect(dts).toContain("export declare function withThis(a:");
  });

  it("负控制：没有 `this` 标注时形参表原样（index 连续、名字不变）", () => {
    const formals = extractFormals(
      firstFnNode(`export function plain(a: number, b: string): string {\n  return b;\n}\n`),
    );
    expect(formals.map((f) => f.index)).toEqual([0, 1]);
    expect(formals.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a", "b"]);
  });
});
