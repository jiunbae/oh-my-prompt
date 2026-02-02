import { Client } from "minio";

/**
 * MinIO client configuration
 *
 * Environment variables required:
 * - MINIO_ENDPOINT: MinIO server endpoint (e.g., "minio.example.com") - without protocol
 * - MINIO_ACCESS_KEY: Access key for authentication
 * - MINIO_SECRET_KEY: Secret key for authentication
 */

/**
 * Default bucket name for prompts
 */
export const PROMPTS_BUCKET = process.env.MINIO_BUCKET || "claude-prompts";

/**
 * Lazy-loaded MinIO client to avoid build-time instantiation
 */
let _minioClient: Client | null = null;

function getEndpoint(): string {
  const endpoint = process.env.MINIO_ENDPOINT || "minio.example.com";
  // Strip protocol if accidentally included
  return endpoint.replace(/^https?:\/\//, "");
}

export function getMinioClient(): Client {
  if (!_minioClient) {
    _minioClient = new Client({
      endPoint: getEndpoint(),
      port: 443,
      useSSL: true,
      accessKey: process.env.MINIO_ACCESS_KEY || "",
      secretKey: process.env.MINIO_SECRET_KEY || "",
    });
  }
  return _minioClient;
}

/**
 * Check if MinIO client is properly configured
 */
export function isMinioConfigured(): boolean {
  return !!(
    process.env.MINIO_ENDPOINT &&
    process.env.MINIO_ACCESS_KEY &&
    process.env.MINIO_SECRET_KEY
  );
}

/**
 * Test MinIO connection
 */
export async function testMinioConnection(): Promise<boolean> {
  try {
    const client = getMinioClient();
    const exists = await client.bucketExists(PROMPTS_BUCKET);
    return exists;
  } catch (error) {
    console.error("MinIO connection test failed:", error);
    return false;
  }
}
