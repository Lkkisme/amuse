import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {test} from 'node:test';
import {startLocalServices} from './start-local-services.mjs';

const execute=promisify(execFile);
const launcher=fileURLToPath(new URL('./start-local-services.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const request=url=>fetch(url,{signal:AbortSignal.timeout(2000)});
function fixture(){
  const parent=realpathSync(tmpdir());
  const root=mkdtempSync(join(parent,'amuse-local-service-test-'));
  mkdirSync(join(root,'.local'));
  return {root,cleanup(){
    // Only this test's freshly-created directory may be removed recursively.
    const actual=realpathSync(root),suffix=relative(parent,actual);
    assert.ok(suffix.startsWith('amuse-local-service-test-')&&!suffix.includes(sep)&&!suffix.startsWith('..'));
    rmSync(actual,{recursive:true});
  }};
}
async function server(reply){
  const http=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply));});
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${http.address().port}/health`,close:()=>new Promise(resolve=>http.close(resolve))};
}
function config(root,service){
  writeFileSync(join(root,'.local','local-services.json'),JSON.stringify({version:1,services:[{
    id:'fixture',command:process.execPath,args:['--eval','process.exit(71)'],cwd:root,identity:{service:'fixture'},...service,
  }]}));
}

test('healthy configured service is reused without launching or recording another process',async()=>{
  const owned=fixture(),existing=await server({service:'fixture',version:1});
  try{
    config(owned.root,{healthUrl:existing.url,identity:{service:'fixture',version:1}});
    assert.deepEqual(await startLocalServices(owned.root),[{id:'fixture',reused:true,ready:true}]);
    assert.equal(existsSync(join(owned.root,'.local','service-fixture.json')),false);
  }finally{await existing.close();owned.cleanup();}
});

test('occupied port with a different identity is refused and its existing server is untouched',async()=>{
  const owned=fixture(),existing=await server({service:'some-other-service',version:1});
  const launched=join(owned.root,'unexpected-launch.txt');
  try{
    config(owned.root,{healthUrl:existing.url,args:['--eval',`require('node:fs').writeFileSync(${JSON.stringify(launched)},'unexpected')`]});
    await assert.rejects(startLocalServices(owned.root),/occupied port.*not the configured service/);
    assert.equal(existsSync(launched),false);
    assert.equal(existsSync(join(owned.root,'.local','service-fixture.json')),false);
    assert.equal((await (await request(existing.url)).json()).service,'some-other-service');
  }finally{await existing.close();owned.cleanup();}
});

test('child outlives the PS5 host and Node launcher, owns disk stdout/stderr, and is reused',async()=>{
  const owned=fixture(),token=randomUUID();
  const holder=await server({temporary:true});
  const port=new URL(holder.url).port;
  await holder.close();
  const healthUrl=`http://127.0.0.1:${port}/health`;
  const serviceFile=join(owned.root,'fixture-service.mjs');
  const counter=join(owned.root,'launches.txt');
  const parentFile=join(owned.root,'ps-host-pid.txt');
  let expectedPid;
  writeFileSync(serviceFile,`
import {appendFileSync,fstatSync,writeSync} from 'node:fs';
import {createServer} from 'node:http';
const token=${JSON.stringify(token)};
appendFileSync(${JSON.stringify(counter)},String(process.pid)+'\\n');
const state={service:'fixture',token,pid:process.pid,launcherPid:process.ppid,cwd:process.cwd(),environment:process.env.AMUSE_FIXTURE_VALUE,stdoutIsFile:fstatSync(1).isFile(),stderrIsFile:fstatSync(2).isFile()};
const heartbeat=setInterval(()=>{writeSync(1,'fixture stdout\\n');writeSync(2,'fixture stderr\\n');},50);
const http=createServer((req,res)=>{
 if(req.url==='/shutdown'&&req.method==='POST'&&req.headers['x-fixture-token']===token){clearInterval(heartbeat);res.end('owned fixture stopping');http.close(()=>process.exit(0));return;}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(state));
});
http.listen(${Number(port)},'127.0.0.1');
setTimeout(()=>{clearInterval(heartbeat);http.close(()=>process.exit(0));},45000).unref();
`);
  config(owned.root,{args:[serviceFile],healthUrl,identity:{service:'fixture',token},env:{AMUSE_FIXTURE_VALUE:'独立 fixture value'}});
  try{
    let result;
    if(process.platform==='win32'){
      const powershell=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const quote=value=>`'${value.replaceAll("'","''")}'`;
      const host=join(owned.root,'owned-host.ps1');
      writeFileSync(host,`$ErrorActionPreference='Stop'\n$PID | Set-Content -LiteralPath ${quote(parentFile)} -Encoding ASCII\n& ${quote(process.execPath)} ${quote(launcher)} ${quote(owned.root)}\nexit $LASTEXITCODE\n`);
      result=await execute(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',host],{windowsHide:true,timeout:10000});
    }else result=await execute(process.execPath,[launcher,owned.root],{timeout:10000});
    const started=JSON.parse(result.stdout);
    assert.equal(started.length,1);assert.equal(started[0].reused,false);expectedPid=started[0].pid;
    const recordPath=join(owned.root,'.local','service-fixture.json');
    const record=JSON.parse(readFileSync(recordPath,'utf8'));
    const response=await (await request(healthUrl)).json();
    assert.equal(response.pid,expectedPid);assert.equal(record.pid,expectedPid);
    assert.equal(response.stdoutIsFile,true,'stdout must be a disk handle, not an anonymous pipe');
    assert.equal(response.stderrIsFile,true,'stderr must be a disk handle, not an anonymous pipe');
    assert.equal(resolve(response.cwd),resolve(owned.root));
    assert.equal(response.environment,'独立 fixture value');
    assert.equal(alive(response.launcherPid),false,'short Node launcher must have exited');
    if(process.platform==='win32')assert.equal(alive(Number(readFileSync(parentFile,'ascii').trim())),false,'PS5 parent host must have exited');
    const outputBefore=readFileSync(record.outputPath).length,errorsBefore=readFileSync(record.errorPath).length;
    await delay(200);
    assert.ok(readFileSync(record.outputPath).length>outputBefore,'stdout must continue after parent exit');
    assert.ok(readFileSync(record.errorPath).length>errorsBefore,'stderr must continue after parent exit');
    const recordBefore=readFileSync(recordPath,'utf8');
    assert.deepEqual(await startLocalServices(owned.root),[{id:'fixture',reused:true,ready:true}]);
    assert.equal(readFileSync(counter,'utf8').trim(),String(expectedPid),'reuse must not spawn a duplicate');
    assert.equal(readFileSync(recordPath,'utf8'),recordBefore,'reuse must retain the original process identity');
    assert.equal(alive(expectedPid),true);
  }finally{
    // Stop only the server that presents this fixture's random identity; never
    // signal a PID whose ownership could have changed after a failed assertion.
    try{
      const value=await (await request(healthUrl)).json();
      if(value.token===token&&value.service==='fixture'){
        expectedPid=value.pid;
        await fetch(new URL('/shutdown',healthUrl),{method:'POST',headers:{'x-fixture-token':token},signal:AbortSignal.timeout(2000)});
        for(let attempt=0;attempt<60&&alive(expectedPid);attempt++)await delay(50);
        assert.equal(alive(expectedPid),false,'owned fixture must exit before its files are removed');
      }
    }catch(error){if(error.code==='ERR_ASSERTION')throw error;}
    owned.cleanup();
  }
});
