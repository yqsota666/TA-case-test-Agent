-- MySQL 8.4 / InnoDB. Applied only to sales_platform_v2, never to sales.
-- Protocol identifiers are strings; every business relationship carries its scope.

CREATE TABLE IF NOT EXISTS platform_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  legacy_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  display_name VARCHAR(80) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_public (public_id),
  UNIQUE KEY uq_user_legacy (legacy_user_id),
  UNIQUE KEY uq_user_email (email),
  CONSTRAINT ck_user_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS platform_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_session_user (user_id), KEY ix_session_expiry (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workspaces (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_workspace_public (public_id),
  UNIQUE KEY uq_workspace_owner (owner_user_id),
  UNIQUE KEY uq_workspace_actor (id,owner_user_id),
  CONSTRAINT fk_workspace_owner FOREIGN KEY (owner_user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ta_environments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment_name VARCHAR(80) NOT NULL,
  environment_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_environment_public (public_id),
  UNIQUE KEY uq_environment_key (environment_key),
  CONSTRAINT ck_environment_status CHECK (status IN ('ACTIVE','DISABLED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exchange_channels (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  protocol_version CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '22',
  protocol_profile VARCHAR(40) NOT NULL DEFAULT 'FUND_22',
  transport_mode VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  daily_batch_policy VARCHAR(16) NOT NULL DEFAULT 'UNVERIFIED',
  UNIQUE KEY uq_channel_scope (workspace_id,id),
  UNIQUE KEY uq_channel_binding (workspace_id,id,ta_environment_id,ta_code,distributor_code),
  UNIQUE KEY uq_channel_org (workspace_id,ta_environment_id,ta_code,distributor_code),
  KEY ix_channel_environment (ta_environment_id),
  CONSTRAINT fk_channel_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT fk_channel_environment FOREIGN KEY (ta_environment_id) REFERENCES ta_environments(id),
  CONSTRAINT ck_channel_version CHECK (protocol_version='22'),
  CONSTRAINT ck_channel_transport CHECK (transport_mode='MANUAL'),
  CONSTRAINT ck_channel_batch CHECK (daily_batch_policy IN ('UNVERIFIED','SINGLE','MULTIPLE'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_chats (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_chat_public (public_id), UNIQUE KEY uq_chat_scope (workspace_id,id),
  KEY ix_chat_list (workspace_id,status,id),
  CONSTRAINT fk_chat_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT ck_chat_status CHECK (status IN ('ACTIVE','ARCHIVED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL,
  author_role VARCHAR(16) NOT NULL, content MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_message_list (workspace_id,chat_id,id),
  CONSTRAINT fk_message_chat FOREIGN KEY (workspace_id,chat_id) REFERENCES test_chats(workspace_id,id),
  CONSTRAINT ck_message_role CHECK (author_role IN ('USER','ASSISTANT','SYSTEM'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL, ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_number INT UNSIGNED NOT NULL, business_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_run_public (public_id),
  UNIQUE KEY uq_run_scope (workspace_id,chat_id,id),
  UNIQUE KEY uq_run_channel (workspace_id,chat_id,id,channel_id),
  UNIQUE KEY uq_run_remote (workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  UNIQUE KEY uq_run_number (workspace_id,chat_id,run_number),
  KEY ix_run_channel (workspace_id,channel_id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT fk_run_chat FOREIGN KEY (workspace_id,chat_id) REFERENCES test_chats(workspace_id,id),
  CONSTRAINT fk_run_channel FOREIGN KEY (workspace_id,channel_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES exchange_channels(workspace_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT ck_run_status CHECK (status IN ('DRAFT','ACTIVE','WAITING_RETURN','COMPLETED','FAILED','ARCHIVED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workflow_steps (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  step_number INT UNSIGNED NOT NULL, step_type VARCHAR(16) NOT NULL,
  title VARCHAR(160) NOT NULL, business_date DATE NOT NULL,
  expected_result JSON NULL, status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_step_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_step_number (workspace_id,chat_id,run_id,step_number),
  CONSTRAINT fk_step_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES test_runs(workspace_id,chat_id,id),
  CONSTRAINT ck_step_type CHECK (step_type IN ('DATA','01','03','RETURN','CHECK')),
  CONSTRAINT ck_step_status CHECK (status IN ('PENDING','READY','GENERATED','WAITING_RETURN','PASSED','FAILED','BLOCKED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS workflow_dependencies (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  step_id BIGINT UNSIGNED NOT NULL, depends_on_step_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,run_id,step_id,depends_on_step_id),
  KEY ix_dependency_parent (workspace_id,chat_id,run_id,depends_on_step_id),
  CONSTRAINT fk_dependency_step FOREIGN KEY (workspace_id,chat_id,run_id,step_id)
    REFERENCES workflow_steps(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_dependency_parent FOREIGN KEY (workspace_id,chat_id,run_id,depends_on_step_id)
    REFERENCES workflow_steps(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_dependency_self CHECK (step_id<>depends_on_step_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_identifiers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  namespace VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_value VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_identifier_remote (ta_environment_id,ta_code,identifier_kind,namespace,identifier_value),
  UNIQUE KEY uq_identifier_scope (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,namespace,identifier_value),
  KEY ix_identifier_run (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT fk_identifier_run FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES test_runs(workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT ck_identifier_kind CHECK (identifier_kind IN ('CERTIFICATE','TRANSACTION','APPLICATION')),
  CONSTRAINT ck_identifier_normalized CHECK (identifier_value=UPPER(identifier_value) AND CHAR_LENGTH(identifier_value)>0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS test_customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  investor_name VARCHAR(200) NOT NULL,
  investor_type CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_type VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CERTIFICATE',
  mobile VARCHAR(40) NULL, email VARCHAR(190) NULL, address VARCHAR(300) NULL,
  simulated_balance DECIMAL(16,2) NOT NULL DEFAULT 0,
  profile_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_customer_public (public_id), UNIQUE KEY uq_customer_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_customer_identity (ta_environment_id,ta_code,certificate_type,certificate_no),
  KEY ix_customer_remote_run (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code),
  KEY ix_customer_reservation (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,certificate_type,certificate_no),
  CONSTRAINT fk_customer_reservation FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,certificate_type,certificate_no)
    REFERENCES test_identifiers(workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,namespace,identifier_value),
  CONSTRAINT fk_customer_run FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES test_runs(workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT ck_customer_type CHECK (investor_type IN ('0','1')),
  CONSTRAINT ck_customer_balance CHECK (simulated_balance>=0),
  CONSTRAINT ck_customer_reservation CHECK (identifier_kind='CERTIFICATE' AND certificate_no=UPPER(certificate_no)),
  CONSTRAINT ck_customer_identity CHECK (CHAR_LENGTH(certificate_no)>0 AND CHAR_LENGTH(certificate_type)>0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trading_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transaction_account_no VARCHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'TRANSACTION',
  branch_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  UNIQUE KEY uq_trading_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_trading_customer (workspace_id,chat_id,run_id,customer_id,id),
  UNIQUE KEY uq_trading_remote (ta_environment_id,ta_code,distributor_code,transaction_account_no),
  KEY ix_trading_remote_run (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code),
  KEY ix_trading_reservation (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,distributor_code,transaction_account_no),
  CONSTRAINT fk_trading_reservation FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,distributor_code,transaction_account_no)
    REFERENCES test_identifiers(workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,namespace,identifier_value),
  CONSTRAINT fk_trading_customer FOREIGN KEY (workspace_id,chat_id,run_id,customer_id)
    REFERENCES test_customers(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_trading_run FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES test_runs(workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT ck_trading_status CHECK (status IN ('PENDING','ACTIVE','FROZEN','LOST','REVOKED')),
  CONSTRAINT ck_trading_reservation CHECK (identifier_kind='TRANSACTION'),
  CONSTRAINT ck_trading_number CHECK (transaction_account_no REGEXP '^[0-9]{1,17}$')
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS target_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, trading_account_id BIGINT UNSIGNED NOT NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_volume DECIMAL(16,2) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
  UNIQUE KEY uq_target_scope (workspace_id,chat_id,run_id,id),
  KEY ix_target_trading (workspace_id,chat_id,run_id,customer_id,trading_account_id),
  CONSTRAINT fk_target_trading FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,customer_id,id),
  CONSTRAINT ck_target_volume CHECK (target_volume>=0),
  CONSTRAINT ck_target_status CHECK (status IN ('PLANNED','ESTABLISHING','CONFIRMED','NEGATIVE_TEST'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS run_funds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fund_name VARCHAR(200) NOT NULL, share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nav DECIMAL(16,8) NULL, parameters_json JSON NOT NULL,
  UNIQUE KEY uq_run_fund (workspace_id,chat_id,run_id,fund_code,share_class),
  CONSTRAINT fk_fund_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES test_runs(workspace_id,chat_id,id),
  CONSTRAINT ck_fund_nav CHECK (nav IS NULL OR nav>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS applications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, trading_account_id BIGINT UNSIGNED NOT NULL, step_id BIGINT UNSIGNED NULL,
  ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_no VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  identifier_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'APPLICATION',
  ta_account_no VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  application_amount DECIMAL(16,2) NULL, application_volume DECIMAL(16,2) NULL,
  business_date DATE NOT NULL, transaction_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', test_mode VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
  record_json JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_application_public (public_id), UNIQUE KEY uq_application_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_application_type (workspace_id,chat_id,run_id,id,file_type),
  UNIQUE KEY uq_application_remote (ta_environment_id,ta_code,distributor_code,app_no),
  KEY ix_application_list (workspace_id,chat_id,run_id,status,id),
  KEY ix_application_trading (workspace_id,chat_id,run_id,customer_id,trading_account_id),
  KEY ix_application_step (workspace_id,chat_id,run_id,step_id),
  KEY ix_application_remote_run (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code),
  KEY ix_application_reservation (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,distributor_code,app_no),
  CONSTRAINT fk_application_reservation FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,distributor_code,app_no)
    REFERENCES test_identifiers(workspace_id,chat_id,run_id,ta_environment_id,ta_code,identifier_kind,namespace,identifier_value),
  CONSTRAINT fk_application_trading FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,customer_id,id),
  CONSTRAINT fk_application_step FOREIGN KEY (workspace_id,chat_id,run_id,step_id)
    REFERENCES workflow_steps(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_application_run FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES test_runs(workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT ck_application_type CHECK (file_type IN ('01','03')),
  CONSTRAINT ck_application_code CHECK (business_code REGEXP '^[0-9]{3}$'),
  CONSTRAINT ck_application_reservation CHECK (identifier_kind='APPLICATION'),
  CONSTRAINT ck_application_number CHECK (app_no REGEXP '^[0-9A-Za-z]{1,24}$'),
  CONSTRAINT ck_application_status CHECK (status IN ('DRAFT','READY','GENERATED','DELIVERED','WAITING_RETURN','PARTIAL','CONFIRMED','FAILED','CANCELED')),
  CONSTRAINT ck_application_mode CHECK (test_mode IN ('NORMAL','NEGATIVE'))
) ENGINE=InnoDB;

-- Exchange packages may contain records from several chats, but never several workspaces/channels.
CREATE TABLE IF NOT EXISTS exchange_packages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL, channel_id BIGINT UNSIGNED NOT NULL,
  direction VARCHAR(16) NOT NULL, business_date DATE NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  archive_key VARCHAR(400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transport_mode VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'GENERATED',
  parse_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_package_public (public_id), UNIQUE KEY uq_package_scope (workspace_id,id),
  UNIQUE KEY uq_package_channel (workspace_id,channel_id,id),
  UNIQUE KEY uq_package_hash (workspace_id,channel_id,direction,content_hash),
  UNIQUE KEY uq_package_archive (archive_key),
  CONSTRAINT fk_package_channel FOREIGN KEY (workspace_id,channel_id) REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT ck_package_direction CHECK (direction IN ('OUTBOUND','INBOUND')),
  CONSTRAINT ck_package_transport CHECK (transport_mode='MANUAL'),
  CONSTRAINT ck_package_delivery CHECK (delivery_status IN ('GENERATED','DOWNLOADED','DELIVERED','WAITING_RETURN','RETURN_RECEIVED')),
  CONSTRAINT ck_package_parse CHECK (parse_status IN ('PENDING','VALIDATED','FILE_ERROR','PROCESSED','QUARANTINED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS package_runs (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL, package_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,run_id,package_id),
  KEY ix_package_run_channel (workspace_id,chat_id,run_id,channel_id),
  KEY ix_package_run_package (workspace_id,channel_id,package_id),
  CONSTRAINT fk_package_run FOREIGN KEY (workspace_id,chat_id,run_id,channel_id)
    REFERENCES test_runs(workspace_id,chat_id,id,channel_id),
  CONSTRAINT fk_package_run_package FOREIGN KEY (workspace_id,channel_id,package_id)
    REFERENCES exchange_packages(workspace_id,channel_id,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exchange_files (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, channel_id BIGINT UNSIGNED NOT NULL, package_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_type VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_kind VARCHAR(16) NOT NULL, protocol_version CHAR(2) NOT NULL DEFAULT '22',
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  byte_length BIGINT UNSIGNED NOT NULL, record_count INT UNSIGNED NOT NULL,
  index_origin VARCHAR(16) NULL, parse_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  error_detail VARCHAR(1000) NULL,
  UNIQUE KEY uq_file_scope (workspace_id,id),
  UNIQUE KEY uq_file_package (workspace_id,channel_id,package_id,id),
  UNIQUE KEY uq_file_name (workspace_id,package_id,file_name),
  CONSTRAINT fk_file_package FOREIGN KEY (workspace_id,channel_id,package_id) REFERENCES exchange_packages(workspace_id,channel_id,id),
  CONSTRAINT ck_file_kind CHECK (file_kind IN ('DATA','INDEX')),
  CONSTRAINT ck_file_version CHECK (protocol_version='22'),
  CONSTRAINT ck_file_index_origin CHECK (
    (file_kind='DATA' AND index_origin IS NULL) OR
    (file_kind='INDEX' AND index_origin IS NOT NULL AND index_origin IN ('ORIGINAL','INTERNAL'))),
  CONSTRAINT ck_file_parse CHECK (parse_status IN ('PENDING','VALIDATED','FILE_ERROR','PROCESSED','QUARANTINED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, channel_id BIGINT UNSIGNED NOT NULL, package_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL, record_index INT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NULL, run_id BIGINT UNSIGNED NULL, application_id BIGINT UNSIGNED NULL,
  record_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_json JSON NOT NULL, match_status VARCHAR(16) NOT NULL DEFAULT 'UNMATCHED',
  match_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_record_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_record_line (workspace_id,file_id,record_index),
  KEY ix_record_run (workspace_id,chat_id,run_id,match_status,id),
  KEY ix_record_application (workspace_id,chat_id,run_id,application_id),
  KEY ix_record_file (workspace_id,channel_id,package_id,file_id),
  KEY ix_record_package_run (workspace_id,chat_id,run_id,package_id),
  CONSTRAINT fk_record_file FOREIGN KEY (workspace_id,channel_id,package_id,file_id)
    REFERENCES exchange_files(workspace_id,channel_id,package_id,id),
  CONSTRAINT fk_record_package_run FOREIGN KEY (workspace_id,chat_id,run_id,package_id)
    REFERENCES package_runs(workspace_id,chat_id,run_id,package_id),
  CONSTRAINT fk_record_run FOREIGN KEY (workspace_id,chat_id,run_id) REFERENCES test_runs(workspace_id,chat_id,id),
  CONSTRAINT fk_record_application FOREIGN KEY (workspace_id,chat_id,run_id,application_id)
    REFERENCES applications(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_record_scope CHECK ((chat_id IS NULL AND run_id IS NULL AND application_id IS NULL)
    OR (chat_id IS NOT NULL AND run_id IS NOT NULL)),
  CONSTRAINT ck_record_matched CHECK (match_status<>'MATCHED' OR (chat_id IS NOT NULL AND run_id IS NOT NULL)),
  CONSTRAINT ck_record_match CHECK (match_status IN ('UNMATCHED','MATCHED','CONFLICT','UNSUPPORTED')),
  CONSTRAINT ck_record_index CHECK (record_index>0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS confirmations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL, application_file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_record_id BIGINT UNSIGNED NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  confirmation_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_code CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error_detail VARCHAR(1000) NULL, dictionary_reason VARCHAR(300) NULL,
  ta_serial_no VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  confirmation_date DATE NOT NULL, application_date DATE NOT NULL,
  confirmed_amount DECIMAL(16,2) NULL, confirmed_volume DECIMAL(16,2) NULL,
  nav DECIMAL(16,8) NULL, charge DECIMAL(16,2) NULL, fee_rate DECIMAL(16,8) NULL,
  business_finish_flag CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  outcome VARCHAR(16) NOT NULL, record_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_confirmation_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_confirmation_effect (workspace_id,chat_id,run_id,application_id,confirmation_key),
  UNIQUE KEY uq_confirmation_source (workspace_id,chat_id,run_id,file_record_id),
  KEY ix_confirmation_application (workspace_id,chat_id,run_id,application_id,application_file_type),
  CONSTRAINT fk_confirmation_application FOREIGN KEY (workspace_id,chat_id,run_id,application_id,application_file_type)
    REFERENCES applications(workspace_id,chat_id,run_id,id,file_type),
  CONSTRAINT fk_confirmation_record FOREIGN KEY (workspace_id,chat_id,run_id,file_record_id)
    REFERENCES file_records(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_confirmation_type CHECK ((file_type='02' AND application_file_type='01')
    OR (file_type='04' AND application_file_type='03')),
  CONSTRAINT ck_confirmation_outcome CHECK (outcome IN ('SUCCESS','FAILURE','PARTIAL','REVIEW'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ta_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ta_account_no VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'OPENED',
  source_confirmation_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_ta_account_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_ta_account_customer (workspace_id,chat_id,run_id,customer_id,id),
  UNIQUE KEY uq_ta_account_remote (ta_environment_id,ta_code,ta_account_no),
  KEY ix_ta_account_remote_run (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code),
  KEY ix_ta_account_confirmation (workspace_id,chat_id,run_id,source_confirmation_id),
  CONSTRAINT fk_ta_account_customer FOREIGN KEY (workspace_id,chat_id,run_id,customer_id)
    REFERENCES test_customers(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_ta_account_run FOREIGN KEY (workspace_id,chat_id,run_id,ta_environment_id,ta_code,distributor_code)
    REFERENCES test_runs(workspace_id,chat_id,id,ta_environment_id,ta_code,distributor_code),
  CONSTRAINT fk_ta_account_confirmation FOREIGN KEY (workspace_id,chat_id,run_id,source_confirmation_id)
    REFERENCES confirmations(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_ta_account_status CHECK (status IN ('OPENED','FROZEN','CLOSED'))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trading_account_links (
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, trading_account_id BIGINT UNSIGNED NOT NULL, ta_account_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,run_id,trading_account_id),
  KEY ix_link_trading (workspace_id,chat_id,run_id,customer_id,trading_account_id),
  KEY ix_link_ta (workspace_id,chat_id,run_id,customer_id,ta_account_id),
  CONSTRAINT fk_link_trading FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,customer_id,id),
  CONSTRAINT fk_link_ta FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,ta_account_id)
    REFERENCES ta_accounts(workspace_id,chat_id,run_id,customer_id,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL, trading_account_id BIGINT UNSIGNED NOT NULL, ta_account_id BIGINT UNSIGNED NOT NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  available_volume DECIMAL(16,2) NOT NULL DEFAULT 0, frozen_volume DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_volume DECIMAL(16,2) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_position_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_position_key (workspace_id,chat_id,run_id,trading_account_id,fund_code,share_class,branch_code),
  KEY ix_position_trading (workspace_id,chat_id,run_id,customer_id,trading_account_id),
  KEY ix_position_ta (workspace_id,chat_id,run_id,customer_id,ta_account_id),
  CONSTRAINT fk_position_trading FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,customer_id,id),
  CONSTRAINT fk_position_ta FOREIGN KEY (workspace_id,chat_id,run_id,customer_id,ta_account_id)
    REFERENCES ta_accounts(workspace_id,chat_id,run_id,customer_id,id),
  CONSTRAINT ck_position_volumes CHECK (available_volume>=0 AND frozen_volume>=0 AND total_volume>=0
    AND available_volume+frozen_volume<=total_volume)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS position_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL, confirmation_id BIGINT UNSIGNED NOT NULL,
  effect_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  volume_delta DECIMAL(16,2) NOT NULL, frozen_delta DECIMAL(16,2) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_movement_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_movement_effect (workspace_id,chat_id,run_id,effect_key),
  KEY ix_movement_position (workspace_id,chat_id,run_id,position_id),
  KEY ix_movement_confirmation (workspace_id,chat_id,run_id,confirmation_id),
  CONSTRAINT fk_movement_position FOREIGN KEY (workspace_id,chat_id,run_id,position_id)
    REFERENCES positions(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_movement_confirmation FOREIGN KEY (workspace_id,chat_id,run_id,confirmation_id)
    REFERENCES confirmations(workspace_id,chat_id,run_id,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS position_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  trading_account_id BIGINT UNSIGNED NOT NULL, file_record_id BIGINT UNSIGNED NOT NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  branch_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NULL,
  snapshot_date DATE NOT NULL, available_volume DECIMAL(16,2) NOT NULL,
  frozen_volume DECIMAL(16,2) NOT NULL, total_volume DECIMAL(16,2) NOT NULL,
  whole_flag CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  detail_flag CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  share_register_date DATE NULL, source_type CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ta_serial_no VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL, record_json JSON NOT NULL,
  UNIQUE KEY uq_snapshot_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_snapshot_source (workspace_id,chat_id,run_id,file_record_id),
  KEY ix_snapshot_trading (workspace_id,chat_id,run_id,trading_account_id,snapshot_date),
  CONSTRAINT fk_snapshot_trading FOREIGN KEY (workspace_id,chat_id,run_id,trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_snapshot_record FOREIGN KEY (workspace_id,chat_id,run_id,file_record_id)
    REFERENCES file_records(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_snapshot_whole CHECK (whole_flag IS NULL OR whole_flag IN ('0','1')),
  CONSTRAINT ck_snapshot_volume CHECK (available_volume>=0 AND frozen_volume>=0 AND total_volume>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reconciliations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  position_id BIGINT UNSIGNED NOT NULL, snapshot_id BIGINT UNSIGNED NOT NULL,
  sales_volume DECIMAL(16,2) NOT NULL, ta_volume DECIMAL(16,2) NOT NULL,
  difference DECIMAL(16,2) NOT NULL, status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reconciliation_scope (workspace_id,chat_id,run_id,id),
  UNIQUE KEY uq_reconciliation_pair (workspace_id,chat_id,run_id,position_id,snapshot_id),
  KEY ix_reconciliation_snapshot (workspace_id,chat_id,run_id,snapshot_id),
  CONSTRAINT fk_reconciliation_position FOREIGN KEY (workspace_id,chat_id,run_id,position_id)
    REFERENCES positions(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_reconciliation_snapshot FOREIGN KEY (workspace_id,chat_id,run_id,snapshot_id)
    REFERENCES position_snapshots(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_reconciliation_status CHECK (status IN ('MATCHED','DIFFERENT','REVIEW','SYNCED')),
  CONSTRAINT ck_reconciliation_difference CHECK (difference=ta_volume-sales_volume)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, package_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL, event_type VARCHAR(24) NOT NULL,
  evidence VARCHAR(500) NULL, occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_delivery_package (workspace_id,package_id,id), KEY ix_delivery_actor (actor_user_id),
  CONSTRAINT fk_delivery_package FOREIGN KEY (workspace_id,package_id) REFERENCES exchange_packages(workspace_id,id),
  CONSTRAINT fk_delivery_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_delivery_type CHECK (event_type IN ('DOWNLOADED','DELIVERY_CONFIRMED','RETURN_UPLOADED'))
) ENGINE=InnoDB;
