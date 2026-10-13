import {workflowScope,workflowFacts} from './durable-workflow.js';
import {discussionSnapshot} from '../../case-agent/src/discussion-context.js';

export function createDiscussionContextReader({transaction}) {
  return (token,input)=>transaction(async db=>{
    const scope=await workflowScope(db,token,input);
    const facts=await workflowFacts(db,scope,token,input);
    const [files]=await db.execute(`SELECT DISTINCT b.status,DATE_FORMAT(b.business_date,'%Y%m%d') AS businessDate,
      f.file_type AS fileType,f.file_name AS fileName,
      EXISTS(SELECT 1 FROM exchange_delivery_packages p WHERE p.workspace_id=b.workspace_id AND p.chat_id=b.chat_id AND p.batch_id=b.id) AS packaged
      FROM case_exchange_plan_bindings k JOIN exchange_batches b ON b.workspace_id=k.workspace_id AND b.chat_id=k.chat_id AND b.id=k.batch_id
      JOIN exchange_files f ON f.workspace_id=b.workspace_id AND f.chat_id=b.chat_id AND f.batch_id=b.id AND f.direction='OUTBOUND'
      WHERE k.workspace_id=? AND k.chat_id=? AND k.case_id=? AND k.plan_version=? ORDER BY businessDate,fileType LIMIT 101`,[...scope.keys,facts.plan?.version??0]);
    facts.fileArtifacts=files.map(f=>({...f,packaged:Boolean(Number(f.packaged))}));
    return discussionSnapshot(facts);
  });
}
