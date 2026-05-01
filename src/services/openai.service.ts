import type { Env, Message, ToolDefinition, ToolCall } from '../types';

/**
 * 流式响应的收集结果
 */
export interface StreamResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
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
   * 创建聊天完成请求（非流式），返回原始 Response
   */
  async createCompletion(
    messages: Message[],
    stream: boolean = true,
    tools?: ToolDefinition[],
  ): Promise<Response> {
    const url = `${this.baseURL}/chat/completions`;

    // 将 Message[] 转换为 OpenAI API 格式
    const apiMessages = messages.map(msg => this.formatMessage(msg));

    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: apiMessages,
      stream,
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

    return response;
  }

  /**
   * 非流式请求，直接返回解析结果
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