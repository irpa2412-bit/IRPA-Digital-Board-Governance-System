const pairs = {
 funderUpdate:{en:"Funder update: [project, period, verified progress, evidence, next steps]",sw:"Taarifa kwa mfadhili: [mradi, kipindi, maendeleo yaliyothibitishwa, ushahidi, hatua zinazofuata]"},
 donorThankYou:{en:"Donor appreciation: [donor, approved contribution description, result, acknowledgement]",sw:"Shukrani kwa mfadhili: [mfadhili, mchango ulioidhinishwa, matokeo, shukrani]"},
 projectStory:{en:"Project story: [community consent, context, activity, verified outcome, participant voice, credit]",sw:"Hadithi ya mradi: [ridhaa ya jamii, muktadha, shughuli, matokeo yaliyothibitishwa, maoni ya mshiriki, sifa]"},
 eventReport:{en:"Event report: [event, date, organizers, attendance evidence, outcomes, photos with consent]",sw:"Ripoti ya tukio: [tukio, tarehe, waandaaji, ushahidi wa mahudhurio, matokeo, picha zenye ridhaa]"},
 partnerCall:{en:"Partner call: [challenge, shared objective, requested contribution, contact, deadline]",sw:"Wito wa ushirikiano: [changamoto, lengo la pamoja, mchango unaohitajika, mawasiliano, tarehe ya mwisho]"},
 impactSnapshot:{en:"Impact snapshot: [baseline, current measure, period, method, evidence, limitations]",sw:"Muhtasari wa matokeo: [hali ya awali, kipimo cha sasa, kipindi, mbinu, ushahidi, mapungufu]"}
};
export function getCommunicationsTemplate(type,language="en"){return pairs[type]?.[language]||null;}
export const COMMUNICATION_TEMPLATE_TYPES=Object.keys(pairs);
