import type { Tool, Env } from '../types';

const MC_WIKI_API_BASE = 'https://zh.minecraft.wiki/api.php';
const MAX_CONTENT_LENGTH = 8000;

export class McWikiGetPageTool implements Tool {
  definition = {
    name: 'mc-wiki-get-page',
    description:
      '获取中文 Minecraft Wiki 的具体页面内容。当 mc-wiki-search 返回相关页面后，使用此工具获取页面的详细信息。pageid 和 title 至少提供一个，优先使用 pageid。',
    parameters: {
      type: 'object' as const,
      properties: {
        pageid: {
          type: 'number',
          description: '页面的数字ID（从 mc-wiki-search 结果中获取）',
        },
        title: {
          type: 'string',
          description: '页面标题（pageid 和 title 至少提供一个）',
        },
      },
      required: [],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const pageid = args.pageid != null ? Number(args.pageid) : undefined;
    const title = args.title != null ? String(args.title) : undefined;

    if (pageid == null && !title) {
      return '错误：pageid 和 title 至少提供一个';
    }

    try {
      const params: Record<string, string> = {
        action: 'parse',
        prop: 'text',
        format: 'json',
        origin: '*',
        disabletoc: '1',
        disablelimitreport: '1',
        disableeditsection: '1',
      };

      if (pageid != null && !isNaN(pageid)) {
        params.pageid = String(pageid);
      } else if (title) {
        params.page = title;
      }

      const url = `${MC_WIKI_API_BASE}?${new URLSearchParams(params).toString()}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return `错误：MC Wiki 页面获取请求失败，HTTP状态码 ${response.status}`;
      }

      const data = await response.json() as {
        parse?: {
          title?: string;
          pageid?: number;
          text?: { ['*']?: string };
        };
        error?: { info: string };
      };

      if (data.error) {
        return `错误：MC Wiki API 返回错误 - ${data.error.info}`;
      }

      if (!data.parse?.text?.['*']) {
        return '错误：页面内容为空或页面不存在';
      }

      const pageTitle = data.parse.title ?? '';
      const pageId = data.parse.pageid ?? pageid ?? 0;
      const htmlContent = data.parse.text['*'];
      const plainText = htmlToPlainText(htmlContent);

      // 截断超长内容
      const truncated = plainText.length > MAX_CONTENT_LENGTH
        ? plainText.substring(0, MAX_CONTENT_LENGTH) + '\n\n...(内容过长，已截断)'
        : plainText;

      return `页面: ${pageTitle} (pageid: ${pageId})\n\n${truncated}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：获取页面时发生异常 - ${message}`;
    }
  }
}

/**
 * 将 HTML 内容转换为可读的纯文本
 */
function htmlToPlainText(html: string): string {
  let text = html;

  // 移除 <style> 和 <script> 块
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 将常见块级元素转为换行
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/tr>/gi, '\n');

  // 处理列表项前缀
  text = text.replace(/<li[^>]*>/gi, '• ');

  // 处理标题标记
  text = text.replace(/<h[1-6][^>]*>/gi, (match) => {
    const level = match.match(/h(\d)/)?.[1] ?? '3';
    const hashes = '#'.repeat(Number(level));
    return `${hashes} `;
  });

  // 提取链接文本
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const cleanText = linkText.replace(/<[^>]*>/g, '');
    if (href.startsWith('/') || href.startsWith('http')) {
      return cleanText;
    }
    return cleanText;
  });

  // 移除所有剩余 HTML 标签
  text = text.replace(/<[^>]*>/g, '');

  // 解码常见 HTML 实体
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&ndash;/g, '–');

  // 清理多余空白
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}