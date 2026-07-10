"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProfiles = listProfiles;
exports.getProfile = getProfile;
exports.getActiveProfile = getActiveProfile;
exports.setActiveProfile = setActiveProfile;
exports.saveProfile = saveProfile;
exports.deleteProfile = deleteProfile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PROFILES_DIR = path_1.default.join(process.cwd(), 'profiles');
const ACTIVE_PROFILE_FILE = path_1.default.join(process.cwd(), 'active-profile.json');
function ensureDir() {
    if (!fs_1.default.existsSync(PROFILES_DIR)) {
        fs_1.default.mkdirSync(PROFILES_DIR, { recursive: true });
    }
}
function loadActiveProfileName() {
    try {
        if (fs_1.default.existsSync(ACTIVE_PROFILE_FILE)) {
            const data = JSON.parse(fs_1.default.readFileSync(ACTIVE_PROFILE_FILE, 'utf-8'));
            return data.profile || 'Balanced';
        }
    }
    catch { }
    return 'Balanced';
}
function saveActiveProfileName(name) {
    try {
        fs_1.default.writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify({ profile: name }, null, 2));
    }
    catch { }
}
function listProfiles() {
    ensureDir();
    const activeName = loadActiveProfileName();
    const files = fs_1.default.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
        const content = JSON.parse(fs_1.default.readFileSync(path_1.default.join(PROFILES_DIR, f), 'utf-8'));
        return {
            name: content.name || f.replace('.json', ''),
            description: content.description || '',
            active: (content.name || f.replace('.json', '')) === activeName,
        };
    });
}
function getProfile(name) {
    ensureDir();
    const files = fs_1.default.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
        const content = JSON.parse(fs_1.default.readFileSync(path_1.default.join(PROFILES_DIR, f), 'utf-8'));
        if (content.name === name || f.replace('.json', '') === name) {
            return content;
        }
    }
    return null;
}
function getActiveProfile() {
    const name = loadActiveProfileName();
    const profile = getProfile(name);
    if (profile)
        return profile;
    // Fallback to Balanced or first available
    const balanced = getProfile('Balanced');
    if (balanced)
        return balanced;
    const all = listProfiles();
    if (all.length > 0) {
        return getProfile(all[0].name);
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
function setActiveProfile(name) {
    const profile = getProfile(name);
    if (!profile)
        return false;
    saveActiveProfileName(name);
    return true;
}
function saveProfile(name, data) {
    ensureDir();
    const profile = {
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
    const filePath = path_1.default.join(PROFILES_DIR, `${name}.json`);
    fs_1.default.writeFileSync(filePath, JSON.stringify(profile, null, 2));
    return profile;
}
function deleteProfile(name) {
    ensureDir();
    const filePath = path_1.default.join(PROFILES_DIR, `${name}.json`);
    if (fs_1.default.existsSync(filePath)) {
        fs_1.default.unlinkSync(filePath);
        // If deleted profile was active, switch to Balanced
        if (loadActiveProfileName() === name) {
            saveActiveProfileName('Balanced');
        }
        return true;
    }
    return false;
}
