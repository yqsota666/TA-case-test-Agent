ALTER TABLE sales_confirmed_transactions DROP CHECK ck_sales_transaction_business, ADD CONSTRAINT ck_sales_transaction_business CHECK (business_code IN ('022','024'));
