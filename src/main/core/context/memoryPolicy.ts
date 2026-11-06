import {redactSensitiveValue} from '../security/permissions';
export const normalizeMemoryText=(value:string)=>value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function canKeepMemory(candidate:{key:string;content:string;quote:string},userText:string) {
  return Boolean(normalizeMemoryText(candidate.key))&&userText.includes(candidate.quote)&&candidate.quote.trim().length>=2
    &&String(redactSensitiveValue(candidate.content))===candidate.content
    &&String(redactSensitiveValue(candidate.quote))===candidate.quote
    &&!candidate.content.includes('[REDACTED')&&!candidate.quote.includes('[REDACTED');
}
