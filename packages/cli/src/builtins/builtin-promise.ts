import { type TypeValue, T, simplifyUnion } from "@nudojs/core";

export const PROMISE_STATIC_METHODS: Record<string, TypeValue> = {
  resolve: T.unknown,
  reject: T.never,
  all: T.unknown,
  race: T.unknown,
  allSettled: T.unknown,
  any: T.unknown,
};

export function evaluatePromiseStaticMethod(
  methodName: string,
  args: TypeValue[],
): TypeValue | null {
  if (methodName === "resolve") {
    if (args.length > 0) return T.promise(args[0]);
    return T.promise(T.undefined);
  }

  if (methodName === "reject") {
    return T.promise(T.never);
  }

  if (methodName === "all") {
    if (args.length > 0 && args[0].kind === "tuple") {
      const elemTypes = args[0].elements.map((e: TypeValue) => {
        if (e.kind === "promise") return e.value;
        return T.unknown;
      });
      return T.promise(T.tuple(elemTypes));
    }
    if (args.length > 0 && args[0].kind === "array") {
      return T.promise(T.array(args[0].element));
    }
    return T.promise(T.array(T.unknown));
  }

  if (methodName === "race") {
    if (args.length > 0 && args[0].kind === "tuple") {
      const elemTypes = args[0].elements.map((e: TypeValue) => {
        if (e.kind === "promise") return e.value;
        return T.unknown;
      });
      return T.promise(simplifyUnion(elemTypes));
    }
    if (args.length > 0 && args[0].kind === "array") {
      const el = args[0].element;
      return T.promise(el.kind === "promise" ? el.value : T.unknown);
    }
    return T.promise(T.unknown);
  }

  if (methodName === "allSettled") {
    // Best effort: each slot settles to { status, value } — the fulfilled
    // value is the element's promise payload (unknown for non-promises).
    const settledOf = (e: TypeValue): TypeValue =>
      T.object({
        status: T.union(T.literal("fulfilled"), T.literal("rejected")),
        value: e.kind === "promise" ? e.value : T.unknown,
      });
    if (args.length > 0 && args[0].kind === "tuple") {
      return T.promise(T.tuple(args[0].elements.map(settledOf)));
    }
    if (args.length > 0 && args[0].kind === "array") {
      return T.promise(T.array(settledOf(args[0].element)));
    }
    return T.promise(T.array(T.unknown));
  }

  if (methodName === "any") {
    if (args.length > 0 && args[0].kind === "tuple") {
      const elemTypes = args[0].elements.map((e: TypeValue) => {
        if (e.kind === "promise") return e.value;
        return T.unknown;
      });
      return T.promise(simplifyUnion(elemTypes));
    }
    if (args.length > 0 && args[0].kind === "array") {
      const el = args[0].element;
      return T.promise(el.kind === "promise" ? el.value : T.unknown);
    }
    return T.promise(T.unknown);
  }

  return null;
}

export function evaluatePromiseInstanceMethod(
  promiseValue: TypeValue,
  methodName: string,
  args: TypeValue[],
): TypeValue | null {
  if (methodName === "then") {
    if (promiseValue.kind === "promise") {
      // A real function callback is executed by the evaluator's main call
      // path (applyPromiseThenCallback) before reaching here; only
      // non-callable handlers fall through to an unresolved value type.
      return T.promise(T.unknown);
    }
  }

  if (methodName === "catch") {
    if (promiseValue.kind === "promise") {
      return promiseValue; // catch returns same promise type
    }
  }

  if (methodName === "finally") {
    if (promiseValue.kind === "promise") {
      return promiseValue; // finally returns same promise type
    }
  }

  return null;
}
