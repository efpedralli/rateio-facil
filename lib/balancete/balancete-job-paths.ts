import path from "path";

/**
 * Garante que `candidateAbs` fica dentro de `uploads/balancetes/{jobId}` (sem path traversal).
 */
export function isPathUnderBalanceteJobDir(
  cwd: string,
  jobId: string,
  candidateAbs: string
): boolean {
  const base = path.resolve(cwd, "uploads", "balancetes", jobId);
  const resolved = path.resolve(candidateAbs);
  const rel = path.relative(base, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
