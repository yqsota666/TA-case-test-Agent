-- Human decisions are append-only. A new evidence basis requires a new decision.
CREATE TABLE case_human_verdicts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  sop_version INT UNSIGNED NOT NULL,
  basis_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  suggested_verdict VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  suggested_json JSON NOT NULL,
  final_verdict VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  decided_by BIGINT UNSIGNED NOT NULL,
  decided_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_case_human_verdict_revision (workspace_id,chat_id,run_id,revision),
  CONSTRAINT fk_case_human_verdict_case FOREIGN KEY (workspace_id,chat_id,run_id)
    REFERENCES global_cases(workspace_id,chat_id,run_id),
  CONSTRAINT fk_case_human_verdict_sop FOREIGN KEY (workspace_id,chat_id,run_id,sop_version)
    REFERENCES case_sop_versions(workspace_id,chat_id,run_id,version),
  CONSTRAINT fk_case_human_verdict_user FOREIGN KEY (decided_by) REFERENCES platform_users(id),
  CONSTRAINT ck_case_human_suggested CHECK (suggested_verdict IN ('PASS','FAIL')),
  CONSTRAINT ck_case_human_final CHECK (final_verdict IN ('PASS','FAIL'))
) ENGINE=InnoDB;
