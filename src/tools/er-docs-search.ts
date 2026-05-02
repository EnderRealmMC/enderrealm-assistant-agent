import type { Tool, Env } from '../types';

const SEARCH_INDEX_URL = 'https://raw.githubusercontent.com/EnderRealmMC/EnderRealm-DOCS/main/docs/search-index.json';
const CACHE_KEY = 'er-docs-search-index';
const CACHE_TTL = 86400; // 24 hours in seconds
const SNIPPET_LENGTH = 300;

interface DocEntry {
  locale: string;
  slug: string;
  title: string;
  content: string;
}

interface SearchIndex {
  entries: DocEntry[];
}

async function getSearchIndex(env: Env): Promise<DocEntry[]> {
  // Try KV cache first
  const cached = await env.SESSIONS.get(CACHE_KEY, 'json');
  if (cached) {
    return (cached as SearchIndex).entries;
  }

  // Fetch from GitHub raw (no redirect issues in Workers runtime)
  const response = await fetch(SEARCH_INDEX_URL, {
    headers: {
      'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`获取文档索引失败，HTTP状态码 ${response.status}`);
  }

  const data = await response.json() as SearchIndex;

  // Cache in KV with 24h TTL
  await env.SESSIONS.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL });

  return data.entries;
}

export class ErDocsSearchTool implements Tool {
  definition = {
    name: 'er-docs-search',
    description:
      '搜索 EnderRealm 服务器文档，返回与关键词匹配的文档条目（标题、语言、slug、内容摘要）。适用于查找服务器相关信息，如服务器规则、小游戏列表、历史沿革、玩家守则等。',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，如"服务器规则"、"小游戏"、"历史"',
        },
        locale: {
          type: 'string',
          description: '语言过滤，如 "zh-CN"、"en-US"。不传则搜索所有语言',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, env: Env): Promise<string> {
    const query = String(args.query ?? '');
    const locale = args.locale != null ? String(args.locale) : undefined;

    if (!query.trim()) {
      return '错误：搜索关键词不能为空';
    }

    try {
      const entries = await getSearchIndex(env);

      // Filter by locale if specified
      const filtered = locale
        ? entries.filter(e => e.locale === locale)
        : entries;

      // Case-insensitive keyword matching on title and content
      const q = query.toLowerCase();
      const matches = filtered.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q)
      );

      if (matches.length === 0) {
        return `没有找到与"${query}"相关的 EnderRealm 文档。建议尝试不同的关键词。`;
      }

      const formatted = matches
        .map((entry, index) => {
          const snippet = entry.content.length > SNIPPET_LENGTH
            ? entry.content.substring(0, SNIPPET_LENGTH) + '...'
            : entry.content;
          return `${index + 1}. 【${entry.locale}】${entry.title}\n   slug: ${entry.slug}\n   摘要: ${snippet}`;
        })
        .join('\n\n');

      return `搜索"${query}"在 EnderRealm 文档中找到 ${matches.length} 条结果：\n\n${formatted}\n\n提示：使用 er-docs-get-doc 工具并传入 locale 和 slug 可以获取文档完整内容。`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：搜索时发生异常 - ${message}`;
    }
  }
}