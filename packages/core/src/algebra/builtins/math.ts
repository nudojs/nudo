/**
 * Math.* — 字面量可折叠的返回精确值，否则 number
 */
import type { Abs } from "../abs.ts";
import { litValue, numLit } from "../abs.ts";
import { numPrim } from "./shared.ts";

export function evalMathMethod(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0] ? litValue(args[0]) : undefined;
  const a1 = args[1] ? litValue(args[1]) : undefined;
  switch (name) {
    case "abs":
      if (typeof a0 === "number") return numLit(Math.abs(a0));
      return numPrim();
    case "floor":
      if (typeof a0 === "number") return numLit(Math.floor(a0));
      return numPrim();
    case "ceil":
      if (typeof a0 === "number") return numLit(Math.ceil(a0));
      return numPrim();
    case "round":
      if (typeof a0 === "number") return numLit(Math.round(a0));
      return numPrim();
    case "random":
      return numPrim("path");
    case "sqrt":
      if (typeof a0 === "number") return numLit(Math.sqrt(a0));
      return numPrim();
    case "min": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.min(...(lits as number[])));
      }
      return numPrim();
    }
    case "max": {
      const lits = args.map(litValue);
      if (lits.length > 0 && lits.every((x) => typeof x === "number")) {
        return numLit(Math.max(...(lits as number[])));
      }
      return numPrim();
    }
    case "pow":
      if (typeof a0 === "number" && typeof a1 === "number") return numLit(Math.pow(a0, a1));
      return numPrim();
    case "sign":
      if (typeof a0 === "number") return numLit(Math.sign(a0));
      return numPrim();
    case "atan2":
      if (typeof a0 === "number" && typeof a1 === "number") {
        return numLit(Math.atan2(a0, a1));
      }
      return numPrim();
    default:
      return undefined;
  }
}
