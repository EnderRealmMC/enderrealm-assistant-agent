import type { Env } from '../types';
import { ToolRegistry } from './registry';
import { McWikiSearchTool } from './mc-wiki-search';
import { McWikiGetPageTool } from './mc-wiki-get-page';
import { ErDocsSearchTool } from './er-docs-search';
import { ErDocsGetDocTool } from './er-docs-get-doc';
import { McServerStatusTool } from './mc-server-status';
import { WebSearchTool } from './web-search';
import { WebFetchTool } from './web-fetch';

export { ToolRegistry } from './registry';
export { McWikiSearchTool } from './mc-wiki-search';
export { McWikiGetPageTool } from './mc-wiki-get-page';
export { ErDocsSearchTool } from './er-docs-search';
export { ErDocsGetDocTool } from './er-docs-get-doc';
export { McServerStatusTool } from './mc-server-status';
export { WebSearchTool } from './web-search';
export { WebFetchTool } from './web-fetch';

export function createDefaultRegistry(_env: Env): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new McWikiSearchTool());
  registry.register(new McWikiGetPageTool());
  registry.register(new ErDocsSearchTool());
  registry.register(new ErDocsGetDocTool());
  registry.register(new McServerStatusTool());
  registry.register(new WebSearchTool());
  registry.register(new WebFetchTool());
  return registry;
}