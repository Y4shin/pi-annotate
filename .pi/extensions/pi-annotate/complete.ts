import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_LIMIT = 50;

const IGNORED_DIRS = new Set([".git", "node_modules", ".pi"]);

interface CacheEntry {
  files: string[];
  maxDepth: number;
}

// Cache per cwd so repeated autocomplete keystrokes don't re-walk the tree.
const fileCache = new Map<string, CacheEntry>();

function isHiddenDir(name: string): boolean {
  return name.startsWith(".");
}

export async function listMarkdownFiles(
  cwd: string,
  opts?: { maxDepth?: number },
): Promise<string[]> {
  const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const cacheKey = `${cwd}:${maxDepth}`;
  const cached = fileCache.get(cacheKey);
  if (cached) {
    return cached.files;
  }

  const files: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (files.length >= DEFAULT_MAX_FILES) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= DEFAULT_MAX_FILES) return;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || isHiddenDir(entry.name)) {
          continue;
        }
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(cwd, fullPath));
      }
    }
  }

  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  await walk(cwd, 1);
  const result = files.sort((a, b) => a.localeCompare(b));
  fileCache.set(cacheKey, { files: result, maxDepth });
  return result;
}

export function filterCompletions(
  files: string[],
  prefix: string,
  limit: number = DEFAULT_LIMIT,
): AutocompleteItem[] {
  const query = prefix.toLowerCase();
  const matched = files
    .filter((file) => {
      const lower = file.toLowerCase();
      return lower.startsWith(query) || lower.includes(query);
    })
    .slice(0, limit);

  return matched.map((file) => ({ value: file, label: file }));
}

export async function getArgumentCompletions(
  cwd: string,
  prefix: string,
): Promise<AutocompleteItem[] | null> {
  const files = await listMarkdownFiles(cwd);
  const items = filterCompletions(files, prefix);
  return items.length > 0 ? items : null;
}
