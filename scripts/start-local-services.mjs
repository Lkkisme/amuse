/** Optional owner-configured CPU services; children own their log file handles. */
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,openSync,closeSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
function address(raw){
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.hash)throw new Error('Local service health address must be loopback HTTP(S).');
  if(url.hostname==='localhost')url.hostname='127.0.0.1';
  return url;
}
async function health(service){
  try{
    const response=await fetch(address(service.healthUrl),{redirect:'manual',signal:AbortSignal.timeout(1500)});
    if(response.status!==200||Number(response.headers.get('content-length')??0)>65536)return false;
    const body=await response.text();if(body.length>65536)return false;
    const value=JSON.parse(body);
    return Object.entries(service.identity).every(([key,expected])=>value[key]===expected);
  }catch{return false;}
}
async function listening(url){
  return new Promise((resolve,reject)=>{
    const socket=createConnection({host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||(url.protocol==='https:'?443:80))});
    const done=(error,result)=>{socket.destroy();error?reject(error):resolve(result);};
    socket.once('connect',()=>done(null,true));
    socket.once('error',error=>error.code==='ECONNREFUSED'?done(null,false):done(new Error('Cannot verify local service port.')));
    socket.setTimeout(1500,()=>done(new Error('Local service port check timed out.')));
  });
}
function valid(service,root){
  if(!service||!/^[a-z][a-z0-9-]{0,39}$/.test(service.id))throw new Error('Invalid local service id.');
  if(!isAbsolute(service.command)||!statSync(service.command).isFile()||!Array.isArray(service.args)||service.args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw new Error('Invalid local service command.');
  if(!isAbsolute(service.cwd??root)||!statSync(service.cwd??root).isDirectory())throw new Error('Invalid local service working directory.');
  if(!service.identity||typeof service.identity!=='object'||!Object.keys(service.identity).length||Object.values(service.identity).some(v=>!['string','number','boolean'].includes(typeof v)))throw new Error('Local service identity is required.');
  for(const [key,value] of Object.entries(service.env??{}))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||typeof value!=='string'||value.includes('\0'))throw new Error('Invalid local service environment.');
  address(service.healthUrl);
}
function save(path,value){const temporary=`${path}.${randomUUID()}.tmp`;writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600});renameSync(temporary,path);}

export async function startLocalServices(root){
  if(!isAbsolute(root))throw new Error('Workspace root must be absolute.');
  const configPath=join(root,'.local','local-services.json');
  if(!existsSync(configPath))return [];
  const config=read(configPath);
  if(config.version!==1||!Array.isArray(config.services)||config.services.length>8)throw new Error('Invalid local services configuration.');
  const ids=new Set();for(const service of config.services){valid(service,root);if(ids.has(service.id))throw new Error('Duplicate local service id.');ids.add(service.id);}
  const logDirectory=join(root,'.local','logs');mkdirSync(logDirectory,{recursive:true});
  const result=[];
  for(const service of config.services){
    if(await health(service)){result.push({id:service.id,reused:true,ready:true});continue;}
    if(await listening(address(service.healthUrl)))throw new Error(`Service ${service.id} has an occupied port but is not the configured service; it was left untouched.`);
    const stamp=`${Date.now()}-${randomUUID().slice(0,8)}`;
    const outputPath=join(logDirectory,`${service.id}-${stamp}.stdout.log`),errorPath=join(logDirectory,`${service.id}-${stamp}.stderr.log`);
    const output=openSync(outputPath,'ax',0o600);let errors;
    let child;
    try{
      errors=openSync(errorPath,'ax',0o600);
      child=spawn(service.command,service.args,{cwd:service.cwd??root,env:{...process.env,...service.env},detached:true,windowsHide:true,stdio:['ignore',output,errors]});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      child.unref();
    }finally{closeSync(output);if(errors!==undefined)closeSync(errors);}
    const record={id:service.id,pid:child.pid,started:new Date().toISOString(),command:service.command,argumentsSha256:createHash('sha256').update(JSON.stringify(service.args)).digest('hex'),healthUrl:service.healthUrl,outputPath,errorPath};
    save(join(root,'.local',`service-${service.id}.json`),record);
    const deadline=Date.now()+30000;
    while(!await health(service)){
      if(child.exitCode!==null)throw new Error(`Service ${service.id} exited during startup; see its local log.`);
      if(Date.now()>deadline)throw new Error(`Service ${service.id} is not ready yet; its recorded process was left running.`);
      await pause(250);
    }
    result.push({id:service.id,pid:child.pid,reused:false,ready:true});
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await startLocalServices(process.argv[2])));}
  catch(error){console.error(error instanceof Error?error.message:'Local services could not start.');process.exitCode=1;}
}
