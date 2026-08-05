const { findTomlLine, parseTomlStringArray, parseTomlValue, setTomlLine } = require("../toml");

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

  // Codex writes notify as a multi-line array with a trailing comma. JSON.parse
  // rejects that, and the `toml` fallback is absent from the published CLI, so a
  // regression here degrades to a raw string only in real installs — never in
  // this suite, where `toml` resolves from the monorepo. These cases must pass
  // on the hand-written parser alone.
  it("parses the multi-line, trailing-comma array Codex actually writes", () => {
    const content = [
      "notify = [",
      '    "/Applications/Client.app/Contents/MacOS/Client",',
      '    "turn-ended",',
      "]",
      'service_tier = "default"',
    ].join("\n");
    const info = findTomlLine(content, "notify");
    expect(info).not.toBeNull();
    const expected = ["/Applications/Client.app/Contents/MacOS/Client", "turn-ended"];
    // Asserted on the dependency-free parser first: parseTomlValue could pass on
    // the `toml` fallback alone and still ship broken.
    expect(parseTomlStringArray(info.value.trim())).toEqual(expected);
    expect(parseTomlValue(info.value)).toEqual(expected);
  });

  it("parses arrays with interior comments and literal strings", () => {
    const content = ["notify = [", '  "node", # the interpreter', "  '/tmp/notify.js',", "]"].join("\n");
    const value = findTomlLine(content, "notify").value.trim();
    expect(parseTomlStringArray(value)).toEqual(["node", "/tmp/notify.js"]);
  });

  it("keeps escapes intact in quoted elements", () => {
    const value = findTomlLine('notify = ["node", "/tmp/a b\\"c.js"]', "notify").value.trim();
    expect(parseTomlStringArray(value)).toEqual(["node", '/tmp/a b"c.js']);
  });

  it("declines non-string arrays so richer parsers still get a turn", () => {
    expect(parseTomlStringArray("[1, 2, 3]")).toBeNull();
    expect(parseTomlValue("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("rejects malformed arrays rather than inventing elements", () => {
    expect(parseTomlStringArray('["a" "b"]')).toBeNull(); // missing separator
    expect(parseTomlStringArray('["a",, "b"]')).toBeNull(); // doubled comma
    expect(parseTomlStringArray('["unterminated]')).toBeNull();
  });

  it("parses an empty array as an empty array", () => {
    expect(parseTomlStringArray("[]")).toEqual([]);
    expect(parseTomlValue("[]")).toEqual([]);
  });
});
