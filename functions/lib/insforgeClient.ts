// Single source of truth for the service-scoped InsForge client used by
// edge functions. Reads INSFORGE_URL + INSFORGE_SERVICE_KEY from env.
//
// Ticket: agents/done/0013-capture-edge-function.md

import { createAdminClient, type InsForgeClient } from '@insforge/sdk';

let cached: InsForgeClient | null = null;

export function getClient(): InsForgeClient {
  if (cached) return cached;
  const baseUrl = process.env.INSFORGE_URL;
  const apiKey = process.env.INSFORGE_SERVICE_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('INSFORGE_URL and INSFORGE_SERVICE_KEY must be set');
  }
  cached = createAdminClient({ baseUrl, apiKey });
  return cached;
}
