/**
 * 族 29 · Bug 891：`fs/promises` 的结果对象是同步族的**裁剪副本**
 * ——`fsPromisesModule.stat` 只抄了 12 个槽（比同步族少 9 个），且
 * `readdir` 的 `Dirent` 是**空 shape 的 brand** ⇒ 成员读出
 * **exact `undefined` / `NaN` / `never`**——那是**确定的错值**，不是精度债。
 *
 * 修法：`statsAbs` / `direntAbs` 抽成**共享常量**，同步族与 promise 族
 * 共用同一张成员表（原生 oracle：两族的成员表**完全一致**）。
 *
 * 原生 oracle（Node v26）：`fs.statSync(p)` 与 `fs.promises.stat(p)` 的
 * 成员表一致（数据属性 + 原型上的谓词方法 + Date 时刻）。
 */
import { describe, it, expect } from "vitest";
import { boolLit, formatShape, objOf, strLit, type Abs } from "@nudojs/core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { callSite, envMember, innerOf, slotsOf } from "./env-bug-s3-helpers.ts";

/** promise 兑现值的内层（`promiseOf(x)` ⇒ x）。 */
function promiseInner(a: unknown): Abs | undefined {
  if (!a) return undefined;
  const s = (a as Abs).shape as { k?: string; inner?: Abs };
  return s.k === "eff" ? s.inner : undefined;
}

/** 数组的元素类型。 */
function elementOf(a: Abs | undefined): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape as { k?: string; element?: Abs };
  return s.k === "arr" ? s.element : undefined;
}

/** sum 里的某个成员（按品牌名找）。 */
function sumMember(a: Abs | undefined, brandNameWanted: string): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape as { k?: string; members?: Abs[] };
  if (s.k !== "sum") return undefined;
  return s.members?.find((m) => m.shape.k === "brand" && (m.shape as { name: string }).name === brandNameWanted);
}

describe("Bug 891 · fs/promises 结果对象与同步族共用成员表", () => {
  it("1. 原生 oracle：同步族与 promise 族的 Stats 成员表一致", async () => {
    const sync = fs.statSync("/tmp");
    const promised = await fsp.stat("/tmp");
    expect(Object.keys(promised).sort()).toEqual(Object.keys(sync).sort());
    // 谓词方法在原型上
    for (const m of ["isFile", "isDirectory", "isSymbolicLink", "isBlockDevice", "isCharacterDevice", "isFIFO", "isSocket"]) {
      expect(typeof (sync as unknown as Record<string, unknown>)[m], m).toBe("function");
      expect(typeof (promised as unknown as Record<string, unknown>)[m], m).toBe("function");
    }
  });

  it("2. 声明面：promise 族的 stat 兑现值含完整成员表（不再是裁剪副本）", () => {
    const ret = envMember("node:fs/promises", "stat").shape as { returnType?: Abs };
    const inner = promiseInner(ret.returnType);
    expect(inner, "stat 的返回类型应是 promise").toBeDefined();
    const slots = slotsOf(inner!);
    for (const k of [
      "isFile", "isDirectory", "isSymbolicLink", "isBlockDevice", "isCharacterDevice",
      "isFIFO", "isSocket", "size", "mode", "uid", "gid", "ino", "dev", "nlink",
      "blksize", "blocks", "rdev", "mtime", "ctime", "atime", "birthtime",
      "mtimeMs", "ctimeMs", "atimeMs", "birthtimeMs",
    ]) {
      expect(slots[k], `stat 兑现值缺 ${k}`).toBeDefined();
    }
    expect(formatShape(slots["mtimeMs"]!.value)).toBe("number");
    expect(formatShape(slots["mtime"]!.value)).toBe("Date");
    expect(formatShape(slots["isFile"]!.value)).toContain("bool");
  });

  it("3. 同步族与 promise 族**共用同一张表**（成员集合相等）", () => {
    const syncRet = envMember("node:fs", "statSync").shape as { returnType?: Abs };
    const promisedRet = envMember("node:fs/promises", "stat").shape as { returnType?: Abs };
    const syncSlots = Object.keys(slotsOf(syncRet.returnType!)).sort();
    const promisedSlots = Object.keys(slotsOf(promiseInner(promisedRet.returnType)!)).sort();
    expect(promisedSlots).toEqual(syncSlots);
  });

  it("4. Dirent：promise 族的 readdir 元素是**有 shape** 的 Dirent（旧面是空 brand）", () => {
    const ret = envMember("node:fs/promises", "readdir").shape as { returnType?: Abs };
    const inner = promiseInner(ret.returnType);
    expect(inner).toBeDefined();
    const element = elementOf(innerOf(inner!));
    expect(element, "readdir 兑现值应是数组").toBeDefined();
    const direntBrand = sumMember(element!, "Dirent");
    expect(direntBrand, "元素并集里应有 Dirent 品牌").toBeDefined();
    const dslots = slotsOf(innerOf(direntBrand!)!);
    expect(Object.keys(dslots).sort()).toEqual(["isDirectory", "isFile", "isSymbolicLink", "name", "parentPath"]);
    expect(formatShape(dslots["name"]!.value)).toBe("string");
  });

  it("5. 反向钉：promise 族的成员读出**不得**是 exact undefined（旧面裁剪副本）", () => {
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/tmp")]);
    expect(site.value).toBeDefined();
    const slots = slotsOf(promiseInner(site.value)!);
    // 旧面：这些槽缺 ⇒ 读出 exact undefined（引擎显示 `promise<NaN>` / `promise<undefined>`）
    expect(slots["mtimeMs"], "mtimeMs 缺槽 ⇒ 读出 exact undefined").toBeDefined();
    expect(slots["nlink"], "nlink 缺槽 ⇒ 读出 exact undefined").toBeDefined();
    expect(slots["isBlockDevice"], "isBlockDevice 缺槽 ⇒ 读出 exact undefined").toBeDefined();
  });

  it("6. readdir 的 withFileTypes 分叉：true ⇒ Dirent[]（原生如此）", async () => {
    const native = await fsp.readdir("/tmp", { withFileTypes: true });
    expect(native[0]?.isFile).toBeTypeOf("function");
    const site = callSite(envMember("node:fs/promises", "readdir"), [
      strLit("/tmp"),
      objOf({ withFileTypes: { value: boolLit(true) } }),
    ]);
    const element = elementOf(promiseInner(site.value!));
    expect(element, "withFileTypes:true ⇒ 元素应是 Dirent").toBeDefined();
    expect(element!.shape.k).toBe("brand");
    expect(slotsOf(innerOf(element!)!)["name"], "Dirent.name 槽").toBeDefined();
  });
});
