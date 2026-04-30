import type { Env, Session, Message, ImportResult } from '../types';

export class SessionService {
  private kv: KVNamespace;

  constructor(env: Env) {
    this.kv = env.SESSIONS;
  }

  async get(sessionId: string): Promise<Session | null> {
    const data = await this.kv.get(sessionId, 'json');
    return data as Session | null;
  }

  async save(sessionId: string, token: string, messages: Message[]): Promise<void> {
    const existing = await this.get(sessionId);
    const now = Date.now();

    const session: Session = existing
      ? { ...existing, messages, updatedAt: now }
      : { id: sessionId, token, messages, createdAt: now, updatedAt: now };

    await this.kv.put(sessionId, JSON.stringify(session));
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  generateToken(): string {
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2);
    return `token_${timestamp}_${random}`;
  }

  async validateToken(sessionId: string, token: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;
    return session.token === token;
  }

  async exportSession(sessionId: string): Promise<Session | null> {
    return await this.get(sessionId);
  }

  async importSession(exportedData: { messages: Message[] }): Promise<ImportResult> {
    const id = this.generateSessionId();
    const token = this.generateToken();
    const messages = exportedData.messages || [];

    await this.save(id, token, messages);

    return {
      id,
      token,
      messageCount: messages.length,
    };
  }
}
