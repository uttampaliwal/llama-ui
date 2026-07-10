"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIEngine = void 0;
const base_1 = require("./base");
const stream_utils_1 = require("./stream-utils");
class OpenAIEngine extends base_1.LLMEngine {
    id = 'openai';
    name = 'OpenAI';
    engineConfig = {
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: 'gpt-4o',
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
            const res = await fetch(`${this.engineConfig.baseUrl}/models`, {
                headers: { Authorization: `Bearer ${this.engineConfig.apiKey}` },
            });
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.data.map((m) => ({
                name: m.id,
                id: m.id,
                size: 0,
                sizeFormatted: 'Cloud',
                provider: this.id,
                capabilities: [],
            }));
        }
        catch {
            return [];
        }
    }
    async generate(messages, options) {
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
        return { stream: (0, stream_utils_1.openaiStreamToGenerator)(res) };
    }
    async health() {
        if (!this.engineConfig.apiKey) {
            return { status: 'error', engine: this.id, detail: 'No API key configured' };
        }
        return { status: 'ok', engine: this.id };
    }
}
exports.OpenAIEngine = OpenAIEngine;
