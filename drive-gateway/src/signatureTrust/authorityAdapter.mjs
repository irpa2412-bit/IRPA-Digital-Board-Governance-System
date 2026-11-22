export const AUTHORITY_SOURCES=Object.freeze({
  BOARD:"BOARD", EXECUTIVE:"EXECUTIVE", DELEGATION:"DELEGATION",
  DEPARTMENT:"DEPARTMENT", COMMITTEE:"COMMITTEE", RESOLUTION:"RESOLUTION", POLICY:"POLICY"
});

const AUTHORITY_SOURCE_VALUES=new Set(Object.values(AUTHORITY_SOURCES));

export function normalizeSigningIdentity({uid,email,name,profileType,department,unit,roles=[]}={}) {
  return {
    uid:uid||null,
    email:String(email||"").trim().toLowerCase()||null,
    name:String(name||"").trim()||null,
    profileType:profileType||null,
    department:department||null,
    unit:unit||null,
    roles:[...new Set((Array.isArray(roles)?roles:[roles]).map(v=>String(v||"").trim()).filter(Boolean))]
  };
}

export function buildAuthorityAssertion({
  identity,
  authoritySource,
  authorityReference,
  effectiveAt,
  expiresAt,
  scope=[]
}={}) {
  if(!identity?.uid) throw new Error("Signing authority requires an authenticated institutional identity.");
  if(!AUTHORITY_SOURCE_VALUES.has(authoritySource)) throw new Error("Signing authority source is invalid.");
  if(!authorityReference) throw new Error("Signing authority reference is required.");

  const startMs=new Date(effectiveAt||"").getTime();
  if(!Number.isFinite(startMs)) throw new Error("Signing authority effective time is invalid.");

  const endMs=expiresAt==null?Infinity:new Date(expiresAt).getTime();
  if(!Number.isFinite(endMs)||endMs<startMs) throw new Error("Signing authority validity window is invalid.");

  return Object.freeze({
    uid:identity.uid,
    authoritySource,
    authorityReference,
    effectiveAt:new Date(startMs).toISOString(),
    expiresAt:expiresAt==null?null:new Date(endMs).toISOString(),
    scope:[...new Set((Array.isArray(scope)?scope:[scope]).map(v=>String(v||"").trim()).filter(Boolean))]
  });
}

export function isAuthorityActive(assertion,at=new Date()) {
  if(!assertion?.effectiveAt) return false;
  const t=new Date(at).getTime();
  const start=new Date(assertion.effectiveAt).getTime();
  const end=assertion.expiresAt?new Date(assertion.expiresAt).getTime():Infinity;
  return Number.isFinite(t)&&Number.isFinite(start)&&t>=start&&t<=end;
}
