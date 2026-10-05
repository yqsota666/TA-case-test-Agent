-- A retry is a new SOP attempt on the same Case. Keep the prior approved SOP,
-- generated applications, TA evidence and human rationale immutable.
CREATE TABLE case_sop_retries (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  source_sop_version INT UNSIGNED NOT NULL,
  target_sop_version INT UNSIGNED NULL,
  ai_assessment_json JSON NOT NULL,
  human_decision_json JSON NULL,
  human_reason VARCHAR(2000) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,run_id,source_sop_version),
  CONSTRAINT fk_case_retry_source FOREIGN KEY (workspace_id,chat_id,run_id,source_sop_version)
    REFERENCES case_sop_versions(workspace_id,chat_id,run_id,version),
  CONSTRAINT fk_case_retry_actor FOREIGN KEY (requested_by) REFERENCES platform_users(id),
  CONSTRAINT ck_case_retry_target CHECK (target_sop_version IS NULL OR target_sop_version>source_sop_version)
) ENGINE=InnoDB;
