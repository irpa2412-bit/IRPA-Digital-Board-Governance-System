import React from"react";
import MeetingRoom from"./MeetingRoom";
import GovernanceWorkspaces from"./GovernanceWorkspaces";

export default function OperationalGateways({module}){
 if(module==="Meeting Room")return <MeetingRoom/>;
 return <GovernanceWorkspaces module={module}/>;
}
