import type { Tool, ToolDefinition, Env } from '../types';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.definition);
  }

  /**
   * 生成工具描述文本，用于注入 system prompt
   */
  getToolDescriptionsForPrompt(): string {
    const tools = Array.from(this.tools.values());
    if (tools.length === 0) {
      return '当前没有可用工具。';
    }

    return tools
      .map(tool => {
        const params = Object.entries(tool.definition.parameters.properties)
          .map(([key, schema]) => {
            const required = tool.definition.parameters.required.includes(key) ? '(必填)' : '(可选)';
            const enumInfo = schema.enum ? `，可选值: ${schema.enum.join(' | ')}` : '';
            return `  - ${key} ${required}: ${schema.type}${enumInfo} - ${schema.description}`;
          })
          .join('\n');

        return `### ${tool.definition.name}\n${tool.definition.description}\n参数:\n${params}`;
      })
      .join('\n\n');
  }
}

export function createDefaultRegistry(_env: Env): ToolRegistry {
  // Will be populated in index.ts after importing tools
  const registry = new ToolRegistry();
  return registry;
}