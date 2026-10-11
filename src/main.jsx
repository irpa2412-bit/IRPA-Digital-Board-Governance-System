import React,{Component,useState}from"react";
import ReactDOM from"react-dom/client";
import App from"./App";
import InvitationActivation from"./pages/InvitationActivation";import MeetingEntryGateway from"./pages/MeetingEntryGateway";
import { logout } from "./firebase/auth";
import "./styles/app.css";
import "./styles/mobile-viewport-containment.css";
import "./styles/tokens.css";
import "./styles/portal-typography.css";
 
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("IRPA offline application shell registration failed:", error);
    });
  });
}
