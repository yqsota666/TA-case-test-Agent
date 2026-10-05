import {z} from 'zod';

export const componentId=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const decimal=z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/);
const fields=z.record(z.string().regex(/^[A-Z][A-Za-z0-9]{0,59}$/),z.string().max(300));
const fundCode=z.string().regex(/^\d{6}$/),shareClass=z.string().regex(/^\w$/).default('0');
const applicationIds=z.array(componentId).min(1).max(50);
const base={id:componentId,title:z.string().min(1).max(120),dependsOn:z.array(componentId).max(200).default([]),
  allowSkippedDependencies:z.boolean().default(false),
  when:z.object({receiveStepId:componentId,applicationStepId:componentId,outcome:z.enum(['SUCCESS','FAILURE'])}).strict().optional()};
const component=(kind,params)=>z.object({...base,kind:z.literal(kind),params:z.object(params).strict()}).strict();
export const componentSchemas={
  'customer.define':component('customer.define',{investorName:z.string().min(1).max(120),simulatedBalance:decimal.default('100000.00'),
    investorType:z.enum(['0','1']).default('1'),profile:fields.default({})}),
  'account.define':component('account.define',{customerStepId:componentId,branchCode:z.string().regex(/^\d{1,9}$/).default('305')}),
  'fund.define':component('fund.define',{fundCode,fundName:z.string().min(1).max(120),shareClass,
    nav:z.string().regex(/^\d{1,8}(?:\.\d{1,8})?$/).default('1.00000000')}),
  'data.validate':component('data.validate',{sourceStepIds:z.array(componentId).min(1).max(50)}),
  'application.prepare':component('application.prepare',{accountStepId:componentId,fileType:z.enum(['01','03']),
    businessCode:z.string().regex(/^\d{3}$/),businessDate:z.iso.date(),fundCode:fundCode.optional(),shareClass,
    amount:decimal.optional(),volume:decimal.optional(),fields:fields.default({}),
    fieldBindings:z.record(z.string().regex(/^[A-Z][A-Za-z0-9]{0,59}$/),
      z.object({stepId:componentId,output:z.enum(['appNo','taSerialNo','transactionAccountNo'])}).strict()).default({}),
    negativeReason:z.enum(['NO_TA_ACCOUNT','NO_POSITION']).optional()}),
  'file.generate':component('file.generate',{applicationStepIds:applicationIds}),
  'file.deliver':component('file.deliver',{fileStepId:componentId}),
  'return.receive':component('return.receive',{fileType:z.enum(['02','04','05']),applicationStepIds:applicationIds.optional(),
    accountStepId:componentId.optional(),fundCode:fundCode.optional(),shareClass,snapshotDate:z.iso.date().optional()}),
  'result.validate':component('result.validate',{receiveStepId:componentId,
    expectations:z.array(z.object({applicationStepId:componentId,outcome:z.enum(['SUCCESS','FAILURE']),
      returnCodes:z.array(z.string().regex(/^[A-Z0-9]{4}$/)).max(10).default([]),fields:fields.default({})}).strict()).min(1).max(50)}),
  'position.reconcile':component('position.reconcile',{accountStepId:componentId,fundCode,shareClass,totalVolume:decimal,
    snapshotDate:z.iso.date().optional(),availableVolume:decimal.optional(),frozenVolume:decimal.optional()}),
  'case.evaluate':component('case.evaluate',{}),
  'case.archive':component('case.archive',{}),
};
export const componentPlanSchema=z.object({schemaVersion:z.literal(2),objective:z.string().min(1).max(1200),
  steps:z.array(z.discriminatedUnion('kind',Object.values(componentSchemas))).min(1).max(200)}).strict();
