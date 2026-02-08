const fs = require("fs");
const path = require("path");
const { getStatePath, ensureDir } = require("./paths");

function loadState() {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch (error) {
    return {};
  }
}

function saveState(state) {
  const statePath = getStatePath();
  ensureDir(path.dirname(statePath));
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function updateState(partial) {
  const state = loadState();
  const next = { ...state, ...partial };
  saveState(next);
  return next;
}

module.exports = {
  loadState,
  saveState,
  updateState,
};
