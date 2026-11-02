# Undefined-name and shadowing diagnostic

- Commit: df93b6e6591516f64fe07be83767e670fe645065
- ESLint exit: 1
- Total reported violations: 101
- no-undef hits: 0
- no-use-before-define hits: 0
- no-shadow hits: 101
- Firestore API shadowing hits: 0

## sourceSha256 introduction history
~~~text
dcfa6ccd fix(signature): persist resolved source integrity on envelopes
1aa86600 fix(signature): resolve source integrity without blocking signer drafts
092cc705 fix: require verified source integrity on new envelopes
aa829105 fix: persist verified source bytes on every new Firebase envelope
~~~

~~~text

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/drive-gateway/src/index.js
   122:14   error  'document' is already a global variable                                no-shadow
   440:40   error  'name' is already a global variable                                    no-shadow
   440:138  error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow
   807:59   error  'value' is already declared in the upper scope on line 807 column 15   no-shadow
   882:64   error  'name' is already a global variable                                    no-shadow
   887:18   error  'document' is already a global variable                                no-shadow
   996:307  error  'name' is already a global variable                                    no-shadow
  1168:11   error  'event' is already a global variable                                   no-shadow
  1251:34   error  'body' is already declared in the upper scope on line 1185 column 9    no-shadow
  1534:66   error  'value' is already declared in the upper scope on line 1534 column 30  no-shadow
  1796:9    error  'document' is already a global variable                                no-shadow
  1860:9    error  'status' is already a global variable                                  no-shadow
  2195:9    error  'document' is already a global variable                                no-shadow
  2236:9    error  'document' is already a global variable                                no-shadow
  2438:9    error  'name' is already a global variable                                    no-shadow
  2537:9    error  'name' is already a global variable                                    no-shadow
  2604:123  error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow
  2646:9    error  'name' is already a global variable                                    no-shadow
  2698:46   error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow
  2817:9    error  'document' is already a global variable                                no-shadow
  2946:53   error  'name' is already a global variable                                    no-shadow
  3105:35   error  'document' is already a global variable                                no-shadow
  3474:21   error  'status' is already a global variable                                  no-shadow
  3484:24   error  'status' is already a global variable                                  no-shadow
  3496:9    error  'origin' is already a global variable                                  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/authorizationPolicy.js
  91:9  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/authorizationService.js
  1:7  error  'crypto' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/financeAccountingFunctions.js
   67:19  error  'name' is already a global variable    no-shadow
  136:62  error  'status' is already a global variable  no-shadow
  176:63  error  'name' is already a global variable    no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/grantCrawler.js
   4:7   error  'crypto' is already a global variable  no-shadow
  59:24  error  'name' is already a global variable    no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/index.js
     9:7    error  'crypto' is already a global variable  no-shadow
    25:38   error  'event' is already a global variable   no-shadow
    53:54   error  'module' is already a global variable  no-shadow
   111:42   error  'event' is already a global variable   no-shadow
   124:127  error  'event' is already a global variable   no-shadow
   125:132  error  'event' is already a global variable   no-shadow
   126:126  error  'event' is already a global variable   no-shadow
   127:122  error  'event' is already a global variable   no-shadow
   128:122  error  'event' is already a global variable   no-shadow
   243:11   error  'status' is already a global variable  no-shadow
   434:37   error  'name' is already a global variable    no-shadow
   488:15   error  'status' is already a global variable  no-shadow
   676:9    error  'name' is already a global variable    no-shadow
   794:9    error  'name' is already a global variable    no-shadow
   874:9    error  'name' is already a global variable    no-shadow
   909:9    error  'origin' is already a global variable  no-shadow
   952:25   error  'status' is already a global variable  no-shadow
  1202:9    error  'status' is already a global variable  no-shadow
  1285:9    error  'status' is already a global variable  no-shadow
  1360:9    error  'status' is already a global variable  no-shadow
  1391:9    error  'name' is already a global variable    no-shadow
  1476:9    error  'name' is already a global variable    no-shadow
  1809:11   error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/liveMeeting.js
   5:7  error  'crypto' is already a global variable  no-shadow
  19:9  error  'status' is already a global variable  no-shadow
  63:9  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/meetingAttendanceRegister.js
  3:7  error  'crypto' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/meetingGateway.js
    4:7   error  'crypto' is already a global variable  no-shadow
   11:17  error  'status' is already a global variable  no-shadow
   22:18  error  'status' is already a global variable  no-shadow
  202:9   error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/meetingRecords.js
    3:7   error  'crypto' is already a global variable  no-shadow
   37:24  error  'status' is already a global variable  no-shadow
  245:26  error  'name' is already a global variable    no-shadow
  245:34  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/mfaSecurityAudit.js
  16:9  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/passwordSecurity.js
  4:7  error  'crypto' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/scripts/deploy-staging-firestore-rules.js
  29:13  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/scripts/verify-cloudflare-livekit-token-worker.js
  2:7   error  'crypto' is already a global variable  no-shadow
  9:19  error  'name' is already a global variable    no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/scripts/verify-livekit-control-plane.js
  3:19  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/functions/systemControl.js
  37:29  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/auth.js
  335:9  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/authorizationAccess.js
  56:42  error  'module' is already a global variable  no-shadow
  64:15  error  'module' is already a global variable  no-shadow
  65:12  error  'module' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/authorizationWorkflow.js
   8:10    error  'event' is already a global variable    no-shadow
   8:16    error  'status' is already a global variable   no-shadow
  13:2230  error  'history' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/data.js
   46:150   error  'name' is already a global variable    no-shadow
   53:47    error  'status' is already a global variable  no-shadow
  187:281   error  'origin' is already a global variable  no-shadow
  187:1079  error  'status' is already a global variable  no-shadow
  217:11    error  'status' is already a global variable  no-shadow
  243:1248  error  'name' is already a global variable    no-shadow
  503:39    error  'alert' is already a global variable   no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/functions.js
  7:45  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/meetingRecords.js
  5:14  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/notifications.js
  28:3  error  'module' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/procurement.js
  100:81  error  'name' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js
  100:9   error  'ref' is already declared in the upper scope on line 3 column 269  no-shadow
  358:9   error  'ref' is already declared in the upper scope on line 3 column 269  no-shadow
  369:11  error  'status' is already a global variable                              no-shadow
  396:54  error  'event' is already a global variable                               no-shadow
  435:9   error  'status' is already a global variable                              no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/workflowLinks.js
  37:37  error  'module' is already a global variable  no-shadow
  62:34  error  'module' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/grantPipeline/eligibility.js
  15:27  error  'status' is already a global variable  no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/grantPipeline/validity.js
  10:38  error  'closed' is already a global variable  no-shadow

✖ 101 problems (101 errors, 0 warnings)

~~~
