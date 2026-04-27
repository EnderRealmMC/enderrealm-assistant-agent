import type { Env, Message } from '../types';

export class OpenAIService {
  private apiKey: string;
  private baseURL: string;
  private modelName: string;

  constructor(env: Env) {
    this.apiKey = env.OPENAI_API_KEY;
    this.baseURL = env.OPENAI_BASE_URL;
    this.modelName = env.MODEL_NAME;
  }

  async createCompletion(messages: Message[]): Promise<Response> {
    const url = `${this.baseURL}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
      }),
    });

    return response;
  }
}
