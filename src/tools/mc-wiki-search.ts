import type { Tool, Env } from '../types';

const MC_WIKI_API_BASE = 'https://zh.minecraft.wiki/api.php';

interface SearchResult {
  ns: number;
  title: string;
  pageid: number;
  snippet: string;
}

export class McWikiSearchTool implements Tool {
  definition = {
    name: 'mc-wiki-search',
    description:
      '搜索中文 Minecraft Wiki，返回与查询相关的页面列表（标题、页面ID、摘要片段）。适用于查找Minecraft相关的游戏机制、物品、方块、生物、指令等信息。当你需要了解某个Minecraft概念时，先用此工具搜索。',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，如"钻石"、"红石电路"、"凋灵"',
        },
        limit: {
          type: 'number',
          description: '返回结果数量，默认5，最大20',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const query = String(args.query ?? '');
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

    if (!query.trim()) {
      return '错误：搜索关键词不能为空';
    }

    try {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: String(limit),
        srprop: 'snippet',
        format: 'json',
        origin: '*',
      });

      const url = `${MC_WIKI_API_BASE}?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return `错误：MC Wiki 搜索请求失败，HTTP状态码 ${response.status}`;
      }

      const data = await response.json() as {
        query?: { search?: SearchResult[] };
        error?: { info: string };
      };

      if (data.error) {
        return `错误：MC Wiki API 返回错误 - ${data.error.info}`;
      }

      const searchResults = data.query?.search ?? [];

      if (searchResults.length === 0) {
        return `没有找到与"${query}"相关的Minecraft Wiki页面。建议尝试不同的关键词。`;
      }

      const formatted = searchResults
        .map((result, index) => {
          // 去除 snippet 中的 HTML 标签
          const cleanSnippet = result.snippet
            .replace(/<span class="searchmatch">/g, '')
            .replace(/<\/span>/g, '')
            .replace(/\[\[.*?\|/g, '')
            .replace(/\[\[/g, '')
            .replace(/\]\]/g, '');

          return `${index + 1}. 【${result.title}】(pageid: ${result.pageid})\n   ${cleanSnippet}`;
        })
        .join('\n\n');

      return `搜索"${query}"的结果（共${searchResults.length}条）：\n\n${formatted}\n\n提示：使用 mc-wiki-get-page 工具并传入 pageid 可以获取页面完整内容。`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：搜索时发生异常 - ${message}`;
    }
  }
}