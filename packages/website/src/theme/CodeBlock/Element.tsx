/**
 * LSP-G8 / Docusaurus v4 prep: upstream may relocate
 * `CodeBlock/Content/Element` → `CodeBlock/Element`.
 * This shim keeps one import path for the rest of the swizzle.
 */
export { default } from './Content/Element';
export type { Props } from '@theme/CodeBlock/Content/Element';
