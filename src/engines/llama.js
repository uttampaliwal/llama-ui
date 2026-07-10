"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlamaCppEngine = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const stream_1 = require("stream");
const base_1 = require("./base");
const VISION_ARCHS = ['llava', 'qwen2vl', 'qwen2.5vl', 'qwen3vl', 'gemma4vl', 'idefics2', 'paligemma', 'florence2', 'minicpmv', 'xcomposer2'];
const REASONING_ARCHS = ['qwq', 'deepseek', 'qwen3', 'gemma4'];
function getModelCapabilities(modelPath) {
    try {
        const fd = fs_1.default.openSync(modelPath, 'r');
        const header = Buffer.alloc(24);
        fs_1.default.readSync(fd, header, 0, 24, 0);
        if (header.readUInt32LE(0) !== 0x46554747) {
            fs_1.default.closeSync(fd);
            return [];
        }
        const kvCount = Number(header.readBigUInt64LE(16));
        const caps = [];
        let off = 24;
        const r8 = () => {
            const b = Buffer.alloc(8);
            fs_1.default.readSync(fd, b, 0, 8, off);
            off += 8;
            return b;
        };
        const r4 = () => {
            const b = Buffer.alloc(4);
            fs_1.default.readSync(fd, b, 0, 4, off);
            off += 4;
            return b;
        };
        const rStr = (len) => {
            const b = Buffer.alloc(len);
            fs_1.default.readSync(fd, b, 0, len, off);
            off += len;
            return b.toString('utf8');
        };
        const skip = (type) => {
            switch (type) {
                case 0:
                case 1:
                    off += 1;
                    break;
                case 2:
                case 3:
                    off += 2;
                    break;
                case 4:
                case 5:
                case 6:
                    off += 4;
                    break;
                case 7:
                    off += 1;
                    break;
                case 8: {
                    const l = Number(r8());
                    off += l;
                    break;
                }
                case 9: {
                    const at = r4().readUInt32LE(0);
                    const al = Number(r8());
                    for (let j = 0; j < al; j++)
                        skip(at);
                    break;
                }
                case 10:
                case 11:
                case 12:
                    off += 8;
                    break;
                default:
                    off += 4;
                    break;
            }
        };
        let hasChatTemplate = false;
        for (let i = 0; i < kvCount; i++) {
            const kLen = Number(r8());
            const key = rStr(kLen);
            const vType = r4().readUInt32LE(0);
            if (key === 'general.architecture') {
                const sLen = Number(r8());
                const arch = rStr(sLen).toLowerCase();
                if (VISION_ARCHS.some((a) => arch.includes(a)))
                    caps.push('vision');
                if (REASONING_ARCHS.some((a) => arch.includes(a)))
                    caps.push('reasoning');
            }
            else if (key.startsWith('vision.')) {
                if (!caps.includes('vision'))
                    caps.push('vision');
                skip(vType);
            }
            else if (key === 'tokenizer.chat_template') {
                hasChatTemplate = true;
                skip(vType);
            }
            else {
                skip(vType);
            }
        }
        if (hasChatTemplate)
            caps.push('tools');
        fs_1.default.closeSync(fd);
        return caps;
    }
    catch {
        return [];
    }
}
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
async function findAvailablePort(startPort) {
    return new Promise((resolve) => {
        const server = net_1.default.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            server.close(() => resolve(startPort));
        });
        server.on('error', () => {
            resolve(findAvailablePort(startPort + 1));
        });
    });
}
class LlamaCppEngine extends base_1.LLMEngine {
    id = 'llamacpp';
    name = 'llama.cpp';
    engineConfig = {
        binPath: path_1.default.join(process.cwd(), 'bin'),
        modelsPath: process.env.LLMODELS_PATH || path_1.default.join(process.env.HOME || process.env.USERPROFILE || '', '.lmstudio', 'models'),
        port: 8080,
        contextSize: 4096,
        threads: 4,
        gpuLayers: 99,
    };
    process = null;
    currentModel = null;
    startPromise = null;
    stopPromise = null;
    configure(config) {
        this.engineConfig = { ...this.engineConfig, ...config };
    }
    async killProcess() {
        return new Promise((resolve) => {
            if (!this.process)
                return resolve();
            const proc = this.process;
            this.process = null;
            if (process.platform === 'win32') {
                const child = (0, child_process_1.spawn)('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
                child.on('exit', () => resolve());
                child.on('error', () => resolve());
                setTimeout(resolve, 3000);
            }
            else {
                proc.kill();
                resolve();
            }
        });
    }
    async start(modelPath) {
        if (this.stopPromise)
            await this.stopPromise;
        if (this.process)
            await this.killProcess();
        this.startPromise = (async () => {
            const serverPath = path_1.default.join(this.engineConfig.binPath, 'llama-server.exe');
            if (!fs_1.default.existsSync(serverPath)) {
                throw new Error('llama-server.exe not found at: ' + serverPath);
            }
            const usedPort = await findAvailablePort(this.engineConfig.port);
            return new Promise((resolve, reject) => {
                const serverReadyPatterns = ['listening on', 'running on', 'starting the server', 'server started', 'http://'];
                let mmprojPath = null;
                try {
                    const files = fs_1.default.readdirSync(path_1.default.dirname(modelPath));
                    const mmproj = files.find((f) => f.includes('mmproj') && f.endsWith('.gguf'));
                    if (mmproj)
                        mmprojPath = path_1.default.join(path_1.default.dirname(modelPath), mmproj);
                }
                catch { }
                const args = [
                    '-m', modelPath,
                    '--host', '0.0.0.0',
                    '--port', usedPort.toString(),
                    '-c', this.engineConfig.contextSize.toString(),
                    '-ngl', this.engineConfig.gpuLayers.toString(),
                    '-t', this.engineConfig.threads.toString(),
                ];
                if (mmprojPath)
                    args.push('--mmproj', mmprojPath);
                console.log('[llama.cpp] Starting:', serverPath);
                const proc = (0, child_process_1.spawn)(serverPath, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    cwd: this.engineConfig.binPath,
                });
                this.process = proc;
                let started = false;
                let stderrOutput = '';
                const onOutput = (data) => {
                    const output = data.toString();
                    process.stdout.write(output);
                    stderrOutput += output;
                    if (!started && serverReadyPatterns.some((p) => output.toLowerCase().includes(p))) {
                        started = true;
                        this.currentModel = modelPath;
                        try {
                            proc.stdout?.removeAllListeners('data');
                            proc.stderr?.removeAllListeners('data');
                            if (proc.stdout)
                                proc.stdout.on('data', (d) => process.stdout.write(d));
                            if (proc.stderr)
                                proc.stderr.on('data', (d) => process.stderr.write(d));
                        }
                        catch { }
                        console.log('[llama.cpp] Server ready');
                        resolve({ success: true, port: usedPort });
                    }
                };
                proc.stdout?.on('data', onOutput);
                proc.stderr?.on('data', onOutput);
                const cleanup = () => {
                    try {
                        proc.stdout?.removeAllListeners('data');
                        proc.stderr?.removeAllListeners('data');
                    }
                    catch { }
                };
                proc.on('error', (err) => {
                    cleanup();
                    if (!started)
                        reject(err);
                });
                proc.on('exit', (code) => {
                    cleanup();
                    if (this.process === proc) {
                        this.process = null;
                        this.currentModel = null;
                    }
                    if (!started) {
                        const detail = stderrOutput.trim().split('\n').slice(-10).join('\n');
                        reject(new Error('Server exited with code ' + code + (detail ? '\n' + detail : '')));
                    }
                });
                setTimeout(() => {
                    if (!started) {
                        cleanup();
                        try {
                            proc.kill();
                        }
                        catch { }
                        reject(new Error('Timeout waiting for server'));
                    }
                }, 60000);
            });
        })();
        try {
            const result = await this.startPromise;
            this._running = result.success;
            this.engineConfig.port = result.port || this.engineConfig.port;
            return result;
        }
        finally {
            this.startPromise = null;
        }
    }
    async stop() {
        const p = (async () => {
            if (this.process) {
                await this.killProcess();
                this.currentModel = null;
            }
            this._running = false;
        })();
        this.stopPromise = p;
        await p;
        this.stopPromise = null;
        return { success: true };
    }
    async listModels() {
        const models = [];
        try {
            const scanDir = (dir, depth = 0) => {
                if (depth > 4)
                    return;
                const items = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path_1.default.join(dir, item.name);
                    if (item.isDirectory()) {
                        scanDir(fullPath, depth + 1);
                    }
                    else if (item.name.endsWith('.gguf') && !item.name.toLowerCase().includes('mmproj')) {
                        const stats = fs_1.default.statSync(fullPath);
                        const caps = getModelCapabilities(fullPath);
                        // Auto-generate metadata
                        const { getOrCreateMetadata } = require('../model-metadata');
                        const metadata = getOrCreateMetadata(fullPath, this.id, {
                            vision: caps.includes('vision'),
                            reasoning: caps.includes('reasoning'),
                            tools: caps.includes('tools'),
                        });
                        models.push({
                            name: item.name,
                            id: fullPath,
                            size: stats.size,
                            sizeFormatted: formatBytes(stats.size),
                            provider: this.id,
                            capabilities: caps,
                            // Extended metadata
                            parameters: metadata.parameters,
                            quantization: metadata.quantization,
                            architecture: metadata.architecture,
                            contextLength: metadata.contextLength,
                            languages: metadata.languages,
                            tags: metadata.tags,
                            memoryRequired: metadata.memoryRequired,
                            description: metadata.description,
                        });
                    }
                }
            };
            scanDir(this.engineConfig.modelsPath);
        }
        catch (e) {
            console.error('[llama.cpp] Error scanning models:', e.message);
        }
        return models;
    }
    async generate(messages, options) {
        if (!this.process || !this._running) {
            throw new Error('Engine not running');
        }
        const res = await fetch(`http://127.0.0.1:${this.engineConfig.port}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                temperature: options?.temperature ?? 0.7,
                top_p: options?.topP ?? 0.9,
                top_k: options?.topK ?? 40,
                repeat_penalty: options?.repeatPenalty ?? 1.1,
                max_tokens: options?.maxTokens ?? 4096,
                stream: true,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`LLM error ${res.status}: ${err}`);
        }
        if (!res.body) {
            throw new Error('No response body');
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const stream = new stream_1.Readable({
            read() { },
        });
        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (!value)
                        continue;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed)
                            stream.push(trimmed + '\n\n');
                    }
                }
                if (buffer.trim())
                    stream.push(buffer.trim() + '\n\n');
                stream.push(null);
            }
            catch (e) {
                stream.destroy(e);
            }
        })();
        return { stream };
    }
    async health() {
        if (!this.process) {
            return { status: 'stopped', engine: this.id };
        }
        try {
            const res = await fetch(`http://127.0.0.1:${this.engineConfig.port}/health`);
            if (res.ok) {
                return { status: 'ok', engine: this.id };
            }
            return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
        }
        catch {
            return { status: 'error', engine: this.id, detail: 'Cannot reach server' };
        }
    }
}
exports.LlamaCppEngine = LlamaCppEngine;
