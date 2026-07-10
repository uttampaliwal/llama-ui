import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { openaiStreamToGenerator } from './stream-utils';

export interface OpenAIConfig extends EngineConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class OpenAIEngine extends LLMEngine {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  protected engineConfig: OpenAIConfig = {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: 'gpt-4o',
  };

  configure(config: EngineConfig): void {
    this.engineConfig = { ...this.engineConfig, ...config };
  }

  async start(_modelPath: string): Promise<{ success: boolean; port?: number }> {
    this._running = true;
    return { success: true };
  }

  async stop(): Promise<{ success: boolean }> {
    this._running = false;
    return { success: true };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.engineConfig.apiKey}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: Array<{ id: string; owned_by: string }> };
      return data.data.map((m) => ({
        name: m.id,
        id: m.id,
        size: 0,
        sizeFormatted: 'Cloud',
        provider: this.id,
        capabilities: [],
      }));
    } catch {
      return [];
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const res = await fetch(`${this.engineConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.engineConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: this.engineConfig.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.topP ?? 0.9,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}`);
    }

    return { stream: openaiStreamToGenerator(res) };
  }

  async health(): Promise<HealthStatus> {
    if (!this.engineConfig.apiKey) {
      return { status: 'error', engine: this.id, detail: 'No API key configured' };
    }
    return { status: 'ok', engine: this.id };
  }
}
