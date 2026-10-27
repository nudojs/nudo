/**
 * BUG-021 / BUG-199：**调用点观测**是一只「点」，不是函数的调用域。
 *
 * `add(1, 2)` 的实参 Abs 是 `lit(1)` / `lit(2)` ⇒ 直接 `joinThenProject` 会把
 * 契约写成「只接受 a === 1 且 b === 2，且只返回 3」⇒ dts 面 `(a: 1, b: 2): 3`、
 * zod 面 `z.literal(3)`、guard 面 `data === 3` ⇒ **合法调用被自己的产物判非法**。
 *
 * ⇒ **单点观测** Abs 进投影器之前先把**字面量 / 收窄谓词**剥到基类型
 * （`number()`）：精度只在 JSDoc 的 `Case:` 见证里保留。多值观测域
 * （`union(lit(1), lit(-2))`）不剥——它是真实观测域（见 `isPointConstraint`）。
 * 与契约面（手写 `lit(...)`）无关——手写契约不走本通道。
 *
 * 必须与 `nudo:interface-drift` 的「今日重算」共用同一实现：写盘侧拓宽、
 * 对账侧不拓宽 ⇒ 每次 `contract --emit` 之后 health 立刻报漂移（永不自愈）。
 */
import { abs as makeAbs, type Abs } from "./abs.ts";
import { derefConstraint, type NudoConstraint } from "./constraint.ts";

/**
 * 「点域」判定：观测集只覆盖**一个点**（无析取成员）。
 *
 * `union(lit(1), lit(-2))` 是多次调用观测到的**真实观测域**，不是点 ⇒ 不得
 * 拓宽（拓宽会把它塌成 `number()`，drift 对账从此看不见域变化）。
 *
 * 写盘（`contract --emit`）与对账（`nudo:interface-drift`）必须用同一条判据，
 * 否则 fresh emit 之后 health 立刻报漂移（BUG-199）。
 */
export function isPointConstraint(
  c: NudoConstraint,
  seen: Set<NudoConstraint> = new Set(),
): boolean {
  if (seen.has(c)) return true;
  seen.add(c);
  const d = derefConstraint(c);
  if (d.members !== undefined) return false;
  if (d.fields !== undefined) {
    return Object.values(d.fields).every((f) => isPointConstraint(f.constraint, seen));
  }
  if (d.element !== undefined) return isPointConstraint(d.element, seen);
  return true;
}

export function widenObservationAbs(a: Abs, seen: Set<Abs> = new Set()): Abs {
  if (seen.has(a)) return a;
  seen.add(a);
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return makeAbs(s, undefined, undefined, a.conf);
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean }> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        slots[k] = {
          value: widenObservationAbs(slot.value, seen),
          ...(slot.optional ? { optional: true } : {}),
        };
      }
      return makeAbs({ k: "obj", slots }, undefined, undefined, a.conf);
    }
    case "arr":
      return makeAbs(
        { k: "arr", element: widenObservationAbs(s.element, seen) },
        undefined,
        undefined,
        a.conf,
      );
    case "tuple":
      return makeAbs(
        {
          k: "tuple",
          elements: s.elements.map((e) => widenObservationAbs(e, seen)),
          ...(s.rest ? { rest: widenObservationAbs(s.rest, seen) } : {}),
          ...(s.holes?.length ? { holes: [...s.holes] } : {}),
        },
        undefined,
        undefined,
        a.conf,
      );
    case "sum":
      return makeAbs(
        { k: "sum", members: s.members.map((m) => widenObservationAbs(m, seen)) },
        undefined,
        undefined,
        a.conf,
      );
    default:
      return a;
  }
}
