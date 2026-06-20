import { profile, type ProfileFacet } from "../profile/ruoxi.ts";

export interface KeywordScore {
  score: number;
  facets: { id: string; label: string; hits: number }[];
}

export function keywordScore(text: string): KeywordScore {
  const lower = text.toLowerCase();
  const facets = profile.facets.map((facet: ProfileFacet) => {
    let hits = 0;
    for (const keyword of facet.keywords) {
      if (lower.includes(keyword.toLowerCase())) hits++;
    }
    return { id: facet.id, label: facet.label, hits };
  });
  const score = facets.reduce((sum, f) => sum + f.hits, 0);
  return { score, facets: facets.filter(f => f.hits > 0) };
}
