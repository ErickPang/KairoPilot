import {afterEach,describe,it,expect,vi} from 'vitest';
import {createAdaptivePoller} from './adaptivePolling';
afterEach(()=>vi.useRealTimers());
describe('adaptive intelligence refresh',()=>{
 it('backs off idle work, refreshes active work quickly, and never overlaps calls',async()=>{
  vi.useFakeTimers();let finish:((value:boolean)=>void)|undefined;
  const load=vi.fn<()=>Promise<boolean>>().mockResolvedValue(false);
  const poller=createAdaptivePoller({load,onValue:vi.fn(),onError:vi.fn(),isActive:value=>value,isVisible:()=>true});
  await vi.advanceTimersByTimeAsync(0);expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4999);expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);expect(load).toHaveBeenCalledTimes(2);
  load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await vi.advanceTimersByTimeAsync(1);poller.refresh();poller.refresh();await vi.advanceTimersByTimeAsync(60000);expect(load).toHaveBeenCalledTimes(3);
  load.mockResolvedValue(true);finish!(true);await vi.advanceTimersByTimeAsync(0);expect(load).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1200);expect(load).toHaveBeenCalledTimes(5);poller.stop();
 });
 it('avoids publishing late results after task switch or unmount',async()=>{
  vi.useFakeTimers();let finish:((value:boolean)=>void)|undefined;const onValue=vi.fn();
  const poller=createAdaptivePoller({load:()=>new Promise<boolean>(resolve=>{finish=resolve;}),onValue,onError:vi.fn(),isActive:value=>value,isVisible:()=>true});
  poller.stop();finish!(true);await vi.advanceTimersByTimeAsync(10000);expect(onValue).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('reduces hidden-window activity and wakes immediately on explicit refresh',async()=>{
  vi.useFakeTimers();const load=vi.fn().mockResolvedValue(true);const poller=createAdaptivePoller({load,onValue:vi.fn(),onError:vi.fn(),isActive:()=>true,isVisible:()=>false});
  await vi.advanceTimersByTimeAsync(59999);expect(load).toHaveBeenCalledTimes(1);poller.refresh();await vi.advanceTimersByTimeAsync(0);expect(load).toHaveBeenCalledTimes(2);poller.stop();
 });
 it('backs off after errors without leaving an active timer on dispose',async()=>{
  vi.useFakeTimers();const onError=vi.fn();const load=vi.fn().mockRejectedValue(new Error('offline'));const poller=createAdaptivePoller({load,onValue:vi.fn(),onError,isActive:()=>false,isVisible:()=>true});
  await vi.advanceTimersByTimeAsync(9999);expect(load).toHaveBeenCalledTimes(1);expect(onError).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(load).toHaveBeenCalledTimes(2);poller.stop();expect(vi.getTimerCount()).toBe(0);
 });
});
