ALTER TABLE agent_runs ADD COLUMN execution_version INT UNSIGNED NULL;

CREATE TABLE agent_components (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  step_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_version INT UNSIGNED NOT NULL, definition_json JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'BLOCKED', revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  attempts INT UNSIGNED NOT NULL DEFAULT 0, output_json JSON NULL, wait_json JSON NULL, error_json JSON NULL,
  PRIMARY KEY(workspace_id,chat_id,run_id,step_key),
  KEY ix_agent_component_ready(workspace_id,chat_id,run_id,status,step_key),
  CONSTRAINT fk_agent_component_run FOREIGN KEY(workspace_id,chat_id,run_id) REFERENCES agent_runs(workspace_id,chat_id,run_id),
  CONSTRAINT ck_agent_component_status CHECK(status IN ('BLOCKED','READY','RUNNING','WAITING_INPUT','SUCCEEDED','REVIEW','FAILED','SKIPPED','CANCELED'))
) ENGINE=InnoDB;

CREATE TABLE agent_component_transitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  step_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, revision BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NOT NULL, to_status VARCHAR(20) NOT NULL, detail_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_agent_transition(workspace_id,chat_id,run_id,step_key,revision),
  CONSTRAINT fk_agent_transition_component FOREIGN KEY(workspace_id,chat_id,run_id,step_key)
    REFERENCES agent_components(workspace_id,chat_id,run_id,step_key)
) ENGINE=InnoDB;
