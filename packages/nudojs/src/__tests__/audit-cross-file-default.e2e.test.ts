/**
 * 审计 34 · D4：跨文件证据的**名字路**（）。
 *
 * 调用记录里的 `targetExport` 是**导出名**（`"default"`），而 check 面按
 * **函数普查名**匹配 ⇒ 重命名默认导入 / `import {default as g}` / `ns.default()`
 * 三条路都把证据丢掉（门禁假绿）。修法是把导出名 `"default"` 换算成该文件的
 * 默认导出本地名，匹配两侧共用同一换算。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(extra: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-d4-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "lib.js"),
    [
      '/// @nudo:import { pos } from "./lib.nudo.js"',
      "/** @nudo:contract x pos */",
      "export default function f(x) { return x; }",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.nudo.js"), "export const pos = number().gt(0);\n", "utf-8");
  for (const [name, src] of Object.entries(extra)) writeFileSync(join(dir, name), src, "utf-8");
  return dir;
}

function codes(dir: string, from: string): string[] {
  const r = runCliTsx(["check", join(dir, "lib.js"), "--from", join(dir, from), "--json"]);
  const json = JSON.parse(r.stdout) as { issues?: Array<{ code: string }> };
  return (json.issues ?? []).map((i) => i.code);
}

describe("默认导出的跨文件证据名字路", () => {
  it("对照：本地名 = 函数名（基线，此前已通过）", () => {
    const dir = fixture({ "use.js": 'import f from "./lib.js";\nf(-1);\n' });
    expect(codes(dir, "use.js")).toContain("nudo:contract-domain-exceeds");
  }, 60000);

  it("重命名默认导入（`import other from`）", () => {
    const dir = fixture({ "use4.js": 'import other from "./lib.js";\nother(-4);\n' });
    expect(codes(dir, "use4.js")).toContain("nudo:contract-domain-exceeds");
  }, 60000);

  it("`import { default as g }`", () => {
    const dir = fixture({ "use2.js": 'import { default as g } from "./lib.js";\ng(-2);\n' });
    expect(codes(dir, "use2.js")).toContain("nudo:contract-domain-exceeds");
  }, 60000);

  it("`import * as ns; ns.default(...)`", () => {
    const dir = fixture({ "use3.js": 'import * as ns from "./lib.js";\nns.default(-3);\n' });
    expect(codes(dir, "use3.js")).toContain("nudo:contract-domain-exceeds");
  }, 60000);
});

// ---------------------------------------------------------------------------
// --from 的静态通道必须穿过 re-export barrel
// ---------------------------------------------------------------------------
describe("--from 静态证据经 barrel 传递", () => {
/** 旧口径只认「import 直接解析到 lib.js」⇒ 经 barrel 引入的现场文件零绑定、
 * 整份证据被跳过（同一违例 `check caller` 红、`check lib --from caller` 绿）。
 */
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const fixture = (): string => {
    const d = mkdtempSync(join(tmpdir(), "nudo-from-barrel-"));
    dirs.push(d);
    writeFileSync(join(d, "shapes.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
    writeFileSync(
      join(d, "lib.js"),
      '/// @nudo:import { positive } from "./shapes.nudo.js"\n' +
        "/** @nudo:contract x positive */\n" +
        "export function make(x) { return { x }; }\n",
      "utf-8",
    );
    writeFileSync(join(d, "barrel.js"), 'export { make } from "./lib.js";\n', "utf-8");
    writeFileSync(join(d, "barrel2.js"), 'export { make } from "./barrel.js";\n', "utf-8");
    return d;
  };
  const codes = (d: string, from: string): string[] => {
    const r = runCliTsx([
      "check", join(d, "lib.js"), "--from", join(d, from), "--json",
    ]);
    const json = JSON.parse(r.stdout) as { issues?: Array<{ code: string; actual?: string }> };
    return (json.issues ?? []).map((i) => i.code);
  };

  it("对照（直接 import）与实验组（barrel / 多跳 barrel）同结论", () => {
    const d = fixture();
    writeFileSync(
      join(d, "direct.js"),
      'import { make } from "./lib.js";\nexport function caller() { return make(-2); }\n',
      "utf-8",
    );
    writeFileSync(
      join(d, "throughBarrel.js"),
      'import { make } from "./barrel.js";\nexport function caller() { return make(-2); }\n',
      "utf-8",
    );
    writeFileSync(
      join(d, "deep.js"),
      'import { make } from "./barrel2.js";\nexport function caller() { return make(-2); }\n',
      "utf-8",
    );
    for (const f of ["direct.js", "throughBarrel.js", "deep.js"]) {
      expect(codes(d, f), f).toContain("nudo:contract-domain-exceeds");
    }
  }, 120000);
});
