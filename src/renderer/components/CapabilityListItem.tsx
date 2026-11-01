import type {ReactNode} from 'react';

interface Props {
  id:string;
  kind:'skill'|'plugin';
  name:string;
  description:string;
  icon:ReactNode;
  status:ReactNode;
  statusLabel:string;
  label:string;
  onOpen:()=>void;
}

export function CapabilityListItem({id,kind,name,description,icon,status,statusLabel,label,onOpen}:Props) {
  return <article className="capability-item" data-skill-id={kind==='skill'?id:undefined} data-plugin-id={kind==='plugin'?id:undefined}>
    <button type="button" className="capability-summary" aria-label={`${label}: ${name}`} onClick={onOpen}>
      <span className="capability-icon">{icon}</span>
      <span className="capability-copy"><span className="capability-name">{name}</span><span className="capability-description" title={description}>{description}</span></span>
      <span className="capability-status" aria-label={statusLabel} title={statusLabel}>{status}</span>
    </button>
  </article>;
}
