import type { Env, Message, ToolDefinition, ToolCall } from '../types';

/**
 * 流式请求的收集结果
 */
export interface StreamResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

/**
 * 流式收集过程中的回调，用于实时推送文本片段
 */
export type StreamCallback = (type: 'reasoning' | 'final_answer', chunk: string) => void;

/**
 * 正在累积的 tool_call（流式模式下需要跨 chunk 拼接）
 */
interface AccumulatingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 流式标签解析器
 * 
 * 功能：
 * 1. 检测 <reasoning>...</reasoning> 和 <final_answer>...</final_answer> 标签
 * 2. 根据当前状态决定推送类型
 * 3. 过滤标签本身，只推送内容
 * 4. 支持标签被分割在多个 chunk 中
 */
class StreamTagParser {
  private buffer = '';
  private currentType: 'reasoning' | 'final_answer' = 'reasoning';
  private onChunk: StreamCallback;
  
  // 标签定义
  private static readonly TAGS = {
    reasoning: { open: '<reasoning>', close: '</reasoning>' },
    final_answer: { open: '<final_answer>', close: '</final_answer>' },
  };

  constructor(onChunk: StreamCallback) {
    this.onChunk = onChunk;
  }

  /**
   * 处理输入的文本块
   * 自动检测标签并推送内容
   */
  processChunk(text: string): void {
    this.buffer += text;
    this.processBuffer();
  }

  /**
   * 处理缓冲区中的所有内容
   */
  private processBuffer(): void {
    while (this.buffer.length > 0) {
      // 查找最近的标签位置
      const nextTag = this.findNextTag();
      
      if (!nextTag) {
        // 没有找到完整标签，检查是否有潜在的标签开始
        const potentialTagStart = this.findPotentialTagStart();
        if (potentialTagStart > 0) {
          // 推送标签之前的内容
          this.pushContent(this.buffer.substring(0, potentialTagStart));
          this.buffer = this.buffer.substring(potentialTagStart);
        }
        // 等待更多数据
        break;
      }

      // 推送标签之前的内容
      if (nextTag.position > 0) {
        this.pushContent(this.buffer.substring(0, nextTag.position));
      }

      // 处理标签
      if (nextTag.type === 'open') {
        this.currentType = nextTag.tagType;
      }
      // 闭标签不改变状态，保持当前类型

      // 移除已处理的标签
      this.buffer = this.buffer.substring(nextTag.position + nextTag.length);
    }
  }

  /**
   * 查找下一个完整的标签
   */
  private findNextTag(): { position: number; length: number; type: 'open' | 'close'; tagType: 'reasoning' | 'final_answer' } | null {
    let earliest: { position: number; length: number; type: 'open' | 'close'; tagType: 'reasoning' | 'final_answer' } | null = null;

    for (const [tagType, tags] of Object.entries(StreamTagParser.TAGS)) {
      const typedTagType = tagType as 'reasoning' | 'final_answer';
      
      // 查找开标签
      const openPos = this.buffer.indexOf(tags.open);
      if (openPos !== -1) {
        if (!earliest || openPos < earliest.position) {
          earliest = { position: openPos, length: tags.open.length, type: 'open', tagType: typedTagType };
        }
      }

      // 查找闭标签
      const closePos = this.buffer.indexOf(tags.close);
      if (closePos !== -1) {
        if (!earliest || closePos < earliest.position) {
          earliest = { position: closePos, length: tags.close.length, type: 'close', tagType: typedTagType };
        }
      }
    }

    return earliest;
  }

  /**
   * 查找潜在的标签开始位置（标签可能被分割）
   * 例如：缓冲区末尾是 "<reason"，等待更多数据
   */
  private findPotentialTagStart(): number {
    // 检查缓冲区末尾是否有潜在的标签开始
    const lastOpenBracket = this.buffer.lastIndexOf('<');
    if (lastOpenBracket === -1) return this.buffer.length;

    // 检查从这个位置开始是否可能是标签
    const potentialTag = this.buffer.substring(lastOpenBracket);
    const allTags = [
      StreamTagParser.TAGS.reasoning.open,
      StreamTagParser.TAGS.reasoning.close,
      StreamTagParser.TAGS.final_answer.open,
      StreamTagParser.TAGS.final_answer.close,
    ];

    for (const tag of allTags) {
      if (tag.startsWith(potentialTag) || potentialTag.startsWith(tag.substring(0, potentialTag.length))) {
        return lastOpenBracket;
      }
    }

    return this.buffer.length;
  }

  /**
   * 推送内容到回调
   */
  private pushContent(content: string): void {
    if (content) {
      this.onChunk(this.currentType, content);
    }
  }

  /**
   * 刷新缓冲区，推送剩余内容
   */
  flush(): void {
    if (this.buffer) {
      this.pushContent(this.buffer);
      this.buffer = '';
    }
  }
}

export class OpenAIService {
  private apiKey: string;
  private baseURL: string;
  private modelName: string;

  constructor(env: Env) {
    this.apiKey = env.OPENAI_API_KEY;
    this.baseURL = env.OPENAI_BASE_URL;
    this.modelName = env.MODEL_NAME;
  }

  /**
   * 流式请求 — 解析 SSE 流，实时回调文本片段，返回完整结果。
   * 
   * 新的标签机制：
   * - LLM 输出中使用 <reasoning>...</reasoning> 和 <final_answer>...</final_answer> 标签
   * - 标签会被过滤，客户端只看到干净的内容
   * - 根据标签实时切换推送类型
   * - 如果没有标签，默认作为 reasoning 推送
   */
  async createCompletionStream(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    onChunk: StreamCallback,
  ): Promise<StreamResult> {
    const url = `${this.baseURL}/chat/completions`;
    const apiMessages = messages.map(msg => this.formatMessage(msg));

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: apiMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body for streaming request');
    }

    // 流式解析
    let fullContent = '';
    const toolCallsMap = new Map<string, AccumulatingToolCall>();
    let finishReason: string | null = null;

    // 创建标签解析器
    const tagParser = new StreamTagParser(onChunk);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按 \n 分割处理 SSE 行
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          // 处理 finish_reason
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          // 处理内容流 - 通过标签解析器处理
          const contentDelta = choice.delta?.content;
          if (contentDelta) {
            fullContent += contentDelta;
            tagParser.processChunk(contentDelta);
          }

          // 处理 tool_calls 流 (跨 chunk 拼接)
          const deltas: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }> = choice.delta?.tool_calls ?? [];

          for (const delta of deltas) {
            const idx = delta.index ?? 0;
            const id = delta.id;
            const funcName = delta.function?.name;
            const funcArgs = delta.function?.arguments;

            if (id) {
              // 新的 tool_call 开始
              toolCallsMap.set(String(idx), {
                id,
                name: funcName ?? '',
                arguments: funcArgs ?? '',
              });
            } else if (toolCallsMap.has(String(idx))) {
              // 续接已有的 tool_call
              const existing = toolCallsMap.get(String(idx))!;
              if (funcName) existing.name += funcName;
              if (funcArgs) existing.arguments += funcArgs;
            }
          }
        } catch {
          // 跳过无效 JSON
        }
      }
    }

    // 处理 buffer 中剩余的数据
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const choice = parsed.choices?.[0];
          if (choice) {
            if (choice.finish_reason) finishReason = choice.finish_reason;
            const contentDelta = choice.delta?.content;
            if (contentDelta) {
              fullContent += contentDelta;
              tagParser.processChunk(contentDelta);
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // 刷新标签解析器的缓冲区
    tagParser.flush();

    // 将累积的 tool_calls 转换为最终格式
    const toolCalls: ToolCall[] = [];
    const sortedKeys = Array.from(toolCallsMap.keys()).sort((a, b) => Number(a) - Number(b));
    for (const key of sortedKeys) {
      const tc = toolCallsMap.get(key)!;
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.arguments || '{}');
      } catch {
        parsedArgs = {};
      }
      toolCalls.push({
        id: tc.id,
        name: tc.name,
        arguments: parsedArgs,
      });
    }

    return {
      content: fullContent || null,
      toolCalls,
      finishReason,
    };
  }

  /**
   * 非流式请求，直接返回解析结果（保留用于兼容，但 agent 不再使用）
   */
  async createCompletionSync(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<StreamResult> {
    const url = `${this.baseURL}/chat/completions`;
    const apiMessages = messages.map(msg => this.formatMessage(msg));

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: apiMessages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('No choices in API response');
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }));

    return {
      content: choice.message.content,
      toolCalls,
      finishReason: choice.finish_reason,
    };
  }

  /**
   * 将内部 Message 格式转换为 OpenAI API 格式
   */
  private formatMessage(msg: Message): Record<string, unknown> {
    switch (msg.role) {
      case 'system':
        return { role: 'system', content: msg.content };
      case 'user':
        return { role: 'user', content: msg.content };
      case 'assistant': {
        const result: Record<string, unknown> = { role: 'assistant', content: msg.content };
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          result.tool_calls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return result;
      }
      case 'tool':
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        };
    }
  }
}
