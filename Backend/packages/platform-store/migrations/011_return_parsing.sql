CREATE TABLE case_return_parses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  expected_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parsed_json JSON NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_parse_scope (workspace_id,chat_id,case_id,id),
  UNIQUE KEY uq_parse_replay (workspace_id,chat_id,case_id,batch_id,expected_type,content_sha256),
  CONSTRAINT fk_parse_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_parse_batch FOREIGN KEY (workspace_id,chat_id,batch_id) REFERENCES exchange_batches(workspace_id,chat_id,id),
  CONSTRAINT fk_parse_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_parse_type CHECK (expected_type IN ('02','04'))
) ENGINE=InnoDB;

CREATE TABLE case_return_parse_files (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  parse_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_bytes LONGBLOB NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,parse_id,file_name),
  CONSTRAINT fk_parse_file FOREIGN KEY (workspace_id,chat_id,case_id,parse_id)
    REFERENCES case_return_parses(workspace_id,chat_id,case_id,id)
) ENGINE=InnoDB;
