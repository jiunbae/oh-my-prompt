import { describe, expect, it } from "vitest";
import { canTeamRoleManage, isOwnerRole } from "@/lib/team-role-policy";

describe("team role policy", () => {
  it("allows only owners and admins to manage team integrations", () => {
    expect(canTeamRoleManage("owner")).toBe(true);
    expect(canTeamRoleManage("admin")).toBe(true);
    expect(canTeamRoleManage("member")).toBe(false);
    expect(canTeamRoleManage(null)).toBe(false);
  });

  it("allows only the owner to delete the team", () => {
    expect(isOwnerRole("owner")).toBe(true);
    expect(isOwnerRole("admin")).toBe(false);
    expect(isOwnerRole("member")).toBe(false);
  });
});
