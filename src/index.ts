import type { Env } from './types';
import { getEnv } from './config/env';
import { router } from './routes/router';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const validatedEnv = getEnv(env);
      return await router(request, validatedEnv);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
