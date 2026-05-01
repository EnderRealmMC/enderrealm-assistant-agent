import type { Env, ImportResult, Message } from '../types';
import { SessionService } from '../services/session.service';

function extractToken(request: Request): string | null {
  return request.headers.get('X-Session-Token');
}

function unauthorized(message: string = 'Unauthorized'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) {
    return unauthorized('Missing X-Session-Token header');
  }

  const url = new URL(request.url);
  const sessionId = url.pathname.split('/').pop();

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionService = new SessionService(env);

  const isValid = await sessionService.validateToken(sessionId, token);
  if (!isValid) {
    return unauthorized('Invalid token');
  }

  const session = await sessionService.get(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Return basic info without token
  return new Response(JSON.stringify({
    id: session.id,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetMessages(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) {
    return unauthorized('Missing X-Session-Token header');
  }

  const url = new URL(request.url);
  const sessionId = url.pathname.split('/')[url.pathname.split('/').length - 2];

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionService = new SessionService(env);

  const isValid = await sessionService.validateToken(sessionId, token);
  if (!isValid) {
    return unauthorized('Invalid token');
  }

  const session = await sessionService.get(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    id: session.id,
    messages: session.messages,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleExportSession(request: Request, env: Env): Promise<Response> {
  const token = extractToken(request);
  if (!token) {
    return unauthorized('Missing X-Session-Token header');
  }

  const url = new URL(request.url);
  const sessionId = url.pathname.split('/').pop();

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing sessionId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionService = new SessionService(env);

  const isValid = await sessionService.validateToken(sessionId, token);
  if (!isValid) {
    return unauthorized('Invalid token');
  }

  const session = await sessionService.exportSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const jsonData = JSON.stringify({
    messages: session.messages,
    exportedAt: Date.now(),
  }, null, 2);

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="session-${sessionId}.json"`,
  });

  return new Response(jsonData, { headers });
}

export async function handleImportSession(request: Request, env: Env): Promise<Response> {
  let body: { messages?: Array<{ role: string; content: string }> };

  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: 'messages array is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionService = new SessionService(env);

  // Cast imported messages to Message[] - they may not conform exactly
  const importData = { messages: body.messages as Message[] };

  let result: ImportResult;
  try {
    result = await sessionService.importSession(importData);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Import failed';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleCreateSession(_request: Request, env: Env): Promise<Response> {
  const sessionService = new SessionService(env);

  const sessionId = sessionService.generateSessionId();
  const token = sessionService.generateToken();

  // Initialize with empty messages (system prompt will be added on first chat)
  await sessionService.save(sessionId, token, []);

  return new Response(JSON.stringify({
    id: sessionId,
    token,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}