# College Copilot

Getting into UC Berkeley is hard. Navigating it can be even harder. After earning a place at a top public university, students face scattered course catalogs, outdated opportunity pages, professor directories, and job boards. They may know what they want to become without knowing which classes to take, whom to work with, or which opportunities are actually relevant.

**College Copilot turns that information overload into a personalized path from coursework to research to industry.** Clone the repository, sign in, describe your goals and constraints, and explore Berkeley resources from one local workspace. A guided demo is coming soon.

## What It Does

- **Plan courses:** Rank Berkeley classes against remaining requirements, interests, professor ratings, workload, time constraints, and open seats.
- **Find research:** Discover professors, labs, and undergraduate research opportunities, then prepare outreach for the student to review.
- **Explore industry:** Normalize job postings, digest qualifications, generate resume-tailoring prompts, and identify possible networking leads.
- **Explain every result:** Show fit scores, evidence, warnings, and an agent trace instead of returning an unexplained answer.

## Why These Tracks

### Anthropic: Educational and Economic Opportunity

Built with Claude Code and powered by Claude when an API key is available, College Copilot helps students translate open-ended goals into concrete academic and career decisions. Claude understands natural-language intent and explains recommendations, while specialized agents and deterministic tools handle retrieval, policy interpretation, ranking, and conflict detection. This division makes AI useful where judgment and communication matter without asking it to invent facts that code can verify.

### The Token Company: Context Compression

An LLM should not need the entire course catalog to recommend eight classes. College Copilot retrieves and scores candidates first, then compresses course records, student constraints, requirement coverage, and policy warnings into a small context packet. The final explanation is generated only from that packet, and the API reports estimated tokens before and after compression, the compression ratio, and percentage saved. This reduces noise and token use while preserving the evidence needed for a high-quality recommendation.

### Redis: Agent Memory and Vector Retrieval

College Copilot uses Redis beyond conventional response caching. It stores a semantic vector index of Berkeley courses for context retrieval and records per-user research and job agent-memory events with bounded lifetimes, allowing independent agents to retain useful workflow context without passing entire histories to an LLM. The architecture combines deterministic embeddings and ranking, isolated key namespaces, health metrics, read-through retrieval, and a resilient SQLite fallback so Redis accelerates a scalable student workflow without becoming a single point of failure. Together, vector search and agent memory turn fragmented university data into a fast, personalized discovery experience for a real human problem.

### Ddoski's World: Educational Access

University resources may be public, but access to them is not equal. Students with experienced mentors and established networks know which courses matter, how to find research, and where to look for career opportunities; first-generation and under-networked students often must reconstruct that knowledge alone. College Copilot makes this hidden institutional knowledge searchable, personalized, and actionable, helping more students turn education into research experience and economic opportunity while keeping every consequential decision under their control.

## Ethical Considerations

College Copilot follows a **draft, explain, and confirm** model. Agents can surface public contact information and prepare outreach, but they never send emails, LinkedIn messages, applications, or connection requests automatically. Recommendations expose their evidence, label heuristic judgments, and do not claim to replace official academic advising or degree audits.

User profiles, plans, and results are isolated behind authenticated sessions. Production deployments can restrict Google sign-in to verified `@berkeley.edu` accounts with `OAUTH_HOSTED_DOMAIN=berkeley.edu`; local development intentionally provides a clearly separated keyless login. We collect only the information needed to personalize results and keep consequential decisions with the student.

## Brainstorming and Process

College Copilot began as three ideas from three Berkeley students. Two freshmen proposed course planning and professor/research discovery; a junior proposed an industry-opportunity assistant. We realized these were not separate problems but three stages of the same student journey.

Our iterations moved the project away from a single all-purpose chatbot. We separated each workflow into narrow agents, moved scoring and schedule conflicts into testable deterministic code, added compressed context and execution traces, introduced keyless fallbacks, and required human approval for outreach. The architecture reflects the decisions and constraints we encountered, not just an interface placed around an LLM.

## The Ambitious Next Step: An Opportunity Graph

Our next step is a living graph connecting:

```text
student goals
  -> courses and prerequisites
  -> skills
  -> professors and labs
  -> research opportunities
  -> internships and jobs
```

A student could ask, *"I want to work in climate AI next summer. What should I take, whom should I learn from, and what should I apply to?"* College Copilot would produce an evidence-backed, semester-by-semester action plan, identify missing skills, monitor deadlines and stale listings, and prepare user-approved outreach. Each agent would receive only a compressed student context capsule, joining personalized guidance, token efficiency, and practical automation in one system.

## Quick Start

```bash
cp .env.example .env
npm install
npm run import:courses
npm run import:professors
npm run dev
```

Open [http://localhost:4174](http://localhost:4174). API keys are optional: without Google OAuth the local app enables development login, and without an Anthropic key the advisor uses deterministic parsing and scoring fallbacks.

```bash
npm test
```

## Stack

TypeScript, Node.js, Express, Claude, SQLite, Redis, Zod, Google OAuth, and a vanilla JavaScript frontend. See [`src/agents`](src/agents/README.md) for the agent architecture and [`ROADMAP.md`](ROADMAP.md) for current implementation status.
