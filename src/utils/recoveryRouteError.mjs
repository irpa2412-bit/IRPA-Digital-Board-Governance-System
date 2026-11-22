export function formatRecoveryRouteError({status,body={},button,route}) {
  const label=String(button||"Recovery action");
  const path=String(route||"unknown route");
  let message;
  let code;
  if(Number(status)===404 && body?.error==="Not found.") {
    message="Recovery service route missing: "+path;
    code="ROUTE_MISSING";
  } else if(Number(status)===401) {
    message="Not signed in";
    code="NOT_SIGNED_IN";
  } else if(Number(status)===403) {
    message="Not your envelope";
    code="NOT_YOUR_ENVELOPE";
  } else if(Number(status)===503) {
    message="Service unavailable";
    code="SERVICE_UNAVAILABLE";
  } else {
    message=String(body?.error||("Recovery request failed (HTTP "+(status||"unknown")+")."));
    code=String(body?.code||"RECOVERY_REQUEST_FAILED");
  }
  return message+" ("+code+") — Button: "+label+" — Route: "+path;
}
