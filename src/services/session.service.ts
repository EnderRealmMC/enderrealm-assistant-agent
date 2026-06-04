import type { Env, Session, Message, ImportResult } from '../types';

export class SessionService {
  private kv: KVNamespace;
  private ttlDays: number;

  constructor(env: Env) {
    this.kv = env.SESSIONS;
    this.ttlDays = env.SESSION_TTL_DAYS ?? 7;
  }

  calculateExpiresAt(fromTime: number = Date.now()): number {
    return fromTime + (this.ttlDays * 24 * 60 * 60 * 1000);
  }

  async get(sessionId: string): Promise<Session | null> {
    const data = await this.kv.get(sessionId, 'json');
    if (!data) return null;

    const session = data as Session;
    // 懒清理：过期则删除
    if (session.expiresAt < Date.now()) {
      await this.kv.delete(sessionId);
      return null;
    }

    return session;
  }

  async save(sessionId: string, token: string, messages: Message[]): Promise<void> {
    const existing = await this.get(sessionId);
    const now = Date.now();

    const session: Session = existing
      ? { ...existing, messages, updatedAt: now, expiresAt: this.calculateExpiresAt(now) }
      : { id: sessionId, token, messages, createdAt: now, updatedAt: now, expiresAt: this.calculateExpiresAt(now) };

    await this.kv.put(sessionId, JSON.stringify(session), {
      expiration: Math.floor(session.expiresAt / 1000),
    });
  }

  async cleanup(): Promise<number> {
    const list = await this.kv.list({ prefix: 'session_' });
    let deletedCount = 0;

    for (const key of list.keys) {
      const session = await this.kv.get(key.name, 'json') as Session | null;
      if (session && session.expiresAt < Date.now()) {
        await this.kv.delete(key.name);
        deletedCount++;
      }
    }

    return deletedCount;
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

  async delete(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;

    await this.kv.delete(sessionId);
    return true;
  }
}
