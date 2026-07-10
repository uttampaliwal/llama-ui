"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransformersEngine = void 0;
const base_1 = require("./base");
const stream_utils_1 = require("./stream-utils");
class TransformersEngine extends base_1.LLMEngine {
    id = 'transformers';
    name = 'Transformers.js';
    engineConfig = {
        model: 'Xenova/gpt2',
        device: 'cpu',
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
        return [];
    }
    async generate(messages, options) {
        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';
        const text = `[Transformers.js] Model: ${this.engineConfig.model}\n\nPrompt received. Full implementation requires @huggingface/transformers.\n`;
        return { stream: (0, stream_utils_1.toGenerator)(text) };
    }
    async health() {
        return { status: 'ok', engine: this.id };
    }
}
exports.TransformersEngine = TransformersEngine;
