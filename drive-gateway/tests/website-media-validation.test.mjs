import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWebsiteMedia,sanitizeWebsiteSvg,validateMediaChunk,websiteMediaSha256} from '../src/websiteMedia.mjs';
const bytes=(...v)=>new Uint8Array(v);
test('accepts permitted signatures and rejects spoofing',()=>{assert.equal(validateWebsiteMedia({filename:'a.jpg',contentType:'image/jpeg',bytes:bytes(255,216,255)}).size,3);assert.throws(()=>validateWebsiteMedia({filename:'a.png',contentType:'image/png',bytes:bytes(1,2,3)}),/signature/);assert.throws(()=>validateWebsiteMedia({filename:'x.exe',contentType:'image/jpeg',bytes:bytes(255,216,255)}));});
test('sanitises SVG and blocks scripts, handlers and external references',()=>{const clean=sanitizeWebsiteSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><rect onclick="x()"/></svg>');assert.match(clean,/<svg/);assert.doesNotMatch(clean,/<script|onclick/);assert.throws(()=>sanitizeWebsiteSvg('<svg><image href="https://evil.test"/></svg>'),/external references/);});
test('chunk manifest validates bounded chunk metadata',()=>{const id='123e4567-e89b-12d3-a456-426614174000';assert.equal(validateMediaChunk({uploadId:id,index:0,total:2,dataBase64:'YWJj'}),true);assert.throws(()=>validateMediaChunk({uploadId:id,index:2,total:2,dataBase64:'YWJj'}),/Invalid media upload chunk/);});
test('media register SHA-256 is a stable digest',async()=>{const hash=await websiteMediaSha256(new TextEncoder().encode('IRPA'));assert.match(hash,/^[a-f0-9]{64}$/);});
