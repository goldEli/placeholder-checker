#!/usr/bin/env node

import path from "path";
import process from "process";
import { DEFAULT_SOURCE_CANDIDATES, run } from "../src/index.js";

function printHelp() {
  const [primarySource, ...fallbackSources] = DEFAULT_SOURCE_CANDIDATES;
  const defaultSourceDescription =
    fallbackSources.length === 0
      ? primarySource
      : `${primarySource} (fallbacks: ${fallbackSources.join(", ")})`;

  console.log(`i18n-placeholder-checker

Usage:
  i18n-placeholder-checker [options]

Options:
  -s, --source <file>    Source locale file to compare against (default: ${defaultSourceDescription})
  --cwd <path>           Directory to scan (default: current working directory)
  --ignore <file>        Additional JSON files to ignore (repeatable, comma separated allowed)
  --keyword-prefix <p>   Treat comma-separated prefixes as numbered placeholders (repeatable)
  -h, --help             Show this help message
`);
}

function parseArguments(argv) {
  const options = {
    source: undefined,
    cwd: process.cwd(),
    ignore: [],
    keywordPrefixes: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    }

    if (arg === "--source" || arg === "-s") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --source");
      }
      options.source = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
      continue;
    }

    if (arg === "--cwd") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --cwd");
      }
      options.cwd = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      options.cwd = path.resolve(arg.slice("--cwd=".length));
      continue;
    }

    if (arg === "--ignore") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --ignore");
      }
      options.ignore.push(...value.split(","));
      index += 1;
      continue;
    }

    if (arg.startsWith("--ignore=")) {
      const value = arg.slice("--ignore=".length);
      options.ignore.push(...value.split(","));
      continue;
    }

    if (arg === "--keyword-prefix" || arg === "-k") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --keyword-prefix");
      }
      options.keywordPrefixes.push(...value.split(","));
      index += 1;
      continue;
    }

    if (arg.startsWith("--keyword-prefix=")) {
      const value = arg.slice("--keyword-prefix=".length);
      options.keywordPrefixes.push(...value.split(","));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  try {
    const ok = await run({
      cwd: options.cwd,
      source: options.source,
      ignore: options.ignore.filter(Boolean),
      keywordPrefixes: options.keywordPrefixes.filter(Boolean),
    });
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    process.exitCode = 1;
    console.error(error.stack || error.message);
  }
}

main();
