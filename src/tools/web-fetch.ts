import type { Tool, Env } from '../types';

const DEFAULT_MAX_LENGTH = 8000;
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
const REQUEST_TIMEOUT = 10000; // 10秒

export class WebFetchTool implements Tool {
  definition = {
    name: 'web-fetch',
    description:
      '获取指定 URL 的网页或 API 内容。支持 GET/POST/PUT/DELETE 等方法，可传入请求头和请求体。适用于：获取搜索结果详情、调用 API、抓取网页内容等。',
    parameters: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: '目标 URL（必填），如 "https://example.com/api/data"',
        },
        method: {
          type: 'string',
          description: 'HTTP 方法，默认 GET',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        },
        headers: {
          type: 'string',
          description: '自定义请求头，JSON 格式，如 \'{"Authorization": "Bearer xxx"}\'',
        },
        body: {
          type: 'string',
          description: '请求体内容（POST/PUT/PATCH 时使用），可以是 JSON 字符串或其他格式',
        },
        max_length: {
          type: 'number',
          description: '返回内容最大长度，默认 8000 字符',
        },
      },
      required: ['url'],
    },
  };

  async execute(args: Record<string, unknown>, _env: Env): Promise<string> {
    const url = String(args.url ?? '');
    const method = String(args.method ?? 'GET').toUpperCase();
    const maxLength = Math.min(Math.max(Number(args.max_length) || DEFAULT_MAX_LENGTH, 1000), 50000);

    // 验证 URL
    if (!url.trim()) {
      return '错误：URL 不能为空';
    }

    try {
      new URL(url);
    } catch {
      return '错误：无效的 URL 格式';
    }

    // 解析请求头
    let customHeaders: Record<string, string> = {};
    if (args.headers) {
      try {
        customHeaders = JSON.parse(String(args.headers));
      } catch {
        return '错误：请求头格式无效，需要 JSON 格式';
      }
    }

    // 构建请求选项
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...customHeaders,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    };

    // 添加请求体（仅对支持 body 的方法）
    if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = String(args.body);
      // 如果没有指定 Content-Type，自动检测
      if (!customHeaders['Content-Type'] && !customHeaders['content-type']) {
        try {
          JSON.parse(String(args.body));
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
        } catch {
          (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'text/plain';
        }
      }
    }

    try {
      console.log(`[WebFetch] ${method} ${url}`);
      const response = await fetch(url, fetchOptions);

      // 检查响应大小
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        return `错误：响应内容过大（${Math.round(parseInt(contentLength) / 1024)}KB），超过 1MB 限制`;
      }

      // 获取响应内容
      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('application/json')) {
        // JSON 响应，格式化输出
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        // 其他格式，作为文本处理
        const text = await response.text();
        if (text.length > MAX_RESPONSE_SIZE) {
          content = text.substring(0, MAX_RESPONSE_SIZE) + '\n\n...(内容过大，已截断)';
        } else if (contentType.includes('text/html')) {
          // HTML 转纯文本
          content = this.htmlToPlainText(text);
        } else {
          content = text;
        }
      }

      // 截断到指定长度
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n...(内容过长，已截断)';
      }

      // 构建响应头信息
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result = [
        `状态码: ${response.status} ${response.statusText}`,
        `Content-Type: ${contentType}`,
        `内容长度: ${content.length} 字符`,
        '',
        '--- 内容 ---',
        '',
        content,
      ].join('\n');

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          return `错误：请求超时（${REQUEST_TIMEOUT / 1000}秒）`;
        }
        if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
          return '错误：网络请求失败，可能是域名不存在或无法访问';
        }
        return `错误：${error.message}`;
      }
      return '错误：未知错误';
    }
  }

  /**
   * 将 HTML 转换为可读的纯文本
   */
  private htmlToPlainText(html: string): string {
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
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, _href, linkText) => {
      const cleanText = linkText.replace(/<[^>]*>/g, '');
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
}
