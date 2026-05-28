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
      return T.promise(T.array(simplifyUnion(elemTypes)));
    }
    if (args.length > 0 && args[0].kind === "array") {
      return T.promise(args[0].element);
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
      const callbackFn = args[0];
      if (callbackFn && callbackFn.kind === "function") {
        // Call the callback with the resolved value
        const result = callPromiseCallback(callbackFn, promiseValue.value);
        // If result is already a promise, return it; otherwise wrap it
        if (result.kind === "promise") return result;
        return T.promise(result);
      }
      // If no valid callback, return Promise<unknown>
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

function callPromiseCallback(fn: TypeValue & { kind: "function" }, arg: TypeValue): TypeValue {
  // Simple callback invocation - create a minimal environment
  const callEnv = fn.closure.extend({});
  if (fn.params.length > 0) {
    callEnv.bind(fn.params[0], arg);
  }
  // For arrow functions with expression body, we can't easily evaluate
  // Just return unknown for now - the actual evaluation happens in the main evaluator
  return T.unknown;
}
