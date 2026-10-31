/**
 * BUG-189 —— 同一个本地绑定**同时**是具名导出与 `default` 导出时，旧实现
 * （`dtsExportNameOf` 只返回一个名字）只发射其中一个 ⇒ 另一个导出名在发布的
 * `.d.ts` 里根本不存在：
 *   - default 名缺失 ⇒ 消费方 `import def from "./m.js"` 得到 `{}` ⇒
 *     `error TS2349: This expression is not callable`；
 *   - 具名缺失 ⇒ `TS2305: has no exported member`。
 *
 * 判据：`.d.ts` 只能引用**它自己声明或导入**的名字；一个本地绑定有几个导出名，
 * 产物就有几条导出 —— 主形态（具名优先）一次，其余逐条 `export { local as … };`。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { localNamedExports } from "@nudojs/core";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

/** 模块面 dts 投影（CLI `export --format dts` 的产品面路径） */
function moduleDts(source: string, path = "/test/bug189.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const names = localNamedExports(source);
  const ontoFace = (name: string): boolean =>
    names.has(name) ||
    name === "default" ||
    /^([A-Za-z_$][\w$]*)\./.test(name);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0 && ontoFace(fn.name))
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("BUG-189 —— 一个绑定多个导出名，全部进 .d.ts", () => {
  it("`export { foo as default, foo }` ⇒ 具名声明 + default 别名", () => {
    const dts = moduleDts(`function foo(x) {
  return x + 1;
}
export { foo as default, foo };
`);
    expect(dts).toContain("export declare function foo(");
    expect(dts).toContain("export { foo as default };");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import def, { foo } from "./mod.js";\nconst a = def(1);\nconst b = foo(2);\nexport { a, b };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("`export default foo;`（具名函数 + 表达式式 default）⇒ default 可调用", () => {
    const dts = moduleDts(`function foo(x) {
  return x + 1;
}
export default foo;
`);
    expect(dts).toContain("export default function foo(");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import def from "./mod.js";\nconst a = def(1);\nexport { a };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("类：具名 + default 双导出 ⇒ 两条导出都在（`new` 不报 TS2351）", () => {
    const dts = moduleDts(`class C {
  m() {
    return 1;
  }
}
export { C as default, C };
`);
    expect(dts).toContain("export declare class C {");
    expect(dts).toContain("export { C as default };");
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import DefC, { C } from "./mod.js";\nconst a = new DefC().m();\nconst b = new C().m();\nexport { a, b };\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  // ── 负控制：单导出的形态不该被改写 ──────────────────────────────
  it("负控制：只有 default 一个导出名时保持 `export default function`", () => {
    const dts = moduleDts(`export default function addOne(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function addOne(");
    expect(dts).not.toContain("export { addOne as default };");
  });

  it("负控制：别名导出仍按导出名声明（不额外发射内部名）", () => {
    const dts = moduleDts(`const internal = (x) => x + 1;
export { internal as publicName };
`);
    expect(dts).toContain("export { internal as publicName };");
    expect(dts).not.toContain("export declare function internal");
  });
});
