import type { useSkillCompletion } from '../hooks/useSkillCompletion';
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { IconSkill } from './Icons';
import { skillDescriptionPreview } from './skillCompletion';

export function SkillCompletionMenu({ completion }: { completion: ReturnType<typeof useSkillCompletion> }) {
  const { t } = useTranslation();
  const [availableHeight, setAvailableHeight] = useState<number>();
  const { open, menu } = completion;
  useLayoutEffect(() => {
    if (!open) return;
    const popup = menu.current;
    const anchor = popup?.parentElement;
    if (!popup || !anchor) return;
    const help = popup.querySelector<HTMLElement>('.skill-completion-help');
    const updateHeight = () => {
      const header = anchor.closest('.workbench-app')?.querySelector('[data-global-titlebar]');
      const top = header?.getBoundingClientRect().bottom || 0;
      setAvailableHeight(Math.max(48, Math.floor(anchor.getBoundingClientRect().top - top - 20 - (help?.offsetHeight || 0))));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(anchor);
    if (help) observer.observe(help);
    window.addEventListener('resize', updateHeight);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateHeight); };
  }, [open, menu]);
  if (!completion.open) return null;
  return <div className="skill-completion" data-skill-completion ref={completion.menu} style={{ '--skill-menu-space': availableHeight === undefined ? undefined : `${availableHeight}px` } as CSSProperties} onMouseDown={event => event.preventDefault()}>
    <div className="skill-completion-options" id={completion.id} role="listbox" aria-label={t('chat.skillChoices')} aria-busy={completion.loading}>
      {completion.loading ? <p role="status">{t('chat.skillsLoading')}</p>
        : completion.error ? <div role="alert"><p>{t('chat.skillsLoadFailed')}</p><button type="button" onClick={completion.retry}>{t('workbench.retry')}</button></div>
        : completion.choices.length ? completion.choices.map((skill, index) => <div role="option" id={`${completion.id}-${index}`} key={skill.id} aria-selected={index === completion.activeIndex} data-skill-choice={skill.id} title={`${skill.name} — ${skill.description.trim() || skill.whenToUse}`} onMouseMove={event => { if (event.movementX || event.movementY) completion.setActive(index); }} onClick={() => completion.choose(index)}>
          <IconSkill size={17}/><span className="skill-completion-copy"><span className="skill-completion-name">{skill.name}</span><span className="skill-completion-description">{skillDescriptionPreview(skill)}</span></span>
        </div>) : <p role="status">{t('chat.skillsNoMatch')}</p>}
    </div>
    <div className="skill-completion-help">{t('chat.skillChoiceHelp')}</div>
  </div>;
}
