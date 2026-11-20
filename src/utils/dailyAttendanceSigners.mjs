const clean=value=>String(value??"").trim();
const lower=value=>clean(value).toLowerCase();

/**
 * Creates one independent signing identity per attendance position.
 * Account UIDs are retained as identity metadata for registered participants,
 * but are never used to deduplicate positions. Guests receive an email-link
 * identity scoped to their participant row. The signer ID is the sole
 * duplicate guard; shared email addresses are deliberately allowed.
 */
export function buildDailyAttendanceSignerAssignments(rows=[],date=""){
  const seenSignerIds=new Set();
  return rows.map((row,index)=>{
    const participantId=clean(row?.participantId||row?.id);
    if(!participantId)throw new Error("Every present attendance row must have its own participant ID.");
    const expectedSignerId="ATT-"+clean(date)+"-"+participantId.replace(/[^A-Za-z0-9_-]/g,"-");
    const suppliedSignerId=clean(row?.signerId);
    if(suppliedSignerId&&suppliedSignerId!==expectedSignerId)throw new Error("The attendance signer ID does not match this participant identity.");
    const signerId=expectedSignerId;
    if(seenSignerIds.has(signerId))throw new Error("The daily attendance sheet contains the same signer ID more than once: "+signerId);
    seenSignerIds.add(signerId);
    const accountUid=clean(row?.participantUid||row?.uid||row?.userId);
    const email=lower(row?.email||row?.participantEmail||row?.invitedEmail);
    const name=clean(row?.name||row?.participantName||row?.fullName);
    if(!email)throw new Error("Cannot dispatch attendance signing for "+(name||participantId)+": an email address is required.");
    if(!name||name.startsWith("NAME NOT FOUND"))throw new Error("Cannot dispatch signed attendance: resolve the full name for "+email+" in the meeting participant register first.");
    return {...row,participantId,signerId,signerUid:accountUid||("email-link-"+signerId),accountUid:accountUid||null,identityType:accountUid?"account":"email-link",email,name};
  });
}
