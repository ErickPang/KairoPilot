import {z} from 'zod';
export const IntelligenceBudgetSchema=z.object({maxTokens:z.number().int().min(1000).max(1000000),maxRetries:z.number().int().min(0).max(5)}).strict();
export const DEFAULT_INTELLIGENCE_BUDGET={maxTokens:64000,maxRetries:2};
export function intelligenceBudget(value?:{maxTokens:number;maxRetries:number}){
 return IntelligenceBudgetSchema.parse(value||DEFAULT_INTELLIGENCE_BUDGET);
}
