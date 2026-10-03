# ADR-008 No semantic search in V1 — Accepted
Decision: lexical search only (FTS5, ADR-002). No embeddings, models, vectors tables or `chunks` schema in V1.
Why: model weights of 30–120 MB, sustained CPU, delivery without a network request is unresolved, quality gain over BM25 for personal history is unproven (blueprint Research §5).
Revisit: only with a relevance eval set showing lexical gaps, after beta.
