import type { Env } from '../types';
import { handleChat } from './chat';
import { handleHealth } from './health';
import {
  handleGetSession,
  handleGetMessages,
  handleExportSession,
  handleImportSession,
  handleCreateSession,
  handleDeleteSession,
} from './session';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let response: Response;

  if (request.method === 'GET' && path === '/health') {
    response = await handleHealth(env);
  } else if (request.method === 'POST' && path === '/api/chat') {
    response = await handleChat(request, env);
  } else if (request.method === 'POST' && path === '/api/session/create') {
    response = await handleCreateSession(request, env);
  } else if (request.method === 'GET' && path.startsWith('/api/session/export/')) {
    response = await handleExportSession(request, env);
  } else if (request.method === 'POST' && path === '/api/session/import') {
    response = await handleImportSession(request, env);
  } else if (request.method === 'GET' && path.match(/^\/api\/session\/[^/]+$/)) {
    response = await handleGetSession(request, env);
  } else if (request.method === 'GET' && path.match(/^\/api\/session\/[^/]+\/messages$/)) {
    response = await handleGetMessages(request, env);
  } else if (request.method === 'DELETE' && path.match(/^\/api\/session\/[^/]+$/)) {
    response = await handleDeleteSession(request, env);
  } else {
    response = new Response('Not Found', { status: 404 });
  }

  return withCors(response);
}
