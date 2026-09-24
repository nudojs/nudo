import { number, fn } from "@nudojs/core";

export const setDelay = fn({ ms: number().gt(0) }, number());
