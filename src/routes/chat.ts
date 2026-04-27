import type { Env, ChatRequest, Message } from '../types';
import { OpenAIService } from '../services/openai.service';
import { SessionService } from '../services/session.service';
import { getSystemPrompt } from '../prompts/system';

export async function handleChat(request: Request, env: Env): Promise<Response> {
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

  const sessionService = new SessionService(env);
  const sessionId = body.sessionId || sessionService.generateSessionId();

  const session = await sessionService.get(sessionId);
  const messages: Message[] = session?.messages || [];

  // Prepend system prompt if this is a new session
  if (messages.length === 0) {
    const systemPrompt = getSystemPrompt();
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: body.message });

  const openaiService = new OpenAIService(env);

  let response: Response;
  try {
    response = await openaiService.createCompletion(messages);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(JSON.stringify({ error: `API error ${response.status}: ${errorText}` }), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Id': sessionId,
  });

  return new Response(response.body, { headers });
}
