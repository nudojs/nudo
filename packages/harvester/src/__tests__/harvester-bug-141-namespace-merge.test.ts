/**
 * BUG-141 回归：同名 `namespace` 的第二份声明（TS declaration merging）成员
 * 被整块丢弃（只留一个 `skipped++`）⇒ 调用它们被判「未定义」⇒ L2 假红。
 *
 * 契约：同名 namespace 的成员取**并集**，且与声明顺序无关。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Abs, Slot } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug141-"));
  dirs.push(dir);
  const p = join(dir, "ns.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

function slotsOf(a: Abs | undefined): Record<string, Slot> {
  const s = a!.shape;
  if (s.k === "obj") return s.slots;
  if (s.k === "fn") return s.slots ?? {};
  return {};
}

const FIRST = `declare namespace Foo {
  function bar(x: number): string;
  const baz: number;
  namespace Inner {
    function qux(): boolean;
  }
}
declare namespace Foo {
  function extra(): void;
}
`;

const SECOND = `declare namespace Foo {
  function extra(): void;
}
declare namespace Foo {
  function bar(x: number): string;
  const baz: number;
  namespace Inner {
    function qux(): boolean;
  }
}
`;

describe("BUG-141 —— 同名 namespace 的成员取并集", () => {
  it("第二份声明的成员不丢（extra 在）", () => {
    const env = harvestDts([writeTemp(FIRST)]);
    const names = Object.keys(slotsOf(env.globals.Foo));
    expect(names).toEqual(expect.arrayContaining(["bar", "baz", "Inner", "extra"]));
    expect(env.stats.skipped).toBe(0);
  });

  it("声明顺序不影响成员集合", () => {
    const a = Object.keys(slotsOf(harvestDts([writeTemp(FIRST)]).globals.Foo)).sort();
    const b = Object.keys(slotsOf(harvestDts([writeTemp(SECOND)]).globals.Foo)).sort();
    expect(a).toEqual(b);
  });
});
