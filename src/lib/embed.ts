/**
 * Lightweight, dependency-free text embedder for semantic course search.
 *
 * Produces a fixed-dimension dense vector via the hashing trick over token
 * unigrams+bigrams, weighted by inverse document frequency (IDF) learned from
 * the catalog corpus, then L2-normalized so cosine similarity == dot product.
 *
 * This is deliberately keyless and offline (mirroring the app's heuristic-vs-LLM
 * fallback): it always works with no API. It is *pluggable* — swap `embed` for a
 * hosted neural embedder (set the same dimension) and the Redis vector store +
 * KNN downstream are unchanged. The honest framing: this default is a hashed
 * TF-IDF embedding (strong lexical retrieval), upgradeable to a neural model.
 */

export const EMBED_DIM = 512;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "this", "that", "by", "as", "at", "be", "will", "from", "it", "its", "into", "introduction",
  "course", "students", "study", "topics", "credit", "units", "prerequisite", "prerequisites",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords + very short tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/** Unigrams + adjacent bigrams (bigrams capture phrases like "machine learning"). */
function terms(text: string): string[] {
  const toks = tokenize(text);
  const out = toks.slice();
  for (let i = 0; i < toks.length - 1; i++) out.push(`${toks[i]}_${toks[i + 1]}`);
  return out;
}

/** Stable, fast string hash (FNV-1a) → bucket in [0, EMBED_DIM). */
function bucket(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % EMBED_DIM;
}

export type IdfMap = Record<string, number>;

/** Learn IDF weights for every term across a corpus of documents. */
export function buildIdf(documents: string[]): IdfMap {
  const df: Record<string, number> = {};
  for (const doc of documents) {
    for (const term of new Set(terms(doc))) df[term] = (df[term] ?? 0) + 1;
  }
  const n = documents.length || 1;
  const idf: IdfMap = {};
  for (const [term, count] of Object.entries(df)) {
    // Smoothed IDF; rarer terms weigh more.
    idf[term] = Math.log((n + 1) / (count + 1)) + 1;
  }
  return idf;
}

/** Embed text into a unit-length EMBED_DIM vector using the corpus IDF weights. */
export function embed(text: string, idf: IdfMap): number[] {
  const v = new Array(EMBED_DIM).fill(0);
  // Default weight for unseen query terms: treat as moderately rare.
  const fallbackIdf = 2;
  for (const term of terms(text)) {
    const w = idf[term] ?? fallbackIdf;
    v[bucket(term)] += w;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity of two equal-length vectors (== dot product when normalized). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
