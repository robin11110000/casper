/**
 * Agent discovery layer. CROO's SDK exposes no public search/listing endpoint
 * (discovery in the real product happens through the "Navigator" AI assistant
 * inside the dashboard UI, not a callable API) -- so for this demo, discovery
 * is a static, versioned registry of the specialist agents *we* built and
 * tagged, exactly as the brief calls for: "you control this by having your
 * specialist agents properly tagged and discoverable." Swapping this module
 * out for a real Agent Store query is the only change needed if/when CROO
 * ships one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ServiceListing } from "./cap/types.js";

const registryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "registry.json");

let cached: ServiceListing[] | null = null;

export function loadRegistry(): ServiceListing[] {
  if (!cached) {
    cached = JSON.parse(readFileSync(registryPath, "utf-8")) as ServiceListing[];
  }
  return cached;
}

/**
 * Finds services matching a required capability (tag/description match),
 * ranked best-fit first (cheapest match wins ties; a tag hit ranks above a
 * description-only hit).
 */
export function findCandidates(capability: string): ServiceListing[] {
  const needle = capability.toLowerCase();
  const scored = loadRegistry()
    .map((service) => {
      const tagHit = service.tags.some((tag) => tag.toLowerCase().includes(needle) || needle.includes(tag.toLowerCase()));
      const descHit = service.description.toLowerCase().includes(needle) || service.name.toLowerCase().includes(needle);
      const score = tagHit ? 2 : descHit ? 1 : 0;
      return { service, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.service.price - b.service.price);

  return scored.map((entry) => entry.service);
}
