export const WEBSITE_MEDIA_TYPES = Object.freeze({
  "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"], "image/gif": [".gif"],
  "image/svg+xml": [".svg"], "video/mp4": [".mp4"], "video/quicktime": [".mov"],
  "video/webm": [".webm"], "audio/mpeg": [".mp3"], "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"]
});
const starts=(b,...s)=>s.every((v,i)=>b[i]===v);
export function sanitizeWebsiteSvg(input) {
  const raw=String(input||"");
  if(raw.length>2*1024*1024||!/^\s*<svg\b/i.test(raw)||/<\s*(script|foreignObject|iframe|object|embed|audio|video)\b/i.test(raw)) throw new Error("SVG contains unsafe or unsupported content.");
  if(/(?:javascript:|data:|https?:|file:|@import|url\s*\()/i.test(raw)||/\bon[a-z]+\s*=/i.test(raw)||/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("SVG external references, entities and event handlers are prohibited.");
  const allowed=new Set(["svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","linearGradient","radialGradient","stop","clipPath","mask","title","desc"]);
  const cleaned=raw.replace(/<\/?([A-Za-z][\w:-]*)\b([^>]*)>/g,(whole,name,attrs)=>{
    if(!allowed.has(name)) return "";
    if(/^<\//.test(whole)) return "</"+name+">";
    const safe=[];
    String(attrs||"").replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,(_m,k,a,b)=>{
      const key=k.toLowerCase(),value=String(a??b??"");
      if(["xmlns","viewbox","width","height","fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","opacity","cx","cy","r","rx","ry","x","y","x1","x2","y1","y2","points","d","transform","offset","stop-color","stop-opacity","id","class","font-size","text-anchor","gradientunits","gradienttransform","clip-rule","fill-rule"].includes(key)&&!/[<>]/.test(value)) safe.push(" "+key+'="'+value.replace(/&/g,"&amp;").replace(/"/g,"&quot;")+'"');
      return "";
    });
    return "<"+name+safe.join("")+( /\/\s*>$/.test(whole)?" />":">");
  });
  if(!/<svg\b/i.test(cleaned)) throw new Error("SVG root element is invalid.");
  return cleaned;
}
export function validateWebsiteMedia({filename,contentType,bytes}) {
  const name=String(filename||"").toLowerCase(),type=String(contentType||"").toLowerCase(),ext=name.slice(name.lastIndexOf("."));
  if(!Object.hasOwn(WEBSITE_MEDIA_TYPES,type)||!WEBSITE_MEDIA_TYPES[type].includes(ext)) throw new Error("File extension and MIME type are not on the permitted media allowlist.");
  if(!bytes?.length) throw new Error("Empty files cannot be uploaded.");
  if(/\.(exe|dll|com|bat|cmd|ps1|sh|php\d*|phtml|phar|cgi|pl|py|js|mjs|html?|htaccess|jar|apk|msi|scr|vbs)$/i.test(name)) throw new Error("Executable and active-content files are prohibited.");
  const b=bytes;
  const valid=type==="image/svg+xml" ? true :
    type==="image/jpeg" ? starts(b,0xff,0xd8,0xff) :
    type==="image/png" ? starts(b,0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a) :
    type==="image/gif" ? ["GIF87a","GIF89a"].includes(new TextDecoder().decode(b.slice(0,6))) :
    type==="image/webp" ? starts(b,0x52,0x49,0x46,0x46)&&new TextDecoder().decode(b.slice(8,12))==="WEBP" :
    type==="application/pdf" ? new TextDecoder().decode(b.slice(0,5))==="%PDF-" :
    ["video/mp4","video/quicktime"].includes(type) ? new TextDecoder().decode(b.slice(4,8))==="ftyp" :
    type==="video/webm" ? starts(b,0x1a,0x45,0xdf,0xa3) :
    type==="audio/mpeg" ? new TextDecoder().decode(b.slice(0,3))==="ID3"||starts(b,0xff,0xfb)||starts(b,0xff,0xf3)||starts(b,0xff,0xf2) :
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(type) ? starts(b,0x50,0x4b,0x03,0x04) : false;
  if(!valid) throw new Error("File signature does not match the declared media type.");
  return {filename:String(filename).replace(/[\\/:*?"<>|\r\n]/g,"-").slice(0,180),contentType:type,size:bytes.byteLength};
}
export async function websiteMediaSha256(bytes) {
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export function validateMediaChunk({uploadId,index,total,dataBase64}) {
  if(!/^[a-f0-9-]{36}$/i.test(String(uploadId||""))||!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>512||index<0||index>=total||!/^[A-Za-z0-9+/]+={0,2}$/.test(String(dataBase64||""))||String(dataBase64||'').length>360000) throw new Error("Invalid media upload chunk.");
  return true;
}
