export interface UsageDay {date:string;totalTokens:number;models:Record<string,number>}
export interface UsageOverview {
 totals:{promptTokens:number;completionTokens:number;totalTokens:number;records:number;peakDailyTokens:number;activeDays:number;runCount:number};
 daily:UsageDay[];
 models:Array<{model:string;totalTokens:number;promptTokens:number;completionTokens:number;records:number}>;
 sources:{main:number;delegation:number;memory:number};
 startDate:string;endDate:string;timeZone:string;
}
