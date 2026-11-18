import { AsyncLocalStorage } from 'node:async_hooks';
const budgets=new AsyncLocalStorage<AbortSignal>();
export function withinNotionBudget<T>(work:()=>Promise<T>,milliseconds=120000):Promise<T>{return budgets.getStore()?work():budgets.run(AbortSignal.timeout(milliseconds),work);}
export function checkNotionBudget(){budgets.getStore()?.throwIfAborted();}
export function notionRequestSignal(){return budgets.getStore();}
export function budgetedFetch(implementation:typeof fetch):typeof fetch{
  return(input,init)=>{const budget=budgets.getStore();budget?.throwIfAborted();return implementation(input,{...init,...(budget?{signal:init?.signal?AbortSignal.any([budget,init.signal]):budget}:{})});};
}
