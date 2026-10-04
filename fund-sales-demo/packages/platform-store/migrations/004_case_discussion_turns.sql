-- Record the user's intent before model generation so a revision can preempt
-- confirmation. A pending response can be retried or explicitly abandoned.
CREATE TABLE case_discussion_turns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  turn_number INT UNSIGNED NOT NULL,
  user_text TEXT NOT NULL,
  assistant_text TEXT NULL,
  prompt_version VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  UNIQUE KEY uq_case_discussion_turn (workspace_id,chat_id,case_id,turn_number),
  KEY ix_case_discussion_order (workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_discussion_case FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_discussion_actor FOREIGN KEY (workspace_id,actor_user_id)
    REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_discussion_turn_number CHECK (turn_number > 0),
  CONSTRAINT ck_discussion_content CHECK (CHAR_LENGTH(TRIM(user_text)) > 0),
  CONSTRAINT ck_discussion_status CHECK (
    (status='PENDING' AND assistant_text IS NULL AND prompt_version IS NULL AND finished_at IS NULL) OR
    (status='COMPLETE' AND assistant_text IS NOT NULL AND CHAR_LENGTH(TRIM(assistant_text)) > 0
      AND prompt_version IS NOT NULL AND finished_at IS NOT NULL) OR
    (status='ABANDONED' AND assistant_text IS NULL AND prompt_version IS NULL AND finished_at IS NOT NULL)
  )
) ENGINE=InnoDB;
