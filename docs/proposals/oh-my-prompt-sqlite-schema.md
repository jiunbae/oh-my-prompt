# Oh My Prompt - SQLite Schema Spec (v1)

## 목표
- 로컬에서 빠른 쓰기/읽기
- 프롬프트/응답/메타데이터 저장
- 검색(FTS5)과 인사이트 계산에 필요한 최소 구조 제공

## 기본 설정
- `PRAGMA journal_mode = WAL;`
- `PRAGMA synchronous = NORMAL;`
- `PRAGMA foreign_keys = ON;`

## 테이블 정의 (DDL)

### 1) prompts
프롬프트 단위 레코드(응답은 옵션).

```sql
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  source TEXT NOT NULL,                 -- claude-code, codex, gemini, opencode
  session_id TEXT,

  role TEXT NOT NULL,                   -- user | assistant | system | tool
  prompt_text TEXT NOT NULL,
  response_text TEXT,

  prompt_length INTEGER NOT NULL,
  response_length INTEGER,

  project TEXT,
  cwd TEXT,

  model TEXT,
  cli_name TEXT NOT NULL,
  cli_version TEXT,
  hook_version TEXT,

  token_estimate INTEGER,
  token_estimate_response INTEGER,
  word_count INTEGER,
  word_count_response INTEGER,

  capture_response INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  event_id TEXT,

  extra_json TEXT                       -- JSON string
);

CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at);
CREATE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source);
CREATE INDEX IF NOT EXISTS idx_prompts_session_id ON prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_event_id ON prompts(event_id);
```

### 2) tags
```sql
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);
```

### 3) prompt_tags
```sql
CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (prompt_id, tag_id),
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

### 4) prompt_reviews
```sql
CREATE TABLE IF NOT EXISTS prompt_reviews (
  prompt_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  signals_json TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);
```

### 5) sync_log (옵션)
```sql
CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  files_uploaded INTEGER DEFAULT 0,
  records_uploaded INTEGER DEFAULT 0,
  error_message TEXT,
  device_id TEXT,
  user_token TEXT,
  storage_type TEXT,
  checkpoint TEXT
);
```

### 6) sync_state
디바이스별 체크포인트 저장.

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  device_id TEXT PRIMARY KEY,
  last_synced_at TEXT,
  last_synced_id TEXT,
  updated_at TEXT
);
```

## 전문 검색 (FTS5)
빠른 검색을 위해 FTS 테이블을 유지.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
  prompt_text,
  response_text,
  project,
  content='prompts',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, prompt_text, response_text, project)
  VALUES (new.rowid, new.prompt_text, new.response_text, new.project);
END;

CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, prompt_text, response_text, project)
  VALUES('delete', old.rowid, old.prompt_text, old.response_text, old.project);
END;

CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, prompt_text, response_text, project)
  VALUES('delete', old.rowid, old.prompt_text, old.response_text, old.project);
  INSERT INTO prompts_fts(rowid, prompt_text, response_text, project)
  VALUES (new.rowid, new.prompt_text, new.response_text, new.project);
END;
```

## 데이터 유지/정리
- 오래된 로컬 큐 파일 정리
- 1년 이상 된 기록 아카이브 옵션

## 마이그레이션 전략
- `omp db migrate` 명령으로 버전 관리
- 스키마 버전 테이블 사용 (ex: `schema_version`)

## 참고
- `response_text`는 옵션이며, `capture_response`가 false인 경우 null 가능
- `extra_json`은 CLI별 메타 확장 필드를 저장하는 안전한 공간
