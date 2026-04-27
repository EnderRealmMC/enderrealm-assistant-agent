import type { Env, Session, Message } from '../types';

export class SessionService {
  private kv: KVNamespace;

  constructor(env: Env) {
    this.kv = env.SESSIONS;
  }

  async get(sessionId: string): Promise<Session | null> {
    const data = await this.kv.get(sessionId, 'json');
    return data as Session | null;
  }

  async save(sessionId: string, messages: Message[]): Promise<void> {
    const existing = await this.get(sessionId);
    const now = Date.now();

    const session: Session = existing
      ? { ...existing, messages, updatedAt: now }
      : { id: sessionId, messages, createdAt: now, updatedAt: now };

    await this.kv.put(sessionId, JSON.stringify(session));
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
