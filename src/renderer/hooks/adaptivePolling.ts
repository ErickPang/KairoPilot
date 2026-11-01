interface Options<T>{load:()=>Promise<T>;onValue:(value:T)=>void;onError:(reason:unknown)=>void;isActive:(value:T)=>boolean;isVisible:()=>boolean}
export function createAdaptivePoller<T>(options:Options<T>){
 let stopped=false;let running=false;let pending=false;let timer:ReturnType<typeof setTimeout>|undefined;let idle=5000;
 const poll=async()=>{
  if(stopped)return;
  if(running){pending=true;return;}
  running=true;clearTimeout(timer);let delay=idle;
  try{
   const value=await options.load();if(stopped)return;
   options.onValue(value);
   if(options.isActive(value)){idle=5000;delay=1200;}else{delay=idle;idle=Math.min(30000,idle*2);}
  }catch(reason){if(!stopped)options.onError(reason);idle=Math.min(30000,idle*2);delay=idle;}
  finally{
   running=false;
   if(!stopped){const next=pending?0:options.isVisible()?delay:60000;pending=false;timer=setTimeout(()=>void poll(),next);}
  }
 };
 void poll();
 return {refresh:()=>{if(stopped)return;idle=5000;clearTimeout(timer);void poll();},stop:()=>{stopped=true;clearTimeout(timer);}};
}
