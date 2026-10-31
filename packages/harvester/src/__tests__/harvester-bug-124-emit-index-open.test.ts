/**
 * BUG-124 回归：`emitEnvModule` 的 `obj` 分支只发 `slots` ⇒ 索引签名 / open
 * 标记全丢 ⇒ 同一份 `.d.ts`，内存面 `total() => number`、落盘面 `total() => NaN`。
 *
 * 契约：落盘源码面（`emitEnvModule` 产物的**实际求值结果**）与内存收割面同口径。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";

const dirs: string[] = [];
const generated: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generated) rmSync(f, { force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug124-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type ObjShape = { k: string; slots: Record<string, unknown>; index?: { key: Abs; value: Abs }; open?: boolean };

function retShape(a: unknown): ObjShape {
  const shape = (a as { shape?: { returnType?: { shape?: ObjShape } } }).shape;
  return shape?.returnType?.shape as ObjShape;
}

const fx = writeTemp("rec.d.ts", "export declare function makeRec(): Record<string, number>;\n");
const env = harvestDts([fx]);
const code = emitEnvModule(env, "recpkg");

describe("BUG-124 —— 落盘面保留索引签名 / open 标记", () => {
  it("内存面有 index + open", () => {
    const s = retShape(env.globals.makeRec);
    expect(s.k).toBe("obj");
    expect(s.open).toBe(true);
    expect(s.index).toBeDefined();
  });

  it("落盘源码面发射 index / open（不是 objOf({})）", () => {
    expect(code).toContain("index: {");
    expect(code).toContain("open: true");
    const line = code.split("\n").find((l) => l.trim().startsWith("makeRec:")) ?? "";
    expect(line).not.toContain("objOf({  })");
  });

  it("落盘产物求值后与内存面同口径", async () => {
    const generatedPath = fileURLToPath(new URL("./generated-env-bug124.tmp.ts", import.meta.url));
    writeFileSync(generatedPath, code, "utf-8");
    generated.push(generatedPath);
    const mod = (await import("./generated-env-bug124.tmp.ts")) as {
      defineEnv: () => { globals: Record<string, Abs> };
    };
    const s = retShape(mod.defineEnv().globals.makeRec);
    expect(s.k).toBe("obj");
    expect(s.open).toBe(true);
    expect(s.index?.value.shape).toEqual({ k: "prim", type: "number" });
  });
});
