-- Prompt event keys historically used the user's API token as their namespace.
-- Replace that credential with the stable user id while preserving the suffix,
-- so retries remain idempotent and token rotation does not create duplicates.
WITH normalized AS (
  SELECT
    p.id,
    p.event_key,
    u.id::text || substring(p.event_key FROM 37) AS normalized_key
  FROM prompts AS p
  JOIN users AS u ON p.user_id = u.id
  -- Cover tokens that were rotated after older prompts were captured. Uploaded
  -- keys always used a UUID namespace followed by a UTC date path.
  WHERE p.event_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}/[0-9]{2}/[0-9]{2}/'
), ranked AS (
  SELECT
    id,
    event_key,
    normalized_key,
    row_number() OVER (
      PARTITION BY normalized_key
      -- Keep an already-normalized row canonical; otherwise choose one stable
      -- winner and give every duplicate a non-secret, unique migration suffix.
      ORDER BY (event_key = normalized_key) DESC, id
    ) AS duplicate_rank
  FROM normalized
)
UPDATE prompts AS p
SET event_key = CASE
  WHEN ranked.duplicate_rank = 1 THEN ranked.normalized_key
  ELSE left(ranked.normalized_key, 208) || '-migrated-' || ranked.id::text
END
FROM ranked
WHERE p.id = ranked.id
  AND p.event_key <> CASE
    WHEN ranked.duplicate_rank = 1 THEN ranked.normalized_key
    ELSE left(ranked.normalized_key, 208) || '-migrated-' || ranked.id::text
  END;
