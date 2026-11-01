import {useCallback,useEffect,useRef,useState} from 'react';
import {createAdaptivePoller} from './adaptivePolling';
export function useAdaptiveResource<T>(key:string,load:()=>Promise<T>,isActive:(value:T)=>boolean){
 const [data,setData]=useState<T>();const [error,setError]=useState('');
 const options=useRef({load,isActive});options.current={load,isActive};
 const poller=useRef<ReturnType<typeof createAdaptivePoller<T>>>();
 useEffect(()=>{
  setData(undefined);setError('');
  const current=createAdaptivePoller({load:()=>options.current.load(),isActive:(value:T)=>options.current.isActive(value),isVisible:()=>document.visibilityState!=='hidden',onValue:(value:T)=>{setData(value);setError('');},onError:reason=>setError(String(reason))});
  poller.current=current;
  const visible=()=>{if(document.visibilityState!=='hidden')current.refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{current.stop();document.removeEventListener('visibilitychange',visible);};
 },[key]);
 const refresh=useCallback(()=>poller.current?.refresh(),[]);
 return {data,error,refresh};
}
