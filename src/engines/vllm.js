"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VLLMEngine = void 0;
const base_1 = require("./base");
const stream_utils_1 = require("./stream-utils");
class VLLMEngine extends base_1.LLMEngine {
    id = 'vllm';
    name = 'vLLM';
    engineConfig = {
        baseUrl: process.env.VLLM_HOST || 'http://127.0.0.1:8000',
        model: 'default',
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
            const res = await fetch(`${this.engineConfig.baseUrl}/v1/models`);
            if (!res.ok)
                return [];
            const data = await res.json();
            return data.data.map((m) => ({
                name: m.id,
                id: m.id,
                size: 0,
                sizeFormatted: 'Served',
                provider: this.id,
                capabilities: [],
            }));
        }
        catch {
            return [];
        }
    }
    async generate(messages, options) {
        const res = await fetch(`${this.engineConfig.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            throw new Error(`vLLM error ${res.status}`);
        }
        return { stream: (0, stream_utils_1.openaiStreamToGenerator)(res) };
    }
    async health() {
        try {
            const res = await fetch(`${this.engineConfig.baseUrl}/v1/models`);
            if (res.ok) {
                return { status: 'ok', engine: this.id };
            }
            return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
        }
        catch {
            return { status: 'error', engine: this.id, detail: 'Cannot reach vLLM' };
        }
    }
}
exports.VLLMEngine = VLLMEngine;
