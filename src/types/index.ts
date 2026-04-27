export interface ChatRequest {
  message: string;
  sessionId?: string;
}

export interface ChatResponse {
  content: string;
  done: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface Session {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Env {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  MODEL_NAME: string;
  SESSIONS: KVNamespace;
}
