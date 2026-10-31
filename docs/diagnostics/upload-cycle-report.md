# Upload initialization cycle diagnostic report

- Workflow run: https://github.com/irpa2412-bit/IRPA-Digital-Board-Governance-System/actions/runs/41235396563
- Commit: 4b90919ea8315dd6c89e58347b91d496c5c6be91
- Conclusion at report capture: failure

## GitHub Actions job summary

## Madge circular dependency output
- Finding files
Processed 156 files (1.6s) (3 warnings)

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
    "firebase/signatureStorage.js"
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
    "firebase/workflowLinks.js"
  ]
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
[32m✓[39m 1000 modules transformed.
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
[2mdist/[22m[2massets/[22m[36mDocumentLifecycleModule-CI9MrgVU.js            [39m[1m[2m   77.74 kB[22m[1m[22m[2m │ gzip:    16.51 kB[22m[2m │ map:    101.22 kB[22m
[2mdist/[22m[2massets/[22m[36mGrantIntelligencePortal-1Hh1pkL4.js            [39m[1m[2m  171.34 kB[22m[1m[22m[2m │ gzip:    32.27 kB[22m[2m │ map:    227.02 kB[22m
[2mdist/[22m[2massets/[22m[36mResearchStatisticsKnowledgePortal-BDmLjgpN.js  [39m[1m[2m  235.74 kB[22m[1m[22m[2m │ gzip:    44.37 kB[22m[2m │ map:    397.45 kB[22m
[2mdist/[22m[2massets/[22m[36mindex-CY3R4CZg.js                              [39m[1m[33m8,070.56 kB[39m[22m[2m │ gzip: 1,696.59 kB[22m[2m │ map: 14,364.51 kB[22m
[32m✓ built in 16.21s[39m

## Create Drive file runtime result
node:internal/modules/package_json_reader:314
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from /tmp/upload-cycle-runtime/run.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:314:9)
    at packageResolve (node:internal/modules/esm/resolve:772:81)
    at moduleResolve (node:internal/modules/esm/resolve:859:18)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v22.23.4

## Workflow diagnostic console
node:internal/modules/package_json_reader:314
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from /tmp/upload-cycle-runtime/run.mjs
    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:314:9)
    at packageResolve (node:internal/modules/esm/resolve:772:81)
    at moduleResolve (node:internal/modules/esm/resolve:859:18)
    at defaultResolve (node:internal/modules/esm/resolve:989:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20)
    at ModuleLoader.resolve (node:internal/modules/esm/loader:724:38)
    at ModuleLoader.getModuleJobForImport (node:internal/modules/esm/loader:320:38)
    at ModuleJob._link (node:internal/modules/esm/module_job:182:49) {
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v22.23.4
