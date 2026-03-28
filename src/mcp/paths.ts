import { isAbsolute, relative, resolve } from "node:path";

export interface PathPolicy {
  workspaceCwd: string;
  allowedRoots: string[];
  /** Resolved absolute default corpus dir when PDF_TO_RAG_SOURCE_DIR is set. */
  defaultSourceDir: string | null;
}

/**
 * Resolve PDF_TO_RAG_CWD, merge allowed dirs from env, dedupe.
 */
export function loadPathPolicy(env: NodeJS.ProcessEnv = process.env): PathPolicy {
  const workspaceCwd = resolve(env.PDF_TO_RAG_CWD || process.cwd());

  const roots = new Set<string>([workspaceCwd]);

  const allowedDirs = env.PDF_TO_RAG_ALLOWED_DIRS?.trim();
  if (allowedDirs) {
    for (const part of allowedDirs.split(",")) {
      const p = part.trim();
      if (p) roots.add(resolve(p));
    }
  }

  const singleRoot = env.PDF_TO_RAG_ROOT?.trim();
  if (singleRoot) {
    roots.add(resolve(singleRoot));
  }

  let defaultSourceDir: string | null = null;
  const sourceDirEnv = env.PDF_TO_RAG_SOURCE_DIR?.trim();
  if (sourceDirEnv) {
    const resolvedSource = resolve(sourceDirEnv);
    roots.add(resolvedSource);
    defaultSourceDir = resolvedSource;
  }

  return {
    workspaceCwd,
    allowedRoots: [...roots],
    defaultSourceDir,
  };
}

export function resolveUnderWorkspace(workspaceCwd: string, userPath: string): string {
  return isAbsolute(userPath) ? resolve(userPath) : resolve(workspaceCwd, userPath);
}

/** True if target is targetRoot or a subdirectory of targetRoot. */
export function isSubpath(targetRoot: string, target: string): boolean {
  const root = resolve(targetRoot);
  const t = resolve(target);
  const rel = relative(root, t);
  if (rel === "") return true;
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return true;
}

export function assertPathAllowed(absolutePath: string, policy: PathPolicy): void {
  const ok = policy.allowedRoots.some((root) => isSubpath(root, absolutePath));
  if (!ok) {
    const err = new Error(
      `Path is not under allowed roots: ${absolutePath}. Configure PDF_TO_RAG_ALLOWED_DIRS or PDF_TO_RAG_ROOT.`
    );
    (err as NodeJS.ErrnoException).code = "PATH_NOT_ALLOWED";
    throw err;
  }
}
