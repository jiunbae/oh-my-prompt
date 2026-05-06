import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Get the visibility of a prompt.
 * Falls back to team settings if the prompt is in a team, otherwise "private".
 */
export async function getPromptVisibility(
  promptId: string
): Promise<"private" | "team" | "public"> {
  const [prompt] = await db
    .select({
      userId: schema.prompts.userId,
      teamId: schema.prompts.teamId,
      visibility: schema.prompts.visibility,
    })
    .from(schema.prompts)
    .where(eq(schema.prompts.id, promptId))
    .limit(1);

  if (!prompt) return "private";

  // If prompt has explicit visibility, use it
  if (prompt.visibility) {
    const v = prompt.visibility;
    if (v === "private" || v === "team" || v === "public") return v;
  }

  // If in a team, look up team settings
  if (prompt.teamId) {
    const [settings] = await db
      .select({ defaultPromptVisibility: schema.teamSettings.defaultPromptVisibility })
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, prompt.teamId))
      .limit(1);

    const teamVis = settings?.defaultPromptVisibility;
    if (teamVis === "private" || teamVis === "team" || teamVis === "public") {
      return teamVis;
    }
    return "team";
  }

  return "private";
}

/**
 * Check if a user can view a prompt.
 * Owner can always view. Team members can view team prompts.
 * Explicit prompt_permissions grantees can view.
 * Public prompts can be viewed by anyone.
 */
export async function canViewPrompt(
  userId: string,
  promptId: string
): Promise<boolean> {
  const [prompt] = await db
    .select({
      userId: schema.prompts.userId,
      teamId: schema.prompts.teamId,
      visibility: schema.prompts.visibility,
    })
    .from(schema.prompts)
    .where(eq(schema.prompts.id, promptId))
    .limit(1);

  if (!prompt) return false;

  // Owner can always view
  if (prompt.userId === userId) return true;

  // Public visibility
  const visibility = prompt.visibility ?? "private";
  if (visibility === "public") return true;

  // Team visibility: any team member can view
  if (prompt.teamId && (visibility === "team" || !prompt.visibility)) {
    const [membership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, prompt.teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .limit(1);
    if (membership) return true;
  }

  // Explicit permission grant
  const [permission] = await db
    .select({ permission: schema.promptPermissions.permission })
    .from(schema.promptPermissions)
    .where(
      and(
        eq(schema.promptPermissions.promptId, promptId),
        eq(schema.promptPermissions.userId, userId)
      )
    )
    .limit(1);

  if (permission) {
    return permission.permission === "view" || permission.permission === "edit" || permission.permission === "admin";
  }

  return false;
}

/**
 * Check if a user can edit a prompt.
 * Owner or explicit "edit"/"admin" permission.
 */
export async function canEditPrompt(
  userId: string,
  promptId: string
): Promise<boolean> {
  const [prompt] = await db
    .select({ userId: schema.prompts.userId, teamId: schema.prompts.teamId })
    .from(schema.prompts)
    .where(eq(schema.prompts.id, promptId))
    .limit(1);

  if (!prompt) return false;

  // Owner can edit
  if (prompt.userId === userId) return true;

  // Explicit edit/admin permission
  const [permission] = await db
    .select({ permission: schema.promptPermissions.permission })
    .from(schema.promptPermissions)
    .where(
      and(
        eq(schema.promptPermissions.promptId, promptId),
        eq(schema.promptPermissions.userId, userId)
      )
    )
    .limit(1);

  if (permission) {
    return permission.permission === "edit" || permission.permission === "admin";
  }

  return false;
}

/**
 * Check if a user can delete a prompt.
 * Owner or "admin" permission or team owner.
 */
export async function canDeletePrompt(
  userId: string,
  promptId: string
): Promise<boolean> {
  const [prompt] = await db
    .select({ userId: schema.prompts.userId, teamId: schema.prompts.teamId })
    .from(schema.prompts)
    .where(eq(schema.prompts.id, promptId))
    .limit(1);

  if (!prompt) return false;

  // Owner can delete
  if (prompt.userId === userId) return true;

  // Team owner can delete team prompts
  if (prompt.teamId) {
    const [membership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, prompt.teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .limit(1);
    if (membership?.role === "owner") return true;
  }

  // Explicit admin permission
  const [permission] = await db
    .select({ permission: schema.promptPermissions.permission })
    .from(schema.promptPermissions)
    .where(
      and(
        eq(schema.promptPermissions.promptId, promptId),
        eq(schema.promptPermissions.userId, userId)
      )
    )
    .limit(1);

  if (permission?.permission === "admin") return true;

  return false;
}

/**
 * Check if a user can manage a team (owner or admin role).
 */
export async function canManageTeam(
  userId: string,
  teamId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .limit(1);

  return membership?.role === "owner" || membership?.role === "admin";
}

/**
 * Check if a user can invite others to a team.
 * Team owner, admin, or member if allowMemberInvites is true.
 */
export async function canInviteToTeam(
  userId: string,
  teamId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .limit(1);

  if (!membership) return false;

  // Owner and admin can always invite
  if (membership.role === "owner" || membership.role === "admin") return true;

  // Members can invite if allowMemberInvites is enabled
  if (membership.role === "member") {
    const [settings] = await db
      .select({ allowMemberInvites: schema.teamSettings.allowMemberInvites })
      .from(schema.teamSettings)
      .where(eq(schema.teamSettings.teamId, teamId))
      .limit(1);
    return settings?.allowMemberInvites === true;
  }

  return false;
}
