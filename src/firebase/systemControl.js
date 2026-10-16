import { getFunctions, httpsCallable } from "firebase/functions";

const functions=getFunctions(undefined,"us-central1");

export const requestDataReset=async data=>(await httpsCallable(functions,"requestDataReset")(data)).data;
export const cancelDataReset=async data=>(await httpsCallable(functions,"cancelDataReset")(data)).data;
export const executeDataReset=async data=>(await httpsCallable(functions,"executeDataReset")(data)).data;
export const getDataResetStatus=async data=>(await httpsCallable(functions,"getDataResetStatus")(data)).data;

export const getActualDataAccessStatus=async()=>(await httpsCallable(functions,"getActualDataAccessStatus")({})).data;
export const setActualDataAccess=async data=>(await httpsCallable(functions,"setActualDataAccess")(data)).data;
