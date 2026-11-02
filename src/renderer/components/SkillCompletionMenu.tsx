import type { useSkillCompletion } from '../hooks/useSkillCompletion';
import { useTranslation } from '../hooks/useTranslation';
import { IconSkill } from './Icons';

export function SkillCompletionMenu({ completion }: { completion: ReturnType<typeof useSkillCompletion> }) {
  const { t } = useTranslation();
  if (!completion.open) return null;
  return <div className="skill-completion" data-skill-completion ref={completion.menu} onMouseDown={event => event.preventDefault()}>
    <div className="skill-completion-options" id={completion.id} role="listbox" aria-label={t('chat.skillChoices')} aria-busy={completion.loading}>
      {completion.loading ? <p role="status">{t('chat.skillsLoading')}</p>
        : completion.error ? <div role="alert"><p>{t('chat.skillsLoadFailed')}</p><button type="button" onClick={completion.retry}>{t('workbench.retry')}</button></div>
        : completion.choices.length ? completion.choices.map((skill, index) => <div role="option" id={`${completion.id}-${index}`} key={skill.id} aria-selected={index === completion.activeIndex} data-skill-choice={skill.id} title={`${skill.name} — ${skill.description}`} onMouseMove={event => { if (event.movementX || event.movementY) completion.setActive(index); }} onClick={() => completion.choose(index)}>
          <IconSkill size={17}/><span className="skill-completion-name">{skill.name}</span><span className="skill-completion-description">{skill.description || skill.whenToUse}</span>
        </div>) : <p role="status">{t('chat.skillsNoMatch')}</p>}
    </div>
    <div className="skill-completion-help">{t('chat.skillChoiceHelp')}</div>
  </div>;
}
