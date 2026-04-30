import type { Env, ChatRequest, Message } from '../types';
import { OpenAIService } from '../services/openai.service';
import { SessionService } from '../services/session.service';
import { getSystemPrompt } from '../prompts/system';

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

  // Not streaming - get full response
  let response: Response;
  try {
    response = await openaiService.createCompletion(messages, false);
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

  // Parse full response and extract content
  const data: any = await response.json();
  const assistantContent = data.choices?.[0]?.message?.content || '';

  // Save messages
  messages.push({ role: 'assistant', content: assistantContent });
  await sessionService.save(body.sessionId, token, messages);

  // Return as SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      if (assistantContent) {
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content: assistantContent, done: false })}\n\n`));
      }
      controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`));
      controller.close();
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Session-Id': body.sessionId,
  });

  return new Response(stream, { headers });
}