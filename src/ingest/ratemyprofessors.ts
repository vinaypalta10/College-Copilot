/**
 * RateMyProfessors lookup via the public GraphQL endpoint.
 *
 * Unofficial but stable: the site ships a hardcoded Basic auth token. We search
 * within UC Berkeley's school id and match on last name. Results are cached on
 * the `instructors` table (see professor-rating skill); callers should rate-limit.
 */

const ENDPOINT = "https://www.ratemyprofessors.com/graphql";
const AUTH = "Basic dGVzdDp0ZXN0"; // "test:test" — the site's public client token
const BERKELEY_SCHOOL_ID = process.env.RMP_SCHOOL_ID || "U2Nob29sLTEwNzI="; // UC Berkeley

export interface RmpRating {
  firstName: string;
  lastName: string;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null;
  numRatings: number | null;
  department: string | null;
}

const TEACHER_QUERY = `
query($text:String!, $sid:ID!){
  newSearch {
    teachers(query:{ text:$text, schoolID:$sid }) {
      edges { node { firstName lastName avgRating avgDifficulty wouldTakeAgainPercent numRatings department } }
    }
  }
}`;

function lastNameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || "";
}

/** Best-effort RMP rating for a Berkeley instructor by display name. Null if not found. */
export async function fetchRmpRating(name: string): Promise<RmpRating | null> {
  const timeoutMs = Math.max(500, Number(process.env.RMP_TIMEOUT_MS || 4000));
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ query: TEACHER_QUERY, variables: { text: lastNameOf(name), sid: BERKELEY_SCHOOL_ID } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RMP ${res.status}`);
  const json = await res.json() as { data?: { newSearch?: { teachers?: { edges?: Array<{ node: RmpRating }> } } } };
  const edges = json.data?.newSearch?.teachers?.edges ?? [];
  if (!edges.length) return null;

  const want = firstNameOf(name).toLowerCase();
  // Prefer an exact first-name match; otherwise the most-rated candidate.
  const exact = edges.find(e => e.node.firstName?.toLowerCase() === want);
  const chosen = exact?.node ?? edges
    .map(e => e.node)
    .sort((a, b) => (b.numRatings ?? 0) - (a.numRatings ?? 0))[0];
  return chosen ?? null;
}
