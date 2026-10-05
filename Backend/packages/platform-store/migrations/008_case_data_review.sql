CREATE TABLE case_data_confirmations (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id),
  CONSTRAINT fk_data_confirmation_execution FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_executions(workspace_id,chat_id,case_id),
  CONSTRAINT fk_data_confirmation_actor FOREIGN KEY (workspace_id,actor_user_id)
    REFERENCES workspaces(id,owner_user_id)
) ENGINE=InnoDB;

CREATE TABLE case_data_review_turns (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  turn_number INT UNSIGNED NOT NULL,
  before_revision INT UNSIGNED NOT NULL,
  after_revision INT UNSIGNED NOT NULL,
  user_text VARCHAR(4000) NOT NULL,
  assistant_text VARCHAR(4000) NOT NULL,
  changes_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id,turn_number),
  CONSTRAINT fk_data_review_execution FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_executions(workspace_id,chat_id,case_id)
) ENGINE=InnoDB;
