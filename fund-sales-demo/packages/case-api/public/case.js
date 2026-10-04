const $ = id => document.getElementById(id);
let base = '';
let currentPlan = null;
let busy = false;

function status(message) { $('status').textContent = message; }
function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) button.disabled = value;
  if (!value && currentPlan?.proposal.openQuestions.length) $('confirm').disabled = true;
}
async function request(path, options) {
  const response = await fetch(base + path, { credentials: 'same-origin', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录。' :
    `请求失败：${result.error ?? response.status}`);
  return result;
}
function showTurns(history) {
  const list = $('turns'); list.replaceChildren();
  for (const turn of history.turns) {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    label.textContent = turn.role === 'user' ? '你' : 'Agent';
    item.append(label, document.createTextNode(turn.content)); list.append(item);
  }
  $('revision').textContent = `已保存 ${history.revision} 轮`;
}
function showPlan(plan) {
  currentPlan = plan;
  $('plan-panel').hidden = !plan;
  if (!plan) return;
  $('compose').hidden = plan.status === 'LOCKED';
  $('plan-state').textContent = `版本 ${plan.versionNumber} · ${plan.status}`;
  const lines = [`测试目标：${plan.proposal.objective}`];
  for (const item of plan.proposal.preconditions) lines.push(`准备条件：${item}`);
  for (const [index, item] of plan.proposal.scenarios.entries()) {
    lines.push(`场景 ${index + 1}：${item.title}`, `准备：${item.setup}`, `动作：${item.action}`,
      `预期：${item.expected}`, `证据：${item.evidence}`);
  }
  for (const item of plan.proposal.openQuestions) lines.push(`待确认：${item}`);
  $('plan-content').textContent = lines.join('\n');
  $('confirm').hidden = plan.status !== 'PENDING_CONFIRMATION';
  $('confirm').disabled = busy || plan.proposal.openQuestions.length > 0;
  if (plan.proposal.openQuestions.length) status('Plan 还有待确认问题。请在讨论框补充后重新生成提案。');
}
async function refresh() {
  const [history, plan] = await Promise.all([request('/discussion'), request('/plan')]);
  showTurns(history); showPlan(plan);
}
async function act(path, body, message) {
  if (busy || !base) return;
  setBusy(true); status(message);
  try {
    await request(path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    $('message').value = '';
    if (path === '/plan/confirm') {
      showPlan(await request('/plan'));
    } else {
      await refresh();
    }
    status('已保存。');
  } catch (error) { status(error.message); }
  finally { setBusy(false); }
}
$('open-case').addEventListener('submit', async event => {
  event.preventDefault();
  const chat = $('chat-id').value.trim(), caseId = $('case-id').value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(chat) || !/^[0-9a-f-]{36}$/i.test(caseId)) {
    status('请输入有效的 Chat 和 Case UUID。'); return;
  }
  base = `/api/chats/${chat}/cases/${caseId}`;
  setBusy(true); status('正在读取 Case…');
  try { await refresh(); $('compose').hidden = currentPlan?.status === 'LOCKED'; status('Case 已打开。'); }
  catch (error) { $('compose').hidden = true; $('plan-panel').hidden = true; status(error.message); }
  finally { setBusy(false); }
});
$('compose').addEventListener('submit', event => {
  event.preventDefault(); act('/discussion', { userInput: $('message').value }, '正在讨论…');
});
$('propose').addEventListener('click', () =>
  act('/plan', { userInput: $('message').value || '请根据已有讨论生成 Plan 提案' }, '正在生成 Plan…'));
$('confirm').addEventListener('click', () => {
  if (currentPlan) act('/plan/confirm', { versionNumber: currentPlan.versionNumber }, '正在确认 Plan…');
});
