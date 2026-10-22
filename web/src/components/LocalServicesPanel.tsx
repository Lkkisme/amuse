import {useEffect,useState} from "react";
import {Mic,Search} from "lucide-react";
import {useT} from "../i18n/react.ts";
type Service={state:"ready"|"unavailable"|"unconfigured"|"configured";provider:string|null;local:boolean};
type Status={voice:Service;search:Service};
const isService=(value:unknown):value is Service=>!!value&&typeof value==="object"&&"state" in value&&["ready","unavailable","unconfigured","configured"].includes(String(value.state));
export function LocalServicesPanel(){
  const t=useT();const [status,setStatus]=useState<Status|null>(null);
  useEffect(()=>{const stop=new AbortController();void fetch("/local-services",{credentials:"same-origin",signal:stop.signal}).then(async response=>response.ok?response.json():null).then((value:unknown)=>{
    if(value&&typeof value==="object"&&"voice" in value&&"search" in value&&isService(value.voice)&&isService(value.search))setStatus({voice:value.voice,search:value.search});
  }).catch(()=>{});return()=>stop.abort();},[]);
  if(!status)return null;
  return <section className="shrink-0 px-5 pb-4 sm:px-6" aria-label={t.localServices.title}>
    <h3 className="mb-2 text-[13px] font-medium" style={{color:"var(--text-secondary)"}}>{t.localServices.title}</h3>
    <div className="divide-y divide-[var(--fill-divider)] rounded-[18px] px-4" style={{background:"var(--fill-secondary)"}}>
      {([{key:"voice",title:t.localServices.voice,detail:t.localServices.voiceHelp,icon:<Mic size={18}/>},{key:"search",title:t.localServices.search,detail:t.localServices.searchHelp,icon:<Search size={18}/>} ] as const).map(row=><div key={row.key} className="flex items-center gap-3 py-3">
        <span style={{color:"var(--icon-secondary)"}}>{row.icon}</span><div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{row.title}</p><p className="mt-0.5 text-[12px]" style={{color:"var(--text-secondary)"}}>{row.detail}</p></div>
        <span className="shrink-0 text-[12px]" style={{color:status[row.key].state==="ready"?"var(--fill-green)":"var(--text-secondary)"}}>{t.localServices.states[status[row.key].state]}</span>
      </div>)}
    </div>
  </section>;
}
