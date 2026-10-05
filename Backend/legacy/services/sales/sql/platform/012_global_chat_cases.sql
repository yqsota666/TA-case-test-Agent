-- The former channel ledger becomes the parent Chat. Existing Cases on the
-- same channel retain their shared data and batches under that Chat.
ALTER TABLE global_case_ledgers
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (workspace_id,chat_id),
  ADD KEY ix_global_ledger_channel (workspace_id,channel_id);

ALTER TABLE global_cases
  ADD COLUMN parent_chat_id BIGINT UNSIGNED NULL AFTER workspace_id;
UPDATE global_cases g JOIN global_case_ledgers l
  ON l.workspace_id=g.workspace_id AND l.channel_id=g.channel_id
  SET g.parent_chat_id=l.chat_id;
UPDATE test_chats c JOIN global_case_ledgers l
  ON l.workspace_id=c.workspace_id AND l.chat_id=c.id
  SET c.title=CONCAT('迁移的对话 · 通道 ',l.channel_id)
  WHERE c.title LIKE '系统共享账本 · %';
ALTER TABLE global_cases
  MODIFY parent_chat_id BIGINT UNSIGNED NOT NULL,
  ADD KEY ix_global_case_parent (workspace_id,parent_chat_id,chat_id),
  ADD CONSTRAINT fk_global_case_parent FOREIGN KEY (workspace_id,parent_chat_id)
    REFERENCES global_case_ledgers(workspace_id,chat_id);

-- A channel may now contain several independent parent Chats. Each Chat has
-- its own run-backed data platform and sequence of generated file batches.
ALTER TABLE global_case_batches
  DROP INDEX uq_global_batch_iteration,
  ADD UNIQUE KEY uq_global_batch_parent_iteration (workspace_id,ledger_chat_id,iteration);
