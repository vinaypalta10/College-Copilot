# Industry Jobs Agent System

Goal: make job search practically useful for students.

This should not share the same data model as research opportunities. Jobs need
structured descriptions, resume targeting, and networking support.

## What This System Owns

- Finding relevant internships/jobs.
- Normalizing job postings into a fixed schema.
- Digesting job descriptions.
- Creating resume-tailoring prompts.
- Finding potential networking leads for user-clicked coffee chat workflows.

## Proposed Agents

```text
job-search-agent
  finds relevant openings from selected sources

job-normalizer-agent
  converts each job into NormalizedJob

jd-digest-agent
  extracts skills, responsibilities, keywords, and qualifications

resume-prompt-agent
  creates a prompt the student can use with Claude/ChatGPT and their resume

networking-agent
  searches for possible LinkedIn/company connections
  must not message people automatically
```

## Minimum Job Schema

```ts
interface NormalizedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  employmentType: "internship" | "new_grad" | "part_time" | "full_time";
  source: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  applicationDeadline?: string;
  notes?: string;
}
```

## User Workflow

```text
search jobs
  -> inspect normalized job cards
  -> generate resume-tailoring prompt
  -> user pastes prompt + resume into Claude/ChatGPT
  -> optional networking search
  -> user clicks any outreach action manually
```

## Safety Rule

Never send LinkedIn messages, emails, applications, or connection requests
automatically. The system can prepare drafts and links; the user must click.
