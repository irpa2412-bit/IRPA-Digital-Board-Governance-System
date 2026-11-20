export const EAT_TIME_ZONE="Africa/Dar_es_Salaam";
const pad=value=>String(value).padStart(2,"0");
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function meetingDateTimeToIso(date,time){
 if(!datePattern.test(String(date||""))||!timePattern.test(String(time||"")))throw new Error("Meeting date and time must be valid local EAT values.");
 const [year,month,day]=date.split("-").map(Number),[hour,minute]=time.split(":").map(Number);
 const check=new Date(Date.UTC(year,month-1,day));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error("Meeting date is not a valid calendar date.");
 return new Date(Date.UTC(year,month-1,day,hour-3,minute)).toISOString();
}
export function meetingDateTimeFromIso(value){
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))throw new Error("Meeting timestamp is invalid.");
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:EAT_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const part=type=>parts.find(item=>item.type===type)?.value||"";
 return {date:part("year")+"-"+part("month")+"-"+part("day"),time:part("hour")+":"+part("minute")};
}
export function formatMeetingDateTimeEAT(value){
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return "Time not recorded";
 return new Intl.DateTimeFormat("en-GB",{timeZone:EAT_TIME_ZONE,dateStyle:"medium",timeStyle:"short"}).format(date)+" EAT";
}
export function meetingSchedulePayload({date,startTime,endTime,...meeting}={}){
 const startAt=meetingDateTimeToIso(date,startTime),endAt=meetingDateTimeToIso(date,endTime);
 if(new Date(endAt)<=new Date(startAt))throw new Error("Meeting end time must be later than its start time in EAT.");
 return {...meeting,date,startTime,endTime,startAt,endAt,timeZone:EAT_TIME_ZONE};
}
