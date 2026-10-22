import assert from "node:assert/strict";
import {test} from "node:test";
import {createHost,type Timers} from "@amuse/core";
import {demoPorts} from "@amuse/demo";
import type {Access} from "./access.ts";
import {listen} from "./server.ts";
import {localServicesStatus} from "./local-services-status.ts";
import type {LocalSearchConfig} from "./local-search.ts";
const voice={url:"http://127.0.0.1:7089/v1",model:"sensevoice-small-int8"};
const search={provider:"searxng",url:"http://127.0.0.1:8889",language:"all",maxResults:8,timeoutMs:20000} satisfies LocalSearchConfig;
test("local status probes identities without disclosing service addresses",async()=>{
 const calls:string[]=[];
 const http=(async(input)=>{const url=String(input);calls.push(url);return new Response(url.endsWith("/health")?JSON.stringify({service:"amuse-local-voice",device:"cpu",pid:123}):"ok");}) as typeof fetch;
 const result=await localServicesStatus(()=>voice,search,http)();
 assert.equal(result.voice.state,"ready");assert.equal(result.search.state,"ready");assert.deepEqual(calls.sort(),["http://127.0.0.1:7089/health","http://127.0.0.1:8889/healthz"]);
 assert.doesNotMatch(JSON.stringify(result),/7089|8889|127\.0|pid/);
});
test("unconfigured and custom voice avoid unsupported health requests",async()=>{
 const http=(async()=>{throw Error("must not call");}) as typeof fetch;
 assert.equal((await localServicesStatus(()=>null,null,http)()).voice.state,"unconfigured");
 assert.equal((await localServicesStatus(()=>({url:"https://speech.example/v1",model:"custom"}),null,http)()).voice.state,"configured");
});
test("wrong service identities and remote health URLs are unavailable",async()=>{
 let requests=0;const http=(async()=>{requests++;return Response.json({service:"different",device:"cpu"});}) as typeof fetch;
 assert.equal((await localServicesStatus(()=>voice,null,http)()).voice.state,"unavailable");
 assert.equal((await localServicesStatus(()=>({...voice,url:"https://speech.example/v1"}),null,http)()).voice.state,"unavailable");
 assert.equal(requests,1);
});
const timers:Timers<number>={set:()=>0,clear:()=>{}};
const access:Access={ready:()=>true,setup:async()=>"",login:async()=>null,valid:(token)=>token==="owner",logout:()=>{},change:async()=>null};
test("local service status requires owner cookie, same origin and GET",async(t)=>{
 let reads=0;const status=localServicesStatus(()=>null,null);
 const server=await listen({session:createHost(demoPorts(timers),{timers}),access,port:0,host:"127.0.0.1",serviceStatus:async()=>{reads++;return status();}});t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.port}/local-services`;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{headers:{cookie:"amuse=owner",origin:"https://foreign.example"}})).status,403);
 assert.equal((await fetch(url,{method:"POST",headers:{cookie:"amuse=owner"}})).status,405);
 const result=await fetch(url,{headers:{cookie:"amuse=owner"}});assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");assert.equal(reads,1);assert.equal((await result.json()).search.state,"unconfigured");
});
