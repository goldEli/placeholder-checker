# i18n-placeholder-checker

CLI and programmatic utility to ensure locale JSON files keep the same placeholders as a source language (default `zh-cn.json`).

## Usage

```bash
# install locally
npm install --save-dev i18n-placeholder-checker

# run the CLI (defaults shown)
npx i18n-placeholder-checker \
  --source zh-cn.json \
  --cwd .
```

### Options

| Flag | Description |
| ---- | ----------- |
| `-s, --source <file>` | Source locale file used as the placeholder reference. Defaults to `zh-cn.json`. |
| `--cwd <path>` | Directory containing locale files. Defaults to the current working directory. |
| `--ignore <file>` | Additional JSON files to skip. Repeat the flag or provide a comma-separated list. |

The CLI exits with code `1` when placeholder mismatches are detected so it fits into Git hooks and CI jobs.

## Programmatic API

```js
import { checkPlaceholders, renderReport } from "i18n-placeholder-checker";

const report = await checkPlaceholders({
  cwd: process.cwd(),
  source: "zh-cn.json",
  ignore: ["package.json"],
});

renderReport(report);

if (!report.ok) {
  process.exit(1);
}
```

`report` contains:

- `ok`: `true` when no placeholder mismatches exist.
- `failures`: array of files with placeholder errors plus warnings.
- `warningsOnly`: files that only have skipped keys/non-string issues.

## Publish Guide

1. Update `version` in `package.json`.
2. Run the test lint in the consumer repository (e.g., `npm run lint:placeholders`).
3. Log in to npm (`npm login`) if needed.
4. Publish from this folder: `npm publish --access public`.

> Note: the consumer project references this package via a local `file:` dependency until an official version is published to npm.
