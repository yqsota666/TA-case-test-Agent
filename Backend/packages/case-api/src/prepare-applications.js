import { isDeepStrictEqual } from 'node:util';
import { compileApplicationIntents, preparationCatalog } from '../../case-agent/src/application-preparation.js';
import { boundPreparationHistory } from '../../platform-store/src/application-preparation.js';

export function createApplicationPreparationService({ repository, preparations, exchangeRepository, derive }) {
  const error = (code, message) => Object.assign(new Error(message), { code, status: 409 });
  async function prepare({ token, chatPublicId, casePublicId, revision, userInput = '', channelId }) {
    const scope = { chatPublicId, casePublicId };
    const [previous, data, plan, channelResult, bindingResult] = await Promise.all([
      preparations.read(token, scope), repository.generatedData(token, chatPublicId, casePublicId),
      repository.getLatestSopProposal(token, chatPublicId, casePublicId),
      exchangeRepository.listChannels(token), exchangeRepository.listCaseBindings(token, scope),
    ]);
    if (data.reviewStatus !== 'CONFIRMED' || plan?.status !== 'LOCKED') {
      throw error('DATA_NOT_CONFIRMED', '须先确认 Plan 和当前 Case 的四张数据表');
    }
    if (revision !== undefined && revision !== previous.revision) {
      throw error('APPLICATION_PREPARATION_CONFLICT', '申请内容已更新，请刷新后重试');
    }
    if (previous.phase === 'PREPARING' && (userInput || (channelId && channelId !== previous.channelId))) {
      throw error('APPLICATION_PREPARATION_CONFLICT', '上次生成尚未完成，请先继续生成再补充新信息');
    }
    channelId ??= previous.channelId ?? (channelResult.channels.length === 1 ? channelResult.channels[0].id : undefined);
    const channel = channelResult.channels.find(row => row.id === channelId);
    if (!channel) {
      return preparations.save(token, { ...scope, revision: previous.revision, state: {
        ...previous, pendingUserInput: [previous.pendingUserInput, userInput].filter(Boolean).join('\n'),
        phase: 'NEEDS_INPUT', reply: '请先选择这份申请使用的交换通道。', questions: ['请选择交换通道'],
      } });
    }
    if (previous.stagedKeys.length && previous.channelId !== channelId) {
      throw error('APPLICATION_ALREADY_STAGED', '已有申请进入原通道，不能切换通道');
    }
    userInput = [previous.pendingUserInput, userInput].filter(Boolean).join('\n');
    const recovering = previous.phase === 'PREPARING' && previous.intents.length && !userInput;
    const history = boundPreparationHistory(previous);
    const suggestion = recovering ?
      { intents: previous.intents, reply: previous.reply, questions: previous.modelQuestions ?? [] } :
      await derive({ plan: plan.proposal,
        data: { customers: data.customers, accounts: data.accounts, funds: data.funds, holdings: data.holdings },
        channel, bindings: bindingResult.bindings, catalog: preparationCatalog(channel.protocolVersion),
        previous: { intents: previous.intents, stagedKeys: previous.stagedKeys,
          turns: history.turns, turnsOmitted: history.turnsOmitted ?? 0 }, userInput });
    for (const key of previous.stagedKeys) {
      const before = previous.intents.find(item => item.key === key);
      const after = suggestion.intents.find(item => item.key === key);
      const normalized = item => item && ({ ...item, targetAccountId: item.targetAccountId ?? null });
      if (!after || !isDeepStrictEqual(normalized(before), normalized(after))) {
        throw error('APPLICATION_ALREADY_STAGED', '已生成的申请不能通过补充对话改写，请保留原申请');
      }
    }
    const compiled = compileApplicationIntents({ intents: suggestion.intents, data, channel,
      bindings: bindingResult.bindings, casePublicId });
    const turns = [...history.turns];
    if (!recovering) {
      turns.push({ userInput, reply: suggestion.reply });
    }
    let state = await preparations.save(token, { ...scope, revision: previous.revision, state: {
      phase: 'PREPARING', channelId, pendingUserInput: '', intents: suggestion.intents, turns,
      turnsOmitted: history.turnsOmitted ?? 0, reply: suggestion.reply,
      modelQuestions: suggestion.questions, questions: compiled.questions,
      stagedKeys: previous.stagedKeys, files: previous.files, waiting: compiled.waiting,
    } });
    for (const application of compiled.records) {
      await exchangeRepository.stageApplication(token, { ...scope, sopVersionId: data.planVersionId,
        channelId, businessDate: application.businessDate, fileType: application.fileType, record: application.record });
      if (!state.stagedKeys.includes(application.key)) state.stagedKeys.push(application.key);
    }
    const { applications } = await exchangeRepository.listCaseApplications(token, scope);
    const ours = new Set(compiled.records.map(item => item.record.AppSheetSerialNo));
    const batches = new Set(applications.filter(item => ours.has(item.applicationNumber) &&
      item.status === 'BATCHED').map(item => item.batchPublicId));
    const dates = new Set(compiled.records.map(item => item.businessDate));
    let waitingChat = false;
    for (const date of dates) {
      const ready = applications.filter(item => ours.has(item.applicationNumber) && item.status === 'READY' &&
        item.channelId === channelId && item.businessDate.replaceAll('-','') === date);
      if (!ready.length) continue;
      try {
        const batch = await exchangeRepository.createOutboundBatch(token, { chatPublicId, channelId,
          businessDate: date, applicationPublicIds: ready.map(item => item.publicId) });
        batches.add(batch.publicId);
      } catch (cause) {
        if (!['SOP_NOT_LOCKED','DATA_NOT_CONFIRMED'].includes(cause.code)) throw cause;
        waitingChat = true;
      }
    }
    for (const batchPublicId of batches) {
      await exchangeRepository.generateOutboundFiles(token, { chatPublicId, batchPublicId });
    }
    const caseApps = await exchangeRepository.listCaseApplications(token, scope);
    const ourBatches = new Set(caseApps.applications
      .map(item => item.batchPublicId).filter(Boolean));
    const files = (await exchangeRepository.listOutboundFiles(token, chatPublicId)).files
      .filter(item => ourBatches.has(item.batchPublicId));
    const questions = [...new Set([...suggestion.questions, ...compiled.questions])];
    const phase = questions.length ? 'NEEDS_INPUT' : waitingChat ? 'WAITING_CHAT' :
      compiled.waiting.length ? 'WAITING_TA' : suggestion.intents.length ? 'GENERATED' : 'NO_APPLICATION';
    return preparations.save(token, { ...scope, revision: state.revision, state: { ...state,
      phase, files, questions, reply: phase === 'WAITING_TA' ?
        '已准备当前可生成的申请。03 申请还在等待对应账户的成功 02 回传；收到后可继续生成。' :
        phase === 'WAITING_CHAT' ? '申请已准备。请先确认当前 Chat 里其他 Case 的 Plan 和数据，再继续生成文件。' :
          phase === 'GENERATED' ? `${suggestion.reply}\n当前已准备的申请文件已生成，可以点击文件卡片查看；继续时会重新核对 Plan 的后续动作。` : suggestion.reply,
    } });
  }
  return Object.freeze({ read: (token, scope) => preparations.read(token, scope), prepare });
}
