# Task: Data Model & Database Design Perspective

## Context
Read: .context/impl/20260202_174951_prompt-analytics-dashboard/tasks/00-project-brief.md

## Your Role
You are a database architect and data engineer. Design the data model and storage strategy.

## Deliverables

### 1. Data Model Design
- Entity-Relationship diagram (describe in text/mermaid)
- Core entities: Prompt, Conversation, Session, User, Analytics
- Relationships and cardinality

### 2. Schema Design
- SQL schema for relational data
- Document schema for semi-structured data
- Indexing strategy for search performance

### 3. Analytics Data Structures
- Aggregation tables for dashboards
- Time-series storage for usage trends
- Vector embeddings for semantic search (optional)

### 4. MinIO Integration
- Object storage structure
- Metadata extraction strategy
- Sync mechanism design

### 5. Migration Strategy
- Initial data import approach
- Incremental sync design
- Data validation checks

## Output
Save your analysis to:
`.context/impl/20260202_174951_prompt-analytics-dashboard/perspectives/codex-datamodel.md`
