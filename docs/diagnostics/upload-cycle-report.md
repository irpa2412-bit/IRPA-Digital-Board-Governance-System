# Upload initialization cycle diagnostic report

- Workflow run: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/41237577706
- Commit: 4cb19b3c0730fb2475b99b7a2f0d76889891aa16
- Conclusion at report capture: failure

## GitHub Actions job summary

## Madge circular dependency output
- Finding files
Processed 157 files (1s) (3 warnings)

✔ No circular dependency found!


## Import graph
{
  "components/ControlledDocumentUpload.jsx": [
    "components/controlledDocumentUploadValidation.mjs",
    "components/uploadRuntimeDiagnostics.mjs",
    "firebase/config.js",
    "firebase/data.js",
    "firebase/signatureStorage.js",
    "firebase/workflowLinks.js"
  ],
  "components/DocumentReader.jsx": [
    "firebase/config.js",
    "firebase/signatureStorage.js",
    "utils/documentIntegrity.mjs"
  ],
  "components/SignatureFieldConfirmationPad.jsx": [],
  "components/SignaturePathwaySelfTest.jsx": [
    "firebase/config.js",
    "firebase/signatureStorage.js"
  ],
  "components/controlledDocumentUploadValidation.mjs": [],
  "components/uploadRuntimeDiagnostics.mjs": [],
  "firebase/auth.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/employeeRegistrationEmail.js",
    "firebase/functions.js",
    "firebase/gatewayUrl.js",
    "firebase/invitationWorkflow.js"
  ],
  "firebase/config.js": [
    "firebase/auth.js"
  ],
  "firebase/data.js": [
    "firebase/config.js",
    "firebase/documentLifecycle.js",
    "firebase/employeeRegistrationEmail.js",
    "firebase/functions.js",
    "firebase/gatewayUrl.js",
    "firebase/meetingPolicy.js",
    "firebase/registeredIdentityReconciliation.js"
  ],
  "firebase/documentLifecycle.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/employeeRegistrationEmail.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/functions.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/functions.js",
    "firebase/registeredIdentityReconciliation.js"
  ],
  "firebase/gatewayUrl.js": [],
  "firebase/invitationWorkflow.js": [
    "firebase/config.js",
    "firebase/data.js"
  ],
  "firebase/meetingPolicy.js": [],
  "firebase/registeredIdentityReconciliation.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/signaturePlatform.js": [
    "firebase/config.js",
    "firebase/data.js",
    "firebase/gatewayUrl.js",
    "firebase/signatureStorage.js",
    "firebase/signatureWorkflowPolicy.js",
    "firebase/signerIdentity.js",
    "firebase/workflowLinks.js"
  ],
  "firebase/signatureStorage.js": [
    "firebase/auth.js",
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/signatureWorkflowPolicy.js": [],
  "firebase/signerIdentity.js": [
    "firebase/config.js",
    "firebase/gatewayUrl.js"
  ],
  "firebase/workflowLinks.js": [
    "firebase/config.js"
  ],
  "pages/SignaturePlatform.jsx": [
    "components/ControlledDocumentUpload.jsx",
    "components/SignatureFieldConfirmationPad.jsx",
    "components/SignaturePathwaySelfTest.jsx",
    "firebase/config.js",
    "firebase/data.js",
    "firebase/signaturePlatform.js",
    "firebase/signatureStorage.js",
    "firebase/signerIdentity.js",
    "firebase/workflowLinks.js",
    "utils/documentIntegrity.mjs"
  ],
  "utils/documentIntegrity.mjs": []
}

## Vite build output
[36mvite v7.3.6 [32mbuilding client environment for production...[36m[39m
[33m[1m(!) %VITE_BUILD_COMMIT% is not defined in env variables found in /index.html. Is the variable mistyped?[22m[39m
[33m[1m(!) %VITE_BUILD_TIME% is not defined in env variables found in /index.html. Is the variable mistyped?[22m[39m
transforming...
[33m[plugin vite:esbuild] src/components/SystemResetControl.jsx: [33mDuplicate key "staffPaymentRequests" in object literal[33m
8  |    ["Donor & Grant Reporting",["donorFunders","grantReportingObligations"]]
9  |  ];
10 |  ..."Authorization Requests",workflowActions:"Workflow Actions",staffPaymentRequests:"Staff Payment Requests",members:...
   |                                                                 ^
11 |  
12 |  export default function SystemResetControl(){
[39m
[32m✓[39m 1001 modules transformed.
rendering chunks...
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/node_modules/firebase/firestore/dist/esm/index.esm.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ControlledDocumentUpload.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DepartmentArchiveRegistry.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DepartmentPortalBuilder.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentTranslationWorkspace.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/GrantOpportunityNotifications.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/SignaturePathwaySelfTest.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/auth.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/authorizationWorkflow.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/config.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/data.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/employeeRegistrationEmail.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/functions.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/messaging.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/procurement.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signerIdentity.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaOperations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaStudio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/DocumentLifecycleModule.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ExternalAuditorPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GovernanceWorkspaces.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GrantIntelligencePortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/MeetingRoom.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/SocialMediaAccounts.jsx, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/config.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ControlledDocumentUpload.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DepartmentArchiveRegistry.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DepartmentPortalBuilder.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentReader.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentTranslationWorkspace.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/GrantOpportunityNotifications.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/IRPADGBSMeetingRoomMedia.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ReleaseReadiness.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/SignaturePathwaySelfTest.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/auth.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/authorizationWorkflow.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/data.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/documentLifecycle.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/documentTranslation.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/employeeRegistrationEmail.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/functions.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/liveInterpreter.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/meetingGatewayApi.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/messaging.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/procurement.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/registeredIdentityReconciliation.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signatureStorage.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signerIdentity.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/systemControl.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/workflowLinks.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaOperations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaStudio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationsConnectionsFunding.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationsSocialStudio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationsWebsiteStudio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/DocumentLifecycleModule.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ExternalAuditorPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GovernanceWorkspaces.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GrantIntelligencePortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/MeetingEntryGateway.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/MeetingRoom.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Meetings.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ProcurementPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ResearchStatisticsKnowledgePortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Settings.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/SignaturePlatform.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/SocialMediaAccounts.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Voting.jsx, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/data.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Voting.jsx but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ControlledDocumentUpload.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentTranslationWorkspace.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DonorFunderRelations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/FinanceAccountingEngine.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/FinanceDonorControlCockpit.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/FinanceTechnologyOperations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/MeetingAccessControl.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ResearchDataCollectionStudio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ResearchEvidenceExchange.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/ResearchInformationGovernance.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/procurement.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/AuditorsSpecialInvitees.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/AuthorizationWorkflow.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/BoardMembers.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/DocumentLifecycleModule.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/EmployeePayments.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Employees.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/FinancePortfolio.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GovernanceWorkspaces.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/InductionAdmin.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/InductionOrientation.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Invitations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/MeetingRoom.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Meetings.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Members.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/OperationalGatewaysParticipants.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ProcurementPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/ResearchStatisticsKnowledgePortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Resolutions.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Settings.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/SignaturePlatform.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Voting.jsx, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/auth.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/functions.js but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/main.jsx?v=20261030-offline-install-1, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/AddAdministratorPortal.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/AuditorsSpecialInvitees.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/BoardMembers.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Employees.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/InductionOrientation.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/InvitationActivation.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/Invitations.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/OperationalGatewaysParticipants.jsx, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentReader.jsx is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/PortalDocumentAccessPoint.jsx but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/DocumentLifecycleModule.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/GovernanceWorkspaces.jsx, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/node_modules/pdf-lib/es/index.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/pages/CommunicationMediaPortal.jsx but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/components/DocumentTranslationWorkspace.jsx, /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/signaturePlatform.js, dynamic import will not move module into another chunk.
[39m
[33m[plugin vite:reporter] 
(!) /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/invitationWorkflow.js is dynamically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/firebase/auth.js but also statically imported by /home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/src/App.jsx, dynamic import will not move module into another chunk.
[39m
computing gzip size...
[2mdist/[22m[32mindex.html                                            [39m[1m[2m    1.89 kB[22m[1m[22m[2m │ gzip:     0.91 kB[22m
[2mdist/[22m[2massets/[22m[32mpdf.worker.min-iDqQPrd3.mjs                    [39m[1m[2m1,232.30 kB[22m[1m[22m
[2mdist/[22m[2massets/[22m[32mpdf.worker-B1D2UnXD.mjs                        [39m[1m[2m2,161.15 kB[22m[1m[22m
[2mdist/[22m[2massets/[22m[35mindex-YGdapERl.css                             [39m[1m[2m  757.19 kB[22m[1m[22m[2m │ gzip:   104.95 kB[22m
[2mdist/[22m[2massets/[22m[36mDocumentLifecycleModule-spHKV_t8.js            [39m[1m[2m   77.74 kB[22m[1m[22m[2m │ gzip:    16.51 kB[22m[2m │ map:    101.22 kB[22m
[2mdist/[22m[2massets/[22m[36mGrantIntelligencePortal-CnQgO7dg.js            [39m[1m[2m  171.34 kB[22m[1m[22m[2m │ gzip:    32.27 kB[22m[2m │ map:    227.02 kB[22m
[2mdist/[22m[2massets/[22m[36mResearchStatisticsKnowledgePortal-DV50ZA52.js  [39m[1m[2m  235.74 kB[22m[1m[22m[2m │ gzip:    44.37 kB[22m[2m │ map:    397.45 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-nv57pjxL.js                              [39m[1m[33m8,073.62 kB[39m[22m[2m │ gzip: 1,697.29 kB[22m[2m │ map: 14,369.64 kB[22m
[32m✓ built in 11.78s[39m

## Create Drive file runtime result
[36mvite v7.3.6 [32mbuilding ssr environment for production...[36m[39m
transforming...
[32m✓[39m 4 modules transformed.
rendering chunks...
[2m../../../../../tmp/upload-cycle-runtime/bundle/[22m[36msignatureStorage.js  [39m[1m[2m28.90 kB[22m[1m[22m[2m │ map: 46.23 kB[22m
[32m✓ built in 109ms[39m
/tmp/upload-cycle-runtime/bundle/firebase-messaging-sw.js:2
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
^

ReferenceError: importScripts is not defined
    at Object.<anonymous> (/tmp/upload-cycle-runtime/bundle/firebase-messaging-sw.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at loadCJSModuleWithModuleLoad (node:internal/modules/esm/translators:335:3)
    at ModuleWrap.<anonymous> (node:internal/modules/esm/translators:235:7)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)

Node.js v22.23.4

## Workflow diagnostic console
[36mvite v7.3.6 [32mbuilding ssr environment for production...[36m[39m
transforming...
[32m✓[39m 4 modules transformed.
rendering chunks...
[2m../../../../../tmp/upload-cycle-runtime/bundle/[22m[36msignatureStorage.js  [39m[1m[2m28.90 kB[22m[1m[22m[2m │ map: 46.23 kB[22m
[32m✓ built in 109ms[39m
/tmp/upload-cycle-runtime/bundle/firebase-messaging-sw.js:2
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
^

ReferenceError: importScripts is not defined
    at Object.<anonymous> (/tmp/upload-cycle-runtime/bundle/firebase-messaging-sw.js:2:1)
    at Module._compile (node:internal/modules/cjs/loader:1781:14)
    at Object..js (node:internal/modules/cjs/loader:1913:10)
    at Module.load (node:internal/modules/cjs/loader:1505:32)
    at Function._load (node:internal/modules/cjs/loader:1309:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
    at loadCJSModuleWithModuleLoad (node:internal/modules/esm/translators:335:3)
    at ModuleWrap.<anonymous> (node:internal/modules/esm/translators:235:7)
    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)

Node.js v22.23.4

## Regression test output
TAP version 13
# Subtest: legacy envelope with no envelope or source metadata is allowed
ok 1 - legacy envelope with no envelope or source metadata is allowed
  ---
  duration_ms: 0.928457
  type: 'test'
  ...
# Subtest: matching envelope hash and size are accepted
ok 2 - matching envelope hash and size are accepted
  ---
  duration_ms: 0.106188
  type: 'test'
  ...
# Subtest: mismatching hash or size is blocked
ok 3 - mismatching hash or size is blocked
  ---
  duration_ms: 0.091496
  type: 'test'
  ...
# Subtest: source document values are fallback when envelope values are absent
ok 4 - source document values are fallback when envelope values are absent
  ---
  duration_ms: 0.104515
  type: 'test'
  ...
# Subtest: envelope values take precedence over source document values
ok 5 - envelope values take precedence over source document values
  ---
  duration_ms: 0.988505
  type: 'test'
  ...
# file:///home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/drive-gateway/src/signing.mjs:16
# export async function verifySourceDocumentIntegrity(bytes,envelope={},sourceDocument={}){const rawHash=envelope.sha256||envelope.documentHash||envelope.originalHash||sourceDocument.sha256||sourceDocument.hash||null;const rawSize=envelope.byteLength??envelope.documentSize??envelope.fileSize??sourceDocument.fileSize??sourceDocument.byteLength??sourceDocument.size??null;const expectedHash=rawHash==null||String(rawHash).trim()===""?null:String(rawHash).trim().toLowerCase();const expectedSize=rawSize==null||rawSize===""||!Number.isFinite(Number(rawSize))?null:Number(rawSize);if((expectedHash&&expectedHash!==await sha256Hex(bytes))||(expectedSize!=null&&expectedSize!==bytes.byteLength))throw new HttpError(409,"The document failed its integrity check.");return{expectedHash,expectedSize}}\\nasync function original(ctx,e){const d=await ctx.meta.get("documents",e.documentId),b=d&&await ctx.storage.get(d.primaryStorageId);if(!b)throw new HttpError(409,"The source document is unavailable.");await verifySourceDocumentIntegrity(b,e,d);return{doc:d,bytes:b}}
#                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ^
# SyntaxError: Invalid or unexpected token
#     at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
#     at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:110:18)
#     at \#translate (node:internal/modules/esm/loader:559:20)
#     at afterLoad (node:internal/modules/esm/loader:612:29)
#     at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:617:12)
#     at \#createModuleJob (node:internal/modules/esm/loader:640:36)
#     at \#getJobFromResolveResult (node:internal/modules/esm/loader:353:34)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:321:41)
# Node.js v22.23.4
# Subtest: tests/gateway-signing-integrity.test.mjs
not ok 2 - tests/gateway-signing-integrity.test.mjs
  ---
  duration_ms: 32.910416
  type: 'test'
  location: '/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/tests/gateway-signing-integrity.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# file:///home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/tests/upload-circular-import-runtime.test.mjs:63
#       assert.match(String(url), /\\\\/api\\\\/upload-controlled-document$/);
#                                 ^
# SyntaxError: Invalid regular expression flags
#     at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
#     at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:110:18)
#     at \#translate (node:internal/modules/esm/loader:559:20)
#     at afterLoad (node:internal/modules/esm/loader:612:29)
#     at ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:617:12)
#     at \#createModuleJob (node:internal/modules/esm/loader:640:36)
#     at \#getJobFromResolveResult (node:internal/modules/esm/loader:353:34)
#     at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:321:41)
#     at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:680:25)
# Node.js v22.23.4
# Subtest: tests/upload-circular-import-runtime.test.mjs
not ok 3 - tests/upload-circular-import-runtime.test.mjs
  ---
  duration_ms: 30.007021
  type: 'test'
  location: '/home/runner/work/IRPA-Digital-Board-Governance-System/IRPA-Digital-Board-Governance-System/tests/upload-circular-import-runtime.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..7
# tests 7
# suites 0
# pass 5
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 43.232179

## Madge exit code
0
