/**
 * LSP-G8 / Docusaurus v4 prep: upstream may relocate
 * `CodeBlock/Content/String` → `CodeBlock/String`.
 * This shim keeps one import path for the rest of the swizzle.
 * Resolves to upstream theme-classic (no local Content/ copy is kept).
 */
export { default } from '@theme/CodeBlock/Content/String';
