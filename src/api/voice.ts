import express, { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/session.ts";
import { transcribeAudio, voiceEnabled } from "../providers/deepgram.ts";
import { log } from "../lib/log.ts";

/**
 * Voice input endpoints (Deepgram speech-to-text).
 *   GET  /api/voice/status      -> { enabled } so the UI can show/hide the mic.
 *   POST /api/voice/transcribe  -> raw audio body in, { transcript } out.
 *
 * The transcribe route reads a raw audio Buffer (not JSON), so it mounts its own
 * `express.raw` body parser; the global `express.json` is a no-op for audio.
 */
export function voiceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/status", (_req, res) => {
    res.json({ enabled: voiceEnabled() });
  });

  router.post(
    "/transcribe",
    express.raw({ type: () => true, limit: "20mb" }),
    async (req: AuthedRequest, res) => {
      if (!voiceEnabled()) {
        res.status(503).json({ error: "Voice transcription not configured (set DEEPGRAM_API_KEY)." });
        return;
      }
      const audio = req.body as Buffer;
      if (!Buffer.isBuffer(audio) || audio.length === 0) {
        res.status(400).json({ error: "No audio received." });
        return;
      }
      try {
        const transcript = await transcribeAudio(audio, String(req.headers["content-type"] || "audio/webm"));
        res.json({ transcript });
      } catch (err) {
        log.warn("voice transcription failed", { error: (err as Error).message });
        res.status(502).json({ error: (err as Error).message });
      }
    },
  );

  return router;
}
