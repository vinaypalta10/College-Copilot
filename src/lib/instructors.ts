/** Normalize an instructor display name into a stable lookup key. */
export function instructorKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-");
}
