import type { Env } from '../types';
import { ToolRegistry } from './registry';
import { McWikiSearchTool } from './mc-wiki-search';
import { McWikiGetPageTool } from './mc-wiki-get-page';
import { ErDocsSearchTool } from './er-docs-search';
import { ErDocsGetDocTool } from './er-docs-get-doc';

export { ToolRegistry } from './registry';
export { McWikiSearchTool } from './mc-wiki-search';
export { McWikiGetPageTool } from './mc-wiki-get-page';
export { ErDocsSearchTool } from './er-docs-search';
export { ErDocsGetDocTool } from './er-docs-get-doc';

export function createDefaultRegistry(_env: Env): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new McWikiSearchTool());
  registry.register(new McWikiGetPageTool());
  registry.register(new ErDocsSearchTool());
  registry.register(new ErDocsGetDocTool());
  return registry;
}