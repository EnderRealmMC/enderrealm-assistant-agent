import type { Env } from '../types';

export function getEnv(env: Env): Env {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }
  if (!env.OPENAI_BASE_URL) {
    throw new Error('OPENAI_BASE_URL is required');
  }
  if (!env.MODEL_NAME) {
    throw new Error('MODEL_NAME is required');
  }
  if (env.SESSION_TTL_DAYS === undefined) {
    env.SESSION_TTL_DAYS = 7;
  }
  return env;
}
