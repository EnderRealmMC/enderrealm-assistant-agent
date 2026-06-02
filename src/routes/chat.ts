import type { Env, ChatRequest, Message } from '../types';
import { OpenAIService } from '../services/openai.service';
import { SessionService } from '../services/session.service';
import { AgentRunner } from '../services/agent-runner';
import { createDefaultRegistry } from '../tools';
import { getSystemPrompt } from '../prompts/system';
import { createSSEEmitter } from '../utils/sse-emitter';
import { extractUserLocation } from '../utils/geo';

function extractToken(request: Request): string | null {
  return request.headers.get('X-Session-Token');
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing X-Session-Token header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.message || typeof body.message !== 'string') {
    return new Response(JSON.stringify({ error: 'message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionService = new SessionService(env);

  const isValid = await sessionService.validateToken(body.sessionId, token);
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await sessionService.get(body.sessionId);
  const messages: Message[] = session?.messages || [];

  // 添加用户消息
  messages.push({ role: 'user', content: body.message });

  // 创建 SSE 流和发射器
  const { stream, emitter } = createSSEEmitter();

  // 初始化 Agent 组件
  const registry = createDefaultRegistry(env);
  const userLocation = extractUserLocation(request);
  const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const locationSection = userLocation ? `\n## 用户位置\n${userLocation}\n` : '';

  const systemPrompt = getSystemPrompt({
    toolsDescription: registry.getToolDescriptionsForPrompt(),
    currentTime,
    locationSection,
  });
  const openaiService = new OpenAIService(env);
  const agentRunner = new AgentRunner(openaiService, registry, systemPrompt, env);

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Id': body.sessionId,
  });

  // 异步运行 Agent 循环
  (async () => {
    try {
      const finalMessages = await agentRunner.run(messages, emitter);

      // 保存会话
      try {
        await sessionService.save(body.sessionId, token, finalMessages);
        console.log(`[Chat] Saved session ${body.sessionId}`);
      } catch (saveError) {
        console.error('[Chat] Failed to save session:', saveError);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Chat] Agent error for session ${body.sessionId}:`, errorMsg);

      // 尝试保存当前消息（即使出错也保留用户消息）
      try {
        await sessionService.save(body.sessionId, token, messages);
      } catch {
        // 忽略保存失败
      }
    } finally {
      // 确保流关闭
      try {
        emitter.close();
      } catch {
        // 流可能已关闭
      }
    }
  })();

  return new Response(stream, { headers });
}