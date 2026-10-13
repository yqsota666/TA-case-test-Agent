import test from 'node:test';
import assert from 'node:assert/strict';
import {setAccountStorageOwner} from '../src/account-storage.js';
import {catalogStorageKey,emptyFilters,initialCatalogQuery,readCatalogState,validCatalogFilters,writeCatalogState} from '../src/catalog-query-state.js';
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};};
test('saved query state is account/resource scoped and corrupt storage has a usable fallback',()=>{
  const storage=memory();setAccountStorageOwner('owner-a');const a=catalogStorageKey('files');
  writeCatalogState(storage,a,{q:'file'});setAccountStorageOwner('owner-b');assert.notEqual(catalogStorageKey('files'),a);
  assert.equal(readCatalogState(storage,catalogStorageKey('files'),null),null);
  storage.setItem(a,'broken');assert.equal(readCatalogState(storage,a,null),null);
  assert.equal(writeCatalogState({setItem:()=>{throw new Error();}},a,{}),false);
});
test('refresh restores applied conditions while broken filter trees reset safely',()=>{
  globalThis.location={search:''};const storage=memory();setAccountStorageOwner('owner');
  writeCatalogState(storage,catalogStorageKey('files'),{q:'OFD',filters:{combinator:'and',rules:[null]}});
  const query=initialCatalogQuery('files',storage);assert.equal(query.q,'OFD');assert.deepEqual(query.filters,emptyFilters());
  assert.equal(validCatalogFilters({combinator:'or',rules:[{field:'status',operator:'eq',value:'READY'}]}),true);
  assert.equal(validCatalogFilters({rules:{}}),false);
});
