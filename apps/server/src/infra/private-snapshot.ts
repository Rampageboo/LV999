import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {Vault} from './vault.js';

const Header=z.object({format:z.literal('lv999-private-snapshot-v1'),id:z.uuid(),created_at:z.iso.datetime(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type SnapshotReceipt=z.infer<typeof Header>;
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
// Immutable encrypted files contain no plaintext source titles, IDs or tokens. Keys live in WinCred.
// Recovery requires BOTH this directory and the current user's snapshot-key credential.
export class PrivateSnapshots{
 constructor(private directory:string,private vault:Vault){}
 async save(payload:unknown):Promise<SnapshotReceipt>{
  const plaintext=Buffer.from(JSON.stringify(payload));if(plaintext.length>50_000_000)throw new Error('SNAPSHOT_TOO_LARGE');
  const header=Header.parse({format:'lv999-private-snapshot-v1',id:randomUUID(),created_at:new Date().toISOString(),sha256:hash(plaintext)});
  const key=randomBytes(32),iv=randomBytes(12),aad=Buffer.from(JSON.stringify(header));
  try{
   await this.vault.write(`snapshot-key/${header.id}`,key.toString('base64'));
   const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
   const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
   await mkdir(this.directory,{recursive:true});
   await writeFile(join(this.directory,`${header.id}.json`),JSON.stringify({header,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{flag:'wx',mode:0o600});
   // Verify recoverability before returning a usable receipt.
   await this.read(header);return header;
  }finally{plaintext.fill(0);key.fill(0);}
 }
 async read(receipt:SnapshotReceipt):Promise<unknown>{
  const expected=Header.parse(receipt),file=await readFile(join(this.directory,`${expected.id}.json`),'utf8');
  if(file.length>70_000_000)throw new Error('SNAPSHOT_TOO_LARGE');
  const parsed=z.object({header:Header,iv:z.string(),tag:z.string(),data:z.string()}).strict().parse(JSON.parse(file));
  if(JSON.stringify(parsed.header)!==JSON.stringify(expected))throw new Error('SNAPSHOT_HEADER_MISMATCH');
  const saved=await this.vault.read(`snapshot-key/${expected.id}`);if(!saved)throw new Error('SNAPSHOT_KEY_UNAVAILABLE');
  const key=Buffer.from(saved,'base64');let plaintext:Buffer|undefined;
  try{
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parsed.iv,'base64'));
   decipher.setAAD(Buffer.from(JSON.stringify(expected)));decipher.setAuthTag(Buffer.from(parsed.tag,'base64'));
   plaintext=Buffer.concat([decipher.update(Buffer.from(parsed.data,'base64')),decipher.final()]);
   if(hash(plaintext)!==expected.sha256)throw new Error('SNAPSHOT_HASH_MISMATCH');return JSON.parse(plaintext.toString('utf8'));
  }finally{key.fill(0);plaintext?.fill(0);}
 }
}
