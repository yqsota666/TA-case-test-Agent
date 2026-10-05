import { z } from 'zod';
import {componentPlanSchema} from './component-schema.js';

const id = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/);
const date = z.iso.date();
const reference = {
  customerStepId: id.optional(),
  customerIndex: z.number().int().min(0).max(4).default(0),
  tradingAccountId: z.string().regex(/^\d{1,20}$/).optional(),
};
const base = { id, title: z.string().min(1).max(120), dependsOn: z.array(id).max(24).default([]) };
const step = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('CUSTOMERS'), params: z.object({
    investorName: z.string().min(1).max(120), count: z.number().int().min(1).max(5).default(1),
    simulatedBalance: money.default('100000.00'),
  }).strict() }).strict(),
  z.object({ ...base, kind: z.literal('FUND'), params: z.object({
    fundCode: z.string().regex(/^\d{6}$/), fundName: z.string().min(1).max(120),
    shareClass: z.string().regex(/^\w$/).default('0'), nav: z.string().regex(/^\d{1,8}(?:\.\d{1,8})?$/).default('1.00000000'),
  }).strict() }).strict(),
  z.object({ ...base, kind: z.literal('APPLICATION'), params: z.object({
    ...reference, fileType: z.enum(['01','03']), businessCode: z.string().regex(/^\d{3}$/), businessDate: date,
    fundCode: z.string().regex(/^\d{6}$/).optional(), shareClass: z.string().regex(/^\w$/).default('0'),
    amount: money.optional(), volume: money.optional(),
    fields: z.record(z.string().regex(/^[A-Z][A-Za-z0-9]{0,59}$/), z.string().max(300)).default({}),
    negativeReason: z.enum(['NO_TA_ACCOUNT','NO_POSITION']).optional(),
  }).strict(), expected: z.object({ outcome: z.enum(['SUCCESS','FAILURE']), returnCodes: z.array(z.string().regex(/^[A-Z0-9]{4}$/)).max(10).default([]) }).strict() }).strict(),
  z.object({ ...base, kind: z.literal('VERIFY_POSITION'), params: z.object({
    ...reference, fundCode: z.string().regex(/^\d{6}$/), shareClass: z.string().regex(/^\w$/).default('0'),
    totalVolume: money, snapshotDate: date.optional(),
  }).strict() }).strict(),
]);

const legacyPlanSchema = z.object({ objective: z.string().min(1).max(1200), steps: z.array(step).min(1).max(24) }).strict();
export const planSchema = z.union([componentPlanSchema,legacyPlanSchema]);
export const executePlanSchema=z.object({planVersion:z.number().int().positive()}).strict();
export const savePlanSchema = z.object({ expectedVersion: z.number().int().min(0), plan: planSchema }).strict();
export const finalizePlanSchema = z.object({proposalId:z.uuid()}).strict();
export const executeStepSchema = z.object({ planVersion: z.number().int().positive(), stepId: id }).strict();
export const messageSchema = z.object({ requestId: z.uuid(), content: z.string().trim().min(1).max(10000) }).strict();
export const resumeSchema = z.object({ requestId: z.uuid() }).strict();
export const notesSchema = z.object({ notes: z.array(z.string().min(1).max(300)).max(8) }).strict();
export const emptySchema = z.object({}).strict();
export const packageSchema = z.object({ packageId: z.uuid() }).strict();
export const waitSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export const rulesSchema = z.object({fileType:z.enum(['01','03']).optional(),businessCode:z.string().regex(/^\d{3}$/).optional()}).strict();
