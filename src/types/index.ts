export interface ChatRequest {
  message: string;
  sessionId: string;
}

export interface ChatResponse {
  content: string;
  done: boolean;
}

// --- Tool Types ---

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, env: Env): Promise<string>;
}

// --- Message Types ---

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
  name: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// --- Session Types ---

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

// --- Env ---

export interface Env {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  MODEL_NAME: string;
  SESSIONS: KVNamespace;
  SESSION_TTL_DAYS?: number;
}
