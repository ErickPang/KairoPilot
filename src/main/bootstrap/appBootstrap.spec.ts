import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({
  lock:true,completedQuits:0,
  listeners:new Map<string,Array<(...args: unknown[])=>void>>(),
  handlers:new Map<string,(event:unknown,value:unknown)=>unknown>(),
  initialize:vi.fn(),start:vi.fn(),stop:vi.fn(),seed:vi.fn(),skillsInitialize:vi.fn(),skillsDispose:vi.fn(),
  createWindow:vi.fn(),paths:vi.fn(),setup:vi.fn(),showError:vi.fn(),send:vi.fn()
}));
vi.mock('electron',()=>({
  app:{
    on:(event:string,callback:(...args:unknown[])=>void)=>{state.listeners.set(event,[...(state.listeners.get(event)||[]),callback]);},
    requestSingleInstanceLock:()=>state.lock,whenReady:async()=>{},getLocale:()=> 'en',dock:{setIcon:vi.fn()},
    quit:()=>{let prevented=false;for(const callback of state.listeners.get('before-quit')||[])callback({preventDefault:()=>{prevented=true;}});if(!prevented)state.completedQuits++;}
  },
  ipcMain:{handle:(channel:string,handler:(event:unknown,value:unknown)=>unknown)=>state.handlers.set(channel,handler)},
  dialog:{showErrorBox:state.showError},BrowserWindow:{getAllWindows:()=>[]}
}));
vi.mock('../services/applicationExecutionLifecycle',()=>({startApplicationConversation:state.start,stopApplicationExecution:state.stop}));
vi.mock('../services/appRuntime',()=>({ensureAppPaths:state.paths,seedBuiltinSkills:state.seed}));
vi.mock('../core/skills/manager',()=>({skillsManager:{initialize:state.skillsInitialize,dispose:state.skillsDispose}}));
vi.mock('../bridge/ipc/setupHandlers',()=>({setupHandlers:state.setup}));
vi.mock('../services/protocolService',()=>({registerKairopilotProtocol:vi.fn()}));
vi.mock('../store/config',()=>({initializeKairoPilotConfig:state.initialize,getAppearanceConfig:()=>({})}));
vi.mock('../services/windowService',()=>({createMainWindow:state.createWindow}));
vi.mock('../services/sentryInit',()=>({initSentry:vi.fn()}));
vi.mock('../services/trayService',()=>({createTrayService:()=>({tray:{}}),disposeTrayService:vi.fn()}));
vi.mock('../services/clipboardMonitor',()=>({startClipboardMonitor:()=>vi.fn()}));
import { KAIRO_INVOKE, KAIRO_EVENT } from '../../shared/ipc';
const context={dirname:'/synthetic',rendererDistPath:'/synthetic',publicPath:'/synthetic'};
beforeEach(()=>{
  vi.resetModules();vi.resetAllMocks();state.listeners.clear();state.handlers.clear();state.lock=true;state.completedQuits=0;
  state.initialize.mockResolvedValue({});state.stop.mockResolvedValue(undefined);state.seed.mockResolvedValue(undefined);state.skillsInitialize.mockResolvedValue(undefined);
  state.paths.mockReturnValue({allowedProtocolRoots:[]});
  state.createWindow.mockReturnValue({isDestroyed:()=>false,webContents:{id:17,send:state.send},show:vi.fn(),focus:vi.fn()});
  vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>vi.restoreAllMocks());
describe('bootstrap and real quit-hook interaction',()=>{
  it('rejects a secondary instance before installing quit hooks or touching execution state',async()=>{
    state.lock=false;const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    expect(state.completedQuits).toBe(1);expect(state.listeners.has('before-quit')).toBe(false);expect(state.handlers.size).toBe(0);
    expect(state.initialize).not.toHaveBeenCalled();expect(state.start).not.toHaveBeenCalled();expect(state.stop).not.toHaveBeenCalled();
  });
  it('completes startup-failure exit without querying the failed runtime or displaying a draft warning',async()=>{
    state.initialize.mockRejectedValue(new Error('Synthetic configuration failure'));
    const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    await vi.waitFor(()=>expect(state.completedQuits).toBe(1));
    expect(state.showError).toHaveBeenCalledTimes(1);expect(state.showError.mock.calls[0][0]).toContain('Startup stopped');
    expect(state.stop).not.toHaveBeenCalled();expect(state.createWindow).not.toHaveBeenCalled();
  });
  it('does not retry a database that failed before execution initialization completed',async()=>{
    state.start.mockImplementation(()=>{throw new Error('Synthetic database failure');});
    const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    await vi.waitFor(()=>expect(state.completedQuits).toBe(1));
    expect(state.stop).not.toHaveBeenCalled();expect(state.showError).toHaveBeenCalledTimes(1);
  });
  it('cleans up initialized execution but still exits when startup cleanup also fails',async()=>{
    state.skillsInitialize.mockRejectedValue(new Error('Synthetic skill initialization failure'));state.stop.mockRejectedValue(new Error('Synthetic cleanup failure'));
    const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    await vi.waitFor(()=>expect(state.completedQuits).toBe(1));
    expect(state.stop).toHaveBeenCalledOnce();expect(state.showError).toHaveBeenCalledTimes(1);expect(state.send).not.toHaveBeenCalled();
  });
  it('never resumes initialization or opens a window after quitting during an asynchronous startup',async()=>{
    let resume!:(value:unknown)=>void;state.initialize.mockImplementation(()=>new Promise(resolve=>{resume=resolve;}));
    const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    await vi.waitFor(()=>expect(state.initialize).toHaveBeenCalledOnce());
    for(const callback of state.listeners.get('activate')||[])callback();expect(state.createWindow).not.toHaveBeenCalled();
    const {app}=await import('electron');app.quit();await vi.waitFor(()=>expect(state.completedQuits).toBe(1));
    resume({});await Promise.resolve();await Promise.resolve();expect(state.start).not.toHaveBeenCalled();expect(state.createWindow).not.toHaveBeenCalled();
  });
  it('retains draft acknowledgement and execution cleanup after a completed startup',async()=>{
    const {bootstrapMainProcess}=await import('./appBootstrap');bootstrapMainProcess(context);
    await vi.waitFor(()=>expect(state.createWindow).toHaveBeenCalledOnce());
    const {app}=await import('electron');app.quit();await vi.waitFor(()=>expect(state.send).toHaveBeenCalledWith(KAIRO_EVENT.appBeforeQuit,expect.anything()));
    expect(state.stop).not.toHaveBeenCalled();expect(state.completedQuits).toBe(0);
    const request=state.send.mock.calls.find(([channel])=>channel===KAIRO_EVENT.appBeforeQuit)![1];
    state.handlers.get(KAIRO_INVOKE.appQuitDraftResponse)!({sender:{id:17}},{id:request.id,saved:true});
    await vi.waitFor(()=>expect(state.completedQuits).toBe(1));expect(state.stop).toHaveBeenCalledOnce();expect(state.skillsDispose).toHaveBeenCalledOnce();
  });
});
