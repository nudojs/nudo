/**
 * 族 29 · Bug 880：`node:fs` **同步族**被建模成「**永不抛**」⇒
 * `readFileSync("/nope/x")` 这类原生**必抛**（`Error` + `code=ENOENT`）的
 * 调用，引擎判「不抛」——**L2 假绿**。
 *
 * 修法：同步族加 **throws 面**（`errBrand("Error")`）。语义是
 * **may-throw**（引擎判不出路径是否存在 ⇒ 不是 always-throw；
 * 成功路径不该变成「必抛」）。
 *
 * 原生 oracle（Node v26）：`fs.readFileSync("/nope/x")` → `Error`
 * （`e.name === "Error"`、`e.code === "ENOENT"`）；`fs.existsSync("/nope/x")`
 * → `false`（**不抛**）。
 */
import { describe, it, expect } from "vitest";
import { boolLit, objOf, strLit, type Abs } from "@nudojs/core";
import fs from "node:fs";
import { brandName, callSite, envMember } from "./env-bug-s3-helpers.ts";

/** 同步族里「原生可能抛」的成员（Bug 880 的修法清单）。 */
const MAY_THROW = [
  "readFileSync",
  "writeFileSync",
  "appendFileSync",
  "mkdirSync",
  "rmdirSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "statSync",
  "readdirSync",
  "realpathSync",
  "readlinkSync",
  "symlinkSync",
  "chmodSync",
  "chownSync",
  "accessSync",
];

/** 原生 oracle：不存在的路径 ⇒ 抛 `Error`（带 code）。 */
const NATIVE_THROWS: Array<[string, () => unknown]> = [
  ["readFileSync", () => fs.readFileSync("/nope/nope.txt")],
  ["writeFileSync", () => fs.writeFileSync("/nope/nope.txt", "x")],
  ["appendFileSync", () => fs.appendFileSync("/nope/nope.txt", "x")],
  ["mkdirSync", () => fs.mkdirSync("/nope/nope-dir")],
  ["rmdirSync", () => fs.rmdirSync("/nope/nope-dir")],
  ["unlinkSync", () => fs.unlinkSync("/nope/nope.txt")],
  ["renameSync", () => fs.renameSync("/nope/a", "/nope/b")],
  ["copyFileSync", () => fs.copyFileSync("/nope/a", "/nope/b")],
  ["statSync", () => fs.statSync("/nope/nope.txt")],
  ["readdirSync", () => fs.readdirSync("/nope/nope-dir")],
  ["realpathSync", () => fs.realpathSync("/nope/nope.txt")],
  ["readlinkSync", () => fs.readlinkSync("/nope/nope.txt")],
  ["symlinkSync", () => fs.symlinkSync("/nope/a", "/nope/b")],
  ["chmodSync", () => fs.chmodSync("/nope/nope.txt", 0o644)],
  ["chownSync", () => fs.chownSync("/nope/nope.txt", 0, 0)],
  ["accessSync", () => fs.accessSync("/nope/nope.txt")],
];

describe("Bug 880 · node:fs 同步族的 throws 面", () => {
  it("1. 原生 oracle：同步族对不存在的路径抛 Error（带 code=ENOENT）", () => {
    for (const [name, fn] of NATIVE_THROWS) {
      let caught: unknown;
      try {
        fn();
      } catch (e) {
        caught = e;
      }
      expect(caught, `${name} 原生应抛`).toBeTruthy();
      const e = caught as { name?: string; code?: string };
      expect(e.name, `${name} 原生异常名`).toBe("Error");
      expect(e.code, `${name} 原生异常 code`).toBe("ENOENT");
    }
  });

  it("2. 引擎侧：同步族调用点记一条 may-throw（Error）throw exit", () => {
    for (const name of MAY_THROW) {
      const fn = envMember("node:fs", name);
      const site = callSite(fn, [strLit("/nope/nope.txt")]);
      expect(site.threw, `${name} 是 may-throw，不该冒泡`).toBeUndefined();
      expect(site.exits.length, `${name} 应记一条 throw exit`).toBe(1);
      expect(brandName(site.exits[0]), `${name} 的 throws 品牌`).toBe("Error");
    }
  });

  it("3. 反向钉：existsSync 原生永不抛 ⇒ 引擎也不得记 throws", () => {
    expect(fs.existsSync("/nope/nope.txt")).toBe(false);
    const site = callSite(envMember("node:fs", "existsSync"), [strLit("/nope/nope.txt")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits, "existsSync 不该有 throw exit").toHaveLength(0);
  });

  it("4. 反向钉：may-throw ≠ always-throw（成功路径的值面不得塌成 never）", () => {
    const site = callSite(envMember("node:fs", "readFileSync"), [strLit("/etc/hostname")]);
    expect(site.threw).toBeUndefined();
    expect(site.value, "成功路径仍应有值面").toBeDefined();
    expect(site.value!.shape.k).not.toBe("never");
  });

  it("5. rmSync：原生 force:true 吞掉 ENOENT（不抛）⇒ 引擎也不得记 throws", () => {
    expect(() => fs.rmSync("/nope/nope.txt", { force: true })).not.toThrow();
    const forceTrue = objOf({ force: { value: boolLit(true) } });
    const site = callSite(envMember("node:fs", "rmSync"), [strLit("/nope/nope.txt"), forceTrue]);
    expect(site.threw).toBeUndefined();
    expect(site.exits, "force:true ⇒ 不记 throw exit").toHaveLength(0);

    // 反向：无 force ⇒ 原生抛 ⇒ 引擎记 may-throw
    expect(() => fs.rmSync("/nope/nope.txt")).toThrow();
    const noForce = callSite(envMember("node:fs", "rmSync"), [strLit("/nope/nope.txt")]);
    expect(noForce.exits.length).toBe(1);
    expect(brandName(noForce.exits[0])).toBe("Error");
  });

  it("6. 抽象实参不改变 throws 面（路径判不出存在性 ⇒ 恒为 may-throw）", () => {
    const site = callSite(envMember("node:fs", "readFileSync"), [
      { shape: { k: "prim", type: "string" }, conf: "exact" } as Abs,
    ]);
    expect(site.threw).toBeUndefined();
    expect(site.exits.length).toBe(1);
    expect(brandName(site.exits[0])).toBe("Error");
  });
});
