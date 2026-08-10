const { BACKGROUND_NICE, lowerBackgroundPriority } = require("../resource-priority");

describe("background resource priority", () => {
  it("lowers CPU and Linux I/O priority without a shell", () => {
    const calls = [];
    const result = lowerBackgroundPriority({
      platform: "linux",
      pid: 1234,
      setPriority: (pid, priority) => calls.push(["nice", pid, priority]),
      spawnSync: (command, args) => {
        calls.push([command, args]);
        return { status: 0 };
      },
    });

    expect(result).toEqual({ cpu: true, io: true });
    expect(calls).toEqual([
      ["nice", 1234, BACKGROUND_NICE],
      ["ionice", ["-c", "2", "-n", "7", "-p", "1234"]],
    ]);
  });

  it("continues when the host does not allow priority changes", () => {
    const result = lowerBackgroundPriority({
      platform: "linux",
      setPriority: () => { throw new Error("denied"); },
      spawnSync: () => { throw new Error("missing"); },
    });

    expect(result).toEqual({ cpu: false, io: false });
  });
});
