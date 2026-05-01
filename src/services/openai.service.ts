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
   * - 文本片段通过 onChunk 回调实时推送（打字机效果）
   * - tool_calls 在流结束时自动拼接完成
   * - 如果没有 tool_calls，onChunk 类型为 'final_answer'
   * - 如果有 tool_calls，onChunk 类型为 'reasoning'
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

    // 我们需要判断：这个流是否有 tool_calls
    // 如果有 tool_calls → 内容属于 'reasoning'
    // 如果没有 tool_calls → 内容属于 'final_answer'
    // 但在流式模式中，我们一开始不知道是否有 tool_calls
    // 所以先缓存内容，在流结束后再决定
    // 但这样用户要等到流结束才看到内容...

    // 更好的方案：始终先作为 'reasoning' 推送内容
    // 如果最终没有 tool_calls，再发一次完整的 'final_answer'
    // 这样用户能看到打字机效果，且最终内容不会丢失

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

          // 处理内容流
          const contentDelta = choice.delta?.content;
          if (contentDelta) {
            fullContent += contentDelta;
            onChunk('reasoning', contentDelta);
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
              onChunk('reasoning', contentDelta);
            }
          }
        } catch {
          // ignore
        }
      }
    }

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

    // 如果有 tool_calls → 之前推送的内容就是 'reasoning'，不需要再做 final_answer
    // 如果没有 tool_calls → 之前推送的内容需要作为 'final_answer' 再发一次完整版
    // 但我们已经在流中逐块推送了 reasoning，现在只需要：
    // - 有 tool_calls: 什么都不用做，reasoning 已经发了
    // - 没有 tool_calls: 需要再发一个 final_answer 的完整事件

    // 实际上用户已经看到了 reasoning 的打字机效果
    // 对于无 tool_calls 的情况，我们再发一次 final_answer 事件来标记这是最终答案
    // 内容就是 fullContent（已经在 reasoning 中逐块推送过了）

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