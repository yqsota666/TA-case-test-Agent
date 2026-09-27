ALTER SESSION SET CONTAINER=FREEPDB1;
CREATE USER ta IDENTIFIED BY ta QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO ta;
ALTER SESSION SET CURRENT_SCHEMA=ta;

CREATE TABLE simulation_state (id NUMBER PRIMARY KEY, scenario_id VARCHAR2(32) NOT NULL, business_date CHAR(8) NOT NULL, previous_date CHAR(8));
CREATE TABLE funds (
  fund_code CHAR(6) PRIMARY KEY, fund_name VARCHAR2(200) NOT NULL, fund_status CHAR(1) DEFAULT '0', nav NUMBER(16,8), nav_date CHAR(8),
  accumulated_nav NUMBER(16,8), total_volume NUMBER(16,2), fund_size NUMBER(16,2), min_first NUMBER(16,2), min_additional NUMBER(16,2),
  max_purchase NUMBER(16,2), daily_max NUMBER(16,2), fee_rate NUMBER(9,8), fund_type CHAR(2), fund_type_name VARCHAR2(30), manager_name VARCHAR2(100)
);
CREATE TABLE accounts (
  ta_account_id CHAR(12) PRIMARY KEY, transaction_account_id CHAR(17) UNIQUE NOT NULL, distributor_code VARCHAR2(9), certificate_no VARCHAR2(40) UNIQUE,
  investor_name VARCHAR2(200), branch_code VARCHAR2(9), account_status CHAR(1) DEFAULT '0', created_date CHAR(8),
  address VARCHAR2(300), mobile VARCHAR2(40), email VARCHAR2(40), cert_valid_date CHAR(8),
  bank_name VARCHAR2(200), bank_no VARCHAR2(40), bank_code VARCHAR2(20), risk_level CHAR(1), region_code CHAR(4)
);
CREATE TABLE transaction_accounts (
  transaction_account_id CHAR(17) PRIMARY KEY, ta_account_id CHAR(12) NOT NULL,
  distributor_code VARCHAR2(9), status VARCHAR2(16) DEFAULT 'ACTIVE', card_status VARCHAR2(16) DEFAULT 'NORMAL',
  is_primary NUMBER(1) DEFAULT 0, created_date CHAR(8)
);
CREATE TABLE sales_distributors (
  distributor_code VARCHAR2(9) PRIMARY KEY, distributor_name VARCHAR2(100) NOT NULL,
  status VARCHAR2(16) DEFAULT 'ENABLED' NOT NULL, is_local NUMBER(1) DEFAULT 0 NOT NULL
);
CREATE TABLE custody_transfers (
  app_no VARCHAR2(24) PRIMARY KEY, ta_account_id CHAR(12) NOT NULL, fund_code CHAR(6) NOT NULL,
  volume NUMBER(16,2) NOT NULL, source_distributor_code VARCHAR2(9) NOT NULL,
  source_transaction_account_id CHAR(17) NOT NULL, target_distributor_code VARCHAR2(9) NOT NULL,
  target_transaction_account_id CHAR(17) NOT NULL, status VARCHAR2(24) NOT NULL,
  ta_serial_no VARCHAR2(20), confirmation_date CHAR(8), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE account_apps (
  app_no VARCHAR2(24) PRIMARY KEY, transaction_account_id CHAR(17), distributor_code VARCHAR2(9), certificate_type VARCHAR2(3), certificate_no VARCHAR2(40),
  investor_name VARCHAR2(200), branch_code VARCHAR2(9), transaction_date CHAR(8), transaction_time CHAR(6), region_code CHAR(4),
  status VARCHAR2(24), return_code CHAR(4), error_detail VARCHAR2(200), ta_account_id CHAR(12), ta_serial_no VARCHAR2(20), force_return_code CHAR(4), replied NUMBER(1) DEFAULT 0,
  business_code CHAR(3) DEFAULT '001', address VARCHAR2(300), mobile VARCHAR2(40), email VARCHAR2(40), cert_valid_date CHAR(8),
  bank_name VARCHAR2(200), bank_no VARCHAR2(40), bank_code VARCHAR2(20), risk_level CHAR(1)
);
CREATE TABLE orders (
  app_no VARCHAR2(24) PRIMARY KEY, fund_code CHAR(6), transaction_date CHAR(8), transaction_time CHAR(6), transaction_account_id CHAR(17),
  distributor_code VARCHAR2(9), amount NUMBER(16,2), ta_account_id CHAR(12), branch_code VARCHAR2(9), status VARCHAR2(24),
  return_code CHAR(4), error_detail VARCHAR2(200), confirmed_amount NUMBER(16,2), confirmed_volume NUMBER(16,2), fee NUMBER(16,2),
  nav NUMBER(16,8), ta_serial_no VARCHAR2(20), force_return_code CHAR(4), replied NUMBER(1) DEFAULT 0,
  business_code CHAR(3) DEFAULT '022', application_vol NUMBER(16,2), large_redemption_flag CHAR(1),
  original_app_no VARCHAR2(24), original_serial_no VARCHAR2(20), target_transaction_account_id CHAR(17),
  target_region_code CHAR(4), target_distributor_code VARCHAR2(9), target_branch_code VARCHAR2(9),
  target_fund_code CHAR(6), target_confirmed_volume NUMBER(16,2), target_nav NUMBER(16,8),
  dividend_method CHAR(1), frozen_cause CHAR(1)
);
CREATE TABLE holdings (
  ta_account_id CHAR(12), transaction_account_id CHAR(17), fund_code CHAR(6), volume NUMBER(16,2) DEFAULT 0,
  frozen_volume NUMBER(16,2) DEFAULT 0, dividend_method CHAR(1) DEFAULT '1', register_date CHAR(8), PRIMARY KEY(ta_account_id,fund_code)
);
CREATE TABLE batches (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scenario_id VARCHAR2(32), batch_id VARCHAR2(16), direction VARCHAR2(24), file_type CHAR(2),
  business_date CHAR(8), relative_path VARCHAR2(300), status VARCHAR2(24), record_count NUMBER, error_detail VARCHAR2(500), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_ta_batch UNIQUE(scenario_id,direction,relative_path,file_type)
);

CREATE SEQUENCE ta_serial_seq START WITH 1 INCREMENT BY 1 NOCACHE;

INSERT INTO simulation_state VALUES (1,'RUN001','20260916',NULL);
INSERT INTO sales_distributors VALUES ('305','蚂蚁基金','ENABLED',1);
INSERT INTO sales_distributors VALUES ('306','天天基金','ENABLED',0);
INSERT INTO funds VALUES ('000001','广发演示成长基金','0',1.25000000,'20260916',1.30000000,1000000,1250000,100,100,1000000,2000000,0.01500000,'01','混合型','广发基金管理有限公司');
INSERT INTO funds VALUES ('000002','广发暂停申购基金','5',1.08000000,'20260916',1.15000000,800000,864000,100,100,1000000,2000000,0.01200000,'02','债券型','广发基金管理有限公司');
INSERT INTO funds VALUES ('000003','广发高门槛基金','0',2.00000000,'20260916',2.20000000,500000,1000000,10000,1000,500000,1000000,0.01000000,'01','混合型','广发基金管理有限公司');
INSERT INTO funds VALUES ('000009','广发创新成长募集期基金','1',1.00000000,'20260916',1.00000000,0,0,100,100,1000000,2000000,0.01200000,'01','混合型','广发基金管理有限公司');
COMMIT;
