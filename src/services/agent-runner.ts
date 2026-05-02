import type { Env, Message } from '../types';
import { ToolRegistry } from '../tools/registry';
import { OpenAIService } from '../services/openai.service';
import { SSEEmitter } from '../utils/sse-emitter';

const MAX_ITERATIONS = 10;

export class AgentRunner {
  private openaiService: OpenAIService;
  private registry: ToolRegistry;
  private systemPrompt: string;
  private env: Env;

  constructor(
    openaiService: OpenAIService,
    registry: ToolRegistry,
    systemPrompt: string,
    env: Env,
  ) {
    this.openaiService = openaiService;
    this.registry = registry;
    this.systemPrompt = systemPrompt;
    this.env = env;
  }

  /**
   * 运行 ReAct 循环，通过 SSE 发射器推送事件。
   *
   * SSE 事件协议:
   *   - reasoning:     AI 推理文本（逐块流式推送，打字机效果）
   *   - tool_call:     AI 决定调用某个工具
   *   - tool_result:   工具执行结果
   *   - final_answer:  最终回答（逐块流式推送，打字机效果；done=true 表示流结束）
   *   - error:         错误信息
   *
   * 流式策略：
   *   LLM 输出文本通过 onChunk 逐块以 reasoning 类型推送（实时打字机效果）。
   *   流结束后：
   *     - 无工具调用 → 将同样内容逐块重放为 final_answer（流式），再发 done:true
   *     - 有工具调用 → 不发 final_answer，继续 ReAct 循环
   */
  async run(
    messages: Message[],
    emitter: SSEEmitter,
  ): Promise<Message[]> {
    // 确保系统提示词在开头
    if (messages.length === 0 || messages[0].role !== 'system') {
      messages.unshift({ role: 'system', content: this.systemPrompt });
    }

    const toolDefs = this.registry.getToolDefinitions();
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let result;
      // 缓存本轮流式文本块，用于后续重放为 final_answer
      const textChunks: string[] = [];

      try {
        // 流式调用 LLM — 文本逐块推送给客户端（打字机效果）
        result = await this.openaiService.createCompletionStream(
          messages,
          toolDefs.length > 0 ? toolDefs : undefined,
          (type, chunk) => {
            textChunks.push(chunk);
            emitter.emit(type, { content: chunk });
          },
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown API error';
        console.error(`[Agent] LLM error: ${errMsg}`);
        emitter.emit('error', { error: errMsg });
        break;
      }

      // 构建助手消息
      const assistantContent = result.content ?? '';
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent || null,
        ...((result.toolCalls.length > 0) ? { tool_calls: result.toolCalls } : {}),
      };

      // 没有工具调用 → 最终回答
      // 将 reasoning 中已推送的文本逐块重放为 final_answer（流式），再发 done:true
      if (result.toolCalls.length === 0) {
        for (const chunk of textChunks) {
          emitter.emit('final_answer', { content: chunk });
        }
        emitter.emit('final_answer', { content: '', done: true });
        messages.push(assistantMessage);
        break;
      }

      // 有工具调用 → reasoning 内容已在流中推送
      // 补充说明即将调用的工具
      const toolNames = result.toolCalls.map(tc => tc.name).join(', ');
      emitter.emit('reasoning', {
        content: `\n决定使用工具: ${toolNames}\n`,
      });

      messages.push(assistantMessage);

      for (const toolCall of result.toolCalls) {
        // 发送 tool_call 事件
        emitter.emit('tool_call', {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        // 执行工具
        const tool = this.registry.getTool(toolCall.name);
        let toolResult: string;

        if (tool) {
          try {
            toolResult = await tool.execute(toolCall.arguments, this.env);
          } catch (error) {
            toolResult = `工具执行错误: ${error instanceof Error ? error.message : 'Unknown error'}`;
          }
        } else {
          toolResult = `错误: 未找到工具 "${toolCall.name}"`;
        }

        // 发送 tool_result 事件
        emitter.emit('tool_result', {
          id: toolCall.id,
          name: toolCall.name,
          result: toolResult,
        });

        // 追加工具结果到消息历史
        const toolMessage: Message = {
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
          name: toolCall.name,
        };
        messages.push(toolMessage);
      }

      // 继续循环，让 LLM 根据工具结果决定下一步
    }

    // 达到最大迭代次数
    if (iterations >= MAX_ITERATIONS) {
      emitter.emit('final_answer', {
        content: '抱歉，我经过多轮搜索仍未能找到完整的答案。建议你直接查阅 Minecraft Wiki 或咨询管理团队获取更准确的信息。',
        done: true,
      });
    }

    return messages;
  }
}