/**
 * BUG-013 回归：load-deps 侧 @nudo:env / @nudo:mock-module 识别面与 parser 对齐。
 * 指纹过近似本身安全，但字符串误匹配会把垃圾 spec 写进依赖集合；
 * `//` 与 `///` 必须都命中 path 型 env。
 */
import { describe, it, expect } from "vitest";
import { extractAllLoadSpecs } from "../load-deps-fp.ts";

describe("extractAllLoadSpecs env/mock-module prefix contract", () => {
  it("// @nudo:env and /// @nudo:env both contribute path specs", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:env ./custom.env.ts\nexport function f(){}`;
      expect(extractAllLoadSpecs(src)).toContain("./custom.env.ts");
    }
  });

  it("@nudo:env inside a string is ignored", () => {
    const src = `const s = "@nudo:env ./evil.env.ts";\nexport function f(){}`;
    expect(extractAllLoadSpecs(src)).not.toContain("./evil.env.ts");
  });

  it("@nudo:env inside a template string is ignored", () => {
    const src = "const s = `@nudo:env ./evil.env.ts`;\nexport function f(){}";
    expect(extractAllLoadSpecs(src)).not.toContain("./evil.env.ts");
  });

  it("@nudo:env inside a block comment is ignored (line comments only)", () => {
    const src = `/* @nudo:env ./evil.env.ts */\nexport function f(){}`;
    expect(extractAllLoadSpecs(src)).not.toContain("./evil.env.ts");
  });

  it("named env is not a loadModule path", () => {
    const src = `// @nudo:env node\nexport function f(){}`;
    expect(extractAllLoadSpecs(src)).not.toContain("node");
  });

  it("// @nudo:mock-module and /// @nudo:mock-module both contribute fromPath", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:mock-module "fs" from "./mock-fs.js"\nexport function f(){}`;
      expect(extractAllLoadSpecs(src)).toContain("./mock-fs.js");
    }
  });

  it("mock-module fromPath inside a string is only an over-approx (generic from)", () => {
    // 指令识别面剥字符串（parser/check 不认字符串里的 @nudo:mock-module）；
    // 但 generic `from "..."` 刻意过近似——多记 dep 只多失效、绝不 stale hit。
    const src = `const s = '@nudo:mock-module "fs" from "./evil.js"';\nexport function f(){}`;
    expect(extractAllLoadSpecs(src)).toContain("./evil.js");
  });

  it("http:// URL does not open a fake comment", () => {
    const src = `const u = "http://@nudo:env ./evil.env.ts";\nexport function f(){}`;
    expect(extractAllLoadSpecs(src)).not.toContain("./evil.env.ts");
  });
});
