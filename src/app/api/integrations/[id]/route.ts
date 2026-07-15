import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/services/webhook";
import { VALID_INTEGRATION_EVENTS } from "../shared";
import { canManageOutgoingIntegration } from "@/lib/team-access";

export const dynamic = "force-dynamic";

const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  webhookUrl: z.string().url().max(4096).optional(),
  secret: z.string().max(1024).optional(),
  clearSecret: z.boolean().optional(),
  events: z
    .array(z.enum(VALID_INTEGRATION_EVENTS))
    .min(1, "At least one event is required")
    .optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /api/integrations/[id] - Update integration
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    if (!(await canManageOutgoingIntegration(session.userId, id))) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = updateIntegrationSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const updates = parseResult.data;

    // Validate webhook URL if being updated
    if (updates.webhookUrl !== undefined) {
      const urlCheck = await validateWebhookUrl(updates.webhookUrl);
      if (!urlCheck.valid) {
        return NextResponse.json(
          { error: `Invalid webhook URL: ${urlCheck.error}` },
          { status: 400 }
        );
      }
      if (!updates.webhookUrl.startsWith("https://")) {
        return NextResponse.json(
          { error: "Webhook URL must use HTTPS" },
          { status: 400 }
        );
      }
    }

    // Build the set object with only provided fields
    const setValues: Record<string, unknown> = {};
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.webhookUrl !== undefined) setValues.webhookUrl = updates.webhookUrl;
    if (updates.events !== undefined) setValues.events = updates.events;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;

    // Secret handling
    if (updates.clearSecret === true) {
      setValues.secret = null;
    } else if (updates.secret !== undefined && updates.secret !== "") {
      setValues.secret = updates.secret;
    }

    if (Object.keys(setValues).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const [integration] = await db
      .update(schema.outgoingIntegrations)
      .set(setValues)
      .where(
        eq(schema.outgoingIntegrations.id, id)
      )
      .returning({
        id: schema.outgoingIntegrations.id,
        userId: schema.outgoingIntegrations.userId,
        teamId: schema.outgoingIntegrations.teamId,
        name: schema.outgoingIntegrations.name,
        provider: schema.outgoingIntegrations.provider,
        webhookUrl: schema.outgoingIntegrations.webhookUrl,
        events: schema.outgoingIntegrations.events,
        isActive: schema.outgoingIntegrations.isActive,
        lastTriggeredAt: schema.outgoingIntegrations.lastTriggeredAt,
        createdAt: schema.outgoingIntegrations.createdAt,
      });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ integration });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integration update error");
    return NextResponse.json(
      { error: "Failed to update integration" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/[id] - Delete integration
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    if (!(await canManageOutgoingIntegration(session.userId, id))) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const [deleted] = await db
      .delete(schema.outgoingIntegrations)
      .where(eq(schema.outgoingIntegrations.id, id))
      .returning({ id: schema.outgoingIntegrations.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integration delete error");
    return NextResponse.json(
      { error: "Failed to delete integration" },
      { status: 500 }
    );
  }
}
