/**
 * Phase 2 root 驱动下行（design-refine-derivation §5 / §11 验收）：
 * lib.nudo.js 手写 add4 契约 → 推导 add2 的组合式 fn({ x }, x.shift(2))。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveFromRoot, emitDerivedFromRoot, formatDerivedSection, extractFnConstraintSources } from "../interface-derivation.ts";
import { checkSource, pTrue } from "@nudojs/core";
import { defaultLoadModule } from "../load-module.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-deriv-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STD = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
`;

const ADD_JS = `export function add2(x) {
  return x + 2;
}
`;

const LIB_JS = `import { add2 } from "./add.js";

export function add4(x) {
  return add2(x + 1) + 1;
}
`;

const LIB_NUDO = `import { fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";

export const add4 = fn({ x: positive }, positive4);
`;

function writeFixture(): void {
  writeFileSync(join(dir, "std.nudo.js"), STD);
  writeFileSync(join(dir, "add.js"), ADD_JS);
  writeFileSync(join(dir, "lib.js"), LIB_JS);
  writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO);
}

describe("extractFnConstraintSources", () => {
  it("resolves identifier params to their import source", () => {
    const r = extractFnConstraintSources(LIB_NUDO, "add4");
    expect(r.params.x).toEqual({
      expr: "positive",
      importFrom: "./std.nudo.js",
      importName: "positive",
    });
    expect(r.returns).toEqual({
      expr: "positive4",
      importFrom: "./std.nudo.js",
      importName: "positive4",
    });
  });
});

describe("deriveFromRoot", () => {
  it("hasRoot=false without handwritten contract", () => {
    writeFileSync(join(dir, "lonely.js"), `export function f(x) { return x; }\n`);
    const r = deriveFromRoot(join(dir, "lonely.js"));
    expect(r.hasRoot).toBe(false);
    expect(r.derived).toEqual([]);
  });

  it("derives add2 compositionally from lib.js:add4 contract (§5)", () => {
    writeFixture();
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["add2"] });
    expect(r.hasRoot).toBe(true);
    expect(r.roots).toEqual(["add4"]);
    expect(r.derived.length).toBe(1);
    const add2 = r.derived[0]!;
    expect(add2.fn).toBe("add2");
    expect(add2.file).toBe(join(dir, "add.js"));
    expect(add2.derivedFrom).toContain("add4");
    expect(add2.params.length).toBe(1);
    expect(add2.params[0]!.name).toBe("x");
    expect(add2.compositional).toBe(true);
    // 组合式：const x = positive.shift(1)
    expect(add2.params[0]!.prelude).toEqual(["const x = positive.shift(1);"]);
    expect(add2.params[0]!.dsl).toBe("x");
    expect(add2.params[0]!.imports).toEqual([
      { name: "positive", from: "./std.nudo.js" },
    ]);
    // 返回：x.shift(2)
    expect(add2.returns).toBeDefined();
    expect(add2.returns!.dsl).toBe("x.shift(2)");
  });

  it("formatDerivedSection emits the §5.3 shape", () => {
    writeFixture();
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["add2"] });
    const add2 = r.derived[0]!;
    const section = formatDerivedSection(add2, {
      targetSourceRel: "add.js",
      rootSidecarDir: dir,
      targetSidecarDir: dir,
    });
    expect(section).toBeDefined();
    expect(section!.text).toContain('import { positive } from "./std.nudo.js";');
    expect(section!.text).toContain("const x = positive.shift(1);");
    expect(section!.text).toContain("export const add2 = fn({ x }, x.shift(2));");
  });

  it("--fn filters to the named downstream export only", () => {
    writeFixture();
    // 加一个无关导出
    writeFileSync(
      join(dir, "add.js"),
      `${ADD_JS}\nexport function other(y) { return y * 2; }\n`,
    );
    const r = deriveFromRoot(join(dir, "lib.js"), { fnNames: ["add2"] });
    expect(r.derived.map((d) => d.fn)).toEqual(["add2"]);
  });
});

describe("emitDerivedFromRoot", () => {
  it("writes add2 into add.nudo.js from lib.js root (§11 Phase 2 验收)", () => {
    writeFixture();
    const r = emitDerivedFromRoot(join(dir, "lib.js"), {
      fnNames: ["add2"],
      mode: "update",
    });
    expect(r.hasRoot).toBe(true);
    expect(r.sidecars.length).toBe(1);
    expect(r.sidecars[0]!.written).toBe(true);
    expect(r.sidecars[0]!.changed).toBe(true);
    const sidecar = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    expect(sidecar).toContain("@generated");
    expect(sidecar).toContain("derived-from:");
    expect(sidecar).toContain("add4");
    expect(sidecar).toContain('import { positive } from "./std.nudo.js";');
    expect(sidecar).toContain("const x = positive.shift(1);");
    expect(sidecar).toContain("export const add2 = fn({ x }, x.shift(2));");
  });

  it("is idempotent on second emit", () => {
    writeFixture();
    emitDerivedFromRoot(join(dir, "lib.js"), { fnNames: ["add2"], mode: "update" });
    const before = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    const r2 = emitDerivedFromRoot(join(dir, "lib.js"), {
      fnNames: ["add2"],
      mode: "update",
    });
    expect(r2.sidecars[0]!.written).toBe(false);
    expect(r2.sidecars[0]!.changed).toBe(false);
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toBe(before);
  });

  it("dryRun does not write", () => {
    writeFixture();
    const r = emitDerivedFromRoot(join(dir, "lib.js"), {
      fnNames: ["add2"],
      mode: "update",
      dryRun: true,
    });
    expect(r.sidecars[0]!.changed).toBe(true);
    expect(r.sidecars[0]!.diff).toContain("+");
    expect(existsSync(join(dir, "add.nudo.js"))).toBe(false);
  });

  it("skips handwritten binding with name-clash", () => {
    writeFixture();
    writeFileSync(
      join(dir, "add.nudo.js"),
      `import { fn, number } from "@nudojs/core";\nexport const add2 = fn({ x: number() });\n`,
    );
    const r = emitDerivedFromRoot(join(dir, "lib.js"), {
      fnNames: ["add2"],
      mode: "update",
    });
    expect(r.sidecars[0]!.written).toBe(false);
    expect(r.sidecars[0]!.issues.some((i) => i.code === "nudo:interface-name-clash")).toBe(true);
    expect(readFileSync(join(dir, "add.nudo.js"), "utf-8")).toContain("number()");
  });

  it("entryOnly when no root", () => {
    writeFileSync(join(dir, "plain.js"), `export function f(x) { return x; }\n`);
    const r = emitDerivedFromRoot(join(dir, "plain.js"), {
      fnNames: ["f"],
      mode: "update",
    });
    expect(r.hasRoot).toBe(false);
    expect(r.entryOnly).toBe(true);
    expect(r.sidecars).toEqual([]);
  });

  it("check(add4) still holds positive4 after emit; second caller does not poison the chain", () => {
    writeFixture();
    emitDerivedFromRoot(join(dir, "lib.js"), { fnNames: ["add2"], mode: "update" });
    expect(existsSync(join(dir, "add.nudo.js"))).toBe(true);

    const checkOpts = {
      loadModule: defaultLoadModule,
      fromFile: join(dir, "lib.js"),
    };
    const before = checkSource(join(dir, "lib.js"), LIB_JS, pTrue, checkOpts);
    expect(before.ok).toBe(true);
    expect(before.issues.filter((i) => i.severity === "error")).toEqual([]);

    // 第二个调用者：把 add2 的落盘接口 join 宽，但 check(add4) 按本链独立
    writeFileSync(
      join(dir, "main.js"),
      `import { add2 } from "./add.js";\nadd2(-10);\n`,
    );
    const after = checkSource(join(dir, "lib.js"), LIB_JS, pTrue, checkOpts);
    expect(after.ok).toBe(true);
    expect(after.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
