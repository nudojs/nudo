import { type TypeValue } from "@nudojs/core";
import { PROMISE_STATIC_METHODS } from "./builtin-promise.ts";

export const ALL_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  Promise: PROMISE_STATIC_METHODS,
};
