import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({}) }, string());
