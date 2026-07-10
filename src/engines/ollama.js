"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaEngine = void 0;
const base_1 = require("./base");
const stream_utils_1 = require("./stream-utils");
class OllamaEngine extends base_1.LLMEngine {
    id = 'ollama';
    name = 'Ollama';
    engineConfig = {
        baseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    };
    configure(config) {
        this.engineConfig = { ...this.engineConfig, ...config };
    }
    async start(_modelPath) {
        this._running = true;
        return { success: true };
    }
    async stop() {
        this._running = false;
        return { success: true };
    }
    async listModels() {
        try {
            const res = await fetch(`${this.engineConfig.baseUrl}/api/tags`);
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.models.map((m) => ({
                name: m.name,
                id: m.name,
                size: m.size,
                sizeFormatted: formatBytes(m.size),
                provider: this.id,
                capabilities: [],
            }));
        }
        catch {
            return [];
        }
    }
    async generate(messages, options) {
        const res = await fetch(`${this.engineConfig.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: messages[0]?.role === 'system' ? 'llama3' : 'llama3',
                messages,
                stream: true,
                options: {
                    temperature: options?.temperature,
                    top_p: options?.topP,
                    top_k: options?.topK,
                    repeat_penalty: options?.repeatPenalty,
                    num_predict: options?.maxTokens,
                },
            }),
        });
        if (!res.ok) {
            throw new Error(`Ollama error ${res.status}`);
        }
        return { stream: (0, stream_utils_1.ollamaStreamToGenerator)(res) };
    }
    async health() {
        try {
            const res = await fetch(`${this.engineConfig.baseUrl}/api/tags`);
            if (res.ok) {
                return { status: 'ok', engine: this.id };
            }
            return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
        }
        catch {
            return { status: 'error', engine: this.id, detail: 'Cannot reach Ollama' };
        }
    }
}
exports.OllamaEngine = OllamaEngine;
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
