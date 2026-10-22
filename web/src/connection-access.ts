import type { Entity } from "@amuse/protocol";

/** Only a known local connection can skip the cloud key and external OAuth tab. */
export function isLocalConnection(entities: readonly Entity[], id: string | null): boolean {
  if (id === null) return false;
  return entities.some((entity) => entity.id === id && entity.kind === "connection" && entity.provider === "local-github");
}

export function connectionNeedsAppsKey(entities: readonly Entity[], id: string | null, missingCloudKey: boolean): boolean {
  return id !== null && missingCloudKey && !isLocalConnection(entities, id);
}
