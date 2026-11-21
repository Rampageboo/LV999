import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
// The bootstrap executable and launcher stay fixed. A pointer switches only after the complete
// immutable bundle exists, so existing MCP processes never lock installer-owned runtime files.
const launcher=`import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{dirname,join}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{spawn}from'node:child_process';
const root=dirname(fileURLToPath(import.meta.url)),p=JSON.parse(await readFile(join(root,'current.json'),'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
for(const k of ['bundle','backend_sha256','vault_sha256','node_sha256'])if(!/^[a-f0-9]{64}$/.test(p[k]))throw Error('INVALID_MANAGED_RUNTIME');
const node=join(root,'nodes',p.node_sha256,'lv999-node.exe'),entry=join(root,'bundles',p.bundle,'backend.mjs');
if(hash(await readFile(node))!==p.node_sha256||hash(await readFile(entry))!==p.backend_sha256||hash(await readFile(join(dirname(entry),'credential-vault.ps1')))!==p.vault_sha256)throw Error('MANAGED_RUNTIME_HASH_MISMATCH');
delete process.env.NODE_OPTIONS;delete process.env.NODE_PATH;
if(hash(await readFile(process.execPath))!==p.node_sha256){const child=spawn(node,[fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});process.on('SIGTERM',()=>child.kill());child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));}else await import(pathToFileURL(entry).href);
`;
async function immutable(path:string,bytes:Uint8Array){
 await mkdir(dirname(path),{recursive:true});
 try{await writeFile(path,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(digest(await readFile(path))!==digest(bytes))throw new Error('MANAGED_RUNTIME_CONFLICT');}
}
export async function prepareManagedMcp(data:string,runtime:string){
 const root=join(data,'managed-mcp'),[node,backend,vault]=await Promise.all(['lv999-node.exe','backend.mjs','credential-vault.ps1'].map(name=>readFile(join(runtime,name))));
 const nodeHash=digest(node),backendHash=digest(backend),vaultHash=digest(vault),bundle=digest(Buffer.from(backendHash+vaultHash));
 const executable=join(root,'nodes',nodeHash,'lv999-node.exe'),entry=join(root,'launcher.mjs');
 await immutable(executable,node);await immutable(join(root,'bundles',bundle,'backend.mjs'),backend);await immutable(join(root,'bundles',bundle,'credential-vault.ps1'),vault);await immutable(entry,Buffer.from(launcher));
 const bootstrapPath=join(root,'bootstrap.json');let bootstrap:{executable:string;node_sha256:string};
 try{bootstrap=JSON.parse(await readFile(bootstrapPath,'utf8'));if(!/^[a-f0-9]{64}$/.test(bootstrap.node_sha256)||bootstrap.executable!==join(root,'nodes',bootstrap.node_sha256,'lv999-node.exe')||digest(await readFile(bootstrap.executable))!==bootstrap.node_sha256)throw new Error('INVALID_MCP_BOOTSTRAP');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;bootstrap={executable,node_sha256:nodeHash};await writeFile(bootstrapPath,JSON.stringify(bootstrap),{flag:'wx'});}
 const temporary=join(root,`current-${randomUUID()}.tmp`);await writeFile(temporary,JSON.stringify({bundle,node_sha256:nodeHash,backend_sha256:backendHash,vault_sha256:vaultHash}));await rename(temporary,join(root,'current.json'));
 return{mcp_executable:bootstrap.executable,mcp_entry:entry};
}
