const SALES = process.env.SALES_API || 'http://localhost:8081/api';
const TA = process.env.TA_API || 'http://localhost:8082/api';

async function call(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error || response.status}`);
  console.log(`✓ ${path}`);
  return result;
}

async function expectFailure(base, path, body, messagePart) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const result = await response.json();
  if (response.ok || !String(result.error || '').includes(messagePart)) throw new Error(`${path}: 应拒绝并提示 ${messagePart}`);
  console.log(`✓ ${path} 正确拒绝 T 日清算`);
}

const scenarioId = `SMOKE${Date.now()}`;
await call(SALES, '/reset', { scenarioId, businessDate: '2026-09-16' });
await call(TA, '/reset', { scenarioId, businessDate: '2026-09-16' });
await call(TA, '/batches/07', {});
await call(SALES, '/inbox/07', {});

const customer = await call(SALES, '/customers', {
  name: '集成测试客户', certificateNo: '440106199001011235', mobile: '13800138000', balance: 100000,
});
await call(SALES, `/customers/${customer.id}/open`, {});
const accountPackage = await call(SALES, '/batches/T', {});
if (accountPackage.fileCount !== 1 || accountPackage.files[0].fileType !== '01') throw new Error('T 日账户包应只包含一个 01 文件');
await call(TA, '/inbox/01', {});
await expectFailure(TA, '/process/01', {}, 'T+1');
await call(SALES, '/time/advance', { days: 1 });
await call(TA, '/time/advance', { days: 1 });
await call(TA, '/process/01', {});
const accountConfirmationPackage = await call(TA, '/batches/T1', {});
if (!accountConfirmationPackage.files.some(file => file.fileType === '02') || !accountConfirmationPackage.files.some(file => file.fileType === '05')) throw new Error('T+1 账户确认包应包含 02 和 05');
await call(SALES, '/inbox/02', {});
await call(SALES, '/inbox/05', {});

for (const amount of [1000, 2000, 3000]) {
  await call(SALES, '/orders', { customerId: customer.id, fundCode: '000001', amount });
}
const secondCustomer = await call(SALES, '/customers', {
  name: '同日开户客户', certificateNo: '11010519491231002X', mobile: '13900139000', balance: 50000,
});
await call(SALES, `/customers/${secondCustomer.id}/open`, {});
const batch03 = await call(SALES, '/batches/T', {});
const file03 = batch03.files.find(file => file.fileType === '03');
const sameDayFile01 = batch03.files.find(file => file.fileType === '01');
if (batch03.fileCount !== 2 || sameDayFile01?.recordCount !== 1 || file03?.recordCount !== 3) throw new Error('同一 T 日 OFI 应同时声明一条 01 和三条 03');
await call(TA, '/inbox/01', {});
await call(TA, '/inbox/03', {});
await expectFailure(TA, '/process/01', {}, 'T+1');
await expectFailure(TA, '/process/03', {}, 'T+1');
await call(SALES, '/time/advance', { days: 1 });
await call(TA, '/time/advance', { days: 1 });
await call(TA, '/process/01', {});
await call(TA, '/process/03', {});
const tradeConfirmationPackage = await call(TA, '/batches/T1', {});
const file04 = tradeConfirmationPackage.files.find(file => file.fileType === '04');
if (tradeConfirmationPackage.fileCount !== 3 || !tradeConfirmationPackage.files.some(file => file.fileType === '02') || file04?.recordCount !== 3 || !tradeConfirmationPackage.files.some(file => file.fileType === '05')) throw new Error('T+1 OFJ 应同时声明 02、三条 04 和 05');
await call(SALES, '/inbox/02', {});
await call(SALES, '/inbox/04', {});
await call(SALES, '/inbox/05', {});

const state = await call(SALES, '/state');
if (state.orders.length !== 3 || state.orders.some((order) => order.status !== 'CONFIRMED')) {
  throw new Error('三笔申购未全部确认');
}
if (state.reconciliations.some((item) => item.status !== 'MATCHED')) throw new Error('05 对账未匹配');
console.log(`\nT+1 全链路通过：03 合并 ${file03.recordCount} 条，04 确认 ${file04.recordCount} 条，05 对账一致。`);
