import React, { useRef, useState } from "react";
import { auth } from "../firebase/config";
import { createRecord, COLLECTIONS } from "../firebase/data";
import { readWorkflowContext, withWorkflowLinks } from "../firebase/workflowLinks";
import { uploadBytes, ref } from "../firebase/signatureStorage";

export default function ControlledDocumentUpload({ purpose = "Controlled Document", onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  function chooseFile() {
    setError("");
    setMessage("Opening the PDF file selector…");
    fileInputRef.current?.click();
  }
