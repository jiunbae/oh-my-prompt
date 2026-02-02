/**
 * TypeScript interfaces for MinIO prompt data
 */

/**
 * Raw prompt data structure as stored in MinIO
 */
export interface MinioPrompt {
  timestamp: string; // ISO 8601 format: "2026-02-02T05:19:51Z"
  working_directory: string; // e.g., "/Users/username/project/path"
  prompt_length: number; // Character count
  prompt: string; // Actual prompt text
}

/**
 * Prompt type classification
 */
export type PromptType = "task_notification" | "system" | "user_input";

/**
 * Extracted metadata from a prompt
 */
export interface PromptMetadata {
  projectName: string | null;
  promptType: PromptType;
  tokenEstimate: number;
  wordCount: number;
}

/**
 * Processed prompt ready for database insertion
 */
export interface ProcessedPrompt {
  minioKey: string;
  timestamp: Date;
  workingDirectory: string;
  promptLength: number;
  promptText: string;
  projectName: string | null;
  promptType: PromptType;
  tokenEstimate: number;
  wordCount: number;
}

/**
 * Sync operation result
 */
export interface SyncResult {
  success: boolean;
  filesProcessed: number;
  filesAdded: number;
  filesSkipped: number;
  errors: string[];
  duration: number; // milliseconds
}

/**
 * MinIO object info
 */
export interface MinioObjectInfo {
  name: string;
  lastModified: Date;
  etag: string;
  size: number;
}

/**
 * Sync status response
 */
export interface SyncStatus {
  lastSync: {
    id: string;
    startedAt: Date;
    completedAt: Date | null;
    status: "running" | "completed" | "failed";
    filesProcessed: number;
    filesAdded: number;
    filesSkipped: number;
    errorMessage: string | null;
  } | null;
  isRunning: boolean;
}
