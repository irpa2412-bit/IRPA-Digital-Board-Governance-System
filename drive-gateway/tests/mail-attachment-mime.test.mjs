import test from "node:test";
import assert from "node:assert/strict";
import {buildMailMimeMessage,MAX_MAIL_ATTACHMENT_BYTES} from "../src/mailDelivery.js";

test("completed signed PDF is sent as a MIME attachment beside readable text and HTML",()=>{
  const bytes=new TextEncoder().encode("%PDF-1.7\nIRPA signed record");
  const mime=buildMailMimeMessage({
    from:'"IRPA Administration" <info@irpa.or.tz>',
    to:"signer@example.org",
    subject:"Completed signed document: Board Resolution",
    text:"The completed signed PDF is attached.",
    html:"<p>The completed signed PDF is attached.</p>",
    attachments:[{filename:"board-resolution-signed.pdf",contentType:"application/pdf",bytes}]
  });
  assert.match(mime,/Content-Type: multipart\/mixed/);
  assert.match(mime,/Content-Type: multipart\/alternative/);
  assert.match(mime,/Content-Disposition: attachment; filename="board-resolution-signed\.pdf"/);
  const encoded=mime.split("Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=")[1].split("\r\n\r\n")[1].split("\r\n\r\n--IRPA-MIXED-")[0].replace(/\r\n/g,"");
  assert.deepEqual(new Uint8Array(Buffer.from(encoded,"base64")),bytes);
});

test("attachment headers reject injection and only permit bounded PDF payloads",()=>{
  const bytes=new Uint8Array([1,2,3]);
  assert.throws(()=>buildMailMimeMessage({from:"IRPA <info@irpa.or.tz>",to:"x@example.org",subject:"safe",text:"x",html:"x",attachments:[{filename:"bad\r\nBcc:evil",contentType:"application/pdf",bytes}]}),/newline/);
  assert.throws(()=>buildMailMimeMessage({from:"IRPA <info@irpa.or.tz>",to:"x@example.org",subject:"safe",text:"x",html:"x",attachments:[{filename:"file.pdf",contentType:"text/plain",bytes}]}),/Only completed PDF/);
  assert.equal(MAX_MAIL_ATTACHMENT_BYTES,12*1024*1024);
});
