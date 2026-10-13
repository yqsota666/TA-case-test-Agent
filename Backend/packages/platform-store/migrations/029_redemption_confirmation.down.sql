-- Only use after reverting redemption writes. Preserve confirmed redemption history.
-- Rollback refuses if any 024 transaction remains; do not delete financial history.
ALTER TABLE sales_confirmed_transactions DROP CHECK ck_sales_transaction_business, ADD CONSTRAINT ck_sales_transaction_business CHECK (business_code='022');
