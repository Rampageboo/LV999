import {z} from 'zod';
const Key=z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,31}$/);
export const BoardRef=z.object({project_key:Key}).strict();
export const SetupBoardInput=BoardRef.extend({route_revision:z.number().int().positive()});
export const ReadBoardInput=BoardRef.extend({start_cursor:z.string().max(200).optional()});
export const PostBoardInput=BoardRef.extend({text:z.string().trim().min(1).max(8000),idempotency_key:z.uuid()});
export type MessageBoard={project_key:string;workspace_id:string;root_page_id:string;route_revision:number;page_id:string;url:string|null;enabled:boolean};
