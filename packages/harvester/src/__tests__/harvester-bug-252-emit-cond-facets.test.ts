/**
 * BUG-252 回归：`emitEnvModule` 的 `emitAbs` `case "fn"` 只补 `ctor` / 静态槽，
 * 丢掉条件类型的 `inferFrom` / `condFallback` ⇒ 同一份 `.d.ts` 的三条物化路径
 * 不同型（落盘面 `unwrapPromise(Promise.resolve("hi"))` 折成 `any`）。
 *
 * 契约：三路径同型 ⇒ 落盘源码面**实际求值结果**也带这两个 facet。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFnImpl, type Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";
import { materializeHarvestJson, serializeHarvestJson } from "../harvest-json.ts";

const dirs: string[] = [];
const generated: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generated) rmSync(f, { force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug252-"));
  dirs.push(dir);
  const p = join(dir, "cond.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

const fx = writeTemp(
  "export declare function unwrapPromise<T>(x: T): T extends Promise<infer U> ? U : never;\n",
);
const env = harvestDts([fx]);
const code = emitEnvModule(env, "condpkg");

type Rel = {
  inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
  condFallback?: Abs;
};

function relOf(a: Abs): Rel {
  return (getFnImpl(a)?.relation ?? {}) as Rel;
}

describe("BUG-252 —— 落盘源码面保留条件类型的两个 facet", () => {
  it("内存收割面带 inferFrom / condFallback（基线）", () => {
    const rel = relOf(env.globals.unwrapPromise!);
    expect(rel.inferFrom).toEqual({ fromVar: "T", via: "promise", inferVar: "U" });
    expect(rel.condFallback?.shape.k).toBe("never");
  });

  it("磁盘缓存面同型（基线）", () => {
    const json = JSON.parse(
      JSON.stringify(serializeHarvestJson("condpkg", env, { dtsHash: "h", maxFiles: 1 })),
    );
    const back = materializeHarvestJson(json)!;
    const rel = relOf(back.globals.unwrapPromise!);
    expect(rel.inferFrom).toEqual({ fromVar: "T", via: "promise", inferVar: "U" });
    expect(rel.condFallback?.shape.k).toBe("never");
  });

  it("落盘源码面发射并求值出这两个 facet（三路径同型）", async () => {
    expect(code).toContain("inferFrom");
    expect(code).toContain("condFallback");
    const generatedPath = fileURLToPath(new URL("./generated-env-bug252.tmp.ts", import.meta.url));
    writeFileSync(generatedPath, code, "utf-8");
    generated.push(generatedPath);
    const mod = (await import("./generated-env-bug252.tmp.ts")) as {
      defineEnv: () => { globals: Record<string, Abs> };
    };
    const rel = relOf(mod.defineEnv().globals.unwrapPromise!);
    expect(rel.inferFrom).toEqual({ fromVar: "T", via: "promise", inferVar: "U" });
    expect(rel.condFallback?.shape.k).toBe("never");
  });
});
