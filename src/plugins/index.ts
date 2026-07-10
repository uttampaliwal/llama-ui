import fs from 'fs';
import path from 'path';
import {
  type Plugin,
  type PluginManifest,
  type PluginContext,
  type PluginConstructor,
  type ToolDefinition,
  type CommandDefinition,
  type HookDefinition,
  type ToolResult,
} from './base';
import { log } from '../logger';

interface PluginEntry {
  manifest: PluginManifest;
  instance: Plugin;
  tools: ToolDefinition[];
  commands: CommandDefinition[];
  hooks: HookDefinition[];
}

const SETTINGS_FILE = path.join(process.cwd(), 'plugins.json');

function loadPluginSettings(): Record<string, { enabled: boolean; config: Record<string, unknown> }> {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function savePluginSettings(settings: Record<string, { enabled: boolean; config: Record<string, unknown> }>): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    log.error('Failed to save settings', e as Error);
  }
}

class PluginManager {
  private plugins = new Map<string, PluginEntry>();
  private registry = new Map<string, PluginConstructor>();
  private settings = loadPluginSettings();
  private tools = new Map<string, ToolDefinition>();
  private commands = new Map<string, CommandDefinition>();
  private hooks = new Map<string, HookDefinition[]>();

  register(type: PluginConstructor): void {
    const instance = new type();
    this.registry.set(instance.manifest.id, type);
  }

  async activate(pluginId: string): Promise<void> {
    if (this.plugins.has(pluginId)) return;

    const Type = this.registry.get(pluginId);
    if (!Type) throw new Error(`Plugin not found: ${pluginId}`);

    const instance = new Type();
    const entry: PluginEntry = {
      manifest: { ...instance.manifest, enabled: true },
      instance,
      tools: [],
      commands: [],
      hooks: [],
    };

    const config = this.settings[pluginId]?.config || {};
    this.settings[pluginId] = { enabled: true, config };
    savePluginSettings(this.settings);

    const ctx: PluginContext = {
      registerTool: (tool) => {
        entry.tools.push(tool);
        this.tools.set(`${pluginId}:${tool.name}`, tool);
      },
      registerCommand: (cmd) => {
        entry.commands.push(cmd);
        this.commands.set(`${pluginId}:${cmd.name}`, cmd);
      },
      registerHook: (hook) => {
        entry.hooks.push(hook);
        const existing = this.hooks.get(hook.name) || [];
        existing.push(hook);
        this.hooks.set(hook.name, existing);
      },
      getConfig: () => config,
      setConfig: (newConfig) => {
        this.settings[pluginId].config = { ...config, ...newConfig };
        savePluginSettings(this.settings);
      },
      log: (msg) => log.server(`[${instance.manifest.name}] ${msg}`),
    };

    await instance.activate(ctx);
    this.plugins.set(pluginId, entry);
    log.server('Activated: ' + instance.manifest.name);
  }

  async deactivate(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    await entry.instance.deactivate();

    for (const tool of entry.tools) {
      this.tools.delete(`${pluginId}:${tool.name}`);
    }
    for (const cmd of entry.commands) {
      this.commands.delete(`${pluginId}:${cmd.name}`);
    }
    for (const hook of entry.hooks) {
      const list = this.hooks.get(hook.name) || [];
      this.hooks.set(hook.name, list.filter((h) => h !== hook));
    }

    this.settings[pluginId] = { enabled: false, config: this.settings[pluginId]?.config || {} };
    savePluginSettings(this.settings);
    this.plugins.delete(pluginId);
    log.server('Deactivated: ' + entry.manifest.name);
  }

  async toggle(pluginId: string): Promise<boolean> {
    if (this.plugins.has(pluginId)) {
      await this.deactivate(pluginId);
      return false;
    } else {
      await this.activate(pluginId);
      return true;
    }
  }

  async activateAll(): Promise<void> {
    for (const [id, settings] of Object.entries(this.settings)) {
      if (settings.enabled && this.registry.has(id)) {
        try {
          await this.activate(id);
        } catch (e) {
          log.error('Failed to activate ' + id, e as Error);
        }
      }
    }
  }

  getTool(fullName: string): ToolDefinition | undefined {
    return this.tools.get(fullName);
  }

  getAllTools(): Array<{ pluginId: string; tool: ToolDefinition }> {
    const result: Array<{ pluginId: string; tool: ToolDefinition }> = [];
    for (const [key, tool] of this.tools) {
      const [pluginId] = key.split(':');
      result.push({ pluginId, tool });
    }
    return result;
  }

  async executeTool(fullName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(fullName);
    if (!tool) return { success: false, error: `Tool not found: ${fullName}` };
    try {
      return await tool.execute(params);
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  getCommand(fullName: string): CommandDefinition | undefined {
    return this.commands.get(fullName);
  }

  async executeHook(name: string, data: unknown): Promise<unknown> {
    const hookList = this.hooks.get(name) || [];
    let result = data;
    for (const hook of hookList) {
      result = await hook.handler(result);
    }
    return result;
  }

  listAvailable(): Array<{ manifest: PluginManifest; active: boolean }> {
    const result: Array<{ manifest: PluginManifest; active: boolean }> = [];
    for (const [id, Type] of this.registry) {
      const instance = new Type();
      const active = this.plugins.has(id);
      result.push({ manifest: { ...instance.manifest, enabled: active }, active });
    }
    return result;
  }

  listActive(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((e) => e.manifest);
  }
}

export const plugins = new PluginManager();
