import test from "node:test";
import assert from "node:assert/strict";
import { assessForwardedSignerName } from "../src/signing.mjs";

test("forwarded signer name matching ignores professional and courtesy titles",()=>{
  assert.equal(assessForwardedSignerName("Prof. Dr. Daniel Estomihi Mollel","Daniel Mollel").matched,true);
  assert.equal(assessForwardedSignerName("Mr Daniel Estomihi Mollel","Daniel E Mollel").matched,true);
  assert.equal(assessForwardedSignerName("Professor Daniel Estomihi Mollel","Daniel Esto Mollel").matched,true);
});

test("forwarded signer name matching accepts omitted, abbreviated, reordered and slightly misspelled middle or name tokens",()=>{
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Daniel Mollel").matched,true);
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Daniel E Mollel").matched,true);
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Mollel Daniel").matched,true);
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Danie Estomihi Mollel").matched,true);
  assert.equal(assessForwardedSignerName("Jane Elizabeth Naserian","Jane E. Naserian").matched,true);
});

test("forwarded signer matching still requires the assigned first and last name anchors",()=>{
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Daniel Estomihi").matched,false);
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Peter James Smith").matched,false);
  assert.equal(assessForwardedSignerName("Daniel Estomihi Mollel","Daniel").matched,false);
});
