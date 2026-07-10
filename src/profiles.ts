import fs from 'fs';
import path from 'path';

export interface Profile {
  name: string;
  description: string;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  maxTokens: number;
  contextSize: number;
  threads: number;
  gpuLayers: number;
  systemPrompt: string;
  [key: string]: unknown;
}

const PROFILES_DIR = path.join(process.cwd(), 'profiles');
const ACTIVE_PROFILE_FILE = path.join(process.cwd(), 'active-profile.json');

function ensureDir(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function loadActiveProfileName(): string {
  try {
    if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf-8'));
      return data.profile || 'Balanced';
    }
  } catch {}
  return 'Balanced';
}

function saveActiveProfileName(name: string): void {
  try {
    fs.writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify({ profile: name }, null, 2));
  } catch {}
}

export function listProfiles(): Array<{ name: string; description: string; active: boolean }> {
  ensureDir();
  const activeName = loadActiveProfileName();
  const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));

  return files.map((f) => {
    const content = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf-8'));
    return {
      name: content.name || f.replace('.json', ''),
      description: content.description || '',
      active: (content.name || f.replace('.json', '')) === activeName,
    };
  });
}

export function getProfile(name: string): Profile | null {
  ensureDir();
  const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));

  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf-8'));
    if (content.name === name || f.replace('.json', '') === name) {
      return content as Profile;
    }
  }
  return null;
}

export function getActiveProfile(): Profile {
  const name = loadActiveProfileName();
  const profile = getProfile(name);
  if (profile) return profile;

  // Fallback to Balanced or first available
  const balanced = getProfile('Balanced');
  if (balanced) return balanced;

  const all = listProfiles();
  if (all.length > 0) {
    return getProfile(all[0].name)!;
  }

  // Ultimate fallback
  return {
    name: 'Default',
    description: 'Default settings',
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    maxTokens: 4096,
    contextSize: 8192,
    threads: 4,
    gpuLayers: 99,
    systemPrompt: 'You are a helpful assistant.',
  };
}

export function setActiveProfile(name: string): boolean {
  const profile = getProfile(name);
  if (!profile) return false;
  saveActiveProfileName(name);
  return true;
}

export function saveProfile(name: string, data: Partial<Profile>): Profile {
  ensureDir();
  const profile: Profile = {
    name,
    description: data.description || '',
    temperature: data.temperature ?? 0.7,
    topP: data.topP ?? 0.9,
    topK: data.topK ?? 40,
    repeatPenalty: data.repeatPenalty ?? 1.1,
    maxTokens: data.maxTokens ?? 4096,
    contextSize: data.contextSize ?? 8192,
    threads: data.threads ?? 4,
    gpuLayers: data.gpuLayers ?? 99,
    systemPrompt: data.systemPrompt ?? 'You are a helpful assistant.',
    ...data,
  };
  profile.name = name;

  const filePath = path.join(PROFILES_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  return profile;
}

export function deleteProfile(name: string): boolean {
  ensureDir();
  const filePath = path.join(PROFILES_DIR, `${name}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    // If deleted profile was active, switch to Balanced
    if (loadActiveProfileName() === name) {
      saveActiveProfileName('Balanced');
    }
    return true;
  }
  return false;
}
