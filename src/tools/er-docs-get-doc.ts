import type { Tool, Env } from '../types';

const DOCS_BASE_URL = 'https://docs.enderrealm.cn/docs';
const MAX_CONTENT_LENGTH = 8000;

/**
 * Manual redirect-following fetch for environments where default redirect
 * handling may cause infinite loops (e.g., EdgeOne Pages in Workers runtime).
 */
async function fetchWithRedirects(url: string, headers: Record<string, string>, maxRedirects = 5): Promise<Response> {
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
    });

    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`重定向响应缺少 Location 头 (HTTP ${response.status})`);
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    return response;
  }

  throw new Error(`获取文档失败：重定向次数超过 ${maxRedirects} 次限制`);
}

export class ErDocsGetDocTool implements Tool {
  definition = {
    name: 'er-docs-get-doc',
    description:
      '获取 EnderRealm 服务器文档的完整内容。当 er-docs-search 返回相关条目后，使用此工具通过 locale 和 slug 获取文档的 Markdown 原文。',
    parameters: {
      type: 'object' as const,
      properties: {
        locale: {
          type: 'string',
          description: '文档语言，如 "zh-CN"、"en-US"',
        },
        slug: {
          type: 'string',
          description: '文档路径标识（从 er-docs-search 结果中获取），如 "common/history"、"smp/rules"',
        },
      },
      required: ['locale', 'slug'],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const locale = String(args.locale ?? '');
    const slug = String(args.slug ?? '');

    if (!locale.trim() || !slug.trim()) {
      return '错误：locale 和 slug 不能为空';
    }

    // Clean slug: remove leading/trailing slashes, remove .md suffix if present
    const cleanSlug = slug.replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '');

    if (!cleanSlug) {
      return '错误：slug 无效';
    }

    // Build URL: https://docs.enderrealm.cn/docs/{locale}/{slug}.md
    const url = `${DOCS_BASE_URL}/${locale}/${cleanSlug}.md`;

    try {
      const response = await fetchWithRedirects(url, {
        'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
        'Accept': 'text/plain',
      });

      if (!response.ok) {
        if (response.status === 404) {
          return `错误：文档不存在 (locale: ${locale}, slug: ${cleanSlug})。请检查 locale 和 slug 是否正确。`;
        }
        return `错误：获取文档失败，HTTP状态码 ${response.status}`;
      }

      const content = await response.text();

      if (!content.trim()) {
        return `错误：文档内容为空 (locale: ${locale}, slug: ${cleanSlug})`;
      }

      // Truncate if too long
      const truncated = content.length > MAX_CONTENT_LENGTH
        ? content.substring(0, MAX_CONTENT_LENGTH) + '\n\n...(内容过长，已截断)'
        : content;

      return `文档: ${cleanSlug} (locale: ${locale})\n\n${truncated}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：获取文档时发生异常 - ${message}`;
    }
  }
}