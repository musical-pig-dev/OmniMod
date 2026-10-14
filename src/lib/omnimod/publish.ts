export type Host = { id: string; name: string; fields: string[] };

export function isConfigured(configs: Record<string, string> | undefined, fields: string[]): boolean {
  if (!configs) return false;
  return fields.every((f) => Boolean(configs[f]?.trim()));
}

export function planPublish(mod: { configs: Record<string, Record<string, string>> }, hosts: Host[]) {
  return hosts.filter((h) => isConfigured(mod.configs[h.id], h.fields));
}
