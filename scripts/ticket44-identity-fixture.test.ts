import {test,expect} from "bun:test";
import {checkLocalURL,validateKey} from "./ticket44-identity-fixture";
test("only dedicated loopback endpoint is admitted",()=>{
  checkLocalURL("http://127.0.0.1:18444");
  for(const bad of ["https://127.0.0.1:18444","http://localhost:18444","http://127.0.0.1:8545","https://mainnet.base.org","http://secret@127.0.0.1:18444","http://127.0.0.1:18444/?x=1"])
    expect(()=>checkLocalURL(bad)).toThrow();
});
test("DEV metadata cannot silently admit old identities or missing parent approval",()=>{
  const hash="0x"+"ab".repeat(32);
  const key={developmentOnly:true,parentApproved:true,version:3,rules:hash,catalog:hash,manifestSHA256:hash,runtimeCodehash:hash};
  const meta={developmentOnly:true,chainId:31344,rules:hash,catalog:hash,manifestSHA256:hash,verifierCodehash:hash,verifier:"0x0000000000000000000000000000000000001234",game:"0x0000000000000000000000000000000000005678"};
  validateKey(key,meta);
  expect(()=>validateKey({...key,parentApproved:false},meta)).toThrow();
  expect(()=>validateKey(key,{...meta,chainId:8453})).toThrow();
  expect(()=>validateKey(key,{...meta,verifier:"0x7"})).toThrow();
  expect(()=>validateKey(key,{...meta,game:"0x1"})).toThrow();
  expect(()=>validateKey(key,{...meta,verifierCodehash:"0x"+"cd".repeat(32)})).toThrow();
});
