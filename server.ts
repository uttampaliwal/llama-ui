import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { engines, type EngineId } from './src/engines/index';
import type { ChatMessage, GenerateOptions } from './src/engines/base';
import { plugins } from './src/plugins/index';
import { ImageGenerationPlugin } from './src/plugins/image-generation';
import { SpeechPlugin } from './src/plugins/speech';
import { WebSearchPlugin } from './src/plugins/web-search';
import { RAGPlugin } from './src/plugins/rag';
import { PythonPlugin } from './src/plugins/python';
import { VisionPlugin } from './src/plugins/vision';
import {
  listProfiles,
  getProfile,
  getActiveProfile,
  setActiveProfile,
  saveProfile,
  deleteProfile,
} from './src/profiles';
import {
  getMetadata,
  getAllMetadata,
  updateMetadata,
  deleteMetadata,
  searchMetadata,
  filterMetadata,
} from './src/model-metadata';
import {
  scanAllModels,
  getScannerConfig,
  updateScannerConfig,
  getAvailableSources,
} from './src/model-scanner';
import { log } from './src/logger';
import { serverSettingsSchema, packageJsonSchema, loadAndValidate } from './src/config-schemas';

export type ServerSettings = import('./src/config-schemas').ServerSettings;

interface ChatMessageDTO {
  role: string;
  content: unknown;
}

// ---------------------------------------------------------------------------
// Request Queue – serializes generation requests so only one runs at a time
// ---------------------------------------------------------------------------
interface QueueEntry {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  messages: ChatMessage[];
  options: GenerateOptions;
  res: express.Response;
  createdAt: Date;
  error?: string;
}

function sendSSE(res: express.Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

class RequestQueue {
  private entries: QueueEntry[] = [];
  private currentId: string | null = null;
  private processing = false;

  enqueue(messages: ChatMessage[], options: GenerateOptions, res: express.Response): QueueEntry {
    const isBusy = this.currentId !== null;
    const entry: QueueEntry = {
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2),
      status: isBusy ? 'queued' : 'running',
      messages,
      options,
      res,
      createdAt: new Date(),
    };
    this.entries.push(entry);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Clean up on client disconnect
    res.on('close', () => {
      const idx = this.entries.indexOf(entry);
      if (idx !== -1) {
        const e = this.entries[idx];
        if (e.status === 'queued') {
          this.entries.splice(idx, 1);
          log.server('Client disconnected, removed queued request ' + entry.id);
        } else if (e.status === 'running') {
          // Don't remove running entry; the stream error handler will clean up
        }
      }
    });

    if (isBusy) {
      const pos = this.entries.filter((e) => e.status === 'queued').length;
      sendSSE(res, { queue: { status: 'queued', position: pos } });
      log.server('Request queued at position ' + pos + ' (' + entry.id + ')');
    } else {
      this.currentId = entry.id;
      sendSSE(res, { queue: { status: 'running' } });
      setImmediate(() => this.processEntry(entry));
    }

    return entry;
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    const engine = engines.getActive();
    if (!engine.running) {
      if (!entry.res.headersSent) {
        entry.res.setHeader('Content-Type', 'text/event-stream');
        entry.res.setHeader('Cache-Control', 'no-cache');
        entry.res.setHeader('Connection', 'keep-alive');
        entry.res.setHeader('X-Accel-Buffering', 'no');
      }
      sendSSE(entry.res, { queue: { status: 'error', message: 'Engine not running' } });
      entry.res.end();
      entry.status = 'failed';
      entry.error = 'Engine not running';
      this.currentId = null;
      this.processing = false;
      this.entries = this.entries.filter((e) => e.id !== entry.id);
      this.dequeueNext();
      return;
    }

    try {
      const result = await engine.generate(entry.messages, entry.options);

      try {
        for await (const token of result.stream) {
          if (token) {
            entry.res.write(
              `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`,
            );
          }
        }
        entry.res.write('data: [DONE]\n\n');
        entry.res.end();
        entry.status = 'completed';
        log.server('Stream complete');
      } catch (streamErr) {
        log.error('Stream error', streamErr as Error);
        if (!entry.res.headersSent) {
          entry.res.status(500).json({ error: (streamErr as Error).message });
        } else {
          sendSSE(entry.res, { error: (streamErr as Error).message });
          entry.res.end();
        }
        entry.status = 'failed';
        entry.error = (streamErr as Error).message;
      }

      this.currentId = null;
      this.processing = false;
      this.entries = this.entries.filter((e) => e.id !== entry.id);
      this.dequeueNext();
    } catch (e) {
      log.error('Chat generate error', e as Error);
      if (!entry.res.headersSent) {
        entry.res.status(500).json({ error: (e as Error).message });
      } else {
        sendSSE(entry.res, { error: (e as Error).message });
        entry.res.end();
      }
      entry.status = 'failed';
      entry.error = (e as Error).message;
      this.currentId = null;
      this.processing = false;
      this.entries = this.entries.filter((e) => e.id !== entry.id);
      this.dequeueNext();
    }
  }

  private dequeueNext(): void {
    const next = this.entries.find((e) => e.status === 'queued');
    if (next) {
      next.status = 'running';
      this.currentId = next.id;
      sendSSE(next.res, { queue: { status: 'running' } });
      setImmediate(() => this.processEntry(next));
    }
  }

  getStatus(): {
    current: string | null;
    entries: { id: string; status: string; createdAt: Date; position?: number }[];
  } {
    const entries = this.entries.map((e, i) => ({
      id: e.id,
      status: e.status,
      createdAt: e.createdAt,
      position:
        e.status === 'queued'
          ? this.entries.filter((x) => x.status === 'queued' && this.entries.indexOf(x) < i)
              .length + 1
          : undefined,
    }));
    return { current: this.currentId, entries };
  }

  cancel(id: string): boolean {
    const entry = this.entries.find((e) => e.id === id && e.status === 'queued');
    if (!entry) return false;
    entry.status = 'cancelled';
    entry.res.end();
    const idx = this.entries.indexOf(entry);
    if (idx !== -1) this.entries.splice(idx, 1);
    return true;
  }
}

const requestQueue = new RequestQueue();

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function getDefaultSettings(): ServerSettings {
  const profile = getActiveProfile();
  return {
    port: 3000,
    activeEngine: 'llamacpp',
    engineConfigs: {},
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    repeatPenalty: profile.repeatPenalty,
    maxTokens: profile.maxTokens,
    contextSize: profile.contextSize,
    threads: profile.threads,
    gpuLayers: profile.gpuLayers,
    systemPrompt: profile.systemPrompt,
  };
}

let settings: ServerSettings = getDefaultSettings();

function loadSettings(): void {
  settings = loadAndValidate(serverSettingsSchema, SETTINGS_FILE, getDefaultSettings(), 'Settings');
  engines.setActive(settings.activeEngine);
  for (const [id, config] of Object.entries(settings.engineConfigs || {})) {
    engines.configure(id, config).catch(() => {});
  }
}

function saveSettings(): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    log.error('Error saving settings', e as Error);
  }
}

loadSettings();

function getGpuInfo(): { name: string; used: number; total: number; utilization: number } | null {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();
    const [name, used, total, utilization] = out.split(',').map((s: string) => s.trim());
    return {
      name,
      used: parseInt(used) * 1024 * 1024,
      total: parseInt(total) * 1024 * 1024,
      utilization: parseInt(utilization),
    };
  } catch {
    return null;
  }
}

function sanitizeMessages(messages: ChatMessageDTO[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role && msg.role !== 'system') {
      last.content = last.content + '\n\n' + String(msg.content);
    } else {
      result.push({ role: msg.role as ChatMessage['role'], content: String(msg.content) });
    }
  }
  return result;
}

// --- API Routes ---

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }),
);

app.get('/api/version', (_req: express.Request, res: express.Response) => {
  const pkg = loadAndValidate(
    packageJsonSchema,
    path.join(__dirname, 'package.json'),
    { version: '0.0.0' },
    'Package',
  );
  res.json({ version: pkg.version });
});

app.get('/api/engines', (_req: express.Request, res: express.Response) => {
  res.json({
    engines: engines.listAvailable(),
    active: engines.getActiveId(),
  });
});

app.post('/api/engines/switch', (req: express.Request, res: express.Response) => {
  const { engineId } = req.body as { engineId: string };
  try {
    engines.setActive(engineId);
    settings.activeEngine = engineId as EngineId;
    saveSettings();
    res.json({ success: true, active: engineId });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/models', async (_req: express.Request, res: express.Response) => {
  try {
    const engine = engines.getActive();
    const models = await engine.listModels();
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/status', async (_req: express.Request, res: express.Response) => {
  const engine = engines.getActive();
  const health = await engine.health();
  res.json({
    running: engine.running,
    engine: engines.getActiveId(),
    health,
    port: settings.port,
  });
});

app.get('/api/system', (_req: express.Request, res: express.Response) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  res.json({
    gpu: getGpuInfo(),
    ram: { used: usedMem, total: totalMem },
  });
});

app.post('/api/server/start', async (req: express.Request, res: express.Response) => {
  try {
    const { modelPath } = req.body as { modelPath: string };
    if (typeof modelPath !== 'string' || !modelPath.trim()) {
      return res.status(400).json({ error: 'modelPath must be a non-empty string' });
    }
    if (modelPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid model path' });
    }
    if (!fs.existsSync(modelPath)) {
      return res.status(400).json({ error: 'Model file not found' });
    }
    const ext = path.extname(modelPath).toLowerCase();
    if (ext !== '.gguf' && ext !== '.gguf_split') {
      return res.status(400).json({ error: 'Model must be a .gguf file' });
    }
    const engine = engines.getActive();
    const result = await engine.start(modelPath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/server/stop', async (_req: express.Request, res: express.Response) => {
  try {
    const engine = engines.getActive();
    const result = await engine.stop();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/settings', (_req: express.Request, res: express.Response) => {
  res.json(settings);
});

app.post('/api/settings', (req: express.Request, res: express.Response) => {
  const body = req.body as Record<string, unknown>;
  const sanitized: Record<string, string | number> = {};

  const stringFields: (keyof ServerSettings)[] = ['systemPrompt'];
  for (const f of stringFields) {
    const v = body[f];
    if (typeof v === 'string') {
      sanitized[f] = v.trim();
    }
  }

  const numFields: (keyof ServerSettings)[] = [
    'temperature',
    'topP',
    'topK',
    'repeatPenalty',
    'maxTokens',
  ];
  for (const f of numFields) {
    const v = body[f];
    if (v !== undefined) {
      const n = Number(v);
      if (!Number.isNaN(n)) sanitized[f] = n;
    }
  }

  settings = { ...settings, ...(sanitized as Partial<ServerSettings>) };
  saveSettings();
  res.json({ success: true });
});

// --- Profile API ---

app.get('/api/profiles', (_req: express.Request, res: express.Response) => {
  const profiles = listProfiles();
  res.json({ profiles });
});

app.get('/api/profiles/active', (_req: express.Request, res: express.Response) => {
  const profile = getActiveProfile();
  res.json({ profile });
});

app.post('/api/profiles/switch', (req: express.Request, res: express.Response) => {
  const { name } = req.body as { name: string };
  const success = setActiveProfile(name);
  if (!success) {
    return res.status(404).json({ error: `Profile not found: ${name}` });
  }
  const profile = getActiveProfile();
  settings.temperature = profile.temperature;
  settings.topP = profile.topP;
  settings.topK = profile.topK;
  settings.repeatPenalty = profile.repeatPenalty;
  settings.maxTokens = profile.maxTokens;
  settings.contextSize = profile.contextSize;
  settings.threads = profile.threads;
  settings.gpuLayers = profile.gpuLayers;
  settings.systemPrompt = profile.systemPrompt;
  saveSettings();
  res.json({ success: true, profile });
});

app.post('/api/profiles/save', (req: express.Request, res: express.Response) => {
  const { name, ...data } = req.body as { name: string } & Partial<ServerSettings>;
  if (!name) {
    return res.status(400).json({ error: 'Profile name required' });
  }
  const profile = saveProfile(name, data);
  res.json({ success: true, profile });
});

app.delete('/api/profiles/:name', (req: express.Request, res: express.Response) => {
  const name = req.params.name as string;
  const success = deleteProfile(name);
  if (!success) {
    return res.status(404).json({ error: `Profile not found: ${name}` });
  }
  res.json({ success: true });
});

// --- Model Metadata API ---

app.get('/api/metadata', (_req: express.Request, res: express.Response) => {
  const metadata = getAllMetadata();
  res.json({ models: metadata });
});

app.get('/api/metadata/search', (req: express.Request, res: express.Response) => {
  const { q, architecture, quantization, vision, reasoning, code, tools, tags, languages } =
    req.query;

  const results = filterMetadata({
    query: q as string,
    architecture: architecture as string,
    quantization: quantization as string,
    vision: vision === 'true' ? true : vision === 'false' ? false : undefined,
    reasoning: reasoning === 'true' ? true : reasoning === 'false' ? false : undefined,
    code: code === 'true' ? true : code === 'false' ? false : undefined,
    tools: tools === 'true' ? true : tools === 'false' ? false : undefined,
    tags: tags ? (tags as string).split(',') : undefined,
    languages: languages ? (languages as string).split(',') : undefined,
  });

  res.json({ models: results, count: results.length });
});

app.get('/api/metadata/:id', (req: express.Request, res: express.Response) => {
  const meta = getMetadata(req.params.id as string);
  if (!meta) {
    return res.status(404).json({ error: 'Model not found' });
  }
  res.json({ model: meta });
});

app.put('/api/metadata/:id', (req: express.Request, res: express.Response) => {
  const updates = req.body as Partial<import('./src/model-metadata').ModelMetadata>;
  const updated = updateMetadata(req.params.id as string, updates);
  if (!updated) {
    return res.status(404).json({ error: 'Model not found' });
  }
  res.json({ model: updated });
});

app.delete('/api/metadata/:id', (req: express.Request, res: express.Response) => {
  const success = deleteMetadata(req.params.id as string);
  if (!success) {
    return res.status(404).json({ error: 'Model not found' });
  }
  res.json({ success: true });
});

// --- Model Scanner API ---

app.get('/api/scanner/scan', (_req: express.Request, res: express.Response) => {
  const models = scanAllModels();
  res.json({ models, count: models.length });
});

app.get('/api/scanner/sources', (_req: express.Request, res: express.Response) => {
  const sources = getAvailableSources();
  res.json({ sources });
});

app.get('/api/scanner/config', (_req: express.Request, res: express.Response) => {
  const config = getScannerConfig();
  res.json({ config });
});

app.post('/api/scanner/config', (req: express.Request, res: express.Response) => {
  const updates = req.body as Partial<import('./src/model-scanner').ScannerConfig>;
  const config = updateScannerConfig(updates);
  res.json({ success: true, config });
});

// --- Plugin API ---

plugins.register(ImageGenerationPlugin);
plugins.register(SpeechPlugin);
plugins.register(WebSearchPlugin);
plugins.register(RAGPlugin);
plugins.register(PythonPlugin);
plugins.register(VisionPlugin);

plugins.activateAll().catch((e) => log.error('Plugins activation error', e));

app.get('/api/plugins', (_req: express.Request, res: express.Response) => {
  res.json({ plugins: plugins.listAvailable() });
});

app.post('/api/plugins/toggle', async (req: express.Request, res: express.Response) => {
  const { pluginId } = req.body as { pluginId: string };
  try {
    const enabled = await plugins.toggle(pluginId);
    res.json({ success: true, enabled });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get('/api/plugins/tools', (_req: express.Request, res: express.Response) => {
  const tools = plugins.getAllTools().map(({ pluginId, tool }) => ({
    pluginId,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  res.json({ tools });
});

app.post('/api/plugins/tools/execute', async (req: express.Request, res: express.Response) => {
  const { tool, params } = req.body as { tool: string; params: Record<string, unknown> };
  try {
    const result = await plugins.executeTool(tool, params || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Queue API ---

app.get('/api/queue', (_req: express.Request, res: express.Response) => {
  res.json(requestQueue.getStatus());
});

app.delete('/api/queue/:id', (req: express.Request, res: express.Response) => {
  const ok = requestQueue.cancel(req.params.id as string);
  if (!ok) return res.status(404).json({ error: 'Queued request not found' });
  res.json({ success: true });
});

app.post('/api/chat', async (req: express.Request, res: express.Response) => {
  const { messages } = req.body as { messages: ChatMessageDTO[] };
  const engine = engines.getActive();

  if (!engine.running) {
    return res.status(503).json({ error: 'Engine not running' });
  }

  const hasSystem = messages.length > 0 && messages[0].role === 'system';
  const allMessages = sanitizeMessages(
    hasSystem ? messages : [{ role: 'system', content: settings.systemPrompt }, ...messages],
  );

  const opts: GenerateOptions = {
    temperature: settings.temperature,
    topP: settings.topP,
    topK: settings.topK,
    repeatPenalty: settings.repeatPenalty,
    maxTokens: settings.maxTokens,
  };

  requestQueue.enqueue(allMessages, opts, res);
});

const PORT = process.env.PORT || settings.port;
const server = app.listen(PORT, () => {
  console.log(`\n  ModelVerse  ->  http://localhost:${PORT}`);
  console.log(`  Engine: ${engines.getActive().name}\n`);
});

server.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    log.error(`Port ${PORT} is already in use. Another instance may be running.`);
  } else {
    log.error('Server failed to start', err);
  }
  process.exit(1);
});
