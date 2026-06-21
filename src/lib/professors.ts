export function normalizeProfessorName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(professor|prof|dr)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
