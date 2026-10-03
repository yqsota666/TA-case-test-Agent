-- Outbound batches belong to a parent Chat, not to one Case. A physical inbound
-- file stays at Workspace/channel scope because one TA file may cover many Chats.
-- Individual applications and matched return rows retain Case provenance.

CREATE TABLE exchange_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_name VARCHAR(120) NOT NULL,
  ta_environment VARCHAR(80) NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  protocol_version CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_channel_scope (workspace_id,id),
  UNIQUE KEY uq_channel_remote (workspace_id,ta_environment,ta_code,distributor_code),
  CONSTRAINT fk_channel_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT ck_channel_version CHECK (protocol_version IN ('21','22'))
) ENGINE=InnoDB;

CREATE TABLE applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  sop_version_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_no VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_json JSON NOT NULL,
  snapshot_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'READY',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_application_public (public_id),
  UNIQUE KEY uq_application_case (workspace_id,chat_id,case_id,id),
  UNIQUE KEY uq_application_chat (workspace_id,chat_id,id),
  UNIQUE KEY uq_application_channel (workspace_id,chat_id,channel_id,id,file_type),
  UNIQUE KEY uq_application_number (workspace_id,channel_id,app_no),
  KEY ix_application_sop (workspace_id,chat_id,case_id,sop_version_id),
  KEY ix_application_list (workspace_id,chat_id,status,id),
  CONSTRAINT fk_application_case FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_application_sop FOREIGN KEY (workspace_id,chat_id,case_id,sop_version_id)
    REFERENCES case_sop_versions(workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_application_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT ck_application_type CHECK (file_type IN ('01','03')),
  CONSTRAINT ck_application_business CHECK (business_code REGEXP '^[0-9]{3}$'),
  CONSTRAINT ck_application_number CHECK (app_no REGEXP '^[0-9A-Za-z]{1,24}$'),
  CONSTRAINT ck_application_status CHECK (status IN
    ('READY','BATCHED','GENERATED','DELIVERED','WAITING_RETURN','CONFIRMED','FAILED','CANCELED'))
) ENGINE=InnoDB;

CREATE TABLE exchange_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  business_date DATE NOT NULL,
  batch_number INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_batch_public (public_id),
  UNIQUE KEY uq_batch_scope (workspace_id,chat_id,id),
  UNIQUE KEY uq_batch_channel (workspace_id,chat_id,channel_id,id),
  UNIQUE KEY uq_batch_number (workspace_id,chat_id,channel_id,business_date,batch_number),
  CONSTRAINT fk_batch_chat FOREIGN KEY (workspace_id,chat_id)
    REFERENCES case_chats(workspace_id,id),
  CONSTRAINT fk_batch_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT ck_batch_status CHECK (status IN ('DRAFT','GENERATED','DELIVERED','RECEIVED')),
  CONSTRAINT ck_batch_delivery CHECK ((status IN ('DRAFT','GENERATED') AND delivered_at IS NULL)
    OR (status IN ('DELIVERED','RECEIVED') AND delivered_at IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE batch_applications (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,batch_id,application_id),
  UNIQUE KEY uq_application_batch (workspace_id,chat_id,application_id),
  KEY ix_batch_application_channel (workspace_id,chat_id,channel_id,application_id,file_type),
  CONSTRAINT fk_batch_application_batch FOREIGN KEY (workspace_id,chat_id,channel_id,batch_id)
    REFERENCES exchange_batches(workspace_id,chat_id,channel_id,id),
  CONSTRAINT fk_batch_application_source FOREIGN KEY (workspace_id,chat_id,channel_id,application_id,file_type)
    REFERENCES applications(workspace_id,chat_id,channel_id,id,file_type)
) ENGINE=InnoDB;

CREATE TABLE exchange_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NULL,
  batch_id BIGINT UNSIGNED NULL,
  direction VARCHAR(8) NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_name VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_bytes LONGBLOB NOT NULL,
  record_count INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_file_scope (workspace_id,id),
  UNIQUE KEY uq_file_type (workspace_id,channel_id,id,file_type),
  UNIQUE KEY uq_file_name (workspace_id,channel_id,file_name),
  UNIQUE KEY uq_file_digest (workspace_id,channel_id,direction,content_sha256),
  KEY ix_file_batch (workspace_id,chat_id,channel_id,batch_id),
  CONSTRAINT fk_file_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT fk_file_batch FOREIGN KEY (workspace_id,chat_id,channel_id,batch_id)
    REFERENCES exchange_batches(workspace_id,chat_id,channel_id,id),
  CONSTRAINT ck_file_direction CHECK (direction IN ('OUTBOUND','INBOUND')),
  CONSTRAINT ck_file_type CHECK (file_type IN ('01','02','03','04','05')),
  CONSTRAINT ck_file_direction_type CHECK ((direction='OUTBOUND' AND file_type IN ('01','03'))
    OR (direction='INBOUND' AND file_type IN ('02','04','05'))),
  CONSTRAINT ck_file_batch_scope CHECK ((direction='OUTBOUND' AND chat_id IS NOT NULL AND batch_id IS NOT NULL)
    OR (direction='INBOUND' AND chat_id IS NULL AND batch_id IS NULL)),
  CONSTRAINT ck_file_name CHECK (file_name REGEXP '^[A-Za-z0-9_.-]{1,120}$')
) ENGINE=InnoDB;

CREATE TABLE return_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_index INT UNSIGNED NOT NULL,
  record_json JSON NOT NULL,
  chat_id BIGINT UNSIGNED NULL,
  application_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NULL,
  match_status VARCHAR(16) NOT NULL DEFAULT 'UNMATCHED',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_return_position (workspace_id,file_id,record_index),
  UNIQUE KEY uq_return_channel (workspace_id,channel_id,id,file_type),
  KEY ix_return_case (workspace_id,chat_id,case_id,id),
  KEY ix_return_application (workspace_id,chat_id,case_id,application_id),
  CONSTRAINT fk_return_file FOREIGN KEY (workspace_id,channel_id,file_id,file_type)
    REFERENCES exchange_files(workspace_id,channel_id,id,file_type),
  CONSTRAINT fk_return_application FOREIGN KEY (workspace_id,chat_id,case_id,application_id)
    REFERENCES applications(workspace_id,chat_id,case_id,id),
  CONSTRAINT ck_return_type CHECK (file_type IN ('02','04','05')),
  CONSTRAINT ck_return_match CHECK (
    (match_status='MATCHED' AND chat_id IS NOT NULL AND application_id IS NOT NULL AND case_id IS NOT NULL) OR
    (match_status IN ('UNMATCHED','CONFLICT') AND chat_id IS NULL AND application_id IS NULL AND case_id IS NULL))
) ENGINE=InnoDB;

-- A TA account becomes usable only from a matched, successful 02 confirmation.
-- The binding is reusable by later Chats in the same Workspace and channel.
CREATE TABLE ta_account_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  transaction_account_id VARCHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ta_account_id VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_return_record_id BIGINT UNSIGNED NOT NULL,
  source_file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '02',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ta_binding_transaction (workspace_id,channel_id,transaction_account_id),
  UNIQUE KEY uq_ta_binding_source (workspace_id,channel_id,source_return_record_id),
  CONSTRAINT fk_ta_binding_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT fk_ta_binding_source FOREIGN KEY (workspace_id,channel_id,source_return_record_id,source_file_type)
    REFERENCES return_records(workspace_id,channel_id,id,file_type),
  CONSTRAINT ck_ta_binding_source_type CHECK (source_file_type='02'),
  CONSTRAINT ck_ta_binding_values CHECK (CHAR_LENGTH(transaction_account_id)>0 AND CHAR_LENGTH(ta_account_id)>0)
) ENGINE=InnoDB;
