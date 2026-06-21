# Fetch.ai / ASI:One Integration — Action Required

The research-opportunities multi-agent pipeline is **fully built in this repo**
(`source-planner → search → page-reader → extractor → deduper → summarizer`, plus
`outreach-helper`). What is left is the **Fetch.ai platform** wiring, which I
cannot do for you from here because it requires accounts, keys, and hosting on
Fetch.ai's own services.

`chat_agent.py` (next to this file) is a ready-to-run uAgent that bridges
Fetch.ai's Chat Protocol to our existing pipeline over HTTP. You run and register
it; the heavy lifting stays in the TypeScript app.

## What is already done (no action needed)

- The 7-agent research pipeline + `ResearchOpportunity` schema.
- The orchestrator returns a full step **trace** (good for the demo).
- `chat_agent.py` formats results, speaks the uAgents Chat Protocol, and calls
  `POST /api/opportunities/search`.

## What YOU must do on Fetch.ai's platform

These steps need the Fetch.ai/ASI:One platform and your credentials — do them
there, then come back and tell me if anything errors:

1. **Get an ASI:One API key** — sign in at <https://asi1.ai> (or the ASI:One
   developer portal) and create an API key. Keep it; the agent / your account
   needs it to be reachable from ASI:One chat.
2. **Create an Agentverse account** — <https://agentverse.ai>. This is where the
   agent is hosted/registered and made discoverable.
3. **Fund/derive the agent address** — run `python chat_agent.py` once locally;
   it prints the agent's address. On testnet you may need to fund it from the
   Agentverse faucet.
4. **Publish to Agentverse** — either:
   - host the script locally and use **Mailbox** (Agentverse → My Agents →
     Connect → Mailbox, paste the agent address), or
   - deploy the script directly as a **Hosted Agent** in Agentverse.
5. **Make it discoverable on ASI:One** — in the agent's Agentverse profile,
   enable the **Chat Protocol** badge and add a clear README/description so
   ASI:One's router can match research queries to it. (The script already calls
   `publish_manifest=True`.)
6. **Expose the TS server** — `chat_agent.py` calls `COLLEGE_COPILOT_URL`. For a
   hosted agent this must be a public URL (e.g. an ngrok tunnel or a deployed
   instance), not `localhost`. Set `COLLEGE_COPILOT_URL` and
   `COLLEGE_COPILOT_TOKEN` accordingly.
7. **Test from ASI:One** — open <https://asi1.ai> chat and ask something like
   "find me undergraduate ML research"; confirm your agent answers.

## Env vars the bridge expects

```bash
export COLLEGE_COPILOT_URL="https://<your-public-host>"
export COLLEGE_COPILOT_TOKEN="<active cc_session token>"
export AGENT_SEED="<stable secret so the agent keeps its address>"
```

## Where I stopped and why

I stopped at steps 1–7 above because they require **your Fetch.ai/ASI:One and
Agentverse accounts, API keys, and hosting** — I can't create or authenticate
those from this environment. Once you have the ASI:One API key and an Agentverse
account, run `python chat_agent.py`, paste me any error output, and I'll help you
debug the bridge and the manifest.

`POST /api/opportunities/search` requires authentication. The bridge sends the
opaque `cc_session` value as a bearer token; the server accepts the same session
token from either the browser cookie or the `Authorization` header.
