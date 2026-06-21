// Voice input — speak to fill any text field (Deepgram speech-to-text).
//
// Progressive enhancement: if voice is disabled server-side or the browser lacks
// MediaRecorder/getUserMedia, no mic buttons are added and typing works as before.
// A mic button is injected into every `[data-voice]` input; click to record, click
// again to stop. The transcript is appended to whatever is already typed.

let initialized = false;

export async function initVoice({ toast } = {}) {
  if (initialized) return;
  // Needs a secure context + recording APIs (available on localhost and https).
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;

  let status;
  try {
    const res = await fetch("/api/voice/status");
    if (!res.ok) return;
    status = await res.json();
  } catch { return; }
  if (!status?.enabled) return; // voice off → typing-only, no mic buttons

  initialized = true;
  document.querySelectorAll("[data-voice]").forEach(input => attachMic(input, toast));
}

function note(toast, msg) { if (typeof toast === "function") toast(msg); else console.warn(msg); }

function attachMic(input, toast) {
  if (input.dataset.voiceReady) return;
  input.dataset.voiceReady = "1";

  // Wrap the input so the mic can sit inside its right edge without disturbing
  // the surrounding flex/grid layout.
  const wrap = document.createElement("span");
  wrap.className = "voice-input";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button"; // never submit the surrounding form
  btn.className = "mic-btn";
  btn.title = "Speak to fill this in";
  btn.setAttribute("aria-label", "Voice input");
  btn.textContent = "🎤";
  wrap.appendChild(btn);

  let recorder = null;
  let stream = null;

  btn.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") { recorder.stop(); return; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      note(toast, "Microphone access denied.");
      return;
    }

    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      btn.classList.remove("recording");
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (!blob.size) return;

      btn.classList.add("loading");
      try {
        const res = await fetch("/api/voice/transcribe", {
          method: "POST",
          headers: { "Content-Type": type },
          body: blob,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "transcription failed");
        const text = (data.transcript || "").trim();
        if (!text) { note(toast, "Didn't catch that — try again."); return; }
        const existing = input.value.trim();
        input.value = existing ? `${existing} ${text}` : text;
        input.dispatchEvent(new Event("input", { bubbles: true })); // trigger debounced search etc.
        input.focus();
      } catch (e) {
        note(toast, `Voice: ${e.message}`);
      } finally {
        btn.classList.remove("loading");
      }
    };

    recorder.start();
    btn.classList.add("recording");
  });
}
