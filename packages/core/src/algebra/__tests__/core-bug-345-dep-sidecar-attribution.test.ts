/**
 * Bug 345 回归：依赖侧车的求值异常**不包装、不标注依赖路径** ⇒ 报错指向
 * **导入方**且点名它根本没有的名字；导入方的合法契约被连坐作废 ⇒ 契约门禁
 * 假绿。
 *
 * 修法：依赖侧车的异常在 `execSidecar` 内包装成 Nudo 原生诊断并**点名依赖
 * 侧车路径**（native ESM 语义：导入方因依赖装载失败而无法装载）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  execNudoModule,
  setRefineDiagCollector,
  takeRefineDiags,
} from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const IMPORTER = `
import { fn, number } from "@nudojs/core";
import { positive } from "./std.nudo.js";

export const good = fn({ n: positive }, number().gt(1000));
`;

describe("Bug 345: 依赖侧车失败的归因", () => {
  it("诊断点名**依赖侧车路径**（旧口径只说导入方坏了）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `export const positive = ((( broken syntax\n`,
    });
    let err: unknown;
    try {
      execNudoModule(IMPORTER, {
        loadModule,
        fromFile: "/t/m.nudo.js",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain("./std.nudo.js");
    expect(message).toContain("imported by");
    expect(message).toContain("/t/m.nudo.js");
  });

  it("依赖侧车正常时，导入方的契约**照常执法**（不再连坐作废）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const out = execNudoModule(IMPORTER, {
      loadModule,
      fromFile: "/t/m.nudo.js",
    });
    expect(Object.keys(out)).toContain("good");
    const v = out["good"] as { fn?: { returns?: unknown } } | undefined;
    expect(v?.fn).toBeDefined();
  });
});
