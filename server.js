const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, maxAge: 0 }));

const net = require('net');

const LLAMA_CPP_PATH = path.join(__dirname, '..', 'build', 'bin', 'Release');
const MODELS_PATH = process.env.LLMODELS_PATH || 'C:\\Users\\uttam\\.lmstudio\\models';
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

let llamaProcess = null;
let currentModel = null;
let isStarting = false;
let startPromise = null;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...settings, ...saved };
    }
  } catch (e) {
    console.error('Error loading settings:', e.message);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Error saving settings:', e.message);
  }
}

const defaultSettings = {
  port: 8080,
  contextSize: 4096,
  threads: 4,
  gpuLayers: 99,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.'
};

let settings = { ...defaultSettings };

loadSettings();

function getModelCapabilities(modelPath) {
  const VISION_ARCHS = ['llava', 'qwen2vl', 'qwen2.5vl', 'qwen3vl', 'gemma4vl', 'idefics2', 'paligemma', 'florence2', 'minicpmv', 'xcomposer2'];
  const REASONING_ARCHS = ['qwq', 'deepseek', 'qwen3', 'gemma4'];
  try {
    const fd = fs.openSync(modelPath, 'r');
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    if (header.readUInt32LE(0) !== 0x46554747) { fs.closeSync(fd); return []; }
    const kvCount = Number(header.readBigUInt64LE(16));
    const caps = [];
    let off = 24;
    const r8 = () => { const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, off); off += 8; return b; };
    const r4 = () => { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, off); off += 4; return b; };
    const rStr = (len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); off += len; return b.toString('utf8'); };

    const skip = (type) => {
      switch (type) {
        case 0: case 1: off += 1; break;
        case 2: case 3: off += 2; break;
        case 4: case 5: case 6: off += 4; break;
        case 7: off += 1; break;
        case 8: { const l = Number(r8()); off += l; break; }
        case 9: { const at = r4().readUInt32LE(0); const al = Number(r8()); for (let j = 0; j < al; j++) skip(at); break; }
        case 10: case 11: off += 8; break;
        case 12: off += 8; break;
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
        if (VISION_ARCHS.some(a => arch.includes(a))) caps.push('vision');
        if (REASONING_ARCHS.some(a => arch.includes(a))) caps.push('reasoning');
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
  } catch (e) { return []; }
}

function findGGUFModels() {
  const models = [];
  try {
    const scanDir = (dir, depth = 0) => {
      if (depth > 4) return;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (item.name.endsWith('.gguf')) {
          const stats = fs.statSync(fullPath);
          models.push({
            name: item.name,
            path: fullPath,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            folder: path.basename(path.dirname(fullPath)),
            capabilities: getModelCapabilities(fullPath)
          });
        }
      }
    };
    scanDir(MODELS_PATH);
  } catch (e) {
    console.error('Error scanning models:', e.message);
  }
  return models;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function findAvailablePort(startPort) {
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

function killLlamaProcess() {
  return new Promise((resolve) => {
    if (!llamaProcess) return resolve();
    const proc = llamaProcess;
    llamaProcess = null;
    if (process.platform === 'win32') {
      const child = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
        stdio: 'ignore'
      });
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
      setTimeout(resolve, 3000);
    } else {
      proc.kill();
      resolve();
    }
  });
}

async function startLlamaServer(modelPath) {
  if (isStarting) {
    if (startPromise) return startPromise;
    throw new Error('Server start already in progress');
  }
  isStarting = true;

  startPromise = (async () => {
    let usedPort;
    let serverPath;

    try {
      if (llamaProcess) {
        await killLlamaProcess();
      }

      serverPath = path.join(LLAMA_CPP_PATH, 'llama-server.exe');
      if (!fs.existsSync(serverPath)) {
        throw new Error('llama-server.exe not found at: ' + serverPath);
      }

      usedPort = await findAvailablePort(settings.port);
      if (usedPort !== settings.port) {
        console.log(`[WARN] Port ${settings.port} in use, using ${usedPort} instead`);
        settings.port = usedPort;
        saveSettings();
      }
    } catch (e) {
      isStarting = false;
      startPromise = null;
      throw e;
    }

    return new Promise((resolve, reject) => {

      const serverReadyPatterns = ['listening on', 'running on', 'starting the server', 'server started', 'http://'];

      const caps = getModelCapabilities(modelPath);
      let mmprojPath = null;
      if (caps.includes('vision')) {
        const dir = path.dirname(modelPath);
        try {
          const files = fs.readdirSync(dir);
          const mmproj = files.find(f => f.includes('mmproj') && f.endsWith('.gguf'));
          if (mmproj) mmprojPath = path.join(dir, mmproj);
        } catch (e) {}
      }

      const args = [
        '-m', modelPath,
        '--host', '0.0.0.0',
        '--port', usedPort.toString(),
        '-c', settings.contextSize.toString(),
        '-ngl', settings.gpuLayers.toString(),
        '-t', settings.threads.toString()
      ];
      if (mmprojPath) args.push('--mmproj', mmprojPath);

      console.log('Starting:', serverPath);
      console.log('Args:', args.join(' '));

      const proc = spawn(serverPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      llamaProcess = proc;

      let started = false;

      const onOutput = (data) => {
        const output = data.toString();
        process.stdout.write(output);
        if (!started && serverReadyPatterns.some(p => output.toLowerCase().includes(p))) {
          started = true;
          currentModel = modelPath;
          try {
            proc.stdout.removeAllListeners('data');
            proc.stderr.removeAllListeners('data');
            proc.stdout.on('data', (d) => process.stdout.write(d));
            proc.stderr.on('data', (d) => process.stderr.write(d));
          } catch (e) {}
          console.log('[OK] Server ready');
          resolve({ success: true, port: usedPort });
        }
      };

      proc.stdout.on('data', onOutput);
      proc.stderr.on('data', onOutput);

      const cleanup = () => {
        try {
          proc.stdout.removeAllListeners('data');
          proc.stderr.removeAllListeners('data');
        } catch (e) {}
      };

      proc.on('error', (err) => {
        console.error('Spawn error:', err);
        cleanup();
        if (!started) reject(err);
      });

      proc.on('exit', (code) => {
        console.log('Server exited:', code);
        cleanup();
        llamaProcess = null;
        currentModel = null;
        if (!started) reject(new Error('Server exited with code ' + code));
      });

      setTimeout(() => {
        if (!started) {
          cleanup();
          try { proc.kill(); } catch (e) {}
          reject(new Error('Timeout waiting for server'));
        }
      }, 60000);
    });
  })();

  try {
    const result = await startPromise;
    return result;
  } finally {
    isStarting = false;
    startPromise = null;
  }
}

async function stopLlamaServer() {
  if (llamaProcess) {
    await killLlamaProcess();
    currentModel = null;
  }
  return { success: true };
}

// --- API Routes ---

app.get('/api/models', (req, res) => {
  res.json({ models: findGGUFModels() });
});

app.get('/api/status', (req, res) => {
  res.json({ running: llamaProcess !== null, currentModel, port: settings.port });
});

app.post('/api/server/start', async (req, res) => {
  try {
    const result = await startLlamaServer(req.body.modelPath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/server/stop', async (req, res) => {
  res.json(await stopLlamaServer());
});

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  const sanitized = {};

  const stringFields = ['systemPrompt'];
  for (const f of stringFields) {
    if (typeof body[f] === 'string') {
      sanitized[f] = body[f].trim();
    }
  }

  const numFields = ['temperature', 'topP', 'topK', 'repeatPenalty', 'maxTokens', 'contextSize', 'gpuLayers', 'threads'];
  for (const f of numFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isNaN(n)) sanitized[f] = n;
    }
  }

  settings = { ...settings, ...sanitized };
  saveSettings();
  res.json({ success: true });
});

// --- Chat endpoint with SSE streaming ---

function sanitizeMessages(messages) {
  // Merge consecutive same-role messages to satisfy chat template
  // role alternation requirements (user/assistant/user/assistant/...)
  const result = [];
  for (const msg of messages) {
    const last = result[result.length - 1];
    if (last && last.role === msg.role && msg.role !== 'system') {
      // Merge content
      if (Array.isArray(last.content) && Array.isArray(msg.content)) {
        last.content = [...last.content, ...msg.content];
      } else if (Array.isArray(last.content)) {
        last.content = [...last.content, { type: 'text', text: String(msg.content) }];
      } else if (Array.isArray(msg.content)) {
        last.content = [{ type: 'text', text: String(last.content) }, ...msg.content];
      } else {
        last.content = (last.content || '') + '\n' + (msg.content || '');
      }
    } else {
      result.push({ ...msg });
    }
  }
  return result;
}

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!llamaProcess) {
    return res.status(503).json({ error: 'Server not running' });
  }

  // Only prepend system prompt if the frontend didn't already include one
  const hasSystem = messages.length > 0 && messages[0].role === 'system';
  const allMessages = sanitizeMessages(hasSystem ? messages : [
    { role: 'system', content: settings.systemPrompt },
    ...messages
  ]);

  console.log('[CHAT] Request with', allMessages.length, 'messages');

  try {
    const llmRes = await fetch(`http://127.0.0.1:${settings.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: allMessages,
        temperature: settings.temperature,
        top_p: settings.topP,
        top_k: settings.topK,
        repeat_penalty: settings.repeatPenalty,
        max_tokens: settings.maxTokens,
        stream: true
      })
    });

    if (!llmRes.ok) {
      const err = await llmRes.text();
      console.log('[CHAT] LLM error:', llmRes.status, err);
      return res.status(502).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = llmRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) res.write(trimmed + '\n\n');
        }
      }
      if (buffer.trim()) res.write(buffer.trim() + '\n\n');
    } catch (e) {
      console.error('[CHAT] Stream read error:', e.message);
    }

    res.end();
    console.log('[CHAT] Stream complete');
  } catch (e) {
    console.error('[CHAT] Error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
server = app.listen(PORT, () => {
  console.log(`\n  Llama.cpp UI  ->  http://localhost:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use. Another instance may be running.`);
  } else {
    console.error('[ERROR] Server failed to start:', err.message);
  }
  process.exit(1);
});
