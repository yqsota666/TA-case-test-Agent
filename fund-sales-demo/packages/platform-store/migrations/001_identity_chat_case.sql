-- MySQL 8.4 / InnoDB. New platform schema; no legacy Run table.
-- Every child key repeats its workspace and Chat scope so a foreign key cannot
-- silently attach a Case or event to another owner's data.

CREATE TABLE platform_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_public (public_id),
  UNIQUE KEY uq_user_email (email),
  CONSTRAINT ck_user_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB;

CREATE TABLE workspaces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_workspace_public (public_id),
  UNIQUE KEY uq_workspace_owner (owner_user_id),
  CONSTRAINT fk_workspace_owner FOREIGN KEY (owner_user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB;

CREATE TABLE platform_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_session_user (user_id),
  KEY ix_session_expiry (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB;

CREATE TABLE case_chats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  close_reason VARCHAR(2000) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_chat_public (public_id),
  UNIQUE KEY uq_chat_scope (workspace_id,id),
  KEY ix_chat_list (workspace_id,status,id),
  CONSTRAINT fk_chat_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT ck_chat_status CHECK (status IN ('ACTIVE','CLOSED','FORCE_CLOSED')),
  CONSTRAINT ck_chat_closure CHECK (
    (status='ACTIVE' AND closed_at IS NULL AND close_reason IS NULL) OR
    (status='CLOSED' AND closed_at IS NOT NULL AND close_reason IS NULL) OR
    (status='FORCE_CLOSED' AND closed_at IS NOT NULL AND close_reason IS NOT NULL
      AND CHAR_LENGTH(TRIM(close_reason))>0)
  )
) ENGINE=InnoDB;

CREATE TABLE cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  predecessor_case_id BIGINT UNSIGNED NULL,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DISCUSSING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_case_public (public_id),
  UNIQUE KEY uq_case_scope (workspace_id,chat_id,id),
  UNIQUE KEY uq_case_successor (predecessor_case_id),
  KEY ix_case_list (workspace_id,chat_id,id),
  KEY ix_case_predecessor (workspace_id,chat_id,predecessor_case_id),
  CONSTRAINT fk_case_chat FOREIGN KEY (workspace_id,chat_id)
    REFERENCES case_chats(workspace_id,id),
  CONSTRAINT fk_case_predecessor FOREIGN KEY (workspace_id,chat_id,predecessor_case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT ck_case_status CHECK (status IN
    ('DISCUSSING','SOP_PENDING','SOP_LOCKED','EXECUTING','WAITING_EVIDENCE','REVIEW','PASS','FAIL'))
) ENGINE=InnoDB;

CREATE TABLE case_sop_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  plan_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  locked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sop_version (workspace_id,chat_id,case_id,version_number),
  UNIQUE KEY uq_sop_scope (workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_sop_case FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT ck_sop_status CHECK (status IN ('DRAFT','PENDING_CONFIRMATION','LOCKED')),
  CONSTRAINT ck_sop_lock CHECK ((status='LOCKED')=(locked_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE chat_state_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  reason VARCHAR(2000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_chat_event_order (workspace_id,chat_id,id),
  CONSTRAINT fk_chat_event_chat FOREIGN KEY (workspace_id,chat_id)
    REFERENCES case_chats(workspace_id,id),
  CONSTRAINT fk_chat_event_actor FOREIGN KEY (actor_user_id) REFERENCES platform_users(id),
  CONSTRAINT ck_chat_event_to CHECK (to_status IN ('ACTIVE','CLOSED','FORCE_CLOSED'))
) ENGINE=InnoDB;

CREATE TABLE case_state_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  reason VARCHAR(2000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_case_event_order (workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_case_event_case FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_case_event_actor FOREIGN KEY (actor_user_id) REFERENCES platform_users(id),
  CONSTRAINT ck_case_event_to CHECK (to_status IN
    ('DISCUSSING','SOP_PENDING','SOP_LOCKED','EXECUTING','WAITING_EVIDENCE','REVIEW','PASS','FAIL'))
) ENGINE=InnoDB;
