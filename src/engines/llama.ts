import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import { LLMEngine, type ModelInfo, type ChatMessage, type GenerateOptions, type GenerateResult, type HealthStatus, type EngineConfig } from './base';
import { openaiStreamToGenerator } from './stream-utils';

export interface LlamaCppConfig extends EngineConfig {
  binPath: string;
  modelsPath: string;
  port: number;
  contextSize: number;
  threads: number;
  gpuLayers: number;
}

const VISION_ARCHS = ['llava', 'qwen2vl', 'qwen2.5vl', 'qwen3vl', 'gemma4vl', 'idefics2', 'paligemma', 'florence2', 'minicpmv', 'xcomposer2'];
const REASONING_ARCHS = ['qwq', 'deepseek', 'qwen3', 'gemma4'];

function getModelCapabilities(modelPath: string): string[] {
  try {
    const fd = fs.openSync(modelPath, 'r');
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    if (header.readUInt32LE(0) !== 0x46554747) {
      fs.closeSync(fd);
      return [];
    }
    const kvCount = Number(header.readBigUInt64LE(16));
    const caps: string[] = [];
    let off = 24;
    const r8 = () => {
      const b = Buffer.alloc(8);
      fs.readSync(fd, b, 0, 8, off);
      off += 8;
      return b;
    };
    const r4 = () => {
      const b = Buffer.alloc(4);
      fs.readSync(fd, b, 0, 4, off);
      off += 4;
      return b;
    };
    const rStr = (len: number) => {
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, off);
      off += len;
      return b.toString('utf8');
    };
    const skip = (type: number) => {
      switch (type) {
        case 0: case 1: off += 1; break;
        case 2: case 3: off += 2; break;
        case 4: case 5: case 6: off += 4; break;
        case 7: off += 1; break;
        case 8: { const l = Number(r8()); off += l; break; }
        case 9: { const at = r4().readUInt32LE(0); const al = Number(r8()); for (let j = 0; j < al; j++) skip(at); break; }
        case 10: case 11: case 12: off += 8; break;
        default: off += 4; break;
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
        if (VISION_ARCHS.some((a) => arch.includes(a))) caps.push('vision');
        if (REASONING_ARCHS.some((a) => arch.includes(a))) caps.push('reasoning');
      } else if (key.startsWith('vision.')) {
        if (!caps.includes('vision')) caps.push('vision');
        skip(vType);
      } else if (key === 'tokenizer.chat_template') {
        hasChatTemplate = true;
        skip(vType);
      } else {
        skip(vType);
      }
    }
    if (hasChatTemplate) caps.push('tools');
    fs.closeSync(fd);
    return caps;
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => resolve(startPort));
    });
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

export class LlamaCppEngine extends LLMEngine {
  readonly id = 'llamacpp';
  readonly name = 'llama.cpp';

  protected engineConfig: LlamaCppConfig = {
    binPath: path.join(process.cwd(), 'bin'),
    modelsPath: process.env.LLMODELS_PATH || path.join(process.env.HOME || process.env.USERPROFILE || '', '.lmstudio', 'models'),
    port: 8080,
    contextSize: 4096,
    threads: 4,
    gpuLayers: 99,
  };

  private process: ChildProcess | null = null;
  private currentModel: string | null = null;
  private startPromise: Promise<{ success: boolean; port: number }> | null = null;
  private stopPromise: Promise<void> | null = null;

  configure(config: EngineConfig): void {
    this.engineConfig = { ...this.engineConfig, ...config };
  }

  private async killProcess(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) return resolve();
      const proc = this.process;
      this.process = null;
      if (process.platform === 'win32') {
        const child = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
        setTimeout(resolve, 3000);
      } else {
        proc.kill();
        resolve();
      }
    });
  }

  async start(modelPath: string): Promise<{ success: boolean; port?: number }> {
    if (this.stopPromise) await this.stopPromise;
    if (this.process) await this.killProcess();

    this.startPromise = (async () => {
      const serverPath = path.join(this.engineConfig.binPath, 'llama-server.exe');
      if (!fs.existsSync(serverPath)) {
        throw new Error('llama-server.exe not found at: ' + serverPath);
      }

      const usedPort = await findAvailablePort(this.engineConfig.port);

      return new Promise<{ success: boolean; port: number }>((resolve, reject) => {
        const serverReadyPatterns = ['listening on', 'running on', 'starting the server', 'server started', 'http://'];

        let mmprojPath: string | null = null;
        try {
          const files = fs.readdirSync(path.dirname(modelPath));
          const mmproj = files.find((f) => f.includes('mmproj') && f.endsWith('.gguf'));
          if (mmproj) mmprojPath = path.join(path.dirname(modelPath), mmproj);
        } catch {}

        const args = [
          '-m', modelPath,
          '--host', '0.0.0.0',
          '--port', usedPort.toString(),
          '-c', this.engineConfig.contextSize.toString(),
          '-ngl', this.engineConfig.gpuLayers.toString(),
          '-t', this.engineConfig.threads.toString(),
        ];
        if (mmprojPath) args.push('--mmproj', mmprojPath);

        console.log('[llama.cpp] Starting:', serverPath);
        const proc = spawn(serverPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          cwd: this.engineConfig.binPath,
        });
        this.process = proc;

        let started = false;
        let stderrOutput = '';

        const onOutput = (data: Buffer): void => {
          const output = data.toString();
          process.stdout.write(output);
          stderrOutput += output;
          if (!started && serverReadyPatterns.some((p) => output.toLowerCase().includes(p))) {
            started = true;
            this.currentModel = modelPath;
            try {
              proc.stdout?.removeAllListeners('data');
              proc.stderr?.removeAllListeners('data');
              if (proc.stdout) proc.stdout.on('data', (d) => process.stdout.write(d));
              if (proc.stderr) proc.stderr.on('data', (d) => process.stderr.write(d));
            } catch {}
            console.log('[llama.cpp] Server ready');
            resolve({ success: true, port: usedPort });
          }
        };

        proc.stdout?.on('data', onOutput);
        proc.stderr?.on('data', onOutput);

        const cleanup = (): void => {
          try {
            proc.stdout?.removeAllListeners('data');
            proc.stderr?.removeAllListeners('data');
          } catch {}
        };

        proc.on('error', (err) => {
          cleanup();
          if (!started) reject(err);
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
            try { proc.kill(); } catch {}
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
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<{ success: boolean }> {
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

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    try {
      const scanDir = (dir: string, depth = 0): void => {
        if (depth > 4) return;
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (item.name.endsWith('.gguf') && !item.name.toLowerCase().includes('mmproj')) {
            const stats = fs.statSync(fullPath);
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
            } as ModelInfo & Record<string, unknown>);
          }
        }
      };
      scanDir(this.engineConfig.modelsPath);
    } catch (e) {
      console.error('[llama.cpp] Error scanning models:', (e as Error).message);
    }
    return models;
  }

  async generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult> {
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

    return { stream: openaiStreamToGenerator(res) };
  }

  async health(): Promise<HealthStatus> {
    if (!this.process) {
      return { status: 'stopped', engine: this.id };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${this.engineConfig.port}/health`);
      if (res.ok) {
        return { status: 'ok', engine: this.id };
      }
      return { status: 'error', engine: this.id, detail: `HTTP ${res.status}` };
    } catch {
      return { status: 'error', engine: this.id, detail: 'Cannot reach server' };
    }
  }
}
