/**
 * Bug 559 —— 契约面打印面用**契约里的参数**冒充**函数的形参表**。
 *
 * 病灶：effective 档直接渲染 `eff.params`（**契约声明的参数**）⇒ 契约参数名
 * 冒充函数形参名（`fn({ zzz: … })` 印成 `(zzz: …)`），而 `nudo check` 的签名面
 * 印的是函数真实形参（`(x: any)`）⇒ 同一函数两套形参（跨 verb 自相矛盾）。
 *
 * 本测试钉住：
 * - 打印面的形参表 = **声明形参表**（与 `nudo check` 签名面同源）；
 * - 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）；
 * - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { checkSource, pTrue } from "@nudojs/core";
import { defaultLoadModule } from "../../load-module.ts";
import { formatInterfaceSurfaceLine, interfaceSurface } from "../interface-surface.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-iface-559-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

const LIB_JS = `export function scale(x) {
  return x * 2;
}
`;

const MISMATCH_NUDO_JS = `
import { fn, number } from "@nudojs/core";
export const scale = fn({ zzz: number().gt(0) }, number());
`;

const MATCH_NUDO_JS = `
import { fn, number } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
`;

const EXTRA_NUDO_JS = `
import { fn, number, string } from "@nudojs/core";
export const scale = fn({ x: number().gt(0), y: string() }, number());
`;

describe("Bug 559 — 契约面打印以声明形参表为骨架", () => {
  it("契约参数绑不上形参时：形参表照旧、契约参数另列并显式标注", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MISMATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await interfaceSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale).toBeDefined();
    expect(scale!.source).toBe("handwritten");

    // 形参表 = 声明形参表（不是契约里的 zzz）
    expect(scale!.params).toEqual([{ name: "x", display: "any" }]);
    // 契约里绑不上的参数另列一栏
    expect(scale!.extraParams).toEqual([{ name: "zzz", display: "number().gt(0)" }]);

    const line = formatInterfaceSurfaceLine(scale!);
    expect(line).toContain("(x: any)");
    expect(line).toContain("zzz: number().gt(0)");
    expect(line).toContain("(not a formal parameter)");
    // 旧病灶形态：契约参数名顶替形参名
    expect(line).not.toContain("(zzz:");
  });

  it("跨 verb 一致：契约面的形参表与 nudo check 签名面同源", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MISMATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const source = LIB_JS;

    const entries = await interfaceSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    const report = checkSource(file, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: file,
    });
    const sig = report.signatures.find((s) => s.name === "scale");

    expect(sig).toBeDefined();
    expect(scale!.params.map((p) => p.name)).toEqual(sig!.params);
    // check 面把绑不上的契约参数报成 nudo:interface-param-mismatch
    expect(
      report.issues.some((i) => i.code === "nudo:interface-param-mismatch"),
    ).toBe(true);
  });

  it("负控制：契约参数与形参同名时行为不变（落在形参槽位、无另列）", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await interfaceSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.params).toEqual([{ name: "x", display: "number().gt(0)" }]);
    expect(scale!.extraParams).toBeUndefined();
    expect(formatInterfaceSurfaceLine(scale!)).not.toContain("not a formal parameter");
  });

  it("负控制：契约多出的参数同样另列，不顶替形参", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": EXTRA_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await interfaceSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.params).toEqual([{ name: "x", display: "number().gt(0)" }]);
    expect(scale!.extraParams).toEqual([{ name: "y", display: "string()" }]);
  });

  it("负控制：无契约（implicit 档）行为不变", async () => {
    const root = makeFixture({ "lib.js": LIB_JS });
    const file = join(root, "lib.js");
    const entries = await interfaceSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.source).toBe("implicit");
    expect(scale!.params[0]!.name).toBe("x");
    expect(scale!.extraParams).toBeUndefined();
  });
});
