-- Additive runtime storage. Existing business/protocol tables remain the source of truth.
CREATE TABLE IF NOT EXISTS agent_runs (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'IDLE',
  memory_json JSON NOT NULL, wait_json JSON NULL,
  verdict VARCHAR(16) NOT NULL DEFAULT 'UNDETERMINED',
  lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,run_id),
  KEY ix_agent_lease (lease_until,status),
  CONSTRAINT fk_agent_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES test_runs(workspace_id,chat_id,id),
  CONSTRAINT ck_agent_status CHECK (status IN ('IDLE','RUNNING','WAITING','REVIEW','ERROR','ARCHIVED')),
  CONSTRAINT ck_agent_verdict CHECK (verdict IN ('UNDETERMINED','PASS','FAIL'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_plans (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL, plan_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,run_id,version),
  CONSTRAINT fk_agent_plan_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES agent_runs(workspace_id,chat_id,run_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source VARCHAR(16) NOT NULL, payload_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING', attempts INT UNSIGNED NOT NULL DEFAULT 0,
  metrics_json JSON NULL,
  error_code VARCHAR(80) NULL, error_message VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_agent_event_public (public_id),
  UNIQUE KEY uq_agent_event_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_agent_event_key (workspace_id,chat_id,run_id,event_key),
  KEY ix_agent_event_work (status,id),
  KEY ix_agent_event_recent (workspace_id,chat_id,run_id,created_at),
  KEY ix_agent_event_actor (workspace_id,actor_user_id),
  CONSTRAINT fk_agent_event_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES agent_runs(workspace_id,chat_id,run_id),
  CONSTRAINT fk_agent_event_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_agent_event_source CHECK (source IN ('USER','RETURN','DELIVERY','RESUME')),
  CONSTRAINT ck_agent_event_status CHECK (status IN ('PENDING','PROCESSING','DONE','ERROR'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  event_id BIGINT UNSIGNED NOT NULL, message_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_agent_message_scope (workspace_id,chat_id,run_id,event_id,id),
  CONSTRAINT fk_agent_message_event FOREIGN KEY (workspace_id,chat_id,run_id,event_id)
    REFERENCES agent_events(workspace_id,chat_id,run_id,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  action_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  step_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
  tool_name VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  input_json JSON NOT NULL, result_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_agent_action (workspace_id,chat_id,run_id,action_key),
  KEY ix_agent_action_step (workspace_id,chat_id,run_id,step_key,id),
  CONSTRAINT fk_agent_action_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES agent_runs(workspace_id,chat_id,run_id),
  CONSTRAINT ck_agent_action_status CHECK (status IN ('DONE','REJECTED'))
) ENGINE=InnoDB;
