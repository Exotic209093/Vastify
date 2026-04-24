import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../../config.ts';

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const cfg = loadConfig();
  if (!cfg.anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set. Add it to api/.env. Get one at https://console.anthropic.com/',
    );
  }
  cached = new Anthropic({ apiKey: cfg.anthropicApiKey });
  return cached;
}

export function modelId(): string {
  return loadConfig().anthropicModel;
}
