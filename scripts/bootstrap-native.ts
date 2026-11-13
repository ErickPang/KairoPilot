import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapMainProcess } from '../src/main/bootstrap/appBootstrap';
import { DEFAULT_CONFIG } from '../src/main/store/configDefaults';
import { createRun, getRunById } from '../src/main/store/chat';
import { getActiveSessionSummary } from '../src/main/store/taskPages';
import { getTaskDraft, saveTaskDraft } from '../src/main/services/taskOrganizationService';
import { KAIRO_INVOKE } from '../src/shared/ipc';
import type { TaskDraftInput } from '../src/shared/contracts';

const output=process.env.KAIROPILOT_BOOTSTRAP_OUTPUT!;
const mode=process.env.KAIROPILOT_BOOTSTRAP_MODE!;
const root=process.env.KAIROPILOT_TEST_ROOT!;
app.setName('KairoPilot Bootstrap Fixture');
const checks:string[]=[];const dialogs:string[]=[];
const assert=(value:unknown,label:string)=>{if(!value)throw new Error(label);checks.push(label);};
const report=(success:boolean,error?:string)=>fs.writeFileSync(path.join(output,`bootstrap-${mode}.json`),JSON.stringify({success,error,checks,dialogs}));
// Keep the genuine application/quit hooks; replace only the OS error box to avoid an interactive test dialog.
dialog.showErrorBox=(title:string)=>{dialogs.push(title);};
if(mode!=='secondary') {
  fs.mkdirSync(root,{recursive:true});
  const config=structuredClone(DEFAULT_CONFIG);
  config.models.providers.fixture={provider:'ollama',baseUrl:'http://127.0.0.1:1',apiKey:'',model:[{id:'fixture',name:'Fixture'}]};
  config.workbench!.defaultModel='fixture/fixture';
  fs.writeFileSync(path.join(root,'kairopilot.json'),JSON.stringify(mode==='failure'?{version:'unsupported'}:config));
}
let runId:string|undefined;
let sessionId:string|undefined;
let draftWrites=0;
app.on('will-quit',()=>{
  try {
    if(mode==='primary') {
      assert(getRunById(runId!)?.status==='cancelled','owner quit still cancels its pending execution after draft acknowledgement');
      assert(getTaskDraft(sessionId!).input==='Synthetic unsent draft for quit','owner quit persists unsent input before exiting');
      assert(draftWrites===1,'repeated quit delivery does not duplicate the delayed draft write');
      assert(dialogs.length===0,'normal owner quit produces no draft or startup error');
    } else if(mode==='failure') {
      assert(dialogs.length===1&&dialogs[0].includes('Startup stopped'),'startup failure emits only the initialization error');
      assert(!fs.existsSync(path.join(root,'kairopilot.db')),'startup failure never opens the task database during exit');
    } else if(mode==='cancel') {
      assert(BrowserWindow.getAllWindows().length===0&&!fs.existsSync(path.join(root,'kairopilot.db')),'quit during initialization opens neither editor nor task database');
      assert(dialogs.length===0,'early startup cancellation produces no false draft warning');
    } else assert(BrowserWindow.getAllWindows().length===0,'secondary process exits without an editor');
    report(true);
  } catch(error) {report(false,String(error));process.exitCode=1;}
});
bootstrapMainProcess({dirname:output,rendererDistPath:output,publicPath:output});
if(mode==='cancel')void app.whenReady().then(()=>app.quit());
if(mode==='primary') {
  let busy=false;
  const timer=setInterval(()=>{
    if(busy)return;busy=true;
    void(async()=>{
      const window=BrowserWindow.getAllWindows()[0];
      if(!window||window.webContents.isLoadingMainFrame())return;
      const task=getActiveSessionSummary(undefined);
      if(!task)return;
      const selector=`.chat-interface[data-session-id="${task.id}"][data-save-state="saved"] textarea:not(:disabled)`;
      const ready=await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if(!ready)return;
      clearInterval(timer);
      sessionId=task.id;
      const type=async(value:string)=>window.webContents.executeJavaScript(`{
        const input=document.querySelector('.input-textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }`);
      const waitState=async(state:string)=>window.webContents.executeJavaScript(`new Promise(resolve=>{
        const end=Date.now()+3000;const timer=setInterval(()=>{
          if(document.querySelector('.chat-interface')?.dataset.saveState===${JSON.stringify(state)}){clearInterval(timer);resolve(true);}
          else if(Date.now()>end){clearInterval(timer);resolve(false);}
        },10);
      })`);
      await type('Temporary edit before undo');assert(await waitState('saving'),'editing marks the draft as pending');
      await type('');assert(await waitState('saved')&&getTaskDraft(task.id).input==='','undo before debounce restores an accurate saved state');
      window.hide();
      // A slow genuine persistence call exercises quit redelivery while the input remains locked.
      ipcMain.removeHandler(KAIRO_INVOKE.chatSaveDraft);
      ipcMain.handle(KAIRO_INVOKE.chatSaveDraft,async(_event,value:{sessionId:string;revision:number;data:TaskDraftInput})=>{
        draftWrites++;await new Promise(resolve=>setTimeout(resolve,700));return saveTaskDraft(value.sessionId,value.revision,value.data);
      });
      runId=createRun(task.id,'workbench','Synthetic instance ownership probe').id;
      fs.writeFileSync(path.join(output,'bootstrap-primary-ready.json'),JSON.stringify({ready:true}));
      const finish=setInterval(()=>{
        if(!fs.existsSync(path.join(output,'bootstrap-secondary-finished')))return;
        clearInterval(finish);
        try {
          assert(getRunById(runId!)?.status==='running','rejected secondary process cannot cancel the owner execution');
          assert(app.hasSingleInstanceLock(),'primary retains the application instance lock');
          void window.webContents.executeJavaScript(`{
            const input=document.querySelector('.input-textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Synthetic unsent draft for quit');
            input.dispatchEvent(new Event('input',{bubbles:true}));
          }`).then(()=>app.quit()).catch(error=>{report(false,String(error));app.exit(1);});
        } catch(error) {report(false,String(error));app.exit(1);}
      },25);
    })().catch(error=>{report(false,String(error));app.exit(1);}).finally(()=>{busy=false;});
  },25);
}
