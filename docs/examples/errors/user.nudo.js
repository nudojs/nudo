import { fn, shape, number, string } from "@nudojs/core";

export const user = shape({ id: number(), name: string() });
export const greet = fn({ u: user }, string());
