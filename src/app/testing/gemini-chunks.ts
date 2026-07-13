import type { GeminiChunk, GeminiUsageMetadata } from '../core/streaming/to-agent-event.operator';

export function textChunk(text: string): GeminiChunk {
  return { candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
}

export function thoughtChunk(text: string): GeminiChunk {
  return { candidates: [{ content: { role: 'model', parts: [{ text, thought: true }] } }] };
}

export function toolChunk(
  name: string,
  args: Record<string, unknown>,
  signature?: string,
): GeminiChunk {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: { name, args },
              ...(signature ? { thoughtSignature: signature } : {}),
            },
          ],
        },
      },
    ],
  };
}

export function finishChunk(reason = 'STOP', usage?: GeminiUsageMetadata): GeminiChunk {
  return {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: reason }],
    ...(usage ? { usageMetadata: usage } : {}),
  };
}

export async function* asAsync(chunks: readonly GeminiChunk[]): AsyncIterable<GeminiChunk> {
  for (const c of chunks) yield c;
}
