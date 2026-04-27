import type { Env } from '../types';

export async function handleHealth(env: Env): Promise<Response> {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
