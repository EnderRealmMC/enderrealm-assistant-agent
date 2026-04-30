export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  content: string;
  done: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Session {
  id: string;
  token: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface ImportResult {
  id: string;
  token: string;
  messageCount: number;
}

export interface Env {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  MODEL_NAME: string;
  SESSIONS: KVNamespace;
  SESSION_TTL_DAYS?: number;
}
