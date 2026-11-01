import {IconShield} from './Icons';
import {useTranslation} from '../hooks/useTranslation';
import type {ConfirmationRequest} from '../types';
function publicArguments(value:unknown):unknown {
  if(Array.isArray(value))return value.map(publicArguments);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('__')).map(([key,item])=>[key,publicArguments(item)]));
  return value;
}
export function ApprovalCard({request,busy,onConfirm,onDeny,stopAction}:{request:ConfirmationRequest;busy:boolean;onConfirm:()=>void;onDeny:()=>void;stopAction?:import('react').ReactNode}) {
  const {t}=useTranslation();const args=publicArguments(request.args) as Record<string,unknown>;
  const kind=request.tool==='execute_command'?'terminal':request.tool==='web_search'?'search':request.tool==='write_file'?'write':'tool';
  const preview=args.command?`${args.command} ${Array.isArray(args.args)?args.args.join(' '):''}`.trim():String(args.query||args.path||args.url||args.name||request.tool);
  const risk=request.riskLevel==='low'||request.riskLevel==='high'||request.riskLevel==='critical'?request.riskLevel:'medium';
  const destructive=risk==='high'||risk==='critical';
  return <section className={`inline-approval ${destructive?'is-destructive':''}`} data-inline-approval={request.id} aria-label={t('approval.heading')} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();event.stopPropagation();onDeny();}}}>
    <div className="inline-approval-heading"><IconShield size={17}/><strong>{t(`approval.tool.${kind}`)}</strong></div>
    <p className="inline-approval-description">{t(destructive?'modal.requestDescHighRisk':'approval.description')}</p><pre className="inline-approval-preview">{preview}</pre>
    <details><summary>{t('approval.details')}</summary><code>{request.tool}</code><pre>{JSON.stringify(args,null,2)}</pre><p>{t('modal.riskLevel')}: {t(`modal.risk.${risk}`)}</p>{request.redacted&&<p>{t('modal.redactedNotice')}</p>}</details>
    <div className="inline-approval-actions">{stopAction&&<span className="approval-stop-action">{stopAction}</span>}<button type="button" className="btn btn-secondary" data-approval-action="deny" disabled={busy} onClick={onDeny}>{t('approval.deny')}</button><button type="button" className={`btn ${destructive?'btn-danger':'btn-primary'}`} data-approval-action="allow" disabled={busy} onClick={onConfirm}>{t('approval.allowOnce')}</button></div>
  </section>;
}
