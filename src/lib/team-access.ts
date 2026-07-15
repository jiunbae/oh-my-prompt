import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import {
  hasPromptViewAccess,
  hasPromptManageAccess,
  type PromptPermissionLevel,
  type PromptVisibility,
} from "@/lib/prompt-access-policy";
import { canTeamRoleManage, isOwnerRole } from "@/lib/team-role-policy";

/** Shared SQL equivalent of canViewPrompt for prompt list/aggregate queries. */
export function promptViewCondition(userId: string) {
  return sql<boolean>`(
    ${schema.prompts.userId} = ${userId}
    OR ${schema.prompts.visibility} = 'public'
    OR (
      ${schema.prompts.teamId} IS NOT NULL
      AND (${schema.prompts.visibility} = 'team' OR ${schema.prompts.visibility} IS NULL)
      AND EXISTS (
        SELECT 1
        FROM ${schema.teamMembers}
        WHERE ${schema.teamMembers.teamId} = ${schema.prompts.teamId}
          AND ${schema.teamMembers.userId} = ${userId}
      )
    )
    OR EXISTS (
      SELECT 1
      FROM ${schema.promptPermissions}
      WHERE ${schema.promptPermissions.promptId} = ${schema.prompts.id}
        AND ${schema.promptPermissions.userId} = ${userId}
        AND ${schema.promptPermissions.permission} IN ('view', 'edit', 'admin')
    )
  )`;
}

/**
 * Kept as a descriptive alias for callers that already verify and scope a team.
 * The full membership predicate remains in place as defense in depth.
 */
export const teamPromptViewConditionForMember = promptViewCondition;

/**
 * Get the visibility of a prompt.
 * Falls back to team settings if the prompt is in a team, otherwise "private".
 */
export async function getPromptVisibility(
  promptId: string
): Promise<PromptVisibility> {
  const [prompt] = await db
    .select({
      userId: schema.prompts.userId,
      teamId: schema.prompts.teamId,
      visibility: schema.prompts.visibility,
    })
    .from(schema.prompts)
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
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
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
    .limit(1);

  if (!prompt) return false;

  const visibility: PromptVisibility =
    prompt.visibility === "team" || prompt.visibility === "public"
      ? prompt.visibility
      : prompt.visibility === "private"
        ? "private"
        : prompt.teamId
          ? "team"
          : "private";

  let isTeamMember = false;
  if (prompt.teamId && visibility === "team") {
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
    isTeamMember = !!membership;
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

  return hasPromptViewAccess({
    isOwner: prompt.userId === userId,
    visibility,
    isTeamMember,
    permission: permission?.permission as PromptPermissionLevel | undefined,
  });
}

/**
 * Check whether a user may manage a prompt's ACL.
 * Edit permission deliberately does not grant access-management rights.
 */
export async function canManagePromptAccess(
  userId: string,
  promptId: string
): Promise<boolean> {
  const [prompt] = await db
    .select({ userId: schema.prompts.userId, teamId: schema.prompts.teamId })
    .from(schema.prompts)
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
    .limit(1);

  if (!prompt) return false;
  if (prompt.userId === userId) {
    return hasPromptManageAccess({ isOwner: true });
  }

  let isTeamManager = false;
  if (prompt.teamId) {
    const [membership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, prompt.teamId),
          eq(schema.teamMembers.userId, userId),
        ),
      )
      .limit(1);
    isTeamManager = canTeamRoleManage(membership?.role);
  }

  const [permission] = await db
    .select({ permission: schema.promptPermissions.permission })
    .from(schema.promptPermissions)
    .where(
      and(
        eq(schema.promptPermissions.promptId, promptId),
        eq(schema.promptPermissions.userId, userId),
        eq(schema.promptPermissions.permission, "admin")
      )
    )
    .limit(1);

  return hasPromptManageAccess({
    isOwner: false,
    isTeamManager,
    permission: permission?.permission as PromptPermissionLevel | undefined,
  });
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
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
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
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
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

  return canTeamRoleManage(membership?.role);
}

/**
 * Personal integrations are managed by their creator. Team integrations are
 * managed by the team's current owner/admin, not by the original creator after
 * that user loses the management role.
 */
export async function canManageOutgoingIntegration(
  userId: string,
  integrationId: string
): Promise<boolean> {
  const [integration] = await db
    .select({
      userId: schema.outgoingIntegrations.userId,
      teamId: schema.outgoingIntegrations.teamId,
    })
    .from(schema.outgoingIntegrations)
    .where(eq(schema.outgoingIntegrations.id, integrationId))
    .limit(1);

  if (!integration) return false;
  if (integration.teamId) {
    return canManageTeam(userId, integration.teamId);
  }
  return integration.userId === userId;
}

/** Check whether a user is the team's owner (admins are intentionally excluded). */
export async function isTeamOwner(
  userId: string,
  teamId: string
): Promise<boolean> {
  const [membership] = await db
    .select({ role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId),
        eq(schema.teamMembers.role, "owner")
      )
    )
    .limit(1);

  return isOwnerRole(membership?.role);
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
