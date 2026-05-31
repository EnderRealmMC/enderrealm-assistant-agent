import type { Tool, Env } from '../types';

const LLMS_FULL_TXT_URL = 'https://docs.enderrealm.cn/llms-full.txt';
const CACHE_KEY = 'er-docs-llms-full-index';
const CACHE_TTL = 10800; // 3 hours in seconds

// Snippet extraction config
const SNIPPET_RADIUS = 50; // characters before/after keyword
const MAX_SNIPPETS_PER_ENTRY = 3;
const MAX_TOTAL_SNIPPET_LENGTH = 300;

interface DocEntry {
  title: string;
  path: string;
  content: string;
}

/**
 * 解析 llms-full.txt 格式
 * 格式：每篇文档以 --- 分隔，头部包含 url: <path>
 *
 * 示例：
 * ---
 * url: /协议与政策/EnderRealm基本章程.md
 * ---
 * [完整正文...]
 */
function parseLlmsFullTxt(content: string): DocEntry[] {
  const entries: DocEntry[] = [];
  // Split on "---url:" boundary pattern
  // Each section starts with: ---\nurl: <path>\n---\n
  const sections = content.split(/\n---\s*\n/);

  for (const section of sections) {
    // Match the url header: url: /some/path.md
    const urlMatch = section.match(/^url:\s*(\/[^\n]+)\n/);
    if (!urlMatch) continue;

    const path = urlMatch[1].trim();
    // Content starts after the url line
    const bodyStart = section.indexOf('\n', urlMatch[0].length) + 1;
    const body = bodyStart > 0 ? section.substring(bodyStart).trim() : '';

    if (!body) continue;

    // Extract title from first # heading
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : path.split('/').pop()?.replace(/\.md$/i, '') ?? path;

    entries.push({ title, path, content: body });
  }

  return entries;
}

/**
 * 从正文内容中提取关键词上下文片段
 * 以关键词出现位置为中心，取前后各 radius 个字符
 */
function extractSnippets(content: string, keywords: string[], radius = SNIPPET_RADIUS): string {
  const lowerContent = content.toLowerCase();
  const positions: number[] = [];

  // Find all keyword occurrence positions
  for (const kw of keywords) {
    const lowerKw = kw.toLowerCase();
    let pos = 0;
    while (true) {
      const idx = lowerContent.indexOf(lowerKw, pos);
      if (idx === -1) break;
      positions.push(idx);
      pos = idx + 1;
    }
  }

  if (positions.length === 0) {
    // Fallback: return beginning of content
    const fallback = content.substring(0, MAX_TOTAL_SNIPPET_LENGTH);
    return fallback.length < content.length ? fallback + '...' : fallback;
  }

  // Sort positions
  positions.sort((a, b) => a - b);

  // Merge overlapping intervals [pos-radius, pos+kw.length+radius)
  const kwMaxLen = Math.max(...keywords.map(k => k.length));
  type Interval = { start: number; end: number };
  const intervals: Interval[] = [];

  for (const pos of positions) {
    const start = Math.max(0, pos - radius);
    const end = Math.min(content.length, pos + kwMaxLen + radius);
    if (intervals.length > 0 && start <= intervals[intervals.length - 1].end) {
      // Merge with previous interval
      intervals[intervals.length - 1].end = end;
    } else {
      intervals.push({ start, end });
    }
  }

  // Take up to MAX_SNIPPETS_PER_ENTRY intervals
  const selectedIntervals = intervals.slice(0, MAX_SNIPPETS_PER_ENTRY);

  // Build snippet string with "..." between intervals
  let totalLength = 0;
  const parts: string[] = [];
  for (const interval of selectedIntervals) {
    let snippet = content.substring(interval.start, interval.end);
    // Add ellipsis markers
    if (interval.start > 0) snippet = '...' + snippet;
    if (interval.end < content.length) snippet = snippet + '...';

    if (totalLength + snippet.length > MAX_TOTAL_SNIPPET_LENGTH) {
      // Truncate to fit
      const remaining = MAX_TOTAL_SNIPPET_LENGTH - totalLength;
      if (remaining > 10) {
        snippet = snippet.substring(0, remaining) + '...';
        parts.push(snippet);
      }
      break;
    }

    parts.push(snippet);
    totalLength += snippet.length;
  }

  return parts.join('\n');
}

async function getLlmsFullIndex(env: Env): Promise<DocEntry[]> {
  // Try KV cache first
  const cached = await env.SESSIONS.get(CACHE_KEY, 'text');
  if (cached) {
    return parseLlmsFullTxt(cached);
  }

  // Fetch from production docs site
  const response = await fetch(LLMS_FULL_TXT_URL, {
    headers: {
      'User-Agent': 'EnderRealmBot/1.0 (https://github.com/EnderRealmMC/enderrealm-assistant-agent)',
      'Accept': 'text/plain',
    },
  });

  if (!response.ok) {
    throw new Error(`获取文档索引失败，HTTP状态码 ${response.status}`);
  }

  const content = await response.text();

  // Cache in KV with 3h TTL
  await env.SESSIONS.put(CACHE_KEY, content, { expirationTtl: CACHE_TTL });

  return parseLlmsFullTxt(content);
}

export class ErDocsSearchTool implements Tool {
  definition = {
    name: 'er-docs-search',
    description:
      '搜索 EnderRealm 服务器文档，返回与关键词匹配的文档条目（标题、路径、上下文摘要）。支持多关键词搜索，空格分隔，按匹配关键词数量排序。适用于查找服务器相关信息，如服务器规则、玩家守则、历史沿革等。',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，多个关键词用空格分隔，如"规则 玩家"、"隐私 数据"',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>, env: Env): Promise<string> {
    const query = String(args.query ?? '');

    if (!query.trim()) {
      return '错误：搜索关键词不能为空';
    }

    // Split query into keywords (space-separated, OR logic, sorted by match count)
    const keywords = query.trim().split(/\s+/).filter(k => k.length > 0);

    if (keywords.length === 0) {
      return '错误：搜索关键词不能为空';
    }

    try {
      const entries = await getLlmsFullIndex(env);

      // Case-insensitive keyword matching on title and content
      // OR logic: match if ANY keyword hits
      // Score: count of distinct keywords that match
      type MatchEntry = DocEntry & { matchCount: number; matchedKeywords: string[] };

      const matches: MatchEntry[] = [];

      for (const entry of entries) {
        const lowerTitle = entry.title.toLowerCase();
        const lowerContent = entry.content.toLowerCase();
        const matchedKeywords: string[] = [];

        for (const kw of keywords) {
          const lowerKw = kw.toLowerCase();
          if (lowerTitle.includes(lowerKw) || lowerContent.includes(lowerKw)) {
            matchedKeywords.push(kw);
          }
        }

        if (matchedKeywords.length > 0) {
          matches.push({
            ...entry,
            matchCount: matchedKeywords.length,
            matchedKeywords,
          });
        }
      }

      // Sort by match count descending (more keywords matched = more relevant)
      matches.sort((a, b) => b.matchCount - a.matchCount);

      if (matches.length === 0) {
        return `没有找到与"${query}"相关的 EnderRealm 文档。建议尝试不同的关键词。`;
      }

      const formatted = matches
        .map((entry, index) => {
          const snippet = extractSnippets(entry.content, entry.matchedKeywords);
          return `${index + 1}. ${entry.title}\n   路径: ${entry.path}\n   摘要: ${snippet}`;
        })
        .join('\n\n');

      return `搜索"${query}"在 EnderRealm 文档中找到 ${matches.length} 条结果：\n\n${formatted}\n\n提示：使用 er-docs-get-doc 工具并传入 path 可以获取文档完整内容。`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return `错误：搜索时发生异常 - ${message}`;
    }
  }
}