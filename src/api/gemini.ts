import { CONFIG, usingProxy } from './config';
import { fetchJson } from './http';
import {
  parseTranscription,
  transcriptionRequest,
  type Transcription,
  type TranscriptionContext,
} from './geminiTranscript';

export const transcriptionConfigured = (): boolean =>
  usingProxy || CONFIG.gemini.apiKey.length > 0;

/** Transcribe a call recording with Gemini (audio sent inline). */
export async function transcribeCall(
  audioBase64: string,
  mimeType: string,
  ctx: TranscriptionContext,
): Promise<Transcription> {
  const path = `models/${CONFIG.gemini.model}:generateContent`;
  const url = usingProxy
    ? `${CONFIG.proxyUrl}/gemini/${path}`
    : `https://generativelanguage.googleapis.com/v1beta/${path}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Header rather than ?key= so the key stays out of URLs and request logs.
  if (!usingProxy) headers['x-goog-api-key'] = CONFIG.gemini.apiKey;

  const res = await fetchJson<Parameters<typeof parseTranscription>[0]>(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(transcriptionRequest(audioBase64, mimeType, ctx)),
      // A long call takes Gemini a while; the default 20s would cut it off.
      timeoutMs: 180_000,
    },
    usingProxy ? 'proxy' : 'gemini',
  );
  return parseTranscription(res);
}
