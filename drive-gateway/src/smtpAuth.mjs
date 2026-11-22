// SMTP AUTH PLAIN supports either immediate acceptance or a 334 challenge.
export async function authenticateSmtpPlain({username,password,writeLine,readResponse,command}) {
  const cleanUsername=String(username||"").trim();
  if(!cleanUsername||/[\r\n<>]/.test(cleanUsername)) throw new Error("IRPA SMTP username is invalid.");
  if(!password) throw new Error("IRPA SMTP password is not configured in the deployment environment.");
  const payload=btoa("\0"+cleanUsername+"\0"+password);
  await writeLine("AUTH PLAIN "+payload);
  let response=await readResponse();
  if(response.startsWith("334")) response=await command(payload,"2");
  else if(!response.startsWith("2")) throw new Error("IRPA SMTP authentication was rejected.");
  return response;
}
