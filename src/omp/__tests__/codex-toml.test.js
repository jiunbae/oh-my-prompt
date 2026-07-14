const { findTomlLine, parseTomlValue, setTomlLine } = require("../toml");

describe("toml parsing", () => {
  it("parses notify arrays with comments", () => {
    const content = `# config\nnotify = [\"node\", \"/tmp/notify.js\"] # trailing`;
    const info = findTomlLine(content, "notify");
    expect(info).not.toBeNull();
    const parsed = parseTomlValue(info.value);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toBe("node");
  });

  it("inserts a new top-level key before the first table header, not at EOF", () => {
    const content = `model = "gpt-5"\n\n[tui]\nnotifications = true\n\n[projects."/tmp/x"]\ntrust = "trusted"\n`;
    const updated = setTomlLine(content, "notify", '["node", "/tmp/notify.js"]', "");
    // The key must land above [tui], so parseTomlValue sees it as top-level.
    const info = findTomlLine(updated, "notify");
    expect(info).not.toBeNull();
    expect(info.index).toBeLessThan(updated.split("\n").findIndex((l) => l.trim() === "[tui]"));
    expect(parseTomlValue(info.value)).toEqual(["node", "/tmp/notify.js"]);
  });
});
