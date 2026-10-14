/**
 * R1 生成器精度（Bug 52/53/54 修复留下的两处 sound-but-imprecise 残差）：
 *
 * - R1a（.throw-into-catch done 域）：`it.throw(e)` 挂在 try/catch 内的
 *   yield 上时，wave-1 分级把 done 恒并成 boolean。事实上 catch 结局可以
 *   静态分类：transpile 侧 finalizerBits 同口径标注 catch 事实位
 *   （YIELD_CATCH_RETURNS/YIELDS/RETHROWS，$yield/$yieldStar 第二实参
 *   扩展位）+ 运行时收集序列——catch 无 yield、重抛不被外层 catch 二次
 *   吸收、挂起点后无剩余收集 yield ⇒ 吸收必完成生成器（catch return /
 *   fallthrough 到体末 / 重抛→may-throw 已记），done 折 true（native）。
 *   值域保持 unknown（catch 体 eager 收集期未执行，return 表达式不可判）。
 *
 * - R1b（>8-yield spread widening）：`[...g()]` 此前把 Bug 53 保留的完整
 *   收集序列（ys.els）经 tupleOrWiden 的 TUPLE_LITERAL_CAP 又降回 widened
 *   arr（单代表元素域），`[...g()].join("")` 丢成抽象 string。修复：
 *   makeGenObject 对**线性收集**（非路径敏感）的 drain 视图注册 exact 位；
 *   消费端（spread $concat / Array.from / 解构 rest / yield* lengthKnown）
 *   读权威列表重组 exact 元组，越过 cap（仅 > TUPLE_MATERIALIZE_CAP 退
 *   arr join 保 sound）。路径敏感（fork 拼接）序列不可 exact——保持 widened
 *   （拼接序列不是 native 序列，禁 wrong-definite）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, effects, tupleEls, throwsError } from "./eval-helpers.ts";
import { anyAbs } from "../abs.ts";

const lv = (src: string): ReturnType<typeof litValue> => litValue(call(src, "f").result);

describe("R1a: .throw-into-catch done 域静态分类", () => {
  it("catch 含 return、无剩余 yield：done 折 true（native true）", () => {
    expect(lv(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "caught"; } }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`)).toEqual({ ok: true, value: true });
  });

  it("catch 含 return：值域保持 unknown（catch 体未执行，native \"caught\"）", () => {
    const r = call(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "caught"; } }
      const it = h(); it.next();
      return it.throw(new Error("x")).value;
    }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(r.result.shape.k).toBe("unknown");
  });

  it("吸收后 catch 重抛面 may-throw 保持（sound 过近似）", () => {
    expect(effects(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "caught"; } }
      const it = h(); it.next(); it.throw(new Error("x")); return 0;
    }`)).toContain("Error");
  });

  it("吸收完成后 next() → {value: undefined, done: true}（native 完成语义）", () => {
    expect(lv(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "caught"; } }
      const it = h(); it.next(); it.throw(new Error("x"));
      return it.next().done;
    }`)).toEqual({ ok: true, value: true });
    expect(lv(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "caught"; } }
      const it = h(); it.next(); it.throw(new Error("x"));
      return it.next().value;
    }`)).toEqual({ ok: true, value: undefined });
  });

  it("catch 空体 fallthrough：done 折 true（native true——无后续 yield 必完成）", () => {
    expect(lv(`export function f(){
      function* h(){ try { yield 1; } catch (e) { } }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`)).toEqual({ ok: true, value: true });
  });

  it("catch 含 yield：done 并 boolean（吸收后可再交付，不可折——sound 降级）", () => {
    const r = call(`export function f(){
      function* h(){ try { yield 1; } catch (e) { yield 9; } }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });

  it("挂起点后还有收集 yield（try 外续 yield）：done 并 boolean（续体可达）", () => {
    const r = call(`export function f(){
      function* h(){ try { yield 1; } catch (e) { } yield 2; }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });

  it("内层 catch 可能重抛进外层 catch：结局不可分类 → done 并 boolean", () => {
    const r = call(`export function f(){
      function* h(){
        try {
          try { yield 1; } catch (e) { throw e; }
        } catch (e2) { return "outer"; }
      }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });

  it("yield* 委托进生成器对象：.throw 转发内层（内层 catch 吸收可续）→ done 并 boolean", () => {
    // native：内层 g 的 catch 吸收后 yield 9 → done false——外层不可分类，
    // 不得折 true（wrong-definite）
    const r = call(`export function f(){
      function* g(){ try { yield 1; } catch (e) { yield 9; } }
      function* h(){ try { yield* g(); } catch (e) { return "outer"; } }
      const it = h(); it.next();
      return it.throw(new Error("x")).done;
    }`);
    expect(litValue(r.result).ok).toBe(false);
    expect(r.result.shape.k).toBe("sum");
  });

  it("无 catch 挂起点：保持原生定值抛（native TypeError）", () => {
    const r = call(`export function f(){
      function* h(){ yield 1; }
      const it = h(); it.next();
      it.throw(new TypeError("x"));
      return 0;
    }`);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("未启动 / 已耗尽的 .throw：无挂起点，保持定值抛（native）", () => {
    const unstarted = call(`export function f(){
      function* h(){ try { yield 1; } catch (e) { return "c"; } }
      const it = h();
      it.throw(new TypeError("x"));
      return 0;
    }`);
    expect(throwsError(unstarted.throws, "TypeError")).toBe(true);
  });
});

describe("R1b: >8-yield 生成器消费读完整收集序列（exact 元组）", () => {
  it("9-yield spread join → \"012345678\"（native）", () => {
    expect(lv(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      return [...g()].join("");
    }`)).toEqual({ ok: true, value: "012345678" });
  });

  it("9-yield spread：length 9、下标 3 → 3（native）", () => {
    expect(tupleEls(call(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      const a = [...g()];
      return [a.length, a[3]];
    }`).result)).toEqual([9, 3]);
  });

  it("9-yield while 循环 spread join 同样 exact（native）", () => {
    expect(lv(`export function f(){
      function* g(){ let i = 0; while (i < 9) { yield i; i++; } }
      return [...g()].join("");
    }`)).toEqual({ ok: true, value: "012345678" });
  });

  it("Array.from(g()) → exact 元组（native \"012345678\"）", () => {
    expect(lv(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      return Array.from(g()).join("");
    }`)).toEqual({ ok: true, value: "012345678" });
  });

  it("yield* 委托 9-yield：外层生成器保持 exact（native \"012345678\"）", () => {
    expect(lv(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      function* h(){ yield* g(); }
      return [...h()].join("");
    }`)).toEqual({ ok: true, value: "012345678" });
  });

  it("数组解构 rest：rest.length 8、join exact（native）", () => {
    expect(tupleEls(call(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      const [x, ...rest] = g();
      return [x, rest.length, rest.join("")];
    }`).result)).toEqual([0, 8, "12345678"]);
  });

  it("for-of 消费保持 exact（Bug 54 回归面，native \"012345678\"）", () => {
    expect(lv(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      let s = "";
      for (const v of g()) s += v;
      return s;
    }`)).toEqual({ ok: true, value: "012345678" });
  });

  it("部分消费后 spread 读剩余（Bug 54 live 视图，native \"12345678\"）", () => {
    expect(lv(`export function f(){
      function* g(){ for (let i = 0; i < 9; i++) yield i; }
      const it = g(); it.next();
      return [...it].join("");
    }`)).toEqual({ ok: true, value: "12345678" });
  });

  it("路径敏感（fork 拼接）>8-yield：保持 widened（拼接非 native 序列，禁 wrong-definite）", () => {
    const r = call(`export function f(c){
      function* g(){ if (c) { for (let i = 0; i < 9; i++) yield i; } else { for (let i = 0; i < 9; i++) yield i + 100; } }
      return [...g()].join("");
    }`, "f", [anyAbs]);
    expect(litValue(r.result).ok).toBe(false);
  });
});
