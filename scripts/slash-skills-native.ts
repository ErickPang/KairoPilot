import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { SessionSummary, TaskDraft } from '../src/shared/contracts';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';

export async function verifySlashSkills(
  window: BrowserWindow,
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>,
  output: string,
  assert: (ok: unknown, label: string) => void,
  requestCount: () => number,
  hasLoadedSkill: () => boolean
) {
  const task = await invoke<SessionSummary>(C.chatCreateSession);
  await invoke(C.chatSetActiveSession, task.id);
  await window.reload();
  window.show();
  window.focus();
  window.webContents.sendInputEvent({type:'mouseMove',x:4,y:4});
  const js = (code: string) => window.webContents.executeJavaScript(code);
  const wait = (condition: string) => js(`new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve(true);}else if(Date.now()>end){clearInterval(timer);resolve(false);}},25);})`);
  const typeBody = (value: string) => js(`(()=>{const input=document.querySelector('.input-textarea');input.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const type = async (value: string) => {
    while (await js(`Boolean(document.querySelector('[data-selected-skill] button'))`)) {
      await js(`document.querySelector('[data-selected-skill] button').click()`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await typeBody(value);
  };
  const key = (value: string, composing = false) => js(`document.querySelector('.input-textarea').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(value)},bubbles:true,isComposing:${composing}}))`);
  const before = requestCount();
  assert(await wait(`document.querySelector('.chat-interface[data-session-id="${task.id}"][data-save-state="saved"] .input-textarea:not(:disabled)')`), 'slash: ready composer restores the selected task');
  await type('/');
  const listed = await wait(`document.querySelector('[data-skill-choice="b2-manual"]') && document.querySelector('[data-skill-choice="b2-workflow"]')`);
  if (!listed) {
    fs.writeFileSync(path.join(output, 'skills-slash-error.png'), (await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output, 'skills-slash-error.json'), JSON.stringify(await js(`(()=>{const input=document.querySelector('.input-textarea');return {value:input.value,caret:input.selectionStart,focused:document.activeElement===input,html:input.outerHTML,menu:document.querySelector('[data-skill-completion]')?.outerHTML};})()`), null, 2));
  }
  assert(listed, 'slash: empty query lists installed skills including manual-only skills');
  assert(await js(`!document.querySelector('[data-skill-choice="b2-hidden"]')`), 'slash: skills that disallow user invocation are excluded');
  assert(await js(`(()=>{const list=document.querySelector('.skill-completion-options');const row=list.querySelector('[role="option"]');return list.querySelectorAll('[role="option"]').length>5 && Math.abs(list.clientHeight-row.getBoundingClientRect().height*5)<1 && list.scrollHeight>list.clientHeight;})()`), 'slash: full catalog stays available in a five-row scroll viewport');
  fs.writeFileSync(path.join(output, 'skills-slash-all.png'), (await window.webContents.capturePage()).toPNG());
  await type('/picker-demo');
  await wait(`document.querySelectorAll('[data-skill-choice]').length===7`);
  assert(await wait(`document.querySelector('[data-skill-choice="picker-demo-0"]').getAttribute('aria-selected')==='true'`), 'slash: filtering starts navigation at the first skill');
  for(let index=0;index<5;index++){
    await key('ArrowDown');
    assert(await wait(`document.querySelector('[data-skill-choice="picker-demo-${index+1}"]').getAttribute('aria-selected')==='true'`), `slash: consecutive Down selects skill ${index+2}`);
  }
  assert(await wait(`(()=>{const list=document.querySelector('.skill-completion-options');const active=list.querySelector('[aria-selected="true"]');const box=list.getBoundingClientRect(),row=active.getBoundingClientRect();return active.dataset.skillChoice==='picker-demo-5' && list.scrollTop>0 && row.top>=box.top && row.bottom<=box.bottom+1;})()`), 'slash: Down reveals the sixth skill within the menu');
  for(let index=0;index<6;index++){
    await key('ArrowUp');
    await wait(`document.querySelector('[data-skill-choice="picker-demo-${(4-index+7)%7}"]').getAttribute('aria-selected')==='true'`);
  }
  assert(await wait(`document.querySelector('[data-skill-choice="picker-demo-6"]').getAttribute('aria-selected')==='true'`), 'slash: Up wraps to the last skill');
  await key('ArrowDown');
  assert(await wait(`document.querySelector('.skill-completion-options').scrollTop===0 && document.querySelector('[data-skill-choice="picker-demo-0"]').getAttribute('aria-selected')==='true'`), 'slash: Down wraps back to the first skill and scrolls to the top');
  const point = await js(`(()=>{const box=document.querySelector('.skill-completion-options').getBoundingClientRect();return {x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2)};})()`);
  window.webContents.sendInputEvent({type:'mouseWheel',...point,deltaY:-120,deltaX:0});
  assert(await wait(`document.querySelector('.skill-completion-options').scrollTop>0`), 'slash: mouse wheel scrolls the remaining skills');
  await type('/b2-');
  await wait(`document.querySelectorAll('[data-skill-choice]').length===2`);
  const initial = await js(`document.querySelector('.input-textarea').getAttribute('aria-activedescendant')`);
  await key('ArrowDown');
  assert(await wait(`document.querySelector('.input-textarea').getAttribute('aria-activedescendant')!==${JSON.stringify(initial)}`), 'slash: arrow key moves the active option');
  await key('Enter');
  assert(await wait(`document.querySelector('[data-selected-skill="b2-workflow"]') && document.querySelector('.input-textarea').value==='' && !document.querySelector('[data-skill-completion]')`), 'slash: Enter creates an independent token without sending');
  assert(await js(`(()=>{const token=document.querySelector('[data-selected-skill]');return token.querySelector('svg') && !token.textContent.includes('/') && getComputedStyle(token).color!==getComputedStyle(document.querySelector('.input-textarea')).color;})()`), 'slash: selected skill has an icon, display name and distinct color');
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Input.imeSetComposition', {text:'zhong', selectionStart:5, selectionEnd:5});
    assert(await wait(`document.querySelector('.input-textarea').value==='zhong'`), 'IME: selected skill permits an active pinyin composition');
    await key('Enter');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(await js(`document.querySelector('.input-textarea').value==='zhong' && !document.querySelector('[data-run-summary]')`), 'IME: unmarked confirmation Enter cannot submit an active composition');
    await window.webContents.debugger.sendCommand('Input.insertText', {text:'中文'});
    assert(await wait(`document.querySelector('.input-textarea').value==='中文' && document.querySelector('[data-selected-skill="b2-workflow"]')`), 'IME: committing Chinese preserves the skill token');
    await window.webContents.debugger.sendCommand('Input.imeSetComposition', {text:'shuru', selectionStart:5, selectionEnd:5});
    await window.webContents.debugger.sendCommand('Input.insertText', {text:'输入'});
    assert(await wait(`document.querySelector('.input-textarea').value==='中文输入'`), 'IME: consecutive Chinese compositions append without reverting to pinyin');
    await window.webContents.debugger.sendCommand('Input.imeSetComposition', {text:'linshi', selectionStart:6, selectionEnd:6});
    await window.webContents.debugger.sendCommand('Input.imeSetComposition', {text:'', selectionStart:0, selectionEnd:0});
    assert(await wait(`document.querySelector('.input-textarea').value==='中文输入'`), 'IME: cancelling a composition retains committed Chinese');
  } finally { window.webContents.debugger.detach(); }
  assert(await wait(`document.querySelector('.chat-interface[data-save-state="saved"]')`), 'IME: composed Chinese draft finishes saving');
  assert((await invoke<TaskDraft>(C.chatGetDraft,task.id)).input==='/b2-workflow 中文输入', 'IME: draft retains both explicit skill and committed Chinese');
  await typeBody('继续输入正文');
  assert(await wait(`document.querySelector('[data-selected-skill="b2-workflow"]') && document.querySelector('.input-textarea').value==='继续输入正文'`), 'slash: typing the request preserves the selected skill');
  fs.writeFileSync(path.join(output, 'skills-selected-token.png'), (await window.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[data-selected-skill] button').click()`);
  assert(await wait(`!document.querySelector('[data-selected-skill]') && document.querySelector('.input-textarea').value==='继续输入正文'`), 'slash: remove button preserves the request text');
  await type('/资料');
  assert(await wait(`document.querySelector('[data-skill-choice="b2-workflow"]') && document.querySelectorAll('[data-skill-choice]').length===1`), 'slash: Chinese description filters the skill list');
  await js(`document.querySelector('.input-textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
  await key('Enter', true);
  assert(await js(`document.querySelector('.input-textarea').value==='/资料'`), 'slash: IME confirmation preserves the draft');
  await js(`document.querySelector('.input-textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);
  await type('/no-such-skill');
  assert(await wait(`document.querySelector('[data-skill-completion] [role="status"]') && !document.querySelector('[data-skill-choice]')`), 'slash: no-match state appears');
  await key('Enter');
  await key('Escape');
  assert(await wait(`!document.querySelector('[data-skill-completion]')`), 'slash: Escape dismisses the menu');
  await type('');
  await wait(`document.querySelector('.input-textarea').value===''`);
  await type('/b2-man');
  assert(await wait(`document.querySelector('[data-skill-choice="b2-manual"]')`), 'slash: partial ID filters the list');
  await key('Tab');
  assert(await wait(`document.querySelector('[data-selected-skill="b2-manual"]') && document.querySelector('.input-textarea').value===''`), 'slash: Tab inserts a selected skill token');
  await key('Backspace');
  assert(await wait(`!document.querySelector('[data-selected-skill]')`), 'slash: Backspace at the beginning removes the selected skill');
  const [width, height] = window.getSize();
  window.setSize(980, height);
  await type('/b2-man');
  await wait(`document.querySelector('[data-skill-choice="b2-manual"]')`);
  assert(await wait(`(()=>{const r=document.querySelector('[data-skill-completion]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0;})()`), 'slash: popup fits the narrower window');
  fs.writeFileSync(path.join(output, 'skills-slash-filtered.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(width, height);
  await type('/b2-work');
  await wait(`document.querySelector('[data-skill-choice="b2-workflow"]')`);
  await js(`document.querySelector('[data-skill-choice="b2-workflow"]').click()`);
  assert(await wait(`document.querySelector('[data-selected-skill="b2-workflow"]')`), 'slash: mouse selects a skill');
  await typeBody('/b2-man');
  await wait(`document.querySelector('[data-skill-choice="b2-manual"]')`);
  await key('Tab');
  assert(await wait(`document.querySelectorAll('[data-selected-skill]').length===2 && document.querySelector('.input-textarea').value===''`), 'slash: a second skill becomes a separate token');
  await typeBody('保留正文');
  await js(`(()=>{const input=document.querySelector('.input-textarea');input.setSelectionRange(0,0);input.dispatchEvent(new Event('select',{bubbles:true}));})()`);
  await key('Backspace');
  assert(await wait(`document.querySelectorAll('[data-selected-skill]').length===1 && document.querySelector('[data-selected-skill="b2-workflow"]') && document.querySelector('.input-textarea').value==='保留正文'`), 'slash: Backspace removes only the last skill and preserves the body');
  await type('/b2-man');
  await wait(`document.querySelector('[data-skill-choice="b2-manual"]')`);
  await key('Tab');
  assert(requestCount() === before, 'slash: choosing, IME and empty matches never submit a model request');
  assert(await wait(`document.querySelector('[data-selected-skill="b2-manual"]') && document.querySelector('.chat-interface[data-save-state="saved"]')`), 'slash: selected skill draft is saved');
  assert((await invoke<TaskDraft>(C.chatGetDraft,task.id)).input==='/b2-manual ', 'slash: selected token uses the existing explicit invocation draft format');
  await window.reload();
  assert(await wait(`document.querySelector('[data-selected-skill="b2-manual"]') && document.querySelector('.input-textarea')?.value==='' && !document.querySelector('[data-skill-completion]')`), 'slash: reload restores the skill token without opening the menu');
  await type('/b2-manual B2_SLASH_PICKER');
  await wait(`document.querySelector('.input-textarea').value==='B2_SLASH_PICKER' && document.querySelector('[data-selected-skill="b2-manual"]')`);
  await key('Enter');
  assert(await wait(`document.querySelector('[data-run-summary="completed"]') && document.querySelector('.messages-container')?.textContent.includes('B2_DONE')`), 'slash: selected skill request completes through the real composer');
  assert(requestCount() > before && hasLoadedSkill(), 'slash: manual-only skill body is preloaded into the actual model request');
  assert(await wait(`!document.querySelector('[data-selected-skill]') && document.querySelector('.input-textarea').value===''`), 'slash: successful send clears the skill token and body together');
}
