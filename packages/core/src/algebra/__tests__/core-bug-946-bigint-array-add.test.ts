/**
 * Bug 946 —— `+` 的 bigint 臂**排在数组臂之前** ⇒ `1n + []` 被短路进数值臂。
 *
 * 根因（两段，见 AGENT-CONTEXT §4 / SURVEY-08 §1 第 5 行）：
 * ① `arithmetic/addsub.ts` 的 `add()`：bigint 臂（`foldBigintBinOp`）在数组臂
 *    之前 ⇒ `+` 的第一步 ToPrimitive 被跳过（数组侧恒 join(",") ⇒ string）。
 *    原生 `1n + []` = string "1"（**从不抛**），引擎却硬抛 TypeError ⇒ 折
 *    `never` ⇒ L2 `nudo:entry-may-throw` **假红**（exit 1）。
 * ② `arithmetic/coerce.ts` 的 `isMaybeBigintOperand`：kind 清单漏 `arr`/
 *    `tuple` ⇒ 数组 ⊗ bigint 落不进「数组专属分流」，只能落进兜底路径。
 *
 * 修法：`add()` 的数组臂**前移**到 bigint 臂之前（ToPrimitive 先行）；kind
 * 清单补 `arr`/`tuple`，并由 `foldBigintBinOp` 的数组分支**显式硬抛**
 * （数组 ToPrimitive 恒 string ⇒ ToNumber ⇒ number ⇒ 算术面混型 TypeError
 * **确定**且可被 catch 吸收 ⇒ 不得走软 may-throw 通道）；同时把数组/元组从
 * `isMaybeCoercionThrowOperand` 排除（数组 ToPrimitive 恒 string ⇒ 既不会成
 * bigint 也不会成 Symbol ⇒ `1 + []` / `[] < 1` 原生从不抛，不得记假
 * may-throw）。
 *
 * 原生 oracle（node 实跑）：
 *   1n + []    => string "1"      1n + [1,2] => string "11,2"
 *   [] + 1n    => string "1"      1n + "s"   => string "1s"
 *   [1] + 1n   => string "11"     1n + 1     => THROW TypeError
 *   1 + []     => string "1"      1n - []    => THROW TypeError
 */
import { describe, it, expect } from "vitest";
import { abs, formatShape } from "../index.ts";
import { call, val, isNever, throwsError, effects } from "./eval-helpers.ts";

const BIG_PRIM = abs({ k: "prim", type: "bigint" }, undefined, undefined, "path");
const ARR_ABS = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "path",
);

describe("Bug 946: bigint ⊗ array in + is string concat (never throws)", () => {
  it("1n + [] folds to string \"1\" (native), not never/TypeError", () => {
    const r = call(`export function f() { return 1n + []; }`);
    expect(isNever(r.result)).toBe(false);
    expect(val(`export function f() { return 1n + []; }`)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe('"1"');
  });

  it("[] + 1n / [1] + 1n / 1n + [1,2] fold to the native join strings", () => {
    expect(val(`export function f() { return [] + 1n; }`)).toEqual({ ok: true, value: "1" });
    expect(val(`export function f() { return [1] + 1n; }`)).toEqual({ ok: true, value: "11" });
    expect(val(`export function f() { return 1n + [1,2]; }`)).toEqual({ ok: true, value: "11,2" });
  });

  it("bigint ⊗ array records NO may-throw (原生从不抛 ⇒ 不得进 L2 假红)", () => {
    expect(effects(`export function f() { return 1n + []; }`)).toEqual([]);
    expect(effects(`export function f() { return [] + 1n; }`)).toEqual([]);
    // 对照：确定混型（bigint ⊗ number）仍走硬抛面（throws 通道，非效果通道）
    const mixed = call(`export function f() { return 1n + 1; }`);
    expect(isNever(mixed.result)).toBe(true);
    expect(throwsError(mixed.throws, "TypeError")).toBe(true);
  });

  it("抽象 bigint 面 ⊗ 数组 / 抽象数组 ⊗ bigint ⇒ string，不折 unknown/never", () => {
    const bigSide = call(`export function f(x) { return x + []; }`, "f", [BIG_PRIM]);
    expect(isNever(bigSide.result)).toBe(false);
    expect(formatShape(bigSide.result)).toBe("string");
    expect(throwsError(bigSide.throws, "TypeError")).toBe(false);

    const arrSide = call(`export function f(x) { return 1n + x; }`, "f", [ARR_ABS]);
    expect(isNever(arrSide.result)).toBe(false);
    expect(formatShape(arrSide.result)).toBe("string");
    expect(throwsError(arrSide.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 946 反向：不得改动既有口径", () => {
  it("number ⊗ 数组仍是 string 拼接（1 + [] = \"1\"，无 may-throw）", () => {
    expect(val(`export function f() { return 1 + []; }`)).toEqual({ ok: true, value: "1" });
    expect(effects(`export function f() { return 1 + []; }`)).toEqual([]);
    expect(val(`export function f() { return [1] + 1; }`)).toEqual({ ok: true, value: "11" });
  });

  it("bigint ⊗ string 仍是拼接（1n + \"s\" = \"1s\"）", () => {
    expect(val(`export function f() { return 1n + "s"; }`)).toEqual({ ok: true, value: "1s" });
    expect(val(`export function f() { return "s" + 1n; }`)).toEqual({ ok: true, value: "s1" });
  });

  it("确定混型 bigint ⊗ number 仍硬抛 TypeError（never）", () => {
    const r = call(`export function f() { return 1n + 1; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("无字符串分支的算子仍抛：1n - [] / 1n * []（原生恒抛 TypeError，硬抛可被 catch 吸收）", () => {
    for (const op of ["-", "*"]) {
      const r = call(`export function f() { return 1n ${op} []; }`);
      expect(isNever(r.result), op).toBe(true);
      expect(throwsError(r.throws, "TypeError"), op).toBe(true);
      // catch 可吸收：原生进 catch 分支
      expect(
        val(`export function f() { try { 1n ${op} []; } catch (e) { return "caught"; } return "missed"; }`),
        op,
      ).toEqual({ ok: true, value: "caught" });
    }
  });

  it("catch 语义：1n + [] 原生不抛 ⇒ try 块正常走完（改前误进 catch）", () => {
    expect(
      val(`export function f() { try { 1n + []; } catch (e) { return "caught"; } return "missed"; }`),
    ).toEqual({ ok: true, value: "missed" });
    // 对照：确定混型 1n + 1 原生抛 ⇒ 进 catch
    expect(
      val(`export function f() { try { 1n + 1; } catch (e) { return "caught"; } return "missed"; }`),
    ).toEqual({ ok: true, value: "caught" });
  });
});
