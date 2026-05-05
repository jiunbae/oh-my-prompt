import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ProcessorInput, InsightResult } from "../types";
import { sendUserDigest } from "@/lib/digest";
import { logger } from "@/lib/logger";

export async function handler(_input: ProcessorInput): Promise<InsightResult> {
  // Fetch all users with email digests enabled
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.emailDigestEnabled, true));

  let sentCount = 0;
  let failCount = 0;

  // Process sequentially to avoid overwhelming the email provider
  for (const user of users) {
    try {
      const result = await sendUserDigest(user.id);
      if (result.sent) {
        sentCount++;
      } else {
        failCount++;
        logger.warn({ userId: user.id, error: result.error }, "Digest not sent for user");
      }
    } catch (error) {
      failCount++;
      logger.error({ err: error, userId: user.id }, "Failed to send digest to user");
    }
  }

  const summary = `Weekly email digests sent to ${sentCount} of ${users.length} users. ${failCount} failures.`;

  return {
    title: "Weekly Email Digest",
    summary,
    highlights: [
      { label: "Total Users", value: users.length },
      { label: "Sent", value: sentCount },
      { label: "Failed", value: failCount },
    ],
    confidence: 1,
    generatedAt: new Date().toISOString(),
  };
}
