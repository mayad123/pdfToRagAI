import { readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import type { DocumentRef } from "../domain/document.js";

async function collectPdfPaths(
  dir: string,
  absoluteRoot: string,
  recursive: boolean,
  out: string[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = resolve(join(dir, ent.name));
    if (ent.isDirectory() && recursive) {
      await collectPdfPaths(full, absoluteRoot, recursive, out);
    } else if (ent.isFile() && extname(ent.name).toLowerCase() === ".pdf") {
      out.push(full);
    }
  }
}

/**
 * List PDF files under root. Returns DocumentRef with posix-style relative paths for stable ids.
 */
export async function listPdfFiles(
  rootPath: string,
  recursive: boolean
): Promise<DocumentRef[]> {
  const absoluteRoot = resolve(rootPath);
  const paths: string[] = [];
  await collectPdfPaths(absoluteRoot, absoluteRoot, recursive, paths);
  paths.sort();

  return paths.map((absolutePath) => {
    const normalized = relative(absoluteRoot, absolutePath).split(/[/\\]/).join("/");
    const fileName = normalized.split("/").pop() ?? normalized;
    return {
      absolutePath,
      relativePath: normalized,
      fileName,
    };
  });
}
