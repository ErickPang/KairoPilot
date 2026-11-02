import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CompositionEvent, KeyboardEvent, RefObject } from 'react';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { completeSkill, filterSkillChoices, invocableSkillChoices, skillInput, slashSkillQuery, splitSkillInput } from '../components/skillCompletion';
import type { SkillChoice } from '../components/skillCompletion';

export function useSkillCompletion(input: string, setInput: (value: string) => void, textarea: RefObject<HTMLTextAreaElement>, disabled: boolean) {
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [compositionText, setCompositionText] = useState('');
  const composition = useRef<{prefix: string; selected: SkillChoice[]} | null>(null);
  const compositionEndedAt = useRef(-Infinity);
  const [dismissed, setDismissed] = useState<string>();
  const [skills, setSkills] = useState<SkillChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => splitSkillInput(input, skills), [input, skills]);
  const { selected, text, prefix } = composition.current
    ? { ...composition.current, text: compositionText } : parsed;
  const query = !disabled && focused && !composing ? slashSkillQuery(text, caret) : null;
  const queryKey = query ? `${query.start}:${query.text}` : '';
  const open = Boolean(query && dismissed !== queryKey);
  const choices = useMemo(() => filterSkillChoices(skills, query?.text || ''), [skills, query?.text]);
  const activeIndex = Math.min(active, choices.length - 1);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setLoading(true); setError('');
    void window.kairo.invoke(KAIRO_INVOKE.skillsGetAll).then(groups => {
      if (!cancelled) { setSkills(invocableSkillChoices(groups)); setLoading(false); }
    }).catch(reason => { if (!cancelled) { setError(String(reason)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [disabled, open, retry]);
  useEffect(() => { setActive(0); if (!queryKey) setDismissed(undefined); }, [queryKey]);
  useEffect(() => { if (open) menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, open, choices]);

  const syncCaret = useCallback(() => {
    const node = textarea.current;
    if (node) {
      setFocused(document.activeElement === node);
      setCaret(node.selectionStart === node.selectionEnd ? node.selectionStart : -1);
    }
  }, [textarea]);
  const choose = (index: number) => {
    if (!query || !choices[index]) return;
    const completed = completeSkill(text, query, choices[index], selected);
    setInput(completed.input);
    setDismissed(queryKey);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(completed.caret, completed.caret); setCaret(completed.caret); });
  };
  const remove = (index: number) => {
    if (disabled || composition.current) return;
    setInput(skillInput(selected.filter((_, item) => item !== index), text));
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(0, 0); setCaret(0); });
  };
  const setText = (value: string) => {
    if (composition.current) setCompositionText(value);
    setInput((composition.current?.prefix ?? prefix) + value);
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Some IMEs omit isComposing on the confirmation key, or deliver it just
    // after compositionend. Let the IME handle it without submitting the draft.
    if (composition.current || event.nativeEvent.isComposing || event.keyCode === 229
      || (event.key === 'Enter' && performance.now() - compositionEndedAt.current < 50)) return true;
    if (disabled) return false;
    if (event.key === 'Backspace' && selected.length && textarea.current?.selectionStart === 0 && textarea.current.selectionEnd === 0) {
      event.preventDefault(); remove(selected.length - 1); return true;
    }
    if (!open) return false;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(queryKey); return true; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (choices.length) setActive(index => (Math.min(index, choices.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault();
      if (!loading && !error && activeIndex >= 0) choose(activeIndex);
      return true;
    }
    return false;
  };
  return {
    id, menu, open, choices, activeIndex, loading, error, choose, keyDown,
    selected, text, remove, setText,
    setActive, retry: () => setRetry(value => value + 1),
    inputProps: {
      role: 'combobox' as const, 'aria-autocomplete': 'list' as const, 'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      'aria-activedescendant': open && !loading && !error && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined,
      onFocus: () => { setFocused(true); setDismissed(undefined); syncCaret(); },
      onBlur: () => setFocused(false), onSelect: syncCaret,
      onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => {
        composition.current = { prefix, selected };
        setCompositionText(event.currentTarget.value);
        setComposing(true);
      },
      onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
        const stablePrefix = composition.current?.prefix ?? prefix;
        composition.current = null;
        compositionEndedAt.current = performance.now();
        setComposing(false);
        setInput(stablePrefix + event.currentTarget.value);
        syncCaret();
      }
    },
    syncCaret
  };
}
