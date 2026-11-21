import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import{join}from'node:path';
import{prepareManagedMcp}from'../apps/server/src/infra/managed-mcp.js';
import{spawnSync}from'node:child_process';
it('keeps the MCP entry stable while atomically selecting complete immutable runtime bundles',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lv999-managed-')),runtime=join(directory,'packaged'),data=join(directory,'data');
 try{await mkdir(runtime);await Promise.all([writeFile(join(runtime,'lv999-node.exe'),'fixture-node-v1'),writeFile(join(runtime,'backend.mjs'),'fixture-backend-v1'),writeFile(join(runtime,'credential-vault.ps1'),'fixture-vault-v1')]);const first=await prepareManagedMcp(data,runtime),pointerPath=join(data,'managed-mcp','current.json'),before=JSON.parse(await readFile(pointerPath,'utf8'));
  await writeFile(join(runtime,'backend.mjs'),'fixture-backend-v2');const second=await prepareManagedMcp(data,runtime),after=JSON.parse(await readFile(pointerPath,'utf8'));expect(second).toEqual(first);expect(after.bundle).not.toBe(before.bundle);expect(await readFile(join(data,'managed-mcp','bundles',before.bundle,'backend.mjs'),'utf8')).toBe('fixture-backend-v1');expect(await readFile(join(data,'managed-mcp','bundles',after.bundle,'backend.mjs'),'utf8')).toBe('fixture-backend-v2');
  await writeFile(join(runtime,'lv999-node.exe'),'fixture-node-v2');expect(await prepareManagedMcp(data,runtime)).toEqual(first);expect(JSON.parse(await readFile(pointerPath,'utf8')).node_sha256).not.toBe(after.node_sha256);
  await writeFile(first.mcp_entry,'tampered');await expect(prepareManagedMcp(data,runtime)).rejects.toThrow('MANAGED_RUNTIME_CONFLICT');
 }finally{await rm(directory,{recursive:true,force:true});}
});
it('launches the newly selected backend through the unchanged managed entry and preserves MCP arguments',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lv999-managed-launch-')),runtime=join(directory,'runtime'),data=join(directory,'data');
 try{await mkdir(runtime);await writeFile(join(runtime,'lv999-node.exe'),await readFile(process.execPath));await writeFile(join(runtime,'credential-vault.ps1'),'fixture');
  const backend=(version:string)=>`process.stdout.write(JSON.stringify({version:${JSON.stringify(version)},args:process.argv.slice(2)}));`;
  await writeFile(join(runtime,'backend.mjs'),backend('first'));const entry=await prepareManagedMcp(data,runtime);const run=()=>{const result=spawnSync(entry.mcp_executable,[entry.mcp_entry,'mcp','--read-scoped','--boards-only'],{encoding:'utf8',windowsHide:true});expect(result.status).toBe(0);return JSON.parse(result.stdout);};
  expect(run()).toEqual({version:'first',args:['mcp','--read-scoped','--boards-only']});await writeFile(join(runtime,'backend.mjs'),backend('second'));expect(await prepareManagedMcp(data,runtime)).toEqual(entry);expect(run().version).toBe('second');
 }finally{await rm(directory,{recursive:true,force:true});}
});
