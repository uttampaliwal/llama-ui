"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanAllModels = scanAllModels;
exports.getScannerConfig = getScannerConfig;
exports.updateScannerConfig = updateScannerConfig;
exports.getAvailableSources = getAvailableSources;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const model_metadata_1 = require("./model-metadata");
const CONFIG_FILE = path_1.default.join(process.cwd(), 'scanner-config.json');
function loadConfig() {
    try {
        if (fs_1.default.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(CONFIG_FILE, 'utf-8'));
        }
    }
    catch { }
    return {
        customPaths: [],
        enabledSources: ['lmstudio', 'ollama', 'llamacpp', 'gpt4all', 'jan', 'openwebui', 'transformers'],
    };
}
function saveConfig(config) {
    try {
        fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    }
    catch { }
}
function formatBytes(bytes) {
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function getHomeDir() {
    return os_1.default.homedir();
}
function scanDirectory(dir, extensions, depth = 0) {
    const results = [];
    if (depth > 6)
        return results;
    try {
        const items = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            if (item.name.startsWith('.') || item.name === 'node_modules')
                continue;
            const fullPath = path_1.default.join(dir, item.name);
            if (item.isDirectory()) {
                results.push(...scanDirectory(fullPath, extensions, depth + 1));
            }
            else if (extensions.some((ext) => item.name.toLowerCase().endsWith(ext))) {
                results.push(fullPath);
            }
        }
    }
    catch { }
    return results;
}
// --- LM Studio Scanner ---
function scanLMStudio() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.cache', 'lm-studio', 'models'),
        path_1.default.join(home, '.lmstudio', 'models'),
        path_1.default.join(home, 'AppData', 'Local', 'LM Studio', 'models'),
        // macOS
        path_1.default.join(home, 'Library', 'Application Support', 'LM Studio', 'models'),
    ];
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const files = scanDirectory(modelsDir, ['.gguf']);
        for (const filePath of files) {
            const stats = fs_1.default.statSync(filePath);
            const name = path_1.default.basename(filePath);
            const relPath = path_1.default.relative(modelsDir, filePath);
            const folder = path_1.default.dirname(relPath);
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
function scanOllama() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.ollama', 'models'),
        process.env.OLLAMA_MODELS || '',
    ].filter(Boolean);
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        // Ollama stores blobs
        const blobsDir = path_1.default.join(modelsDir, 'blobs', 'sha256');
        if (fs_1.default.existsSync(blobsDir)) {
            const files = fs_1.default.readdirSync(blobsDir);
            for (const file of files) {
                const filePath = path_1.default.join(blobsDir, file);
                try {
                    const stats = fs_1.default.statSync(filePath);
                    if (stats.size < 1024 * 1024)
                        continue; // Skip small files
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
                }
                catch { }
            }
        }
        // Also check manifests
        const manifestsDir = path_1.default.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library');
        if (fs_1.default.existsSync(manifestsDir)) {
            const modelDirs = fs_1.default.readdirSync(manifestsDir, { withFileTypes: true });
            for (const modelDir of modelDirs) {
                if (!modelDir.isDirectory())
                    continue;
                const tagsDir = path_1.default.join(manifestsDir, modelDir.name);
                const tags = fs_1.default.readdirSync(tagsDir);
                for (const tag of tags) {
                    const manifestPath = path_1.default.join(tagsDir, tag);
                    try {
                        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, 'utf-8'));
                        const layers = manifest.layers || [];
                        const totalSize = layers.reduce((sum, l) => sum + (l.size || 0), 0);
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
                    }
                    catch { }
                }
            }
        }
    }
    return models;
}
// --- llama.cpp Scanner ---
function scanLlamaCpp() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.cache', 'llama.cpp', 'models'),
        path_1.default.join(home, 'llama.cpp', 'models'),
        process.env.LLMODELS_PATH || '',
    ].filter(Boolean);
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const files = scanDirectory(modelsDir, ['.gguf']);
        for (const filePath of files) {
            const stats = fs_1.default.statSync(filePath);
            models.push({
                id: `llamacpp:${path_1.default.relative(modelsDir, filePath)}`,
                name: path_1.default.basename(filePath),
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
function scanGPT4All() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.gpt4all'),
        path_1.default.join(home, 'gpt4all'),
        path_1.default.join(home, 'AppData', 'Local', 'nomic.ai', 'GPT4All'),
    ];
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const files = scanDirectory(modelsDir, ['.gguf', '.bin']);
        for (const filePath of files) {
            const stats = fs_1.default.statSync(filePath);
            models.push({
                id: `gpt4all:${path_1.default.relative(modelsDir, filePath)}`,
                name: path_1.default.basename(filePath),
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
function scanJan() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.jan'),
        path_1.default.join(home, 'AppData', 'Local', 'Jan'),
        path_1.default.join(home, 'jan'),
    ];
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const modelsSubdir = path_1.default.join(modelsDir, 'models');
        if (fs_1.default.existsSync(modelsSubdir)) {
            const files = scanDirectory(modelsSubdir, ['.gguf', '.bin']);
            for (const filePath of files) {
                const stats = fs_1.default.statSync(filePath);
                models.push({
                    id: `jan:${path_1.default.relative(modelsSubdir, filePath)}`,
                    name: path_1.default.basename(filePath),
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
function scanOpenWebUI() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.open-webui'),
        path_1.default.join(home, 'open-webui'),
        path_1.default.join(home, 'AppData', 'Local', 'open-webui'),
    ];
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const files = scanDirectory(modelsDir, ['.gguf', '.bin', '.safetensors']);
        for (const filePath of files) {
            const stats = fs_1.default.statSync(filePath);
            models.push({
                id: `openwebui:${path_1.default.relative(modelsDir, filePath)}`,
                name: path_1.default.basename(filePath),
                path: filePath,
                source: 'openwebui',
                size: stats.size,
                sizeFormatted: formatBytes(stats.size),
                format: path_1.default.extname(filePath).replace('.', ''),
                metadata: { source: 'Open WebUI' },
            });
        }
    }
    return models;
}
// --- Transformers Scanner ---
function scanTransformers() {
    const models = [];
    const home = getHomeDir();
    const paths = [
        path_1.default.join(home, '.cache', 'huggingface', 'hub'),
        path_1.default.join(home, '.cache', 'torch'),
        process.env.TRANSFORMERS_CACHE || '',
        process.env.HF_HOME || '',
    ].filter(Boolean);
    for (const modelsDir of paths) {
        if (!fs_1.default.existsSync(modelsDir))
            continue;
        const files = scanDirectory(modelsDir, ['.safetensors', '.bin', '.gguf']);
        for (const filePath of files) {
            try {
                const stats = fs_1.default.statSync(filePath);
                if (stats.size < 1024 * 1024)
                    continue; // Skip small files
                models.push({
                    id: `transformers:${path_1.default.relative(modelsDir, filePath)}`,
                    name: path_1.default.basename(filePath),
                    path: filePath,
                    source: 'transformers',
                    size: stats.size,
                    sizeFormatted: formatBytes(stats.size),
                    format: path_1.default.extname(filePath).replace('.', ''),
                    metadata: { source: 'Transformers' },
                });
            }
            catch { }
        }
    }
    return models;
}
// --- Main Scanner ---
const scanners = {
    lmstudio: scanLMStudio,
    ollama: scanOllama,
    llamacpp: scanLlamaCpp,
    gpt4all: scanGPT4All,
    jan: scanJan,
    openwebui: scanOpenWebUI,
    transformers: scanTransformers,
    custom: () => [],
};
function scanAllModels(config) {
    const cfg = config || loadConfig();
    const allModels = [];
    for (const source of cfg.enabledSources) {
        const scanner = scanners[source];
        if (scanner) {
            try {
                allModels.push(...scanner());
            }
            catch (e) {
                console.error(`[Scanner] Error scanning ${source}:`, e.message);
            }
        }
    }
    // Scan custom paths
    for (const customPath of cfg.customPaths) {
        if (!fs_1.default.existsSync(customPath))
            continue;
        try {
            const files = scanDirectory(customPath, ['.gguf', '.bin', '.safetensors']);
            for (const filePath of files) {
                const stats = fs_1.default.statSync(filePath);
                allModels.push({
                    id: `custom:${path_1.default.relative(customPath, filePath)}`,
                    name: path_1.default.basename(filePath),
                    path: filePath,
                    source: 'custom',
                    size: stats.size,
                    sizeFormatted: formatBytes(stats.size),
                    format: path_1.default.extname(filePath).replace('.', ''),
                    metadata: { source: 'Custom' },
                });
            }
        }
        catch { }
    }
    // Enrich with metadata
    for (const model of allModels) {
        try {
            const meta = (0, model_metadata_1.getOrCreateMetadata)(model.path, model.source, model.metadata);
            model.metadata = meta;
        }
        catch { }
    }
    // Sort by source then name
    allModels.sort((a, b) => {
        if (a.source !== b.source)
            return a.source.localeCompare(b.source);
        return a.name.localeCompare(b.name);
    });
    return allModels;
}
function getScannerConfig() {
    return loadConfig();
}
function updateScannerConfig(updates) {
    const config = { ...loadConfig(), ...updates };
    saveConfig(config);
    return config;
}
function getAvailableSources() {
    const sources = [
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
        }
        catch { }
    }
    return sources;
}
