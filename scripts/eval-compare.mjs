#!/usr/bin/env node
/**
 * Comparative (A/B) eval report differ (F18).
 *
 * Compares two eval reports produced by `eval:run` and quantifies whether
 * a pipeline change (model upgrade, new chunking, config tweak) improved
 * or degraded retrieval quality.
 *
 * Usage:
 *   npm run eval:compare -- before.json after.json
 *   npm run eval:compare -- --before eval-results-before.json --after eval-results-after.json
 *
 * Output: delta table for all summary metrics, list of regressions and
 * improvements (per-case rank changes), and an overall verdict.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { before: null, after: null, showAll: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--before") args.before = argv[++i];
    else if (a === "--after") args.after = argv[++i];
    else if (a === "--show-all") args.showAll = true;
    else if (!a.startsWith("-")) pos.push(a);
  }
  if (!args.before && pos[0]) args.before = pos[0];
  if (!args.after && pos[1]) args.after = pos[1];
  return args;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(v) {
  return v === null || v === undefined ? "  —  " : `${(v * 100).toFixed(1)}%`;
}

function fmt3(v) {
  return v === null || v === undefined ? "  —  " : v.toFixed(3);
}

function delta(after, before) {
  if (after === null || before === null) return "  —  ";
  const d = after - before;
  const s = (d >= 0 ? "+" : "") + (d * 100).toFixed(1) + "%";
  return d > 0.001 ? `\x1b[32m${s}\x1b[0m` : d < -0.001 ? `\x1b[31m${s}\x1b[0m` : `  ±0  `;
}

function deltaRaw(after, before, fmt) {
  if (after === null || before === null) return "  —  ";
  const d = after - before;
  const s = (d >= 0 ? "+" : "") + fmt(d);
  return Math.abs(d) > 0.0005 ? (d > 0 ? `\x1b[32m${s}\x1b[0m` : `\x1b[31m${s}\x1b[0m`) : "  ±0  ";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadReport(path) {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
  } catch (e) {
    console.error(`Cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.before || !args.after) {
    console.error("Usage: npm run eval:compare -- before.json after.json");
    console.error("       npm run eval:compare -- --before before.json --after after.json");
    process.exit(1);
  }

  const before = loadReport(args.before);
  const after = loadReport(args.after);

  const bS = before.summary;
  const aS = after.summary;

  const sep = "─".repeat(65);
  console.log(sep);
  console.log(`A/B Comparison`);
  console.log(`  Before: ${args.before}  (${before.timestamp ?? "unknown"})`);
  console.log(`  After:  ${args.after}  (${after.timestamp ?? "unknown"})`);
  console.log(`  Model:  ${before.embeddingModel ?? "?"} → ${after.embeddingModel ?? "?"}`);
  console.log(sep);

  // Summary table
  const row = (label, key, formatFn, deltaFn) => {
    const b = bS[key];
    const a = aS[key];
    const bStr = formatFn(b).padEnd(8);
    const aStr = formatFn(a).padEnd(8);
    const dStr = deltaFn(a, b);
    console.log(`  ${label.padEnd(20)} ${bStr}  →  ${aStr}  ${dStr}`);
  };

  console.log(`  ${"Metric".padEnd(20)} ${"Before".padEnd(8)}     ${"After".padEnd(8)}  Delta`);
  console.log(`  ${"─".repeat(60)}`);
  row("Hit@1",           "hitAt1",          pct,  delta);
  row("Hit@3",           "hitAt3",          pct,  delta);
  row("Hit@5",           "hitAt5",          pct,  delta);
  row("Hit@10",          "hitAt10",         pct,  delta);
  row("MRR",             "mrr",             fmt3, (a, b) => deltaRaw(a, b, (d) => d.toFixed(3)));
  row("nDCG@10",         "ndcg10",          fmt3, (a, b) => deltaRaw(a, b, (d) => d.toFixed(3)));
  row("Mean gold score", "meanGoldScore",   fmt3, (a, b) => deltaRaw(a, b, (d) => d.toFixed(3)));
  row("Not found",       "notFound", (v) => String(v ?? "—").padEnd(8),
      (a, b) => { if (a === null || b === null) return "  —  "; const d = a - b; return d === 0 ? "  ±0  " : d < 0 ? `\x1b[32m${d}\x1b[0m` : `\x1b[31m+${d}\x1b[0m`; });
  console.log(sep);

  // Per-case rank changes
  if (before.allCases && after.allCases) {
    const beforeMap = new Map(before.allCases.map((c) => [c.chunkId, c]));
    const afterMap = new Map(after.allCases.map((c) => [c.chunkId, c]));

    const regressions = [];
    const improvements = [];
    const unchanged = [];

    for (const [id, aCase] of afterMap) {
      const bCase = beforeMap.get(id);
      if (!bCase) continue;
      const bRank = bCase.rank ?? (before.searchDepth + 1);
      const aRank = aCase.rank ?? (after.searchDepth + 1);
      const diff = bRank - aRank; // positive = improved (rank went down numerically)
      if (diff > 2) improvements.push({ ...aCase, bRank, aRank, diff });
      else if (diff < -2) regressions.push({ ...aCase, bRank, aRank, diff });
      else unchanged.push({ ...aCase, bRank, aRank, diff });
    }

    regressions.sort((a, b) => a.diff - b.diff); // worst regressions first
    improvements.sort((a, b) => b.diff - a.diff); // best improvements first

    if (regressions.length > 0) {
      console.log(`\n\x1b[31mRegressions (${regressions.length} cases, rank got worse by >2):\x1b[0m`);
      for (const r of regressions.slice(0, 10)) {
        const bR = r.bRank > before.searchDepth ? "NOT FOUND" : `rank ${r.bRank}`;
        const aR = r.aRank > after.searchDepth ? "NOT FOUND" : `rank ${r.aRank}`;
        console.log(`  ${bR} → ${aR}  ${r.sourceFile} p.${r.page ?? "?"}`);
        if (args.showAll || regressions.length <= 5) {
          const q = (r.question ?? "").slice(0, 70);
          console.log(`    ${q}${q.length === 70 ? "…" : ""}`);
        }
      }
    }

    if (improvements.length > 0) {
      console.log(`\n\x1b[32mImprovements (${improvements.length} cases, rank got better by >2):\x1b[0m`);
      for (const r of improvements.slice(0, 10)) {
        const bR = r.bRank > before.searchDepth ? "NOT FOUND" : `rank ${r.bRank}`;
        const aR = r.aRank > after.searchDepth ? "NOT FOUND" : `rank ${r.aRank}`;
        console.log(`  ${bR} → ${aR}  ${r.sourceFile} p.${r.page ?? "?"}`);
      }
    }

    console.log(`\nUnchanged (rank Δ ≤ 2): ${unchanged.length} cases`);
  }

  // Verdict
  const mrrDelta = (aS.mrr ?? 0) - (bS.mrr ?? 0);
  const h10Delta = (aS.hitAt10 ?? 0) - (bS.hitAt10 ?? 0);
  console.log(`\n${sep}`);
  if (mrrDelta > 0.02 || h10Delta > 0.02) {
    console.log("\x1b[32mVerdict: IMPROVED — measurable gain in MRR or Hit@10\x1b[0m");
  } else if (mrrDelta < -0.02 || h10Delta < -0.02) {
    console.log("\x1b[31mVerdict: REGRESSED — measurable drop in MRR or Hit@10\x1b[0m");
  } else {
    console.log("Verdict: NEUTRAL — no significant change (|ΔMRR| < 0.02, |ΔHit@10| < 0.02)");
  }
  console.log(sep);
}

main();
