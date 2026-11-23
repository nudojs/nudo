/**
 * dts 产物 golden 基线（P3b 收口用）。
 *
 * 删除旧 `absToTSType` / `absToTSTypeB` 渲染器前先固化现有产物文本；后续
 * 迁移只允许 IR 输出逐字一致，不允许 fallback 或静默降级。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, runTranspiled, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";
import { absToDtsTypeText as absToTSType } from "../dts-type.ts";

const FIXTURES: ReadonlyArray<readonly [string, string]> = [
  [
    "primitives-arrays-tuples",
    `export function lit(): 1 { return 1; }
export function tuple(p: [number, string], rest: [...string[]]) { return p; }
export function arr(xs: number[]): number[] { return xs; }
export function union(x: number | string): number | string { return x; }
`,
  ],
  [
    "objects-index-view",
    `export function obj(x: { a: number; b?: string }) { return x; }
export function idx(): { [key: string]: number } { return { a: 1 }; }
export function frozen() { return Object.freeze([1, 2]); }
export function view(): RegExpExecArray | null { return /a/.exec("a"); }
`,
  ],
  [
    "classes-generics",
    `export class Base<T> { get(): T { throw new Error(); } }
export class Impl extends Base<string> {
  readonly n = 1;
  get value(): number { return this.n; }
  m(x: number = 1): number { return x; }
}
`,
  ],
  [
    "brands",
    `export function map(): Map<string, number> { return new Map(); }
export function set(): Set<number> { return new Set(); }
export function date(): Date { return new Date(); }
export function args() { return arguments; }
`,
  ],
  [
    "fn-hof-overloads",
    `export function fn(x: number): string { return String(x); }
export function hof<T>(x: T) { return (y: T) => y; }
export function overloaded(x: number): number;
export function overloaded(x: string): string;
export function overloaded(x: any): any { return x; }
`,
  ],
  [
    "generator-template",
    `export function* gen() { yield 1; yield 2; }
export function tpl(x: number): \`id-\${number}\` { return \`id-\${x}\`; }
export function literal(x: "a" | "b") { return x; }
`,
  ],
  [
    "cjs-export-equals",
    `function f(x: number): number { return x; }
export = f;
`,
  ],
  [
    "namespace",
    `export namespace NS {
  export const x: number = 1;
  export function f(a: string): string { return a; }
}
`,
  ],
];

describe("dts golden — 删除旧渲染器前的基线", () => {
  for (const [name, source] of FIXTURES) {
    it(name, () => {
      const result = analyzeFile(`/test/${name}.ts`, source);
      expect(generateDts(result)).toMatchSnapshot();
    });
  }

  it("cycle / depth truncation", () => {
    const cyclic = (runTranspiled(`const a = {}; a.self = a; export default a;`, {}) as {
      default: Abs;
    }).default;
    expect(absToTSType(cyclic)).toMatchSnapshot("cycle");

    let deep: Abs = num();
    for (let i = 0; i < 200; i++) {
      deep = makeAbs({ k: "obj", slots: { v: { value: deep } } }, undefined, undefined, "exact");
    }
    expect(absToTSType(deep)).toMatchSnapshot("depth");
  });
});
