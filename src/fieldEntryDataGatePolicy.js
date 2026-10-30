export function isFieldEntryConfirmationDisabled({dataType,environment,actualOnly,actualDataAccessLoading,actualDataAccessOpen,confirmed}) {
  return !dataType || !environment ||
    (environment === "ACTUAL" && (actualDataAccessLoading || !actualDataAccessOpen || !confirmed)) ||
    (actualOnly && environment !== "ACTUAL");
}

export function canConfirmFieldEntry({dataType,environment,actualOnly,actualDataAccessLoading,actualDataAccessOpen,confirmed}) {
  if (!dataType || !environment) return false;
  if (environment === "ACTUAL" && (actualDataAccessLoading || !actualDataAccessOpen || !confirmed)) return false;
  if (actualOnly && environment !== "ACTUAL") return false;
  return environment === "TRIAL" || environment === "ACTUAL";
}
