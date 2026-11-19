import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateSnapshots} from '../apps/server/src/infra/private-snapshot.js';
it('recovers an encrypted snapshot and refuses missing keys or modified ciphertext',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lv999-snapshot-')),secrets=new Map<string,string>();
 const vault={read:async(key:string)=>secrets.get(key)??null,write:async(key:string,value:string)=>{secrets.set(key,value);},remove:async()=>{},probe:async()=>true};
 try{
  const snapshots=new PrivateSnapshots(directory,vault),payload={title:'Private project notes',rows:[{text:'source-content-secret'}]},receipt=await snapshots.save(payload);
  const path=join(directory,`${receipt.id}.json`),file=await readFile(path,'utf8');
  expect(file).not.toContain(payload.title);expect(file).not.toContain(payload.rows[0].text);expect(await snapshots.read(receipt)).toEqual(payload);
  const key=secrets.get(`snapshot-key/${receipt.id}`)!;secrets.clear();await expect(snapshots.read(receipt)).rejects.toThrow('SNAPSHOT_KEY_UNAVAILABLE');secrets.set(`snapshot-key/${receipt.id}`,key);
  const parsed=JSON.parse(file);const data=Buffer.from(parsed.data,'base64');data[0]^=1;parsed.data=data.toString('base64');await writeFile(path,JSON.stringify(parsed));
  await expect(snapshots.read(receipt)).rejects.toThrow();
 }finally{await rm(directory,{recursive:true,force:true});}
});
