import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { getOrCreateMetadata, type ModelMetadata } from './model-metadata';

export interface ScannedModel {
  id: string;
  name: string;
  path: string;
  source: ModelSource;
  size: number;
  sizeFormatted: string;
  format: string;
  metadata: Partial<ModelMetadata>;
}

export type ModelSource =
  | 'lmstudio'
  | 'ollama'
  | 'llamacpp'
  | 'gpt4all'
  | 'jan'
  | 'openwebui'
  | 'transformers'
  | 'custom';

export interface ScannerConfig {
  customPaths: string[];
  enabledSources: ModelSource[];
}

const CONFIG_FILE = path.join(process.cwd(), 'scanner-config.json');

function loadConfig(): ScannerConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {
    customPaths: [],
    enabledSources: ['lmstudio', 'ollama', 'llamacpp', 'gpt4all', 'jan', 'openwebui', 'transformers'],
  };
}

function saveConfig(config: ScannerConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch {}
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getHomeDir(): string {
  return os.homedir();
}

function scanDirectory(dir: string, extensions: string[], depth = 0): string[] {
  const results: string[] = [];
  if (depth > 6) return results;

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        results.push(...scanDirectory(fullPath, extensions, depth + 1));
      } else if (extensions.some((ext) => item.name.toLowerCase().endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

// --- LM Studio Scanner ---
function scanLMStudio(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.cache', 'lm-studio', 'models'),
    path.join(home, '.lmstudio', 'models'),
    path.join(home, 'AppData', 'Local', 'LM Studio', 'models'),
    // macOS
    path.join(home, 'Library', 'Application Support', 'LM Studio', 'models'),
  ];

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;

    const files = scanDirectory(modelsDir, ['.gguf']);
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      const name = path.basename(filePath);
      const relPath = path.relative(modelsDir, filePath);
      const folder = path.dirname(relPath);

      models.push({
        id: `lmstudio:${relPath}`,
        name,
        path: filePath,
        source: 'lmstudio',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        format: 'gguf',
        metadata: {
          name,
          source: 'LM Studio',
          tags: folder !== '.' ? [folder] : [],
        },
      });
    }
  }
  return models;
}

// --- Ollama Scanner ---
function scanOllama(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.ollama', 'models'),
    process.env.OLLAMA_MODELS || '',
  ].filter(Boolean);

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;

    // Ollama stores blobs
    const blobsDir = path.join(modelsDir, 'blobs', 'sha256');
    if (fs.existsSync(blobsDir)) {
      const files = fs.readdirSync(blobsDir);
      for (const file of files) {
        const filePath = path.join(blobsDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.size < 1024 * 1024) continue; // Skip small files

          models.push({
            id: `ollama:${file}`,
            name: file.substring(0, 12),
            path: filePath,
            source: 'ollama',
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            format: 'gguf',
            metadata: { source: 'Ollama' },
          });
        } catch {}
      }
    }

    // Also check manifests
    const manifestsDir = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library');
    if (fs.existsSync(manifestsDir)) {
      const modelDirs = fs.readdirSync(manifestsDir, { withFileTypes: true });
      for (const modelDir of modelDirs) {
        if (!modelDir.isDirectory()) continue;
        const tagsDir = path.join(manifestsDir, modelDir.name);
        const tags = fs.readdirSync(tagsDir);
        for (const tag of tags) {
          const manifestPath = path.join(tagsDir, tag);
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const layers = manifest.layers || [];
            const totalSize = layers.reduce((sum: number, l: { size?: number }) => sum + (l.size || 0), 0);

            models.push({
              id: `ollama:${modelDir.name}:${tag}`,
              name: `${modelDir.name}:${tag}`,
              path: manifestPath,
              source: 'ollama',
              size: totalSize,
              sizeFormatted: formatBytes(totalSize),
              format: 'ollama',
              metadata: {
                name: `${modelDir.name}:${tag}`,
                source: 'Ollama',
                tags: [modelDir.name],
              },
            });
          } catch {}
        }
      }
    }
  }
  return models;
}

// --- llama.cpp Scanner ---
function scanLlamaCpp(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.cache', 'llama.cpp', 'models'),
    path.join(home, 'llama.cpp', 'models'),
    process.env.LLMODELS_PATH || '',
  ].filter(Boolean);

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;
    const files = scanDirectory(modelsDir, ['.gguf']);
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      models.push({
        id: `llamacpp:${path.relative(modelsDir, filePath)}`,
        name: path.basename(filePath),
        path: filePath,
        source: 'llamacpp',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        format: 'gguf',
        metadata: { source: 'llama.cpp' },
      });
    }
  }
  return models;
}

// --- GPT4All Scanner ---
function scanGPT4All(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.gpt4all'),
    path.join(home, 'gpt4all'),
    path.join(home, 'AppData', 'Local', 'nomic.ai', 'GPT4All'),
  ];

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;
    const files = scanDirectory(modelsDir, ['.gguf', '.bin']);
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      models.push({
        id: `gpt4all:${path.relative(modelsDir, filePath)}`,
        name: path.basename(filePath),
        path: filePath,
        source: 'gpt4all',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        format: 'gguf',
        metadata: { source: 'GPT4All' },
      });
    }
  }
  return models;
}

// --- Jan Scanner ---
function scanJan(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.jan'),
    path.join(home, 'AppData', 'Local', 'Jan'),
    path.join(home, 'jan'),
  ];

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;
    const modelsSubdir = path.join(modelsDir, 'models');
    if (fs.existsSync(modelsSubdir)) {
      const files = scanDirectory(modelsSubdir, ['.gguf', '.bin']);
      for (const filePath of files) {
        const stats = fs.statSync(filePath);
        models.push({
          id: `jan:${path.relative(modelsSubdir, filePath)}`,
          name: path.basename(filePath),
          path: filePath,
          source: 'jan',
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          format: 'gguf',
          metadata: { source: 'Jan' },
        });
      }
    }
  }
  return models;
}

// --- Open WebUI Scanner ---
function scanOpenWebUI(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.open-webui'),
    path.join(home, 'open-webui'),
    path.join(home, 'AppData', 'Local', 'open-webui'),
  ];

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;
    const files = scanDirectory(modelsDir, ['.gguf', '.bin', '.safetensors']);
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      models.push({
        id: `openwebui:${path.relative(modelsDir, filePath)}`,
        name: path.basename(filePath),
        path: filePath,
        source: 'openwebui',
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        format: path.extname(filePath).replace('.', ''),
        metadata: { source: 'Open WebUI' },
      });
    }
  }
  return models;
}

// --- Transformers Scanner ---
function scanTransformers(): ScannedModel[] {
  const models: ScannedModel[] = [];
  const home = getHomeDir();
  const paths = [
    path.join(home, '.cache', 'huggingface', 'hub'),
    path.join(home, '.cache', 'torch'),
    process.env.TRANSFORMERS_CACHE || '',
    process.env.HF_HOME || '',
  ].filter(Boolean);

  for (const modelsDir of paths) {
    if (!fs.existsSync(modelsDir)) continue;
    const files = scanDirectory(modelsDir, ['.safetensors', '.bin', '.gguf']);
    for (const filePath of files) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size < 1024 * 1024) continue; // Skip small files

        models.push({
          id: `transformers:${path.relative(modelsDir, filePath)}`,
          name: path.basename(filePath),
          path: filePath,
          source: 'transformers',
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          format: path.extname(filePath).replace('.', ''),
          metadata: { source: 'Transformers' },
        });
      } catch {}
    }
  }
  return models;
}

// --- Main Scanner ---

const scanners: Record<ModelSource, () => ScannedModel[]> = {
  lmstudio: scanLMStudio,
  ollama: scanOllama,
  llamacpp: scanLlamaCpp,
  gpt4all: scanGPT4All,
  jan: scanJan,
  openwebui: scanOpenWebUI,
  transformers: scanTransformers,
  custom: () => [],
};

export function scanAllModels(config?: ScannerConfig): ScannedModel[] {
  const cfg = config || loadConfig();
  const allModels: ScannedModel[] = [];

  for (const source of cfg.enabledSources) {
    const scanner = scanners[source];
    if (scanner) {
      try {
        allModels.push(...scanner());
      } catch (e) {
        console.error(`[Scanner] Error scanning ${source}:`, (e as Error).message);
      }
    }
  }

  // Scan custom paths
  for (const customPath of cfg.customPaths) {
    if (!fs.existsSync(customPath)) continue;
    try {
      const files = scanDirectory(customPath, ['.gguf', '.bin', '.safetensors']);
      for (const filePath of files) {
        const stats = fs.statSync(filePath);
        allModels.push({
          id: `custom:${path.relative(customPath, filePath)}`,
          name: path.basename(filePath),
          path: filePath,
          source: 'custom',
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          format: path.extname(filePath).replace('.', ''),
          metadata: { source: 'Custom' },
        });
      }
    } catch {}
  }

  // Enrich with metadata
  for (const model of allModels) {
    try {
      const meta = getOrCreateMetadata(model.path, model.source, model.metadata);
      model.metadata = meta;
    } catch {}
  }

  // Sort by source then name
  allModels.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });

  return allModels;
}

export function getScannerConfig(): ScannerConfig {
  return loadConfig();
}

export function updateScannerConfig(updates: Partial<ScannerConfig>): ScannerConfig {
  const config = { ...loadConfig(), ...updates };
  saveConfig(config);
  return config;
}

export function getAvailableSources(): Array<{ id: ModelSource; name: string; detected: boolean }> {
  const sources: Array<{ id: ModelSource; name: string; detected: boolean }> = [
    { id: 'lmstudio', name: 'LM Studio', detected: false },
    { id: 'ollama', name: 'Ollama', detected: false },
    { id: 'llamacpp', name: 'llama.cpp', detected: false },
    { id: 'gpt4all', name: 'GPT4All', detected: false },
    { id: 'jan', name: 'Jan', detected: false },
    { id: 'openwebui', name: 'Open WebUI', detected: false },
    { id: 'transformers', name: 'Transformers', detected: false },
  ];

  for (const source of sources) {
    try {
      const models = scanners[source.id]();
      source.detected = models.length > 0;
    } catch {}
  }

  return sources;
}
