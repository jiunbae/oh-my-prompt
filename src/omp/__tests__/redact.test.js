const { redactText } = require("../redact");

describe("redactText", () => {
  it("redacts API keys", () => {
    const input = "Authorization: Bearer sk-123456789012345678901234567890";
    const result = redactText(input, { mask: "[REDACTED]" });
    expect(result.text).not.toContain("sk-123456");
    expect(result.text).toContain("[REDACTED]");
  });
});
