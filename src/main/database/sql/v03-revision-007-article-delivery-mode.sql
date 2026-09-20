ALTER TABLE article_delivery_jobs ADD COLUMN delivery_mode TEXT
  CHECK (delivery_mode IS NULL OR delivery_mode IN ('PUBLISH', 'DRAFT'));
