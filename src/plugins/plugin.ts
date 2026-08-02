import { ValidationError } from "../errors";
import { normalizeMiddleware } from "../middleware/middleware";
import type { AgentPlugin, PluginConfig } from "./types";

const PLUGIN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/;

/** Creates a frozen Agent plugin that contributes runtime middleware. */
export function plugin(config: PluginConfig): AgentPlugin {
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("Plugin configuration must be an object.");
  }
  if (typeof config.name !== "string" || !PLUGIN_NAME_PATTERN.test(config.name.trim())) {
    throw new ValidationError(
      "Plugin names must start with a letter or underscore and contain up to 96 safe characters.",
      { metadata: { field: "plugin.name" } }
    );
  }

  return Object.freeze({
    middleware: normalizeMiddleware(config.middleware, `Plugin "${config.name.trim()}"`),
    name: config.name.trim()
  });
}

/** Validates, de-duplicates, and freezes Agent plugins. */
export function normalizePlugins(
  entries: readonly AgentPlugin[] | undefined
): readonly AgentPlugin[] {
  if (entries === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(entries)) {
    throw new ValidationError("Agent plugins must be an array.", {
      metadata: { field: "plugins" }
    });
  }

  const names = new Set<string>();
  const plugins = entries.map((entry) => {
    const normalized = plugin(entry);
    if (names.has(normalized.name)) {
      throw new ValidationError(`Agent plugins contain duplicate name "${normalized.name}".`, {
        metadata: { plugin: normalized.name }
      });
    }
    names.add(normalized.name);
    return normalized;
  });

  return Object.freeze(plugins);
}
