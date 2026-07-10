import {
  LLMEngine,
  type ModelInfo,
  type ChatMessage,
  type GenerateOptions,
  type GenerateResult,
  type HealthStatus,
  type EngineConfig,
  detectCapabilitiesFromName,
} from './base';
import { ollamaStreamToGenerator } from './stream-utils';

export interface OllamaConfig extends EngineConfig {
  baseUrl: string;
}

export class OllamaEngine extends LLMEngine {
  readonly id = 'ollama';
  readonly name = 'Ollama';

  protected engineConfig: OllamaConfig = {
    baseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  };

  configure(config: EngineConfig): void {
    this.engineConfig = { ...this.engineConfig, ...config };
  }

  start(_modelPath: string): Promise<{ success: boolean; port?: number }> {
    this._running = true;
    return Promise.resolve({ success: true });
  }

  stop(): Promise<{ success: boolean }> {
    this._running = false;
    return Promise.resolve({ success: true });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models: Array<{ name: string; size: number }> };
      return data.models.map((m) => ({
        name: m.name,
        id: m.name,
        size: m.size,
        sizeFormatted: formatBytes(m.size),
        provider: this.id,
        capabilities: detectCapabilitiesFromName(m.name),
      }));
    } catch {
      return [];
    }
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
    const model = this._activeModel || 'llama3';
    const res = await fetch(`${this.engineConfig.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          repeat_penalty: options?.repeatPenalty,
          num_predict: options?.maxTokens,
          num_ctx: options?.contextSize,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}`);
    }

    return { stream: ollamaStreamToGenerator(res) };
  }

  async health(): Promise<HealthStatus> {
    try {
      const res = await fetch(`${this.engineConfig.baseUrl}/api/tags`);
      if (res.ok) {
        return { status: 'ok', engine: this.id };
      }
      return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
    } catch {
      return { status: 'error', engine: this.id, detail: 'Cannot reach Ollama' };
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
