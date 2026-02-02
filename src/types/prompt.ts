export interface Prompt {
  id: string;
  sessionId?: string;
  timestamp: Date;
  projectName?: string;
  messages: Message[];
  inputTokens: number;
  outputTokens: number;
  tags?: string[];
  model?: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  tokens?: number;
}

export interface PromptListItem {
  id: string;
  timestamp: Date;
  projectName?: string;
  preview: string;
  promptType: "user" | "system" | "assistant";
  tokenCount: number;
  tags?: string[];
}

export interface PromptFilters {
  search?: string;
  dateRange?: {
    from: Date;
    to: Date;
  };
  models?: string[];
  tags?: string[];
  minTokens?: number;
  maxTokens?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type SortField = "timestamp" | "tokenCount";
export type SortDirection = "asc" | "desc";

export interface PromptQueryParams {
  page?: number;
  pageSize?: number;
  sortBy?: SortField;
  sortDirection?: SortDirection;
  filters?: PromptFilters;
}
