-- The ledger is an implementation detail. A user-facing Chat is one Case;
-- all Cases on a channel reference the same sales-side accounts and TA state.
CREATE TABLE global_case_ledgers (
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,channel_id),
  UNIQUE KEY uq_global_ledger_run (workspace_id,chat_id,run_id),
  CONSTRAINT fk_global_ledger_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT fk_global_ledger_run FOREIGN KEY (workspace_id,chat_id,run_id,channel_id)
    REFERENCES test_runs(workspace_id,chat_id,id,channel_id)
) ENGINE=InnoDB;

CREATE TABLE global_cases (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,run_id),
  KEY ix_global_case_channel (workspace_id,channel_id,chat_id),
  CONSTRAINT fk_global_case_run FOREIGN KEY (workspace_id,chat_id,run_id,channel_id)
    REFERENCES test_runs(workspace_id,chat_id,id,channel_id)
) ENGINE=InnoDB;

-- Each approved version is immutable. The highest version is the active SOP.
CREATE TABLE case_sop_versions (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PROPOSED',
  sop_json JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  approved_at DATETIME(3) NULL,
  PRIMARY KEY (workspace_id,chat_id,run_id,version),
  KEY ix_sop_status (workspace_id,status,chat_id,run_id),
  CONSTRAINT fk_sop_case_run FOREIGN KEY (workspace_id,chat_id,run_id)
    REFERENCES global_cases(workspace_id,chat_id,run_id),
  CONSTRAINT fk_sop_creator FOREIGN KEY (created_by) REFERENCES platform_users(id),
  CONSTRAINT fk_sop_approver FOREIGN KEY (approved_by) REFERENCES platform_users(id),
  CONSTRAINT ck_sop_status CHECK (status IN ('PROPOSED','APPROVED','SUPERSEDED'))
) ENGINE=InnoDB;

CREATE TABLE global_case_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  ledger_chat_id BIGINT UNSIGNED NOT NULL,
  ledger_run_id BIGINT UNSIGNED NOT NULL,
  iteration INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PREPARING',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_global_batch_public (public_id),
  UNIQUE KEY uq_global_batch_iteration (workspace_id,channel_id,iteration),
  KEY ix_global_batch_ledger (workspace_id,ledger_chat_id,ledger_run_id),
  CONSTRAINT fk_global_batch_ledger FOREIGN KEY (workspace_id,ledger_chat_id,ledger_run_id)
    REFERENCES global_case_ledgers(workspace_id,chat_id,run_id),
  CONSTRAINT fk_global_batch_creator FOREIGN KEY (created_by) REFERENCES platform_users(id),
  CONSTRAINT ck_global_batch_status CHECK (status IN ('PREPARING','GENERATED'))
) ENGINE=InnoDB;

CREATE TABLE global_batch_packages (
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  package_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,channel_id,batch_id,package_id),
  UNIQUE KEY uq_global_batch_package (workspace_id,channel_id,package_id),
  CONSTRAINT fk_global_batch_package_batch FOREIGN KEY (batch_id)
    REFERENCES global_case_batches(id),
  CONSTRAINT fk_global_batch_package_file FOREIGN KEY (workspace_id,channel_id,package_id)
    REFERENCES exchange_packages(workspace_id,channel_id,id)
) ENGINE=InnoDB;

-- One SOP action yields at most one application. The application is owned by
-- the shared ledger, while the action and final verdict belong to the Case.
CREATE TABLE case_action_applications (
  workspace_id BIGINT UNSIGNED NOT NULL,
  case_chat_id BIGINT UNSIGNED NOT NULL,
  case_run_id BIGINT UNSIGNED NOT NULL,
  sop_version INT UNSIGNED NOT NULL,
  action_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ledger_chat_id BIGINT UNSIGNED NOT NULL,
  ledger_run_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,case_chat_id,case_run_id,sop_version,action_key),
  UNIQUE KEY uq_case_action_application (workspace_id,ledger_chat_id,ledger_run_id,application_id),
  KEY ix_case_action_batch (batch_id),
  CONSTRAINT fk_case_action_sop FOREIGN KEY (workspace_id,case_chat_id,case_run_id,sop_version)
    REFERENCES case_sop_versions(workspace_id,chat_id,run_id,version),
  CONSTRAINT fk_case_action_application FOREIGN KEY (workspace_id,ledger_chat_id,ledger_run_id,application_id)
    REFERENCES applications(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_case_action_batch FOREIGN KEY (batch_id) REFERENCES global_case_batches(id)
) ENGINE=InnoDB;
