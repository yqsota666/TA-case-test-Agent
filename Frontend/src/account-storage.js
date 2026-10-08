let owner=null;
export function setAccountStorageOwner(id){owner=id;}
export function accountStorageKey(){if(!owner)throw new Error('未登录，不能读取账户草稿');return `case-agent-live-workbench:${owner}`;}
export function accountStorageOwner(){return owner;}
