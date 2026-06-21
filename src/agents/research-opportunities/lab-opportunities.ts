export interface ResearchLab {
  slug: string;
  name: string;
  university: string;
  description: string;
  topics: string[];
  url: string;
}

export const RESEARCH_LABS: ResearchLab[] = [
  {
    slug: "bair",
    name: "Berkeley Artificial Intelligence Research",
    university: "UC Berkeley",
    description: "AI research spanning machine learning, robotics, computer vision, and language.",
    topics: ["artificial intelligence", "machine learning", "robotics", "computer vision", "NLP"],
    url: "https://bair.berkeley.edu/students.html",
  },
  {
    slug: "berkeley-nlp",
    name: "Berkeley NLP",
    university: "UC Berkeley",
    description: "Research on natural language processing, language models, and machine learning.",
    topics: ["NLP", "language models", "machine learning", "artificial intelligence"],
    url: "https://nlp.cs.berkeley.edu/",
  },
  {
    slug: "sky-computing",
    name: "Sky Computing Lab",
    university: "UC Berkeley",
    description: "Systems research for cloud computing, distributed systems, and AI infrastructure.",
    topics: ["cloud computing", "distributed systems", "systems", "AI infrastructure"],
    url: "https://sky.cs.berkeley.edu/",
  },
  {
    slug: "rise-lab",
    name: "RISELab",
    university: "UC Berkeley",
    description: "Research on real-time, intelligent, secure, and explainable computing systems.",
    topics: ["machine learning systems", "data systems", "security", "real-time systems"],
    url: "https://rise.cs.berkeley.edu/",
  },
  {
    slug: "berkeley-hci",
    name: "Berkeley HCI",
    university: "UC Berkeley",
    description: "Human-computer interaction research across design, accessibility, and interactive systems.",
    topics: ["human-computer interaction", "accessibility", "design", "interactive systems"],
    url: "https://hci.berkeley.edu/",
  },
  {
    slug: "deepdrive",
    name: "Berkeley DeepDrive",
    university: "UC Berkeley",
    description: "Computer vision and machine learning research for automotive and autonomous systems.",
    topics: ["computer vision", "autonomous systems", "machine learning", "robotics"],
    url: "https://bdd-data.berkeley.edu/",
  },
];

function terms(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9+#]+/).filter((term) => term.length > 1);
}

export function searchResearchLabs(query: string): ResearchLab[] {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [...RESEARCH_LABS];

  return RESEARCH_LABS
    .map((lab) => {
      const title = lab.name.toLowerCase();
      const haystack = `${lab.name} ${lab.description} ${lab.topics.join(" ")}`.toLowerCase();
      const score = queryTerms.reduce((total, term) => {
        if (title.includes(term)) return total + 3;
        if (haystack.includes(term)) return total + 1;
        return total;
      }, 0);
      return { lab, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.lab.name.localeCompare(b.lab.name))
    .map(({ lab }) => lab);
}
