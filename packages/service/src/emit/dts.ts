/**
 * `@nudojs/service/emit` extensional projections (`nudo export` face).
 *
 * One-way, lossy renderings of Abs: TypeScript `.d.ts`, schema source
 * (zod dialect), Standard Schema modules, and runtime guards. Nothing
 * reads a projection back into Abs.
 */
export {
  generateDts,
  generateFunctionDtsLines,
  absToTSType,
} from "./dts-generator.ts";

export {
  absToSchemaSource,
  absToSchemaNode,
  absToZodSchemaModule,
  constraintToSchemaNode,
  projectAbsToSchema,
  schemaNodeToZod,
  type SchemaDialect,
  type SchemaNode,
  type SchemaProjection,
  type SchemaRefinement,
  type ZodModuleProjection,
} from "./schema-generator.ts";

export {
  absToStandardSchema,
  absToStandardSchemaModule,
  validateSchemaNode,
  type StandardSchemaIssue,
  type StandardSchemaModuleProjection,
  type StandardSchemaResult,
} from "./standard-schema.ts";

export {
  generateGuardFunction,
  generateGuardFunctionFromAbs,
} from "./guard-generator.ts";
