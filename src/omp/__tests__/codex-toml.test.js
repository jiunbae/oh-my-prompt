const { findTomlLine, parseTomlValue } = require("../toml");

describe("toml parsing", () => {
  it("parses notify arrays with comments", () => {
    const content = `# config\nnotify = [\"node\", \"/tmp/notify.js\"] # trailing`;
    const info = findTomlLine(content, "notify");
    expect(info).not.toBeNull();
    const parsed = parseTomlValue(info.value);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toBe("node");
  });
});
