// Provisional dictionary-assisted Maa substitutions. Not a grammar-aware translator.
export const MAA_TERMS = [
  { maa:"ashe", en:["thank you","thanks"], sw:["asante"], enMeaning:"thank you / thanks", swMeaning:"asante" },
  { maa:"enkare", en:["water"], sw:["maji"], enMeaning:"water", swMeaning:"maji" },
  { maa:"Enkai", en:["god"], sw:["mungu"], enMeaning:"God / the divine", swMeaning:"Mungu" },
  { maa:"oleng", en:["very","much"], sw:["sana","mno"], enMeaning:"very / much", swMeaning:"sana / mno" },
  { maa:"sidai", en:["good","beautiful","well"], sw:["nzuri","vizuri"], enMeaning:"good / beautiful / well", swMeaning:"nzuri / vizuri" },
  { maa:"supa", en:[], sw:[], enMeaning:"context-specific greeting used for a man", swMeaning:"salamu ya muktadha kwa mwanaume" },
  { maa:"tash", en:[], sw:[], enMeaning:"context-specific greeting used for a woman", swMeaning:"salamu ya muktadha kwa mwanamke" }
];

function replaceTerm(text,term,replacement){
  const pattern=term.replaceAll(" ","\\s+");
  return text.replace(new RegExp("(^|[^\\p{L}])("+pattern+")(?=$|[^\\p{L}])","giu"),(match,prefix,word)=>prefix+(word[0]===word[0].toUpperCase()?replacement.charAt(0).toUpperCase()+replacement.slice(1):replacement));
}

export function dictionaryTranslate(content,source,target){
  let output=String(content||""),matched=0;
  const entries=[...MAA_TERMS].sort((a,b)=>Math.max(...b.en.map(x=>x.length),...b.sw.map(x=>x.length),b.maa.length)-Math.max(...a.en.map(x=>x.length),...a.sw.map(x=>x.length),a.maa.length));
  if(target==="maa"){
    for(const entry of entries){
      const synonyms=[...(source==="sw"?entry.sw:entry.en)];
      for(const term of synonyms){const before=output;output=replaceTerm(output,term,entry.maa);if(output!==before)matched++;}
    }
  }else{
    for(const entry of entries){
      const terms=source==="maa"?[entry.maa]:[];
      for(const term of terms){const before=output;output=replaceTerm(output,term,target==="sw"?entry.swMeaning:entry.enMeaning);if(output!==before)matched++;}
    }
  }
  return {translatedText:output,matchedTerms:matched,coverage:matched?"partial":"none"};
}
