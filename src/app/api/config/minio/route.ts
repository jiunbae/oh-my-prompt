import { NextResponse } from "next/server";

/**
 * GET /api/config/minio
 * Returns the MinIO configuration for display in settings
 */
export async function GET() {
  const endpoint = process.env.MINIO_ENDPOINT || "";
  const bucket = process.env.MINIO_BUCKET || "claude-prompts";

  return NextResponse.json({
    endpoint,
    bucket,
  });
}
