import type { Env, ChatRequest, Message } from '../types';
import { OpenAIService } from '../services/openai.service';
import { SessionService } from '../services/session.service';
import { getSystemPrompt } from '../prompts/system';

function extractToken(request: Request): string | null {
  return request.headers.get('X-Session-Token');
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  // Validate token
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

  // Validate token
  const isValid = await sessionService.validateToken(body.sessionId, token);
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await sessionService.get(body.sessionId);
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

  // Build our own SSE stream while reading OpenAI response
  const encoder = new TextEncoder();
  let assistantContent = '';

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Send [DONE] to signal end
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`));
            controller.close();

            // Save assistant message to session
            if (assistantContent) {
              messages.push({ role: 'assistant', content: assistantContent });
              await sessionService.save(body.sessionId!, token, messages);
            }
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);

              if (data === '[DONE]') {
                controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content: '', done: true })}\n\n`));
                controller.close();

                // Save assistant message to session
                if (assistantContent) {
                  messages.push({ role: 'assistant', content: assistantContent });
                  await sessionService.save(body.sessionId!, token, messages);
                }
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;

                if (content) {
                  assistantContent += content;
                  controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ content, done: false })}\n\n`));
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
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