import { promises as fs } from "fs";
import path from "path";

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;
export const DEFAULT_SOURCE_CANDIDATES = [
  "zh-cn.json",
  "zhCN.json",
  "zh-CN.json",
  "zh_CN.json",
];
const DEFAULT_IGNORES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json"
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveSourceFile(directoryEntries, { directory, override }) {
  if (override) {
    const explicitEntry = directoryEntries.find(
      (entry) => entry.isFile() && entry.name === override
    );
    if (!explicitEntry) {
      throw new Error(`Source locale file "${override}" not found in ${directory}`);
    }
    return override;
  }

  const candidate = DEFAULT_SOURCE_CANDIDATES.find((name) =>
    directoryEntries.some((entry) => entry.isFile() && entry.name === name)
  );
  if (candidate) {
    return candidate;
  }

  throw new Error(
    `Source locale file not found in ${directory}. Provide --source or add one of: ${DEFAULT_SOURCE_CANDIDATES.join(", ")}`
  );
}

export function collectPlaceholders(value, options = {}) {
  const { keywordPrefixes = [] } = options;
  const counts = new Map();
  if (typeof value !== "string") {
    return counts;
  }

  let match;
  while ((match = PLACEHOLDER_PATTERN.exec(value)) !== null) {
    const startIndex = match.index;
    const rawToken = match[1];
    const endIndex = startIndex + match[0].length;

    if (startIndex > 0 && value[startIndex - 1] === "\\") {
      continue;
    }
    if (startIndex > 0 && value[startIndex - 1] === "{") {
      continue;
    }
    if (endIndex < value.length && value[endIndex] === "}") {
      continue;
    }

    const token = rawToken.trim();
    if (!token) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  if (keywordPrefixes.length > 0) {
    for (const prefix of keywordPrefixes) {
      if (!prefix) {
        continue;
      }
      const pattern = new RegExp(`${escapeRegExp(prefix)}\\d+`, "g");
      let match;
      while ((match = pattern.exec(value)) !== null) {
        const token = match[0];
        const startIndex = match.index;
        const endIndex = startIndex + token.length;

        const charBefore = value[startIndex - 1];
        const charAfter = value[endIndex];
        if (charBefore === "{" && charAfter === "}") {
          continue;
        }

        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }

  return counts;
}

async function loadJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${path.basename(filePath)}: ${error.message}`);
  }
}

function buildSourcePlaceholderMap(sourceEntries, collectOptions) {
  const map = new Map();
  for (const [key, value] of Object.entries(sourceEntries)) {
    map.set(key, collectPlaceholders(value, collectOptions));
  }
  return map;
}

function diffPlaceholders(sourceMap, targetMap) {
  const missing = [];
  const extra = [];
  const countMismatch = [];

  for (const [token, count] of sourceMap.entries()) {
    const targetCount = targetMap.get(token);
    if (targetCount === undefined) {
      missing.push(token);
    } else if (targetCount !== count) {
      countMismatch.push({ token, expected: count, actual: targetCount });
    }
  }

  for (const [token] of targetMap.entries()) {
    if (!sourceMap.has(token)) {
      extra.push(token);
    }
  }

  return { missing, extra, countMismatch };
}

function formatPlaceholderMap(placeholderMap) {
  return Array.from(placeholderMap.entries())
    .map(([token, count]) => (count > 1 ? `${token} (x${count})` : token))
    .sort();
}

function compareLocaleFile(sourcePlaceholders, targetEntries, collectOptions) {
  const errors = [];
  const warnings = [];

  for (const [key, sourcePlaceholderMap] of sourcePlaceholders.entries()) {
    if (!(key in targetEntries)) {
      warnings.push({
        type: "missing-key",
        key,
      });
      continue;
    }

    const targetValue = targetEntries[key];
    if (typeof targetValue !== "string") {
      warnings.push({
        type: "non-string",
        key,
        actualType: typeof targetValue,
      });
      continue;
    }

    const targetPlaceholderMap = collectPlaceholders(targetValue, collectOptions);
    const diff = diffPlaceholders(sourcePlaceholderMap, targetPlaceholderMap);
    if (diff.missing.length || diff.extra.length || diff.countMismatch.length) {
      errors.push({
        type: "placeholder-mismatch",
        key,
        diff,
        expected: formatPlaceholderMap(sourcePlaceholderMap),
        actual: formatPlaceholderMap(targetPlaceholderMap),
      });
    }
  }

  return { errors, warnings };
}

function logWarningSummary(warnings, logFn, { prefix = "  • ", sampleSize = 5 } = {}) {
  if (warnings.length === 0) {
    return;
  }

  const groups = new Map();
  for (const warning of warnings) {
    const list = groups.get(warning.type) ?? [];
    list.push(warning);
    groups.set(warning.type, list);
  }

  const formatSample = (items, formatter) => {
    const sample = items.slice(0, sampleSize).map(formatter);
    if (items.length <= sampleSize) {
      return sample.join(", ");
    }
    return `${sample.join(", ")}${sample.length ? ", " : ""}…`;
  };

  for (const [type, items] of groups.entries()) {
    switch (type) {
      case "missing-key": {
        const details = formatSample(items, (item) => item.key);
        const suffix = details ? ` (e.g. ${details})` : "";
        logFn(`${prefix}Missing key (placeholder check skipped): ${items.length} total${suffix}`);
        break;
      }
      case "non-string": {
        const details = formatSample(items, (item) => `${item.key} as ${item.actualType}`);
        const suffix = details ? ` (e.g. ${details})` : "";
        logFn(`${prefix}Non-string values (placeholder check skipped): ${items.length} total${suffix}`);
        break;
      }
      default: {
        const details = formatSample(items, (item) => item.key);
        const suffix = details ? ` (e.g. ${details})` : "";
        logFn(`${prefix}${type}: ${items.length} total${suffix}`);
      }
    }
  }
}

export async function checkPlaceholders(options = {}) {
  const {
    cwd = process.cwd(),
    source,
    ignore = [],
    keywordPrefixes = [],
  } = options;

  const directory = path.resolve(cwd);
  const directoryEntries = await fs.readdir(directory, { withFileTypes: true });

  const resolvedSource = resolveSourceFile(directoryEntries, {
    directory,
    override: source,
  });

  const ignoreSet = new Set([resolvedSource, ...ignore]);
  for (const name of DEFAULT_IGNORES) {
    ignoreSet.add(name);
  }

  const localeFiles = directoryEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !ignoreSet.has(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  const sourcePath = path.join(directory, resolvedSource);
  const sourceEntries = await loadJson(sourcePath);
  const collectOptions = { keywordPrefixes };
  const sourcePlaceholders = buildSourcePlaceholderMap(sourceEntries, collectOptions);

  const results = [];
  for (const file of localeFiles) {
    const targetEntries = await loadJson(path.join(directory, file));
    const outcome = compareLocaleFile(sourcePlaceholders, targetEntries, collectOptions);
    results.push({ file, ...outcome });
  }

  const failures = results.filter((result) => result.errors.length > 0);
  const warningsOnly = results.filter(
    (result) => result.errors.length === 0 && result.warnings.length > 0
  );

  return {
    ok: failures.length === 0,
    directory,
    sourceFile: resolvedSource,
    filesChecked: localeFiles,
    failures,
    warningsOnly,
  };
}

export function renderReport(report, consoleLike = console) {
  const { ok, failures, warningsOnly } = report;

  if (ok) {
    consoleLike.log(`All locale files match ${report.sourceFile} placeholders.`);
    if (warningsOnly.length > 0) {
      consoleLike.warn("\nWarnings:");
      for (const { file, warnings } of warningsOnly) {
        consoleLike.warn(`${file}:`);
        logWarningSummary(warnings, consoleLike.warn.bind(consoleLike), { prefix: "  • " });
        consoleLike.warn("");
      }
    }
    return ok;
  }

  consoleLike.error(`Placeholder inconsistencies detected (source: ${report.sourceFile}):\n`);

  for (const { file, errors, warnings } of failures) {
    consoleLike.error(`${file}:`);
    for (const issue of errors) {
      switch (issue.type) {
        case "placeholder-mismatch": {
          const { diff, expected, actual } = issue;
          consoleLike.error(`  • Placeholder mismatch for key ${issue.key}`);
          if (diff.missing.length) {
            consoleLike.error(`    - Missing placeholders: ${diff.missing.join(", ")}`);
          }
          if (diff.extra.length) {
            consoleLike.error(`    - Extra placeholders: ${diff.extra.join(", ")}`);
          }
          if (diff.countMismatch.length) {
            for (const entry of diff.countMismatch) {
              consoleLike.error(
                `    - Placeholder "${entry.token}" count mismatch (expected ${entry.expected}, found ${entry.actual})`
              );
            }
          }
          consoleLike.error(`    - Expected: [${expected.join(", ")}]`);
          consoleLike.error(`    - Actual:   [${actual.join(", ")}]`);
          break;
        }
        default:
          consoleLike.error(`  • ${issue.type} issue at ${issue.key}`);
      }
    }

    if (warnings.length > 0) {
      consoleLike.error("  Warnings:");
      logWarningSummary(warnings, consoleLike.error.bind(consoleLike), { prefix: "    - " });
    }

    consoleLike.error("");
  }

  if (warningsOnly.length > 0) {
    consoleLike.error("Additional warnings:");
    for (const { file, warnings } of warningsOnly) {
      consoleLike.error(`${file}:`);
      logWarningSummary(warnings, consoleLike.error.bind(consoleLike), { prefix: "  • " });
      consoleLike.error("");
    }
  }

  return ok;
}

export async function run(options) {
  const report = await checkPlaceholders(options);
  renderReport(report);
  return report.ok;
}
