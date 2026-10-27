/**
 * 统一 Abs 键（abs-key.ts）：单一结构序列化，三个消费面共享。
 *
 * 回归背景：absShapeKey / relationFingerprint / instantiateMemoKey 此前各自
 * 实现一份键，字段覆盖互有缺口（tuple holes、fn slots/optionalParams/ctor、
 * obj 槽标志、eff rejected/unsettled、brand tv）⇒ 同一可观察差异在不同缓存
 * 面上时灵时不灵。本文件锁死统一面的覆盖与 α-rename 语义。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  absFunction,
  absShapeKey,
  lit,
  makeSum,
  numLit,
  unknown,
  v,
  type Abs,
  type Shape,
  type Slot,
} from "../index.ts";
import { absKey, predKey, shapeKey, termKey } from "../abs-key.ts";
import { instantiateMemoKey, renameAbs, renameShape } from "../generalize-key.ts";
import { relationFingerprint } from "../abs-fn.ts";
import { app, lit as tlit } from "../term.ts";
import { eq, gt, pTrue } from "../pred.ts";

type ObjShape = Extract<Shape, { k: "obj" }>;
type TupleShape = Extract<Shape, { k: "tuple" }>;
type FnShape = Extract<Shape, { k: "fn" }>;
type EffShape = Extract<Shape, { k: "eff" }>;
type BrandShape = Extract<Shape, { k: "brand" }>;

function undefLit(): Abs {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

function tuple(elements: Abs[], extra?: { rest?: Abs; holes?: number[] }): Abs {
  const shape: TupleShape = { k: "tuple", elements, ...extra };
  return abs(shape, undefined, undefined, "exact");
}

function obj(
  slots: Record<string, Slot>,
  extra?: { index?: { key: Abs; value: Abs }; open?: boolean },
): Abs {
  const shape: ObjShape = { k: "obj", slots, ...extra };
  return abs(shape, undefined, undefined, "exact");
}

function fnv(over: Partial<FnShape> = {}): Abs {
  const shape: FnShape = { k: "fn", params: ["x"], ...over };
  return abs(shape, undefined, undefined, "exact");
}

function effv(over: Partial<EffShape> = {}): Abs {
  const shape: EffShape = { k: "eff", eff: "promise", inner: numLit(1), ...over };
  return abs(shape, undefined, undefined, "path");
}

function brandv(over: Partial<BrandShape> = {}): Abs {
  const shape: BrandShape = { k: "brand", name: "Date", shape: obj({}), ...over };
  return abs(shape, undefined, undefined, "path");
}

function primVar(id: string, pred?: Abs["pred"]): Abs {
  return abs({ k: "prim", type: "number" }, v(id), pred, "path");
}

describe("abs-key: tuple holes vs explicit undefined", () => {
  const sparse = tuple([numLit(1), undefLit(), numLit(3)], { holes: [1] });
  const dense = tuple([numLit(1), undefLit(), numLit(3)]);

  it("absKey distinguishes hole from undefined element", () => {
    expect(absKey(sparse)).not.toBe(absKey(dense));
  });

  it("absShapeKey wrapper keeps the distinction", () => {
    expect(absShapeKey(sparse)).not.toBe(absShapeKey(dense));
  });

  it("relationFingerprint distinguishes holes", () => {
    expect(relationFingerprint([sparse], numLit(0))).not.toBe(
      relationFingerprint([dense], numLit(0)),
    );
  });

  it("instantiateMemoKey distinguishes holes", () => {
    expect(instantiateMemoKey([sparse], pTrue).key).not.toBe(
      instantiateMemoKey([dense], pTrue).key,
    );
  });

  it("structurally equal sparse tuples share keys (dedupe preserved)", () => {
    const clone = tuple([numLit(1), undefLit(), numLit(3)], { holes: [1] });
    expect(absKey(sparse)).toBe(absKey(clone));
    expect(relationFingerprint([sparse], numLit(0))).toBe(
      relationFingerprint([clone], numLit(0)),
    );
    // flattenSum 去重不得把 hole 判成 undefined
    const s = makeSum(sparse, dense);
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);
    // 同值仍可去重
    const same = makeSum(sparse, clone);
    expect(same.shape.k).toBe("tuple");
  });
});

describe("abs-key: fn metadata (slots / optionalParams / ctor)", () => {
  const slot1 = fnv({ slots: { y: { value: numLit(1) } } });
  const slot2 = fnv({ slots: { y: { value: numLit(2) } } });
  const slotReadonly = fnv({ slots: { y: { value: numLit(1), readonly: true } } });
  const slotOptional = fnv({ slots: { y: { value: numLit(1), optional: true } } });
  const opt = fnv({ optionalParams: [true] });
  const req = fnv({ optionalParams: [false] });
  const ctorT = fnv({ ctor: true });
  const ctorF = fnv({ ctor: false });

  it("distinguishes expando slot values and slot flags", () => {
    expect(absKey(slot1)).not.toBe(absKey(slot2));
    expect(absKey(slot1)).not.toBe(absKey(slotReadonly));
    expect(absKey(slot1)).not.toBe(absKey(slotOptional));
  });

  it("distinguishes optionalParams and ctor (including absence)", () => {
    expect(new Set([absKey(fnv()), absKey(opt), absKey(req)]).size).toBe(3);
    expect(new Set([absKey(fnv()), absKey(ctorT), absKey(ctorF)]).size).toBe(3);
  });

  it("relationFingerprint inherits slot / optionalParams / ctor distinctions", () => {
    expect(relationFingerprint([slot1], numLit(0))).not.toBe(
      relationFingerprint([slot2], numLit(0)),
    );
    expect(relationFingerprint([opt], numLit(0))).not.toBe(
      relationFingerprint([req], numLit(0)),
    );
    expect(relationFingerprint([ctorT], numLit(0))).not.toBe(
      relationFingerprint([ctorF], numLit(0)),
    );
  });

  it("instantiateMemoKey inherits slot / optionalParams / ctor distinctions", () => {
    expect(instantiateMemoKey([slot1], pTrue).key).not.toBe(
      instantiateMemoKey([slot2], pTrue).key,
    );
    expect(instantiateMemoKey([opt], pTrue).key).not.toBe(
      instantiateMemoKey([req], pTrue).key,
    );
    expect(instantiateMemoKey([ctorT], pTrue).key).not.toBe(
      instantiateMemoKey([ctorF], pTrue).key,
    );
  });
});

describe("abs-key: obj slot flags / index / open", () => {
  const plain = obj({ a: { value: numLit(1) } });
  const variants = [
    plain,
    obj({ a: { value: numLit(1), optional: true } }),
    obj({ a: { value: numLit(1), readonly: true } }),
    obj({ a: { value: numLit(1), internal: true } }),
    obj({ a: { value: numLit(1), inherited: true } }),
    obj({ a: { value: numLit(1), symbolKey: true } }),
  ];

  it("each slot flag changes the key", () => {
    expect(new Set(variants.map((v) => absKey(v))).size).toBe(variants.length);
  });

  it("index and open change the key", () => {
    const indexed = obj(
      { a: { value: numLit(1) } },
      { index: { key: numLit(1), value: numLit(2) } },
    );
    const open = obj({ a: { value: numLit(1) } }, { open: true });
    expect(absKey(plain)).not.toBe(absKey(indexed));
    expect(absKey(plain)).not.toBe(absKey(open));
    expect(absKey(indexed)).not.toBe(absKey(open));
  });

  it("relationFingerprint / instantiateMemoKey inherit obj flag distinctions", () => {
    const internal = obj({ a: { value: numLit(1), internal: true } });
    expect(relationFingerprint([plain], numLit(0))).not.toBe(
      relationFingerprint([internal], numLit(0)),
    );
    expect(instantiateMemoKey([plain], pTrue).key).not.toBe(
      instantiateMemoKey([internal], pTrue).key,
    );
  });

  it("separator characters in slot names do not collide", () => {
    const one = obj({ "a,b": { value: numLit(1) } });
    const two = obj({ a: { value: numLit(1) }, b: { value: numLit(1) } });
    expect(absKey(one)).not.toBe(absKey(two));
  });
});

describe("abs-key: eff rejected / unsettled and brand facets", () => {
  it("distinguishes rejected channel payloads", () => {
    expect(absKey(effv())).not.toBe(absKey(effv({ rejected: numLit(2) })));
    expect(absKey(effv({ rejected: numLit(2) }))).not.toBe(
      absKey(effv({ rejected: numLit(3) })),
    );
  });

  it("distinguishes unsettled state", () => {
    expect(absKey(effv())).not.toBe(absKey(effv({ unsettled: true })));
    expect(relationFingerprint([effv()], numLit(0))).not.toBe(
      relationFingerprint([effv({ unsettled: true })], numLit(0)),
    );
  });

  it("distinguishes brand ctor / tv facets", () => {
    expect(new Set([absKey(brandv()), absKey(brandv({ ctor: true }))]).size).toBe(2);
    expect(new Set([absKey(brandv()), absKey(brandv({ tv: 0 })), absKey(brandv({ tv: 1 }))]).size).toBe(3);
  });
});

describe("abs-key: literal sentinels", () => {
  it("distinguishes -0 from 0 in every key face", () => {
    expect(absKey(numLit(0))).not.toBe(absKey(numLit(-0)));
    expect(absShapeKey(numLit(0))).not.toBe(absShapeKey(numLit(-0)));
    expect(termKey(tlit(0))).not.toBe(termKey(tlit(-0)));
    expect(relationFingerprint([numLit(0)], numLit(1))).not.toBe(
      relationFingerprint([numLit(-0)], numLit(1)),
    );
    expect(instantiateMemoKey([numLit(0)], pTrue).key).not.toBe(
      instantiateMemoKey([numLit(-0)], pTrue).key,
    );
  });

  it("lit(undefined) differs from true unknown and from no term", () => {
    expect(absKey(undefLit())).not.toBe(absKey(unknown));
    expect(absShapeKey(undefLit())).not.toBe(absShapeKey(unknown));
    const noTerm = abs({ k: "unknown" }, undefined, undefined, "partial");
    expect(absKey(undefLit())).not.toBe(absKey(noTerm));
    expect(relationFingerprint([undefLit()], numLit(0))).not.toBe(
      relationFingerprint([unknown], numLit(0)),
    );
  });

  it("term identity (var / app) is part of the key for non-prim shapes", () => {
    const arrA = abs({ k: "arr", element: numLit(1) }, v("a"), undefined, "path");
    const arrB = abs({ k: "arr", element: numLit(1) }, v("b"), undefined, "path");
    const arrPlain = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "path");
    expect(new Set([absKey(arrA), absKey(arrB), absKey(arrPlain)]).size).toBe(3);
  });
});

describe("abs-key: α-rename", () => {
  it("term/pred keys are α-canonical", () => {
    const x = primVar("x", gt(v("x"), tlit(0)));
    const y = primVar("y", gt(v("y"), tlit(0)));
    const renamedX = absKey(x, new Set(), new Map([["x", "α0"]]));
    const renamedY = absKey(y, new Set(), new Map([["y", "α0"]]));
    expect(renamedX).toBe(renamedY);
    expect(absKey(x)).not.toBe(absKey(y));
    expect(termKey(app("+", [v("x"), tlit(1)]), new Map([["x", "α0"]]))).toBe(
      termKey(app("+", [v("y"), tlit(1)]), new Map([["y", "α0"]])),
    );
  });

  it("threads rename into fn slots / tuple elements", () => {
    const fnX = fnv({ slots: { y: { value: primVar("x") } } });
    const fnY = fnv({ slots: { y: { value: primVar("y") } } });
    expect(absKey(fnX, new Set(), new Map([["x", "α0"]]))).toBe(
      absKey(fnY, new Set(), new Map([["y", "α0"]])),
    );
    const tupX = tuple([primVar("x")], { holes: [0] });
    const tupY = tuple([primVar("y")], { holes: [0] });
    expect(absKey(tupX, new Set(), new Map([["x", "α0"]]))).toBe(
      absKey(tupY, new Set(), new Map([["y", "α0"]])),
    );
  });

  it("instantiateMemoKey α-normalizes args + phi", () => {
    const mk = (id: string) =>
      primVar(id, gt(v(id), tlit(0)));
    const a = instantiateMemoKey([mk("x")], eq(v("x"), tlit(1)));
    const b = instantiateMemoKey([mk("y")], eq(v("y"), tlit(1)));
    expect(a.key).toBe(b.key);
    expect(a.varOrder).toEqual(["x"]);
    // 结构差异仍分键（不是把所有键都塌成 α 形）
    const c = instantiateMemoKey([mk("x")], eq(v("x"), tlit(2)));
    expect(a.key).not.toBe(c.key);
  });

  it("renameShape preserves holes / fn slots / optionalParams / ctor (key-level)", () => {
    const inner = primVar("x");
    const tupleBefore: TupleShape = { k: "tuple", elements: [inner], holes: [0] };
    const tupleAfter = renameShape(tupleBefore, new Map([["x", "α7"]])) as TupleShape;
    expect(tupleAfter.holes).toEqual([0]);
    const alphaInner = primVar("α7");
    expect(shapeKey(tupleAfter, new Set())).toBe(
      shapeKey({ k: "tuple", elements: [alphaInner], holes: [0] }, new Set()),
    );

    const fnBefore: FnShape = {
      k: "fn",
      params: ["a"],
      name: "g",
      paramTypes: [inner],
      returnType: inner,
      slots: { s: { value: inner, optional: true, readonly: true } },
      optionalParams: [true],
      ctor: true,
    };
    const fnAfter = renameShape(fnBefore, new Map([["x", "α7"]])) as FnShape;
    expect(fnAfter.optionalParams).toEqual([true]);
    expect(fnAfter.ctor).toBe(true);
    expect(fnAfter.slots!.s).toMatchObject({ optional: true, readonly: true });
    expect(shapeKey(fnAfter, new Set())).toBe(
      shapeKey(
        {
          k: "fn",
          params: ["a"],
          name: "g",
          paramTypes: [alphaInner],
          returnType: alphaInner,
          slots: { s: { value: alphaInner, optional: true, readonly: true } },
          optionalParams: [true],
          ctor: true,
        },
        new Set(),
      ),
    );

    const objBefore: ObjShape = {
      k: "obj",
      slots: {
        a: { value: inner, internal: true },
        b: { value: inner, inherited: true },
        c: { value: inner, symbolKey: true },
      },
      index: { key: inner, value: inner },
      open: true,
    };
    const objAfter = renameShape(objBefore, new Map([["x", "α7"]])) as ObjShape;
    expect(objAfter.slots.a).toMatchObject({ internal: true });
    expect(objAfter.slots.b).toMatchObject({ inherited: true });
    expect(objAfter.slots.c).toMatchObject({ symbolKey: true });
    expect(shapeKey(objAfter, new Set())).toBe(
      shapeKey(
        {
          k: "obj",
          slots: {
            a: { value: alphaInner, internal: true },
            b: { value: alphaInner, inherited: true },
            c: { value: alphaInner, symbolKey: true },
          },
          index: { key: alphaInner, value: alphaInner },
          open: true,
        },
        new Set(),
      ),
    );
  });

  it("renameAbs round-trips through absKey with the inverse rename", () => {
    const src = abs(
      { k: "obj", slots: { n: { value: primVar("x"), readonly: true } } },
      v("x"),
      gt(v("x"), tlit(0)),
      "path",
    );
    const renamed = renameAbs(src, new Map([["x", "α0"]]));
    expect(absKey(renamed, new Set(), new Map([["α0", "x"]]))).toBe(absKey(src));
  });
});

describe("abs-key: canonical structure", () => {
  it("ignores conf and pathNote (value-domain metadata)", () => {
    const a = abs({ k: "prim", type: "number" }, tlit(1), undefined, "exact");
    const b = abs({ k: "prim", type: "number" }, tlit(1), undefined, "partial");
    b.pathNote = "note";
    expect(absKey(a)).toBe(absKey(b));
  });

  it("DAG-shared and cloned equal subtrees share a key", () => {
    const child = numLit(1);
    const shared = obj({ a: { value: child }, b: { value: child } });
    const cloned = obj({ a: { value: numLit(1) }, b: { value: numLit(1) } });
    expect(absKey(shared)).toBe(absKey(cloned));
  });

  it("cyclic graphs terminate with the cycle sentinel", () => {
    const makeCycle = (): Abs => {
      const root = obj({});
      (root.shape as ObjShape).slots.self = { value: root };
      return root;
    };
    const k1 = absKey(makeCycle());
    const k2 = absKey(makeCycle());
    expect(k1).toContain("cycle");
    expect(k1).toBe(k2);
  });

  it("absShapeKey stays structural: impl identity is not in the key", () => {
    const f1 = absFunction(["x"], { apply: () => numLit(1) });
    const f2 = absFunction(["x"], { apply: () => numLit(2) });
    expect(absShapeKey(f1)).toBe(absShapeKey(f2));
    // makeSum 去重键额外带 impl 身份 ⇒ 不同函数体不塌缩
    const s = makeSum(f1, f2);
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);
  });

  it("predKey is commutative for and/or", () => {
    const a = eq(v("x"), tlit(1));
    const b = gt(v("x"), tlit(0));
    expect(predKey({ op: "and", args: [a, b] })).toBe(
      predKey({ op: "and", args: [b, a] }),
    );
  });
});
