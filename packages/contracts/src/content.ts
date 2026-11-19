import { z } from 'zod';

const Id=z.uuid().transform(value=>value.toLowerCase());
const Version=z.string().min(1).max(100);
export const ContentTarget=z.object({workspace_id:Id.optional(),project_key:z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,31}$/).optional(),
  project_name:z.string().trim().min(1).max(80).optional(),route_revision:z.number().int().positive().optional()}).strict()
  .refine(value=>[value.workspace_id,value.project_key,value.project_name].filter(Boolean).length===1,'Choose exactly one Workspace or project')
  .refine(value=>value.workspace_id?value.route_revision===undefined:value.route_revision!==undefined,'Project writes require the current route revision');
const JsonObject=z.record(z.string().min(1).max(200),z.json()).refine(value=>JSON.stringify(value).length<=64000,'JSON is too large');
const Blocks=z.array(JsonObject).min(1).max(100);
const EmojiIcon=z.object({type:z.literal('emoji'),emoji:z.string().min(1).max(32)}).strict();
export const ContentOperation=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('create_page'),parent_page_id:Id,title:z.string().trim().min(1).max(1000),text:z.string().max(16000).default(''),icon:EmojiIcon.optional()}).strict(),
  z.object({kind:z.literal('update_page'),page_id:Id,expected_last_edited_time:Version,title:z.string().trim().min(1).max(1000).optional(),properties:JsonObject.optional()}).strict(),
  z.object({kind:z.literal('append_blocks'),page_id:Id,expected_last_edited_time:Version,blocks:Blocks}).strict(),
  z.object({kind:z.literal('update_block'),page_id:Id,block_id:Id,expected_last_edited_time:Version,body:JsonObject}).strict(),
  z.object({kind:z.literal('delete_block'),page_id:Id,block_id:Id,expected_last_edited_time:Version}).strict(),
  z.object({kind:z.literal('trash_page'),page_id:Id,expected_last_edited_time:Version}).strict(),
  z.object({kind:z.literal('restore_page'),page_id:Id,expected_last_edited_time:Version}).strict(),
  z.object({kind:z.literal('create_database'),parent_page_id:Id,title:z.string().trim().min(1).max(1000),properties:JsonObject}).strict(),
  z.object({kind:z.literal('create_data_source'),database_id:Id,title:z.string().trim().min(1).max(1000),properties:JsonObject}).strict(),
  z.object({kind:z.literal('update_data_source'),data_source_id:Id,expected_last_edited_time:Version,title:z.string().trim().min(1).max(1000).optional(),properties:JsonObject}).strict(),
  z.object({kind:z.literal('create_record'),data_source_id:Id,properties:JsonObject,text:z.string().max(16000).default(''),icon:EmojiIcon.optional()}).strict(),
  z.object({kind:z.literal('update_record'),page_id:Id,expected_last_edited_time:Version,properties:JsonObject}).strict(),
  z.object({kind:z.literal('create_view'),data_source_id:Id,name:z.string().trim().min(1).max(100),view_type:z.enum(['table','list','board','calendar','gallery','timeline']).default('table'),filter:JsonObject.optional()}).strict(),
  z.object({kind:z.literal('upload_file'),page_id:Id,expected_last_edited_time:Version,filename:z.string().regex(/^[^\\/:\x00-\x1f]{1,120}$/),
    content_type:z.enum(['text/plain','image/png','image/jpeg','application/pdf','application/octet-stream']),base64:z.string().min(1).max(2800000)}).strict(),
]);
export const MutationRequest=z.object({target:ContentTarget,operation:ContentOperation,idempotency_key:Id}).strict();
export const ExecuteMutationInput=MutationRequest.extend({approval:z.object({plan_id:Id,plan_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()});
export const ContentReadInput=z.object({workspace_id:Id,kind:z.enum(['page_tree','block_children','database','data_source','query','databases','markdown','views']),
  resource_id:Id.optional(),start_cursor:z.string().max(200).optional(),filter:JsonObject.optional(),max_depth:z.number().int().min(0).max(8).default(2)}).strict();
export type Mutation=z.infer<typeof MutationRequest>;
export type MutationOp=z.infer<typeof ContentOperation>;
export type ContentRead=z.infer<typeof ContentReadInput>;
export type ContentCaller={actor:'human'|'claude'|'codex'|'mcp';write_workspace_ids:string[]|'owner';project_keys?:string[];
  limited_board?:{append_page_id?:string;create_parent_id?:string;validate:()=>void}};
export type MutationResult={id:string;url:string|null;last_edited_time:string|null;kind:MutationOp['kind'];readback_verified:boolean;details:Record<string,unknown>};
export type MutationPlan={id:string;hash:string;workspace_id:string;project_key:string|null;operation:MutationOp['kind'];resource_id:string;
  title:string;version:string|null;destructive:boolean;expires_at:string;summary:string};
