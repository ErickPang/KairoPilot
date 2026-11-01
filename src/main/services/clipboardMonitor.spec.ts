import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const state=vi.hoisted(()=>({read:vi.fn(),send:vi.fn(),enabled:false,focused:true}));
vi.mock('electron',()=>({clipboard:{readText:state.read}}));
import type {BrowserWindow} from 'electron';
import {startClipboardMonitor} from './clipboardMonitor';
const window={isVisible:()=>true,isMinimized:()=>false,isFocused:()=>state.focused,webContents:{send:state.send}} as unknown as BrowserWindow;
beforeEach(()=>{vi.useFakeTimers();state.enabled=false;state.focused=true;state.read.mockReset().mockReturnValue('const synthetic = 123;');state.send.mockReset();});
afterEach(()=>vi.useRealTimers());
describe('clipboard privacy',()=>{
 it('never reads clipboard until explicitly enabled and focused',async()=>{
  const stop=startClipboardMonitor(()=>window,()=>state.enabled);
  await vi.advanceTimersByTimeAsync(1600);expect(state.read).not.toHaveBeenCalled();
  state.enabled=true;state.focused=false;await vi.advanceTimersByTimeAsync(1600);expect(state.read).not.toHaveBeenCalled();
  state.focused=true;await vi.advanceTimersByTimeAsync(1600);expect(state.read).toHaveBeenCalledTimes(1);expect(state.send).toHaveBeenCalledTimes(1);
  state.enabled=false;await vi.advanceTimersByTimeAsync(1600);expect(state.read).toHaveBeenCalledTimes(1);stop();
 });
 it('stops reading after disposal',()=>{state.enabled=true;const stop=startClipboardMonitor(()=>window,()=>state.enabled);stop();vi.advanceTimersByTime(5000);expect(state.read).not.toHaveBeenCalled();});
});
