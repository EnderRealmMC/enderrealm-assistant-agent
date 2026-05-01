import type { Env } from '../types';
import { ToolRegistry } from './registry';
import { McWikiSearchTool } from './mc-wiki-search';
import { McWikiGetPageTool } from './mc-wiki-get-page';

export { ToolRegistry } from './registry';
export { McWikiSearchTool } from './mc-wiki-search';
export { McWikiGetPageTool } from './mc-wiki-get-page';

export function createDefaultRegistry(_env: Env): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new McWikiSearchTool());
  registry.register(new McWikiGetPageTool());
  return registry;
}