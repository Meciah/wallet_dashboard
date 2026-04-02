import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { SCOPES } from "./config.js";

export function utcNowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ensureDir(targetPath, { treatAsFile = true } = {}) {
  const dirPath = treatAsFile ? dirname(targetPath) : targetPath;
  mkdirSync(dirPath, { recursive: true });
}

export function writeJsonFile(targetPath, payload) {
  ensureDir(targetPath);
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function parseCliArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = tokens[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { command, options };
}

export function readIntOption(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer value, received ${value}`);
  }

  return parsed;
}

export function validateScope(scope) {
  return SCOPES.includes(scope) ? scope : null;
}

export async function withRetry(action, options = {}) {
  const {
    attempts = 4,
    baseDelayMs = 400,
    maxDelayMs = 4000,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 120);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1) + jitter);
      await sleep(delay);
    }
  }

  throw lastError;
}

function defaultShouldRetry(error) {
  if (!error) {
    return false;
  }

  if (typeof error.status === "number" && [408, 425, 429, 500, 502, 503, 504].includes(error.status)) {
    return true;
  }

  const message = String(error.message ?? error);
  return /ECONNRESET|ETIMEDOUT|fetch failed|429|503|rate limit/i.test(message);
}
