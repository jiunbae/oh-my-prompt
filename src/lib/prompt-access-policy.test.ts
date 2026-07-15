import { describe, expect, it } from "vitest";
import {
  hasPromptManageAccess,
  hasPromptViewAccess,
  type PromptPermissionLevel,
  type PromptVisibility,
} from "@/lib/prompt-access-policy";

describe("prompt access policy", () => {
  const canView = (
    visibility: PromptVisibility,
    options: {
      isOwner?: boolean;
      isTeamMember?: boolean;
      permission?: PromptPermissionLevel;
    } = {},
  ) =>
    hasPromptViewAccess({
      isOwner: options.isOwner ?? false,
      visibility,
      isTeamMember: options.isTeamMember ?? false,
      permission: options.permission,
    });

  it("always lets the owner view their prompt", () => {
    expect(canView("private", { isOwner: true })).toBe(true);
  });

  it("lets any authenticated viewer see a public prompt", () => {
    expect(canView("public")).toBe(true);
  });

  it("only lets team members see team-visible prompts", () => {
    expect(canView("team", { isTeamMember: true })).toBe(true);
    expect(canView("team", { isTeamMember: false })).toBe(false);
  });

  it("does not expose a private prompt merely because the viewer is a team member", () => {
    expect(canView("private", { isTeamMember: true })).toBe(false);
  });

  it.each(["view", "edit", "admin"] as const)(
    "honors an explicit %s grant for a private prompt",
    (permission) => {
      expect(canView("private", { permission })).toBe(true);
    },
  );

  it("does not let an editor manage ACLs or self-escalate", () => {
    expect(hasPromptManageAccess({ isOwner: false, permission: "edit" })).toBe(false);
    expect(hasPromptManageAccess({ isOwner: false, permission: "admin" })).toBe(true);
    expect(hasPromptManageAccess({ isOwner: true })).toBe(true);
  });

  it("lets current team owners and admins manage team prompt access", () => {
    expect(hasPromptManageAccess({ isOwner: false, isTeamManager: true })).toBe(true);
  });
});
