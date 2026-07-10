import fs from 'fs';
import path from 'path';

export interface ModelMetadata {
  id: string;
  name: string;
  path: string;
  provider: string;

  // Model info
  parameters?: string;
  quantization?: string;
  architecture?: string;
  contextLength?: number;

  // Capabilities
  vision: boolean;
  embedding: boolean;
  reasoning: boolean;
  tools: boolean;
  code: boolean;

  // Requirements
  memoryRequired?: string;
  recommendedGpu?: string;
  recommendedRam?: string;

  // Metadata
  languages?: string[];
  license?: string;
  tags?: string[];
  description?: string;

  // Source
  source?: string;
  family?: string;

  // Timestamps
  addedAt: string;
  updatedAt: string;
}

const METADATA_FILE = path.join(process.cwd(), 'model-metadata.json');

let metadataStore: Map<string, ModelMetadata> = new Map();

function loadStore(): void {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8')) as ModelMetadata[];
      metadataStore = new Map(data.map((m) => [m.id, m]));
    }
  } catch {}
}

function saveStore(): void {
  try {
    const data = Array.from(metadataStore.values());
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[ModelMetadata] Failed to save:', (e as Error).message);
  }
}

loadStore();

function generateId(modelPath: string): string {
  const name = path.basename(modelPath, path.extname(modelPath));
  const hash = modelPath.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return `${name}_${Math.abs(hash).toString(36)}`;
}

function estimateFromFilename(filename: string): Partial<ModelMetadata> {
  const lower = filename.toLowerCase();
  const meta: Partial<ModelMetadata> = {};

  // Estimate parameters
  if (lower.includes('70b') || lower.includes('72b')) meta.parameters = '70B';
  else if (lower.includes('34b')) meta.parameters = '34B';
  else if (lower.includes('13b') || lower.includes('14b')) meta.parameters = '13B';
  else if (lower.includes('8b') || lower.includes('8x7b') || lower.includes('8x22b')) meta.parameters = '8B';
  else if (lower.includes('7b')) meta.parameters = '7B';
  else if (lower.includes('3b') || lower.includes('3.8b')) meta.parameters = '3B';
  else if (lower.includes('1b') || lower.includes('1.5b')) meta.parameters = '1B';
  else if (lower.includes('0.5b') || lower.includes('500m')) meta.parameters = '0.5B';

  // Estimate quantization
  const quants = ['q2_k', 'q3_k_s', 'q3_k_m', 'q3_k_l', 'q4_0', 'q4_k_s', 'q4_k_m', 'q5_0', 'q5_k_s', 'q5_k_m', 'q6_k', 'q8_0', 'f16', 'f32'];
  for (const q of quants) {
    if (lower.includes(q)) {
      meta.quantization = q.toUpperCase();
      break;
    }
  }

  // Detect architecture
  const archs: Record<string, string> = {
    'llama': 'LLaMA',
    'mistral': 'Mistral',
    'mixtral': 'Mixtral',
    'qwen': 'Qwen',
    'phi': 'Phi',
    'gemma': 'Gemma',
    'gemma2': 'Gemma 2',
    'deepseek': 'DeepSeek',
    'yi': 'Yi',
    'codellama': 'Code Llama',
    'vicuna': 'Vicuna',
    'orca': 'Orca',
    'neural': 'NeuralChat',
    'starcoder': 'StarCoder',
    'falcon': 'Falcon',
    'baichuan': 'Baichuan',
    'internlm': 'InternLM',
    'chatglm': 'ChatGLM',
    'command': 'Command',
    'dbrx': 'DBRX',
    'olmo': 'OLMo',
    'openchat': 'OpenChat',
    'bagel': 'Bagel',
  };
  for (const [key, name] of Object.entries(archs)) {
    if (lower.includes(key)) {
      meta.architecture = name;
      meta.family = name;
      break;
    }
  }

  // Detect capabilities
  meta.vision = lower.includes('llava') || lower.includes('vision') || lower.includes('vl') || lower.includes('mmproj');
  meta.embedding = lower.includes('embed') || lower.includes('e5') || lower.includes('bge');
  meta.reasoning = lower.includes('qwq') || lower.includes('deepseek-r1') || lower.includes('think');
  meta.code = lower.includes('code') || lower.includes('coder') || lower.includes('starcoder') || lower.includes('deepseek-coder');
  meta.tools = lower.includes('tool') || lower.includes('function');

  // Detect languages
  const langs: string[] = [];
  if (lower.includes('chinese') || lower.includes('zh') || lower.includes('cn')) langs.push('Chinese');
  if (lower.includes('japanese') || lower.includes('ja') || lower.includes('jp')) langs.push('Japanese');
  if (lower.includes('korean') || lower.includes('ko')) langs.push('Korean');
  if (lower.includes('arabic') || lower.includes('ar')) langs.push('Arabic');
  if (lower.includes('french') || lower.includes('fr')) langs.push('French');
  if (lower.includes('german') || lower.includes('de')) langs.push('German');
  if (lower.includes('spanish') || lower.includes('es')) langs.push('Spanish');
  if (lower.includes('multilingual') || lower.includes('multi')) {
    langs.push('Multilingual');
  }
  if (langs.length === 0) langs.push('English');
  meta.languages = [...new Set(langs)];

  // Detect source
  if (lower.includes('huggingface') || lower.includes('hf')) meta.source = 'HuggingFace';
  else if (lower.includes('gguf')) meta.source = 'GGUF';
  else if (lower.includes('lmstudio')) meta.source = 'LM Studio';
  else meta.source = 'Local';

  return meta;
}

function estimateMemoryRequirements(params: string, quant: string): string {
  const paramNum = parseFloat(params) || 7;
  const quantLower = (quant || 'q4_k_m').toLowerCase();

  let bytesPerParam = 4;
  if (quantLower.includes('q2')) bytesPerParam = 0.3;
  else if (quantLower.includes('q3')) bytesPerParam = 0.4;
  else if (quantLower.includes('q4')) bytesPerParam = 0.5;
  else if (quantLower.includes('q5')) bytesPerParam = 0.7;
  else if (quantLower.includes('q6')) bytesPerParam = 0.8;
  else if (quantLower.includes('q8')) bytesPerParam = 1.0;
  else if (quantLower.includes('f16')) bytesPerParam = 2.0;
  else if (quantLower.includes('f32')) bytesPerParam = 4.0;

  const gb = paramNum * bytesPerParam;
  return `~${gb.toFixed(1)} GB`;
}

export function getOrCreateMetadata(
  modelPath: string,
  provider: string,
  autoDetected?: Partial<ModelMetadata>
): ModelMetadata {
  const id = generateId(modelPath);
  const existing = metadataStore.get(id);

  if (existing) return existing;

  const filename = path.basename(modelPath);
  const fromFilename = estimateFromFilename(filename);
  const stats = fs.existsSync(modelPath) ? fs.statSync(modelPath) : null;

  const meta: ModelMetadata = {
    id,
    name: filename,
    path: modelPath,
    provider,
    vision: false,
    embedding: false,
    reasoning: false,
    tools: false,
    code: false,
    ...fromFilename,
    ...autoDetected,
    memoryRequired: estimateMemoryRequirements(
      (autoDetected?.parameters || fromFilename.parameters || '7B'),
      (autoDetected?.quantization || fromFilename.quantization || 'Q4_K_M')
    ),
    tags: [...new Set([
      ...(autoDetected?.tags || []),
      ...(fromFilename.architecture ? [fromFilename.architecture] : []),
      ...(fromFilename.vision ? ['vision'] : []),
      ...(fromFilename.reasoning ? ['reasoning'] : []),
      ...(fromFilename.code ? ['code'] : []),
    ].filter(Boolean))],
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  metadataStore.set(id, meta);
  saveStore();
  return meta;
}

export function updateMetadata(id: string, updates: Partial<ModelMetadata>): ModelMetadata | null {
  const existing = metadataStore.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, id: existing.id, updatedAt: new Date().toISOString() };
  metadataStore.set(id, updated);
  saveStore();
  return updated;
}

export function getMetadata(id: string): ModelMetadata | undefined {
  return metadataStore.get(id);
}

export function getAllMetadata(): ModelMetadata[] {
  return Array.from(metadataStore.values());
}

export function searchMetadata(query: string): ModelMetadata[] {
  const lower = query.toLowerCase();
  return Array.from(metadataStore.values()).filter((m) => {
    const searchFields = [
      m.name, m.architecture, m.family, m.description, m.source,
      m.quantization, m.parameters, m.license,
      ...(m.tags || []),
      ...(m.languages || []),
    ].filter(Boolean).map((s) => s!.toLowerCase());

    return searchFields.some((f) => f.includes(lower));
  });
}

export function filterMetadata(filters: {
  query?: string;
  architecture?: string;
  quantization?: string;
  vision?: boolean;
  reasoning?: boolean;
  code?: boolean;
  embedding?: boolean;
  tools?: boolean;
  languages?: string[];
  tags?: string[];
  minParameters?: string;
  maxParameters?: string;
}): ModelMetadata[] {
  let results = Array.from(metadataStore.values());

  if (filters.query) {
    const lower = filters.query.toLowerCase();
    results = results.filter((m) => {
      const searchFields = [
        m.name, m.architecture, m.family, m.description,
        m.quantization, m.parameters,
        ...(m.tags || []),
        ...(m.languages || []),
      ].filter(Boolean).map((s) => s!.toLowerCase());
      return searchFields.some((f) => f.includes(lower));
    });
  }

  if (filters.architecture) {
    results = results.filter((m) => m.architecture?.toLowerCase() === filters.architecture!.toLowerCase());
  }
  if (filters.quantization) {
    results = results.filter((m) => m.quantization?.toLowerCase() === filters.quantization!.toLowerCase());
  }
  if (filters.vision !== undefined) {
    results = results.filter((m) => m.vision === filters.vision);
  }
  if (filters.reasoning !== undefined) {
    results = results.filter((m) => m.reasoning === filters.reasoning);
  }
  if (filters.code !== undefined) {
    results = results.filter((m) => m.code === filters.code);
  }
  if (filters.embedding !== undefined) {
    results = results.filter((m) => m.embedding === filters.embedding);
  }
  if (filters.tools !== undefined) {
    results = results.filter((m) => m.tools === filters.tools);
  }
  if (filters.languages && filters.languages.length > 0) {
    results = results.filter((m) =>
      filters.languages!.some((l) => m.languages?.includes(l))
    );
  }
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter((m) =>
      filters.tags!.some((t) => m.tags?.includes(t))
    );
  }

  return results;
}

export function deleteMetadata(id: string): boolean {
  const existed = metadataStore.has(id);
  metadataStore.delete(id);
  if (existed) saveStore();
  return existed;
}
