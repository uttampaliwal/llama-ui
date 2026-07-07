const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LLAMA_CPP_PATH = path.join(__dirname, '..', 'build', 'bin', 'Release');
const MODELS_PATH = process.env.LLMODELS_PATH || 'C:\\Users\\uttam\\.lmstudio\\models';

let llamaProcess = null;
let currentModel = null;
let serverPort = 8080;

const defaultSettings = {
  port: 8080,
  contextSize: 4096,
  threads: 4,
  gpuLayers: 99,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 2048,
  systemPrompt: 'You are a helpful assistant.'
};

let settings = { ...defaultSettings };

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
            folder: path.basename(path.dirname(fullPath))
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

function startLlamaServer(modelPath) {
  return new Promise((resolve, reject) => {
    if (llamaProcess) {
      llamaProcess.kill();
      llamaProcess = null;
    }

    const serverPath = path.join(LLAMA_CPP_PATH, 'llama-server.exe');
    
    if (!fs.existsSync(serverPath)) {
      reject(new Error('llama-server.exe not found'));
      return;
    }

    const args = [
      '-m', modelPath,
      '--host', '0.0.0.0',
      '--port', settings.port.toString(),
      '-c', settings.contextSize.toString(),
      '-ngl', settings.gpuLayers.toString(),
      '-t', settings.threads.toString(),
      '-lv', '0'
    ];

    console.log('Starting server:', serverPath, args.join(' '));

    llamaProcess = spawn(serverPath, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let started = false;

    const onOutput = (data) => {
      const output = data.toString();
      console.log(output);
      
      if (!started && output.includes('listening on')) {
        started = true;
        currentModel = modelPath;
        resolve({ success: true, port: settings.port });
      }
    };

    llamaProcess.stdout.on('data', onOutput);
    llamaProcess.stderr.on('data', onOutput);

    llamaProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    llamaProcess.on('exit', (code) => {
      console.log('Server exited with code:', code);
      llamaProcess = null;
      currentModel = null;
    });

    setTimeout(() => {
      if (!started) {
        llamaProcess.kill();
        reject(new Error('Server startup timeout'));
      }
    }, 30000);
  });
}

function stopLlamaServer() {
  return new Promise((resolve) => {
    if (llamaProcess) {
      llamaProcess.on('exit', () => {
        resolve({ success: true });
      });
      llamaProcess.kill();
      llamaProcess = null;
      currentModel = null;
    } else {
      resolve({ success: true, message: 'No server running' });
    }
  });
}

async function queryLLM(messages, stream = true) {
  const response = await fetch(`http://127.0.0.1:${settings.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: settings.temperature,
      top_p: settings.topP,
      top_k: settings.topK,
      repeat_penalty: settings.repeatPenalty,
      max_tokens: settings.maxTokens,
      stream
    })
  });
  return response;
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'chat') {
        const messages = [
          { role: 'system', content: settings.systemPrompt },
          ...message.history,
          { role: 'user', content: message.content }
        ];

        try {
          const response = await queryLLM(messages, true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  ws.send(JSON.stringify({ type: 'done' }));
                } else {
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                      ws.send(JSON.stringify({ type: 'token', content }));
                    }
                  } catch (e) {}
                }
              }
            }
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', content: e.message }));
        }
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

app.get('/api/models', (req, res) => {
  const models = findGGUFModels();
  res.json({ models });
});

app.get('/api/status', (req, res) => {
  res.json({
    running: llamaProcess !== null,
    currentModel,
    port: settings.port
  });
});

app.post('/api/server/start', async (req, res) => {
  try {
    const { modelPath } = req.body;
    const result = await startLlamaServer(modelPath);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/server/stop', async (req, res) => {
  const result = await stopLlamaServer();
  res.json(result);
});

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  res.json({ success: true, settings });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, stream = false } = req.body;
    
    const allMessages = [
      { role: 'system', content: settings.systemPrompt },
      ...messages
    ];

    const response = await queryLLM(allMessages, stream);
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
      res.end();
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    Llama.cpp Web UI                         ║
║                  http://localhost:${PORT}                    ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
