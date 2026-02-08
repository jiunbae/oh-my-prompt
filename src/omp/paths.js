const fs = require("fs");
const os = require("os");
const path = require("path");

function getConfigDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "oh-my-prompt");
}

function getConfigPath() {
  return process.env.OMP_CONFIG_PATH || path.join(getConfigDir(), "config.json");
}

function getStatePath() {
  return path.join(getConfigDir(), "state.json");
}

function getQueueDir() {
  return path.join(getConfigDir(), "queue");
}

function getHooksDir() {
  return path.join(getConfigDir(), "hooks");
}

function getLogsDir() {
  return path.join(getConfigDir(), "logs");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDefaultSqlitePath() {
  return path.join(getConfigDir(), "omp.db");
}

module.exports = {
  getConfigDir,
  getConfigPath,
  getStatePath,
  getQueueDir,
  getHooksDir,
  getLogsDir,
  ensureDir,
  getDefaultSqlitePath,
};
