import type { Env, ChatRequest, Message } from '../types';
import { OpenAIService } from '../services/openai.service';
import { SessionService } from '../services/session.service';
import { getSystemPrompt } from '../prompts/system';
import { createStreamingProxy } from '../utils/sse';

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

  if (messages.length === 0) {
    messages.push({ role: 'system', content: getSystemPrompt() });
  }

  messages.push({ role: 'user', content: body.message });

  const openaiService = new OpenAIService(env);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await openaiService.createCompletion(messages, true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    return new Response(JSON.stringify({ error: `API error ${upstreamResponse.status}: ${errorText}` }), {
      status: upstreamResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return new Response(JSON.stringify({ error: 'Upstream response has no body' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { stream: downstreamStream, onComplete } = createStreamingProxy(upstreamBody);

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Id': body.sessionId,
  });

  onComplete
    .then(async (fullContent) => {
      messages.push({ role: 'assistant', content: fullContent });
      await sessionService.save(body.sessionId, token, messages);
      console.log(`[Chat] Saved ${fullContent.length} chars to KV`);
    })
    .catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Stream error';
      console.error(`[Chat] Stream error for session ${body.sessionId}:`, errorMessage);
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        messages.push({ role: 'assistant', content: '(回答中断)' });
        try {
          await sessionService.save(body.sessionId, token, messages);
        } catch (saveError) {
          console.error('[Chat] Failed to save session after stream error:', saveError);
        }
      }
    });

  return new Response(downstreamStream, { headers });
}
