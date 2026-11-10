export const SOCIAL_PLATFORMS = {
 facebook:{label:"Facebook",characters:63206,hashtags:30,imageBytes:10*1024*1024,videoBytes:4*1024*1024*1024},
 instagram:{label:"Instagram",characters:2200,hashtags:30,imageBytes:30*1024*1024,videoBytes:4*1024*1024*1024},
 linkedin:{label:"LinkedIn",characters:3000,hashtags:5,imageBytes:8*1024*1024,videoBytes:5*1024*1024*1024},
 x:{label:"X",characters:280,hashtags:10,imageBytes:5*1024*1024,videoBytes:512*1024*1024},
 youtube:{label:"YouTube",characters:5000,hashtags:15,imageBytes:2*1024*1024,videoBytes:256*1024*1024*1024},
 whatsapp:{label:"WhatsApp",characters:4096,hashtags:30,imageBytes:16*1024*1024,videoBytes:16*1024*1024}
};
export const SOCIAL_MEDIA_UPLOAD_TYPES=Object.freeze({"image/jpeg":[".jpg",".jpeg"],"image/png":[".png"],"image/webp":[".webp"],"video/mp4":[".mp4"],"application/pdf":[".pdf"]});
export function validateSocialMediaUpload(file,altText){
 const errors=[];
 if(!file)return ["Choose a JPG, PNG, WebP, MP4 or PDF file."];
 const name=String(file.name||"").toLowerCase(),type=String(file.type||"").toLowerCase(),ext=name.slice(name.lastIndexOf("."));
 if(!Object.hasOwn(SOCIAL_MEDIA_UPLOAD_TYPES,type)||!SOCIAL_MEDIA_UPLOAD_TYPES[type].includes(ext))errors.push("Only matching JPG, PNG, WebP, MP4 and PDF files are allowed.");
 if(!Number.isFinite(file.size)||file.size<1||file.size>8*1024*1024)errors.push("Media must be between 1 byte and 8 MB.");
 if(!String(altText||"").trim())errors.push("Alternative text is required before media upload.");
 return errors;
}
export const SOCIAL_STATUSES=["Draft","In review","Approved","Exported"];
export const SOCIAL_TEMPLATES={
 "Project update":["Project update: [verified activity, location, reporting period, evidence and next steps]","Taarifa ya mradi: [shughuli iliyothibitishwa, eneo, kipindi cha taarifa, ushahidi na hatua zinazofuata]"],
 "Impact story":["Impact story: [community-approved context, action, verified result and evidence source]","Hadithi ya matokeo: [muktadha ulioidhinishwa na jamii, hatua, matokeo yaliyothibitishwa na chanzo cha ushahidi]"],
 "Event announcement":["Event announcement: [event, date, venue, purpose and registration details]","Tangazo la tukio: [tukio, tarehe, mahali, madhumuni na maelezo ya usajili]"],
 "Call for partners":["IRPA invites partners to support [priority] in [location]. We seek [specific contribution].","IRPA inakaribisha washirika kusaidia [kipaumbele] katika [eneo]. Tunahitaji [mchango mahususi]."],
 "Donor thank-you":["Thank you [funder] for supporting [activity]. Verified result: [result and evidence].","Asante [mfadhili] kwa kusaidia [shughuli]. Matokeo yaliyothibitishwa: [matokeo na ushahidi]."]
};
const PRIVATE_PATTERNS=[
 {name:"password or credential",pattern:/\b(password|passwd|passcode|api[_ -]?key|access[_ -]?token|secret)\s*[:=]/i},
 {name:"private phone number",pattern:/\b(?:\+?\d[\d ()-]{7,}\d)\b/},
 {name:"email address",pattern:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i},
 {name:"confidential record marker",pattern:/\b(confidential|strictly confidential|private record|medical record|national id|passport number)\b/i}
];
export function inspectSocialText(value){
 const text=String(value||"");
 return PRIVATE_PATTERNS.filter(x=>x.pattern.test(text)).map(x=>x.name);
}
export function validateSocialDraft(draft){
 const errors=[];
 if(!String(draft.title||"").trim())errors.push("Post title is required.");
 if(!String(draft.body||"").trim())errors.push("Post text is required.");
 if(!Array.isArray(draft.platforms)||!draft.platforms.length)errors.push("Select at least one platform.");
 for(const url of [draft.link,draft.mediaUrl].filter(Boolean)){try{if(new URL(url).protocol!=="https:")errors.push("Links and media URLs must use HTTPS.");}catch{errors.push("Enter a valid HTTPS link.");}}
 if(!String(draft.altText||"").trim()&&draft.mediaUrl)errors.push("Alternative text is required for media.");
 const flags=inspectSocialText(draft.body);
 if(flags.length)errors.push("Potentially sensitive content detected: "+flags.join(", ")+". Remove it before saving.");
 for(const platform of draft.platforms||[]){const spec=SOCIAL_PLATFORMS[platform];if(!spec){errors.push("Unsupported platform: "+platform);continue;}if(String(draft.body||"").length>spec.characters)errors.push(spec.label+" text exceeds "+spec.characters+" characters.");const count=(String(draft.hashtags||"").match(/#[\p{L}\p{N}_]+/gu)||[]).length;if(count>spec.hashtags)errors.push(spec.label+" allows at most "+spec.hashtags+" hashtags.");}
 return errors;
}
export function canTransitionSocialStatus(from,to,{isAdmin=false,isAuthor=false,secondApprover=false}={}){
 if(from==="Draft"&&to==="In review")return true;
 if(from==="In review"&&to==="Approved")return (isAdmin||secondApprover)&&!isAuthor;
 if(from==="Approved"&&to==="Exported")return true;
 if(from==="In review"&&to==="Draft")return isAdmin||isAuthor;
 return false;
}
export function socialCalendarCsv(items){
 const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
 return ["title,platforms,status,campaign,plannedAt,lastModified",...(items||[]).map(x=>[x.title,(x.platforms||[]).join(";"),x.status,x.campaignTag,x.scheduledAt,x.updatedAt].map(quote).join(","))].join("\r\n");
}

export function socialCalendarRange(items,date,view="week"){
 const target=new Date(date+"T00:00:00");
 if(Number.isNaN(target.getTime()))return [];
 const start=new Date(target);
 if(view==="week"){const day=(start.getDay()+6)%7;start.setDate(start.getDate()-day);}
 const end=new Date(start);end.setDate(end.getDate()+(view==="day"?1:7));
 return (items||[]).filter(item=>{const value=item.scheduledAt||item.updatedAt;if(!value)return false;const d=new Date(value);return !Number.isNaN(d.getTime())&&d>=start&&d<end;});
}
export function socialCalendarDocxXml(items,date,view){
 const esc=value=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 const paragraphs=["IRPA Social Editorial Calendar",view==="day"?"Day view":"Week view",date,...(items||[]).flatMap(item=>[item.title||"Untitled","Platforms: "+(item.platforms||[]).join(", ")+" | Status: "+(item.status||"")+" | Planned: "+(item.scheduledAt||"Not scheduled")+" | Last modified: "+(item.updatedAt||"Not recorded"),item.content||""])].map(value=>'<w:p><w:r><w:t xml:space="preserve">'+esc(value)+'</w:t></w:r></w:p>').join("");
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr/></w:body></w:document>';
}
