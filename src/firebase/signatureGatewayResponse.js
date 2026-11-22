export function assertGatewaySigningResponse(response,data){
  if(!response?.ok||data?.ok===false||data?.status==="CompletionFailed"){
    throw new Error(data?.error||"Gateway signing was recorded, but final PDF completion failed. Retry completion before treating this signature as complete.");
  }
  return data;
}
