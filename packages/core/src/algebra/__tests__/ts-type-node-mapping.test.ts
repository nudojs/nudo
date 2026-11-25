/**
 * 节点面类型映射（`mapTsTypeNode`）的回归钉：与文本面无关的节点面自身契约。
 *
 * - 明确不支持的类型种类 ⇒ undefined（switch 的 `default` 分支是 `never`：
 *   Babel 新增种类 ⇒ 编译红；运行期未知种类同归 undefined，不抛、不伪造）；
 * - 带类型实参的内建泛型：实参随 Abs 走，不塌成裸 brand（`Map<string, number>`
 *   的 `get` 返回 `number | undefined`，`Set<string>` 的 `has` 收 `string`）；
 * - 宽键 mapped type ⇒ 索引签名；
 * - 联合去重键对循环引用安全（`Map` 形 Abs 的 relation `returnType` 自引用；
 *   此前去重键用 `JSON.stringify` ⇒ 抛 TypeError，整条注解映射连同
 *   `nudo check` 进程一起崩）；
 * - 合成节点（无 `start` / `end`）不靠文本回落也能映射。
 *
 * Invariants:
 * - 不支持的种类返回 undefined，回落与否由调用方决定；
 * - 下列构造的节点面结果逐字钉住（展示串空白折叠）。
 */
import { describe, expect, it } from "vitest";
import type { Abs } from "../abs.ts";
import { formatAbs } from "../format/format.ts";
import { leqAbs } from "../leq.ts";
import {
  absTypeForTsTypeNode,
  absTypeForTsTypeText,
  tsTypeNodeOfText,
} from "../contract/ts-type-shape.ts";

const show = (a: Abs | undefined): string =>
  a === undefined ? "undefined" : formatAbs(a).replace(/\s+/g, " ");

function nodeAbsOf(text: string): Abs | undefined {
  const { node, source } = tsTypeNodeOfText(text);
  return absTypeForTsTypeNode(node, undefined, source);
}

describe("TS 类型节点映射（节点面）", () => {
  it("明确不支持的类型种类返回 undefined", () => {
    for (const text of ["intrinsic", "T extends string ? 1 : 0", "infer U"]) {
      expect(nodeAbsOf(text), text).toBeUndefined();
      expect(absTypeForTsTypeText(text, undefined), `${text}（文本面）`).toBeUndefined();
    }
    // 不是类型位置的节点（类 implements / interface extends 子句）与运行期
    // 未知种类同归 undefined。
    const notTypePosition = [
      { type: "TSClassImplements", expression: { type: "Identifier", name: "Base" } },
      { type: "TSInterfaceHeritage", expression: { type: "Identifier", name: "Base" } },
      { type: "TSSomeFutureKind" },
    ];
    for (const node of notTypePosition) {
      expect(absTypeForTsTypeNode(node), node.type).toBeUndefined();
    }
    for (const notNode of [undefined, null, 42, "TSStringKeyword"]) {
      expect(absTypeForTsTypeNode(notNode)).toBeUndefined();
    }
  });

  it("带类型实参的内建泛型：实参随 Abs 走，不塌成裸 brand", () => {
    const pinned: ReadonlyArray<readonly [string, string]> = [
      ["Promise<string>", "promise<string> #exact"],
      ['Record<"a", number>', '{ [k: "a"]: number } #exact'],
      ["Record<string, string[]>", "{ [k: string]: string[] } #exact"],
      ["Array<{ price: number }>", "{ price: number }[] #exact"],
      ["ReadonlyArray<string | number>", "(string | number)[] #exact"],
      ["Partial<{ a: number; b?: string }>", "{ a?: number, b?: string } #exact"],
      ["Required<{ a?: number; b: string }>", "{ a: number, b: string } #exact"],
      ['Pick<{ a: number; b: string }, "a">', "{ a: number } #exact"],
      ['Omit<{ a: number; b: string }, "a">', "{ b: string } #exact"],
    ];
    const fragments: ReadonlyArray<readonly [string, string]> = [
      ["Map<string, number>", "get: (string) => number | undefined"],
      ["Map<string, number>", "has: (string) => boolean"],
      ["ReadonlyMap<string, number>", "get: (string) => number | undefined"],
      ["Set<string>", "add: (string) => "],
      ["Set<{ id: number }>", "has: ({ id: number }) => boolean"],
      ["Map<string, Set<number>>", "get: (string) => { add: (number) => "],
      ["WeakMap<object, string>", "get: ({ }) => string | undefined"],
    ];
    const parameterized = [
      ...pinned.map(([text]) => text),
      ...fragments.map(([text]) => text),
      "Map<string, 10n>",
      "Map<string, Map<string, number>>",
      "Map<string, number>[]",
      "[Map<string, number>]",
    ];
    for (const [text, expected] of pinned) {
      expect(show(nodeAbsOf(text)), text).toBe(expected);
    }
    for (const [text, fragment] of fragments) {
      expect(show(nodeAbsOf(text)), text).toContain(fragment);
    }
    for (const text of parameterized) {
      const shown = show(nodeAbsOf(text));
      // 裸 brand：空对象 / any 索引签名 / any promise——带了实参还塌回去即回归。
      expect(shown, text).not.toBe("{ } #exact");
      expect(shown, text).not.toContain("[k: any]: any");
      expect(shown, text).not.toBe("promise<any> #exact");
    }
  });

  it("mapped type：窄键按键集展开，宽键映射成索引签名", () => {
    const pinned: ReadonlyArray<readonly [string, string]> = [
      ["{ [K in 'a' | 'b']: number }", "{ a: number, b: number } #exact"],
      ['{ [K in "a" | "b"]-?: number }', "{ a: number, b: number } #exact"],
      ["{ [K in 'a' | 'b']?: number }", "{ a?: number, b?: number } #exact"],
      ["{ [K in 'a' | 'b']: { key: K } }", '{ a: { key: "a" }, b: { key: "b" } } #exact'],
      ["{ [K in keyof { a: 1 }]: number }", "{ a: number } #exact"],
      ["{ [K in string]: number }", "{ [k: string]: number } #exact"],
      ["{ [K in number]: string }", "{ [k: number]: string } #exact"],
      ["{ [K in string | number]: boolean }", "{ [k: string | number]: boolean } #exact"],
      // `'a' | string` 塌成 string：仍然是宽键。
      ["{ [K in 'a' | string]: number }", "{ [k: string]: number } #exact"],
      ["{ [K in string]: { key: K } }", "{ [k: string]: { key: string } } #exact"],
    ];
    for (const [text, expected] of pinned) {
      expect(show(nodeAbsOf(text)), text).toBe(expected);
    }
    const readonly = nodeAbsOf("{ readonly [K in 'a']: number }");
    const slots = (readonly as { shape: { slots: Record<string, { readonly?: boolean }> } }).shape
      .slots;
    expect(slots.a?.readonly).toBe(true);
  });

  it("联合去重对循环引用的 Abs 安全（Map 形成员）", () => {
    // 前置：Map 形 Abs 自身带环（relation 的 returnType 指回自己）——所以去重
    // 键不能是 JSON 序列化。
    const map = absTypeForTsTypeText("Map<string, number>", undefined)!;
    expect(() => JSON.stringify({ shape: map.shape, term: map.term })).toThrow(TypeError);

    const joined = [
      "[Map<string, number>]",
      "Map<string, number> | undefined",
      "{ a: number; m: Map<string, number> }[string]",
      "Map<string, Map<string, number>>",
      "Map<string, Set<number>>",
      "Map<string, Date>",
    ];
    for (const text of joined) {
      let textAbs: Abs | undefined;
      expect(() => {
        textAbs = absTypeForTsTypeText(text, undefined);
      }, `${text}（文本面）`).not.toThrow();
      const node = nodeAbsOf(text);
      expect(node && textAbs ? leqAbs(node, textAbs).ok && leqAbs(textAbs, node).ok : false, text)
        .toBe(true);
    }
    // 节点面独有、成员带环的构造同样不抛。
    expect(show(nodeAbsOf("Map<string, Iterator<string>>"))).toContain("get: (string) =>");
    expect(show(nodeAbsOf("Map<string, Iterable<number>>"))).toContain("get: (string) =>");
  });

  it("合成节点（无 start / end）不靠文本回落也能映射", () => {
    const str = { type: "TSStringKeyword" };
    const num = { type: "TSNumberKeyword" };
    expect(show(absTypeForTsTypeNode(str))).toBe("string #exact");
    expect(show(absTypeForTsTypeNode({ type: "TSUnionType", types: [str, num] }))).toBe(
      "string | number #exact",
    );
    const map = absTypeForTsTypeNode({
      type: "TSTypeReference",
      typeName: { type: "Identifier", name: "Map" },
      typeArguments: { type: "TSTypeParameterInstantiation", params: [str, num] },
    });
    expect(show(map)).toContain("get: (string) => number | undefined");
  });
});
