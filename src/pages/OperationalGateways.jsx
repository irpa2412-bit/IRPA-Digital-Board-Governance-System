import React from"react";
import MeetingRoom from"./MeetingRoom";
import FinancePortfolio from"./FinancePortfolio";
import GovernanceWorkspaces from"./GovernanceWorkspaces";

export default function OperationalGateways({module}){
 if(module==="Meeting Room")return <MeetingRoom/>;
 if(module==="Finance Portfolio")return <FinancePortfolio/>;
 return <GovernanceWorkspaces module={module}/>;
}
