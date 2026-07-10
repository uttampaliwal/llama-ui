import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { engines, type EngineId } from './src/engines/index';
import type { ChatMessage } from './src/engines/base';
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

interface ServerSettings {
  port: number;
  activeEngine: EngineId;
  engineConfigs: Record<string, Record<string, unknown>>;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  maxTokens: number;
  contextSize: number;
  threads: number;
  gpuLayers: number;
  systemPrompt: string;
}

interface ChatMessageDTO {
  role: string;
  content: unknown;
}

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
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<ServerSettings>;
      settings = { ...settings, ...saved };
      engines.setActive(settings.activeEngine);
      for (const [id, config] of Object.entries(settings.engineConfigs || {})) {
        engines.configure(id, config).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Error loading settings:', (e as Error).message);
  }
}

function saveSettings(): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Error saving settings:', (e as Error).message);
  }
}

loadSettings();

function getGpuInfo(): { name: string; used: number; total: number; utilization: number } | null {
  try {
    const { execSync } = require('child_process');
    const out = execSync('nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits', { encoding: 'utf-8', timeout: 3000 }).trim();
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
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

app.get('/api/version', (_req: express.Request, res: express.Response) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
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

  const numFields: (keyof ServerSettings)[] = ['temperature', 'topP', 'topK', 'repeatPenalty', 'maxTokens'];
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
  const { q, architecture, quantization, vision, reasoning, code, tools, tags, languages } = req.query;

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

// --- Plugin API ---

plugins.register(ImageGenerationPlugin);
plugins.register(SpeechPlugin);
plugins.register(WebSearchPlugin);
plugins.register(RAGPlugin);
plugins.register(PythonPlugin);
plugins.register(VisionPlugin);

plugins.activateAll().catch((e) => console.error('[Plugins] Activation error:', e.message));

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

  console.log('[CHAT] Request with', allMessages.length, 'messages via', engines.getActiveId());

  try {
    const result = await engine.generate(allMessages, {
      temperature: settings.temperature,
      topP: settings.topP,
      topK: settings.topK,
      repeatPenalty: settings.repeatPenalty,
      maxTokens: settings.maxTokens,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    result.stream.on('data', (chunk: Buffer) => {
      res.write(chunk);
    });

    result.stream.on('end', () => {
      res.end();
      console.log('[CHAT] Stream complete');
    });

    result.stream.on('error', (err: Error) => {
      console.error('[CHAT] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.end();
      }
    });
  } catch (e) {
    console.error('[CHAT] Error:', (e as Error).message);
    if (!res.headersSent) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
});

const PORT = process.env.PORT || settings.port;
const server = app.listen(PORT, () => {
  console.log(`\n  ModelVerse  ->  http://localhost:${PORT}`);
  console.log(`  Engine: ${engines.getActive().name}\n`);
});

server.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use. Another instance may be running.`);
  } else {
    console.error('[ERROR] Server failed to start:', (err as Error).message);
  }
  process.exit(1);
});
