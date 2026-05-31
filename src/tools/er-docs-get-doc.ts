import type { Tool, Env } from '../types';

const DOCS_BASE_URL = 'https://docs.enderrealm.cn';
const MAX_CONTENT_LENGTH = 8000;

export class ErDocsGetDocTool implements Tool {
  definition = {
    name: 'er-docs-get-doc',
    description:
      '获取 EnderRealm 服务器文档的完整内容。当 er-docs-search 返回相关条目后，使用此工具通过 path 获取文档的 Markdown 原文。',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: '文档路径（从 er-docs-search 结果中获取），如 "/协议与政策/EnderRealm基本章程.md" 或 "圣经"',
        },
      },
      required: ['path'],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const rawPath = String(args.path ?? '');

    if (!rawPath.trim()) {
      return '错误：path 不能为空';
    }

    // Clean path: remove leading/trailing slashes, add .md if missing
    let cleanPath = rawPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath.endsWith('.md')) {
      cleanPath += '.md';
    }

    if (!cleanPath) {
      return '错误：path 无效';
    }

    // URL encode the path for Chinese characters
    const encodedPath = cleanPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const url = `${DOCS_BASE_URL}/${encodedPath}`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
          'Accept': 'text/plain',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return `错误：文档不存在 (path: ${rawPath})。请检查路径是否正确。`;
        }
        return `错误：获取文档失败，HTTP状态码 ${response.status}`;
      }

      const content = await response.text();

      if (!content.trim()) {
        return `错误：文档内容为空 (path: ${rawPath})`;
      }

      // Truncate if too long
      const truncated = content.length > MAX_CONTENT_LENGTH
        ? content.substring(0, MAX_CONTENT_LENGTH) + '\n\n...(内容过长，已截断)'
        : content;

      return `文档: ${cleanPath}\n\n${truncated}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：获取文档时发生异常 - ${message}`;
    }
  }
}
