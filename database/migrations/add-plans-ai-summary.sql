-- ============================================================================
-- Plans AI Summary columns
-- Store AI-generated quick insight and full insights in DB; web app reads from here.
-- ============================================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS ai_quick_insight TEXT,
  ADD COLUMN IF NOT EXISTS ai_insights JSONB;

COMMENT ON COLUMN plans.ai_quick_insight IS 'One-line AI summary for list view';
COMMENT ON COLUMN plans.ai_insights IS 'Full AI insights JSON: summary, risks, recommendations, predictions, quick_insight';
