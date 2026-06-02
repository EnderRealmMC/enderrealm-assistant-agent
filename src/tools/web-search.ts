import type { Tool, Env } from '../types';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

interface BraveResponse {
  web?: {
    results?: BraveResult[];
  };
}

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 通用 Web 搜索工具
 *
 * 支持多个搜索源自动降级：
 * 1. Tavily（优先级最高，专为 AI 优化）
 * 2. Brave Search（高质量，免费 2000次/月）
 * 3. DuckDuckGo（免费兜底，无需 API Key）
 */
export class WebSearchTool implements Tool {
  definition = {
    name: 'web-search',
    description:
      '搜索互联网获取通用信息。适用于：技术问题、编程问题、非 Minecraft 相关问题等。注意：Minecraft 相关内容必须使用 mc-wiki-search，EnderRealm 服务器文档必须使用 er-docs-search，不要用此工具搜索游戏相关内容。',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，如"Minecraft 1.21 更新内容"、"我的世界 最新版本"',
        },
        limit: {
          type: 'number',
          description: '返回结果数量，默认5，最大10',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, env: Env): Promise<string> {
    const query = String(args.query ?? '');
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);

    if (!query.trim()) {
      return '错误：搜索关键词不能为空';
    }

    // 优先级 1: Tavily
    if (env.TAVILY_API_KEY) {
      try {
        const result = await this.searchTavily(query, limit, env.TAVILY_API_KEY);
        if (result) {
          console.log(`[WebSearch] Tavily succeeded for query: ${query}`);
          return result;
        }
      } catch (e) {
        console.warn('[WebSearch] Tavily failed, trying Brave...', e);
      }
    }

    // 优先级 2: Brave Search
    if (env.BRAVE_API_KEY) {
      try {
        const result = await this.searchBrave(query, limit, env.BRAVE_API_KEY);
        if (result) {
          console.log(`[WebSearch] Brave succeeded for query: ${query}`);
          return result;
        }
      } catch (e) {
        console.warn('[WebSearch] Brave failed, trying DuckDuckGo...', e);
      }
    }

    // 优先级 3: DuckDuckGo (免费兜底)
    try {
      const result = await this.searchDuckDuckGo(query, limit);
      if (result) {
        console.log(`[WebSearch] DuckDuckGo succeeded for query: ${query}`);
        return result;
      }
    } catch (e) {
      console.warn('[WebSearch] DuckDuckGo also failed', e);
    }

    return '错误：所有搜索源都失败了，请稍后再试。建议尝试更具体的关键词或直接查阅相关文档。';
  }

  /**
   * Tavily 搜索
   * 专为 AI 优化，返回内容已经过清洗
   */
  private async searchTavily(query: string, limit: number, apiKey: string): Promise<string | null> {
    console.log(`[WebSearch] Trying Tavily for query: ${query}`);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: limit,
        include_answer: true,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[WebSearch] Tavily HTTP error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = (await response.json()) as TavilyResponse;

    if (!data.results?.length) {
      return null;
    }

    let output = `搜索"${query}"的结果（来源: Tavily）：\n\n`;

    if (data.answer) {
      output += `📝 摘要：${data.answer}\n\n`;
    }

    output += data.results
      .map((r, i) => {
        const snippet = r.content.length > 200 ? r.content.substring(0, 200) + '...' : r.content;
        return `${i + 1}. 【${r.title}】\n   ${r.url}\n   ${snippet}`;
      })
      .join('\n\n');

    return output;
  }

  /**
   * Brave Search 搜索
   * 高质量搜索结果，免费 2000次/月
   */
  private async searchBrave(query: string, limit: number, apiKey: string): Promise<string | null> {
    const params = new URLSearchParams({
      q: query,
      count: String(limit),
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      console.warn(`[WebSearch] Brave HTTP error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as BraveResponse;

    if (!data.web?.results?.length) {
      return null;
    }

    return `搜索"${query}"的结果（来源: Brave）：\n\n` +
      data.web.results
        .map((r, i) => `${i + 1}. 【${r.title}】\n   ${r.url}\n   ${r.description}`)
        .join('\n\n');
  }

  /**
   * DuckDuckGo 搜索（免费兜底）
   * 使用 HTML 版本，无需 API Key
   */
  private async searchDuckDuckGo(query: string, limit: number): Promise<string | null> {
    const params = new URLSearchParams({
      q: query,
      kl: 'cn-zh', // 中文结果
    });

    const response = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      headers: {
        'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
      },
    });

    if (!response.ok) {
      console.warn(`[WebSearch] DuckDuckGo HTTP error: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const results = this.parseDuckDuckGoHtml(html, limit);

    if (!results.length) {
      return null;
    }

    return `搜索"${query}"的结果（来源: DuckDuckGo）：\n\n` +
      results
        .map((r, i) => `${i + 1}. 【${r.title}】\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');
  }

  /**
   * 解析 DuckDuckGo HTML 搜索结果
   */
  private parseDuckDuckGoHtml(html: string, limit: number): DuckDuckGoResult[] {
    const results: DuckDuckGoResult[] = [];

    // DuckDuckGo HTML 结果的正则解析
    // 匹配 result__a (标题和链接) 和 result__snippet (摘要)
    const resultBlocks = html.split('result__body');

    for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
      const block = resultBlocks[i];

      // 提取链接
      const linkMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) continue;

      const url = this.decodeDuckDuckGoUrl(linkMatch[1]);
      const title = this.stripHtml(linkMatch[2]).trim();

      // 提取摘要
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]).trim() : '';

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    return results;
  }

  /**
   * 解码 DuckDuckGo 的重定向 URL
   */
  private decodeDuckDuckGoUrl(ddgUrl: string): string {
    try {
      // DuckDuckGo URL 格式: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
      const urlMatch = ddgUrl.match(/uddg=([^&]+)/);
      if (urlMatch) {
        return decodeURIComponent(urlMatch[1]);
      }
      return ddgUrl;
    } catch {
      return ddgUrl;
    }
  }

  /**
   * 移除 HTML 标签
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
