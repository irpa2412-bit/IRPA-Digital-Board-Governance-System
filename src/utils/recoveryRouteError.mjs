export function formatRecoveryRouteError({status,body={},requestId,button,route}) {
  const label=String(button||"Recovery action");
  const path=String(route||"unknown route");
  const code=String(body?.code||(
    Number(status)===401?"TOKEN_INVALID":
    Number(status)===403?"NOT_OWNER":
    Number(status)>=500?"PROFILE_LOOKUP_FAILED":"RECOVERY_REQUEST_FAILED"
  ));
  const message=String(body?.error||({
    TOKEN_INVALID:"Firebase ID token is invalid or expired",
    PROFILE_LOOKUP_FAILED:"Owner profile lookup failed",
    NOT_ACTIVATED:"Owner account is not activated",
    NOT_OWNER:"This account is not the envelope owner"
  }[code]||("Recovery request failed (HTTP "+(status||"unknown")+")")));
  const id=String(requestId||body?.requestId||"not supplied");
  return message+" ("+code+") — Request ID: "+id+" — Button: "+label+" — Route: "+path;
}
