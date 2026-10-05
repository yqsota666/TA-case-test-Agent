-- Closing a Chat is an explicit human decision. Existing Chats stay open so
-- migrated workspaces can finish them in creation order.
ALTER TABLE global_case_ledgers
  ADD COLUMN ended_at DATETIME(3) NULL,
  ADD COLUMN ended_by BIGINT UNSIGNED NULL,
  ADD COLUMN end_conclusion VARCHAR(20) NULL,
  ADD COLUMN end_reason TEXT NULL,
  ADD KEY ix_global_ledger_open (workspace_id,ended_at,chat_id),
  ADD CONSTRAINT fk_global_ledger_ended_by FOREIGN KEY (ended_by) REFERENCES platform_users(id),
  ADD CONSTRAINT ck_global_ledger_end CHECK (
    (ended_at IS NULL AND ended_by IS NULL AND end_conclusion IS NULL AND end_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND end_conclusion IN ('ALL_PASS','ACCEPT_FAILURE')
      AND end_reason IS NOT NULL)
  );
