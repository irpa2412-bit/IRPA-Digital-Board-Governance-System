import React,{useLayoutEffect,useRef,useState}from"react";
import{fitSignatureImage}from"../utils/signatureImageFit.mjs";

export default function SignatureImagePreview({src,alt="Signature",...props}){
  const imageRef=useRef(null);
  const[fit,setFit]=useState(null);
  useLayoutEffect(()=>{
    const image=imageRef.current;
    if(!image)return;
    const measure=()=>{
      const parent=image.parentElement;
      if(!parent||!image.naturalWidth||!image.naturalHeight)return;
      const style=window.getComputedStyle(parent);
      const width=Math.max(0,parent.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0));
      const height=Math.max(0,parent.clientHeight-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0));
      if(!width||!height)return;
      try{setFit(fitSignatureImage(image.naturalWidth,image.naturalHeight,{x:0,y:0,width,height}));}
      catch{setFit(null);}
    };
    if(image.complete)measure();
    image.addEventListener("load",measure);
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
    if(image.parentElement)observer?.observe(image.parentElement);
    window.addEventListener("resize",measure);
    return()=>{image.removeEventListener("load",measure);observer?.disconnect();window.removeEventListener("resize",measure);};
  },[src]);
  return <img ref={imageRef} src={src} alt={alt} {...props} style={{display:"block",width:fit?fit.width:"auto",height:fit?fit.height:"auto",maxWidth:"100%",maxHeight:"100%",objectFit:"contain",...props.style}}/>;
}
