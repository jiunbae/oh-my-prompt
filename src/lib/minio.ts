import { Client } from "minio";
import { env } from "@/env";
import { logger } from "./logger";

export const PROMPTS_BUCKET = env.MINIO_BUCKET ?? "oh-my-prompt";

let _minioClient: Client | null = null;

function getEndpoint(): string {
  return (env.MINIO_ENDPOINT ?? "").replace(/^https?:\/\//, "");
}

export function getMinioClient(): Client {
  if (!isMinioConfigured()) {
    throw new Error("MinIO is not configured");
  }
  if (!_minioClient) {
    _minioClient = new Client({
      endPoint: getEndpoint(),
      port: 443,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY!,
      secretKey: env.MINIO_SECRET_KEY!,
    });
  }
  return _minioClient;
}

export function isMinioConfigured(): boolean {
  return !!(
    env.MINIO_ENDPOINT &&
    env.MINIO_ACCESS_KEY &&
    env.MINIO_SECRET_KEY
  );
}

export async function testMinioConnection(): Promise<boolean> {
  try {
    const client = getMinioClient();
    return await client.bucketExists(PROMPTS_BUCKET);
  } catch (error) {
    logger.error({ error }, "MinIO connection test failed");
    return false;
  }
}
