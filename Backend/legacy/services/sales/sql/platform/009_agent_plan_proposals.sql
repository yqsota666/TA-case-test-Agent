CREATE TABLE agent_plan_proposals (
  proposal_sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  proposal_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  base_version INT UNSIGNED NOT NULL, plan_json JSON NOT NULL,
  plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED',
  confirmation_event_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(workspace_id,chat_id,run_id,proposal_id),
  UNIQUE KEY uq_agent_proposal_sequence(proposal_sequence),
  KEY ix_agent_proposal_latest(workspace_id,chat_id,run_id,proposal_sequence),
  CONSTRAINT fk_agent_proposal_run FOREIGN KEY(workspace_id,chat_id,run_id)
    REFERENCES agent_runs(workspace_id,chat_id,run_id),
  CONSTRAINT fk_agent_proposal_source FOREIGN KEY(workspace_id,chat_id,run_id,source_event_id)
    REFERENCES agent_events(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_agent_proposal_confirmation FOREIGN KEY(workspace_id,chat_id,run_id,confirmation_event_id)
    REFERENCES agent_events(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_agent_proposal_status CHECK(status IN ('PROPOSED','CONFIRMED','SUPERSEDED'))
) ENGINE=InnoDB;
