/**
 * Bug 445 —— 值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。
 *
 * 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === "type"），
 * 不看「绑定是否只在类型位置被使用」。tsc 的 import elision 会把只用在类型
 * 位置的具名 import **消掉**；不消掉的话，被 import 的模块被剥成空模块 ⇒
 * 产物 ESM 链接期 SyntaxError（"does not provide an export named 'Foo'"）。
 *
 * 修法：语法级的「值位置引用收集」（collectValueReferences）⇒ 值位置零引用
 * 的绑定按 tsc 口径消掉；判不准的一律**保留**（保守）。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../index.ts";

const body = (src: string) => parseSource(src).program.body;
const imports = (src: string) =>
  body(src).filter((n) => n.type === "ImportDeclaration") as unknown as {
    specifiers: { local: { name: string } }[];
  }[];

describe("Bug 445: 值位置的类型专用导入被消掉（tsc import elision 同口径）", () => {
  it("绑定只在类型位置被用到 ⇒ 整条 import 消失（产物可加载）", () => {
    expect(
      imports(`import { Foo } from "./types.js";\nexport function use(f: Foo): string { return "ok"; }`),
    ).toHaveLength(0);
  });

  it("绑定在值位置被用到 ⇒ import 保留", () => {
    const kept = imports(
      `import { val } from "./types.js";\nexport function use(): number { return val; }`,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].specifiers.map((s) => s.local.name)).toEqual(["val"]);
  });

  it("混用：type specifier 被剔除、值 specifier 保留", () => {
    const kept = imports(`import { type A, b } from "m";\nexport function u() { return b; }`);
    expect(kept).toHaveLength(1);
    expect(kept[0].specifiers.map((s) => s.local.name)).toEqual(["b"]);
  });

  it("显式 import type 整条删除（既有行为）", () => {
    expect(imports(`import type { A } from "m";\nexport const x = 1;`)).toHaveLength(0);
  });

  it("裸 import（副作用）保留", () => {
    expect(imports(`import "./side.js";\nexport const x = 1;`)).toHaveLength(1);
  });

  it("typeof 类型查询是类型位置 ⇒ import 同样被消掉（tsc 同口径）", () => {
    expect(imports(`import { val } from "./m.js";\nexport type T = typeof val;`)).toHaveLength(0);
  });

  it("本地再导出（export { X }）判不准 ⇒ 保守保留 import", () => {
    expect(imports(`import { Foo } from "./m.js";\nexport { Foo };`)).toHaveLength(1);
  });

  it("export { X } from \"m\" 的 X 是源模块的绑定 ⇒ 本地 import 判为「没被引用」⇒ 保守保留", () => {
    // 保守口径：绑定**根本没被引用**（既不在值位置也不在类型位置）的本地 import
    // **保留**（tsc 会消掉它，但那是「产物更干净」而不是「产物可用」）。
    expect(imports(`import { Foo } from "./m.js";\nexport { Foo } from "./other.js";`)).toHaveLength(1);
  });

  it("包说明符的 import 一律保留（nudo 不剥除包 ⇒ 不动）", () => {
    expect(imports(`import { Foo } from "some-pkg";\nexport function use(f: Foo) { return f; }`)).toHaveLength(1);
  });

  it("类 heritage 的基类是值引用 ⇒ import 保留", () => {
    expect(
      imports(`import { Base } from "./m.js";\nexport class C extends Base {}`),
    ).toHaveLength(1);
  });

  it("接口的 extends 是类型位置 ⇒ import 被消掉（tsc 同口径）", () => {
    expect(imports(`import { Base } from "./m.js";\nexport interface I extends Base {}`)).toHaveLength(
      0,
    );
  });
});
