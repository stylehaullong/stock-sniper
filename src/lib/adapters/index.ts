import type { Retailer, RetailerAdapter } from "@/types";
import { TargetAdapter } from "./target-adapter";
// Future:
// import { WalmartAdapter } from "./walmart-adapter";
// import { PokemonCenterAdapter } from "./pokemon-center-adapter";

// -- Adapter Registry --

const adapters: Map<Retailer, RetailerAdapter> = new Map();

// Register all adapters
adapters.set("target", new TargetAdapter());
// adapters.set("walmart", new WalmartAdapter());
// adapters.set("pokemon_center", new PokemonCenterAdapter());

/**
 * Get adapter by retailer name
 */
export function getAdapter(retailer: Retailer): RetailerAdapter {
  const adapter = adapters.get(retailer);
  if (!adapter) {
    throw new Error(`No adapter registered for retailer: ${retailer}`);
  }
  return adapter;
}

/**
 * Auto-detect retailer from a URL and return the matching adapter
 */
export function detectAdapter(url: string): RetailerAdapter | null {
  for (const adapter of adapters.values()) {
    if (adapter.matchesUrl(url)) {
      return adapter;
    }
  }
  return null;
}

/**
 * Get all registered retailer names
 */
export function getRegisteredRetailers(): Retailer[] {
  return Array.from(adapters.keys());
}

export { TargetAdapter };
