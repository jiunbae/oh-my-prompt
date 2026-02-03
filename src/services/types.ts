/**
 * TypeScript interfaces for MinIO prompt data
 */

/**
 * Raw prompt data structure as stored in MinIO
 */
export interface MinioPrompt {
  timestamp: string; // ISO 8601 format: "2026-02-02T05:19:51Z"
  working_directory: string; // e.g., "/Users/username/project/path"
  prompt_length?: number; // Character count (optional for output)
  prompt?: string; // Actual prompt text (optional for output)
  type?: "input" | "output";
  response?: string; // Assistant response text (for type: "output")
  response_length?: number; // (for type: "output")
  input_hash?: string; // (for type: "output")
  input_timestamp?: string; // (for type: "output")
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
  promptLength?: number;
  promptText?: string;
  responseText?: string;
  responseLength?: number;
  projectName: string | null;
  promptType: PromptType;
  tokenEstimate?: number;
  wordCount?: number;
  tokenEstimateResponse?: number;
  wordCountResponse?: number;
  isOutput?: boolean;
  inputHash?: string;
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
