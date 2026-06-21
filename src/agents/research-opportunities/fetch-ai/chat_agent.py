"""
Fetch.ai uAgent bridge for College Copilot's research-opportunities system.

This is the ONLY piece that lives outside the TypeScript app, because the
Fetch.ai stack (uAgents + Agentverse + ASI:One) is Python-native. It is a thin
transport shim: it speaks the Chat Protocol on the Fetch.ai side and calls the
existing College Copilot HTTP endpoint to do the real multi-agent work.

>>> YOU must run/register this on the Fetch.ai platform — see README.md. <<<

Prereqs (run locally first):
    pip install uagents uagents-core requests
    export COLLEGE_COPILOT_URL="http://localhost:4174"   # your running TS server
    export COLLEGE_COPILOT_TOKEN="<a session token / API key>"

Then:
    python chat_agent.py
and follow README.md to publish it to Agentverse and connect ASI:One.
"""

import os
from datetime import datetime, timezone
from uuid import uuid4

import requests
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
    chat_protocol_spec,
)

COLLEGE_COPILOT_URL = os.environ.get("COLLEGE_COPILOT_URL", "http://localhost:4174")
COLLEGE_COPILOT_TOKEN = os.environ.get("COLLEGE_COPILOT_TOKEN", "")

agent = Agent(name="college-copilot-research", seed=os.environ.get("AGENT_SEED", "college-copilot-research-seed"))
chat = Protocol(spec=chat_protocol_spec)


def search_research(query: str) -> str:
    """Call the TS multi-agent pipeline over HTTP and return a chat answer."""
    try:
        resp = requests.post(
            f"{COLLEGE_COPILOT_URL}/api/opportunities/search",
            json={"category": "research", "query": query, "limit": 8},
            headers={"Authorization": f"Bearer {COLLEGE_COPILOT_TOKEN}"},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        return f"Sorry — the research pipeline is unreachable right now ({exc})."

    items = data.get("research") or data.get("opportunities") or []
    if not items:
        return data.get("summary", "No undergraduate research openings found for that query.")

    lines = [data.get("summary", "Here is what I found:"), ""]
    for i, o in enumerate(items[:8], start=1):
        title = o.get("title") or o.get("name")
        org = o.get("organization") or o.get("org")
        lines.append(f"{i}. {title} — {org}")
        if o.get("url"):
            lines.append(f"   {o['url']}")
    lines.append("")
    lines.append("Drafts for outreach are available on request — nothing is sent automatically.")
    return "\n".join(lines)


@chat.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage):
    # Acknowledge per the Chat Protocol.
    await ctx.send(sender, ChatAcknowledgement(
        timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id,
    ))

    query = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    answer = search_research(query) if query else "Tell me what kind of research you're looking for."

    await ctx.send(sender, ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=answer)],
    ))


@chat.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    ctx.logger.info(f"ack from {sender} for {msg.acknowledged_msg_id}")


agent.include(chat, publish_manifest=True)

if __name__ == "__main__":
    agent.run()
