export type PromptVisibility = "private" | "team" | "public";
export type PromptPermissionLevel = "view" | "edit" | "admin";

/** Pure prompt visibility policy shared by database-backed checks and tests. */
export function hasPromptViewAccess({
  isOwner,
  visibility,
  isTeamMember,
  permission,
}: {
  isOwner: boolean;
  visibility: PromptVisibility;
  isTeamMember: boolean;
  permission?: PromptPermissionLevel | null;
}): boolean {
  if (isOwner || visibility === "public") return true;
  if (visibility === "team" && isTeamMember) return true;
  return permission === "view" || permission === "edit" || permission === "admin";
}

/** Edit rights do not imply authority to grant or revoke access. */
export function hasPromptManageAccess({
  isOwner,
  isTeamManager = false,
  permission,
}: {
  isOwner: boolean;
  isTeamManager?: boolean;
  permission?: PromptPermissionLevel | null;
}): boolean {
  return isOwner || isTeamManager || permission === "admin";
}
