# Undefined-name and shadowing diagnostic

- Commit: 486300dc71235d1092d4bcbc960b685f04a97f2a
- ESLint exit: 1
- Total reported violations: 11
- no-undef hits: 3
- no-use-before-define hits: 0
- no-shadow hits: 8
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
   440:138  error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow
   807:59   error  'value' is already declared in the upper scope on line 807 column 15   no-shadow
  1251:34   error  'body' is already declared in the upper scope on line 1185 column 9    no-shadow
  1534:66   error  'value' is already declared in the upper scope on line 1534 column 30  no-shadow
  2604:123  error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow
  2698:46   error  'html' is already declared in the upper scope on line 3484 column 10   no-shadow

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/gatewayUrl.js
   3:6   error  '__IRPA_STAGING_BUILD__' is not defined        no-undef
   8:34  error  '__IRPA_DEFAULT_GATEWAY_URL__' is not defined  no-undef
  14:11  error  '__IRPA_STAGING_BUILD__' is not defined        no-undef

/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js
  100:9  error  'ref' is already declared in the upper scope on line 3 column 269  no-shadow
  358:9  error  'ref' is already declared in the upper scope on line 3 column 269  no-shadow

✖ 11 problems (11 errors, 0 warnings)

~~~
