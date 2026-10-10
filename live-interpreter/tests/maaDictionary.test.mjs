import test from "node:test";
import assert from "node:assert/strict";
import {dictionaryTranslate} from "../src/maaDictionary.js";

test("English phrases use dictionary terms and clearly report partial coverage",()=>{
  const result=dictionaryTranslate("Thank you for the water. This is good.","en","maa");
  assert.match(result.translatedText,/Ashe/);
  assert.match(result.translatedText,/enkare/i);
  assert.match(result.translatedText,/sidai/i);
  assert.equal(result.coverage,"partial");
  assert.equal(result.matchedTerms,3);
});

test("Kiswahili terms use the provisional Maa glossary",()=>{
  const result=dictionaryTranslate("Asante kwa maji mengi sana.","sw","maa");
  assert.match(result.translatedText,/ashe/i);
  assert.match(result.translatedText,/enkare/i);
  assert.match(result.translatedText,/oleng/i);
  assert.equal(result.coverage,"partial");
});

test("unrecognised grammar and vocabulary remain unchanged",()=>{
  const input="The committee shall approve the minutes.";
  const result=dictionaryTranslate(input,"en","maa");
  assert.equal(result.translatedText,input);
  assert.equal(result.coverage,"none");
});

test("Maa glossary terms can be looked up in English and Kiswahili",()=>{
  assert.match(dictionaryTranslate("enkare","maa","en").translatedText,/water/i);
  assert.match(dictionaryTranslate("enkare","maa","sw").translatedText,/maji/i);
});
