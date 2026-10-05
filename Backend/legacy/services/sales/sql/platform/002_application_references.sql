-- Typed protocol references prevent indirect links across chat/run boundaries.
CREATE TABLE IF NOT EXISTS application_references (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, chat_id BIGINT UNSIGNED NOT NULL, run_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  reference_type VARCHAR(24) NOT NULL,
  referenced_application_id BIGINT UNSIGNED NULL,
  referenced_trading_account_id BIGINT UNSIGNED NULL,
  referenced_confirmation_id BIGINT UNSIGNED NULL,
  referenced_ta_account_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_reference_source (workspace_id,chat_id,run_id,application_id,reference_type),
  KEY ix_reference_application (workspace_id,chat_id,run_id,referenced_application_id),
  KEY ix_reference_trading (workspace_id,chat_id,run_id,referenced_trading_account_id),
  KEY ix_reference_confirmation (workspace_id,chat_id,run_id,referenced_confirmation_id),
  KEY ix_reference_ta (workspace_id,chat_id,run_id,referenced_ta_account_id),
  CONSTRAINT fk_reference_source FOREIGN KEY (workspace_id,chat_id,run_id,application_id)
    REFERENCES applications(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_reference_application FOREIGN KEY (workspace_id,chat_id,run_id,referenced_application_id)
    REFERENCES applications(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_reference_trading FOREIGN KEY (workspace_id,chat_id,run_id,referenced_trading_account_id)
    REFERENCES trading_accounts(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_reference_confirmation FOREIGN KEY (workspace_id,chat_id,run_id,referenced_confirmation_id)
    REFERENCES confirmations(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_reference_ta FOREIGN KEY (workspace_id,chat_id,run_id,referenced_ta_account_id)
    REFERENCES ta_accounts(workspace_id,chat_id,run_id,id),
  CONSTRAINT ck_reference_target CHECK (
    (reference_type='ORIGINAL_APPLICATION' AND referenced_application_id IS NOT NULL
      AND referenced_trading_account_id IS NULL AND referenced_confirmation_id IS NULL AND referenced_ta_account_id IS NULL)
    OR (reference_type='TARGET_TRADING' AND referenced_trading_account_id IS NOT NULL
      AND referenced_application_id IS NULL AND referenced_confirmation_id IS NULL AND referenced_ta_account_id IS NULL)
    OR (reference_type='ORIGINAL_CONFIRMATION' AND referenced_confirmation_id IS NOT NULL
      AND referenced_application_id IS NULL AND referenced_trading_account_id IS NULL AND referenced_ta_account_id IS NULL)
    OR (reference_type='TARGET_TA_ACCOUNT' AND referenced_ta_account_id IS NOT NULL
      AND referenced_application_id IS NULL AND referenced_trading_account_id IS NULL AND referenced_confirmation_id IS NULL)
  )
) ENGINE=InnoDB;
