/**
 * Rough token estimation for the context meter (brief §6). A characters ÷ 4
 * estimate is explicitly "fine for MVP". We count the whole payload that would
 * be sent: system prompt + every message's content, plus a small per-message
 * overhead for role tokens / formatting.
 */
import { CHARS_PER_TOKEN } from './constants';
import type { ChatMessage } from './api';

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimated tokens for the full outgoing payload. */
export function estimatePayloadTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + PER_MESSAGE_OVERHEAD_TOKENS;
  }
  return total;
}

/** 0..1 fraction of the context window the payload occupies (clamped at 1). */
export function contextFraction(
  payloadTokens: number,
  windowTokens: number
): number {
  if (windowTokens <= 0) return 0;
  return Math.min(payloadTokens / windowTokens, 1);
}
