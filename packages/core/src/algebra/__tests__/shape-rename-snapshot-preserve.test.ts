/**
 * 结构保持的 α-rename / 快照回归。
 *
 * `renameShape`（generalize-key.ts）与 `snapshotAbs`（hof.ts）此前用白名单
 * 重建 Shape：tuple `holes`/`rest`、fn `slots`/`optionalParams`/`ctor`/`name`、
 * obj slot `optional`/`readonly`/`internal`/`inherited`/`symbolKey`、obj
 * `index`/`open`、brand `ctor`/`tv`、eff `rejected`/`unsettled` 均有丢失面。
 * 现改为 spread + 嵌套映射：term/pred/conf 语义不变，字段全量保留。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { abs, numLit, strLit, absLit, litValue, type Abs, type Shape } from "../abs.ts";
import { generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { renameShape } from "../generalize-key.ts";
import { snapshotAbs } from "../hof.ts";

const numVar = (id: string): Abs =>
  abs({ k: "prim", type: "number" }, { op: "var", id }, undefined, "exact");

const map = new Map([["x", "z"]]);

describe("generalize instantiate 保留 tuple holes（memo 命中 + α 改名）", () => {
  beforeEach(() => resetGeneralizeMemo());

  it("identity 函数第二次 instantiate 仍保留 holes", () => {
    const g = generalizeFromAst("f", "export function f(a){ return a; }");
    expect(g).toBeDefined();
    const mk = (id: string): Abs =>
      abs(
        {
          k: "tuple",
          elements: [numVar(id), absLit(undefined), numLit(3)],
          holes: [1, 2],
        },
        undefined,
        undefined,
        "exact",
      );
    const r1 = g!.instantiate([mk("x")]);
    const r2 = g!.instantiate([mk("y")]);
    expect(r1.shape.k).toBe("tuple");
    if (r1.shape.k !== "tuple") return;
    expect(r1.shape.holes).toEqual([1, 2]);
    expect(r2.shape.k).toBe("tuple");
    if (r2.shape.k !== "tuple") return;
    expect(r2.shape.holes).toEqual([1, 2]);
  });
});

describe("renameShape 保留全部 Shape 字段", () => {
  it("fn：name/paramTypes/returnType/optionalParams/ctor/slots（含槽标志）", () => {
    const fn: Shape = {
      k: "fn",
      params: ["a", "b"],
      name: "g",
      paramTypes: [numVar("x")],
      returnType: numVar("x"),
      optionalParams: [false, true],
      ctor: false,
      slots: {
        prototype: { value: numVar("x") },
        y: { value: numLit(1), readonly: true },
      },
    };
    const out = renameShape(fn, map);
    if (out.k !== "fn") throw new Error("expected fn");
    expect(out.name).toBe("g");
    expect(out.params).toEqual(["a", "b"]);
    expect(out.optionalParams).toEqual([false, true]);
    expect(out.ctor).toBe(false);
    expect(out.paramTypes![0]!.term).toEqual({ op: "var", id: "z" });
    expect(out.returnType!.term).toEqual({ op: "var", id: "z" });
    expect(Object.keys(out.slots!).sort()).toEqual(["prototype", "y"]);
    expect(out.slots!.y!.readonly).toBe(true);
    expect(out.slots!.prototype!.value.term).toEqual({ op: "var", id: "z" });
    // 新对象（不污染源）
    expect(out.slots).not.toBe(fn.slots);
    expect(out.optionalParams).not.toBe(fn.optionalParams);
  });

  it("tuple：elements/rest/holes", () => {
    const t: Shape = {
      k: "tuple",
      elements: [numVar("x")],
      rest: numVar("x"),
      holes: [0, 2],
    };
    const out = renameShape(t, map);
    if (out.k !== "tuple") throw new Error("expected tuple");
    expect(out.holes).toEqual([0, 2]);
    expect(out.holes).not.toBe(t.holes);
    expect(out.rest!.term).toEqual({ op: "var", id: "z" });
    expect(out.elements[0]!.term).toEqual({ op: "var", id: "z" });
  });

  it("obj：slot 标志全保留 + index/open", () => {
    const o: Shape = {
      k: "obj",
      slots: {
        a: {
          value: numVar("x"),
          optional: true,
          readonly: true,
          internal: true,
          inherited: true,
          symbolKey: true,
        },
      },
      index: { key: strLit("k"), value: numVar("x") },
      open: true,
    };
    const out = renameShape(o, map);
    if (out.k !== "obj") throw new Error("expected obj");
    expect(out.open).toBe(true);
    expect(out.slots.a).toMatchObject({
      optional: true,
      readonly: true,
      internal: true,
      inherited: true,
      symbolKey: true,
    });
    expect(out.slots.a!.value.term).toEqual({ op: "var", id: "z" });
    expect(out.index!.value.term).toEqual({ op: "var", id: "z" });
    expect(litValue(out.index!.key)).toEqual({ ok: true, value: "k" });
  });

  it("brand：ctor/tv + 内层递归；eff：rejected/unsettled + 内层递归", () => {
    const b: Shape = { k: "brand", name: "A", shape: numVar("x"), ctor: true, tv: 3 };
    const rb = renameShape(b, map);
    if (rb.k !== "brand") throw new Error("expected brand");
    expect(rb.ctor).toBe(true);
    expect(rb.tv).toBe(3);
    expect(rb.shape.term).toEqual({ op: "var", id: "z" });

    const e: Shape = {
      k: "eff",
      eff: "promise",
      inner: numVar("x"),
      rejected: numVar("x"),
      unsettled: true,
    };
    const re = renameShape(e, map);
    if (re.k !== "eff") throw new Error("expected eff");
    expect(re.unsettled).toBe(true);
    expect(re.inner.term).toEqual({ op: "var", id: "z" });
    expect(re.rejected!.term).toEqual({ op: "var", id: "z" });
  });
});

describe("snapshotAbs 保留全部 Shape 字段（直接探针）", () => {
  it("fn 元数据全保留且嵌套值独立", () => {
    const f = abs(
      {
        k: "fn",
        params: ["a"],
        name: "g",
        paramTypes: [numLit(1)],
        returnType: strLit("r"),
        optionalParams: [true],
        ctor: true,
        slots: { x: { value: numLit(1) }, y: { value: numLit(2), readonly: true } },
      },
      { op: "lit", value: 1 },
      undefined,
      "path",
    );
    const s = snapshotAbs(f);
    expect(s).not.toBe(f);
    if (s.shape.k !== "fn") throw new Error("expected fn");
    expect(s.shape.name).toBe("g");
    expect(s.shape.params).toEqual(["a"]);
    expect(s.shape.optionalParams).toEqual([true]);
    expect(s.shape.ctor).toBe(true);
    expect(s.shape.paramTypes![0]).not.toBe((f.shape as { paramTypes: Abs[] }).paramTypes[0]);
    expect(s.shape.slots).not.toBe((f.shape as { slots: object }).slots);
    expect(s.shape.slots!.y!.readonly).toBe(true);
    expect(s.term).toBe(f.term);
    expect(s.conf).toBe("path");
  });

  it("tuple holes/rest、obj 标志/index/open、brand/eff 递归、sum 成员", () => {
    const t = abs(
      {
        k: "tuple",
        elements: [numLit(1)],
        rest: numLit(2),
        holes: [0],
      },
      undefined,
      undefined,
      "exact",
    );
    const st = snapshotAbs(t);
    if (st.shape.k !== "tuple") throw new Error("expected tuple");
    expect(st.shape.holes).toEqual([0]);
    expect(st.shape.rest).toBeDefined();

    const o = abs(
      {
        k: "obj",
        slots: {
          a: { value: numLit(1), optional: true, readonly: true, internal: true, inherited: true, symbolKey: true },
        },
        index: { key: strLit("k"), value: numLit(1) },
        open: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const so = snapshotAbs(o);
    if (so.shape.k !== "obj") throw new Error("expected obj");
    expect(so.shape.open).toBe(true);
    expect(so.shape.slots.a).toMatchObject({
      optional: true,
      readonly: true,
      internal: true,
      inherited: true,
      symbolKey: true,
    });
    expect(so.shape.index).toBeDefined();

    const brand = abs({ k: "brand", name: "A", shape: numLit(1), ctor: true, tv: 2 }, undefined, undefined, "exact");
    const sb = snapshotAbs(brand);
    if (sb.shape.k !== "brand") throw new Error("expected brand");
    expect(sb.shape.ctor).toBe(true);
    expect(sb.shape.tv).toBe(2);
    expect(sb.shape.shape).not.toBe((brand.shape as { shape: Abs }).shape);

    const eff = abs(
      { k: "eff", eff: "promise", inner: numLit(1), rejected: numLit(2), unsettled: true },
      undefined,
      undefined,
      "path",
    );
    const se = snapshotAbs(eff);
    if (se.shape.k !== "eff") throw new Error("expected eff");
    expect(se.shape.unsettled).toBe(true);
    expect(se.shape.rejected).not.toBe((eff.shape as { rejected: Abs }).rejected);

    const sum = abs(
      { k: "sum", members: [numLit(1), strLit("a")] },
      undefined,
      undefined,
      "path",
    );
    const ss = snapshotAbs(sum);
    if (ss.shape.k !== "sum") throw new Error("expected sum");
    expect(ss.shape.members).toHaveLength(2);
    expect(ss.shape.members[0]).not.toBe((sum.shape as { members: Abs[] }).members[0]);
  });
});
