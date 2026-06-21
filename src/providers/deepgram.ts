/**
 * Deepgram speech-to-text adapter.
 *
 * Powers voice input: the browser records audio and POSTs it to our backend,
 * which proxies to Deepgram's prerecorded transcription API. Keeping the key
 * server-side means it never reaches the client.
 *
 * Keyless-fallback philosophy (like the rest of the app): without
 * `DEEPGRAM_API_KEY`, voice is simply disabled and the UI stays typing-only.
 *
 * Read by: src/api/voice.ts
 */

import { log } from "../lib/log.ts";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const TIMEOUT_MS = Number(process.env.DEEPGRAM_TIMEOUT_MS || 20000);

export function voiceEnabled(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

/** Pull the best transcript out of a Deepgram prerecorded response. */
export function parseDeepgramTranscript(json: unknown): string {
  const alt = (json as any)?.results?.channels?.[0]?.alternatives?.[0];
  return typeof alt?.transcript === "string" ? alt.transcript.trim() : "";
}

/**
 * Transcribe an audio buffer. `contentType` is the recording's MIME type
 * (e.g. "audio/webm;codecs=opus"); Deepgram auto-detects the container.
 */
export async function transcribeAudio(audio: Buffer, contentType: string): Promise<string> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY not set");

  const model = process.env.DEEPGRAM_MODEL || "nova-3";
  const params = new URLSearchParams({ model, smart_format: "true", punctuate: "true" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType || "audio/webm" },
      // Node's fetch (undici) accepts a byte view at runtime; the cast bridges the
      // DOM/@types-node BodyInit typing mismatch.
      body: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 200)}`);
    }
    const transcript = parseDeepgramTranscript(await res.json());
    log.info("deepgram transcription", { model, bytes: audio.length, chars: transcript.length });
    return transcript;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error("Deepgram request timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
