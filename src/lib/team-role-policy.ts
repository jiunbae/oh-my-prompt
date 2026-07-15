export type TeamRole = "owner" | "admin" | "member";

export function canTeamRoleManage(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}
