import type {LocalSearchConfig} from "./local-search.ts";

export interface LocalServiceStatus { state: "ready" | "unavailable" | "unconfigured" | "configured"; provider: string | null; local: boolean }
export interface LocalServicesStatus { voice: LocalServiceStatus; search: LocalServiceStatus }
type Voice={url:string;model:string}|null;
async function ready(raw:string,path:string,http:typeof fetch,identity?:string):Promise<boolean>{
  try{
    const url=new URL(raw);
    if(!["http:","https:"].includes(url.protocol)||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.username||url.password)return false;
    const response=await http(new URL(path,url.origin),{redirect:"error",signal:AbortSignal.timeout(2000)});
    if(response.status!==200){await response.body?.cancel();return false;}
    if(identity){const body=await response.json() as {service?:unknown;device?:unknown};return body.service===identity&&body.device==="cpu";}
    await response.body?.cancel();return true;
  }catch{return false;}
}
/** Settings receives only service state; addresses, paths and credentials stay on the host. */
export function localServicesStatus(voice:()=>Voice,search:LocalSearchConfig|null,http:typeof fetch=fetch):()=>Promise<LocalServicesStatus>{
  return async()=>{
    const speech=voice();
    const managed=speech?.model==="sensevoice-small-int8";
    const [speechReady,searchReady]=await Promise.all([
      managed?ready(speech.url,"/health",http,"amuse-local-voice"):false,
      search?ready(search.url,"/healthz",http):false,
    ]);
    return {
      voice:{state:!speech?"unconfigured":!managed?"configured":speechReady?"ready":"unavailable",provider:!speech?null:managed?"SenseVoice CPU":"custom",local:!!managed},
      search:{state:!search?"unconfigured":searchReady?"ready":"unavailable",provider:search?"SearXNG":null,local:!!search},
    };
  };
}
